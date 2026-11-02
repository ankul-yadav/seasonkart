const test=require("node:test");
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {EventEmitter}=require("node:events");
const {matchesHmacSha256,parseRazorpayPaymentEvent,paymentAlreadyHandled}=require("../webhook-security");
const {deliverSupplierEvent,signatureFor,isPublicAddress}=require("../supplier-delivery");
const {validPricePair,taxMatchesCategory}=require("../product-rules");
const {calculateSupplierPayout,isPayoutEligible,isValidPayoutAdjustment,netPayoutAdjustments}=require("../payout-rules");
const {canSupplierTransition,canAdminTransition,canVerifyDelivery}=require("../order-rules");
const {assertSafeDemoSeed}=require("../scripts/seed-safety");
const {parseSchema,migrationFiles,requirements}=require("../scripts/schema-contract");
const {taxLines}=require("../extras");
const nodemailer=require("nodemailer");
const sharp=require("sharp");
const registerCatalog=require("../catalog");

test("Sharp is a production dependency because live photo uploads require image processing",()=>{
  const pkg=require("../package.json");
  assert.ok(pkg.dependencies.sharp);
  assert.equal(pkg.devDependencies?.sharp,undefined);
  assert.match(pkg.engines.node,/20\.9/);
});

function mockedHttps(status=204,chunks=[]){
  const calls=[];
  const requestImpl=(url,options,callback)=>{
    const request=new EventEmitter();
    request.setTimeout=()=>{};
    request.destroy=()=>{};
    request.end=body=>{
      calls.push({url:String(url),options,body});
      const response=new EventEmitter();
      response.statusCode=status;
      response.destroy=()=>{};
      callback(response);
      queueMicrotask(()=>{
        for(const chunk of chunks)response.emit("data",Buffer.from(chunk));
        response.emit("end");
      });
    };
    return request;
  };
  return{calls,requestImpl};
}

test("Razorpay HMAC accepts valid exact bytes and rejects missing, malformed, or modified signatures",()=>{
  const raw=Buffer.from('{"event":"payment.captured","payload":{"id":"pay_test"}}'),secret="test-only-secret";
  const signature=crypto.createHmac("sha256",secret).update(raw).digest("hex");
  assert.equal(matchesHmacSha256(raw,secret,signature),true);
  assert.equal(matchesHmacSha256(raw,secret,""),false);
  assert.equal(matchesHmacSha256(raw,secret,"abc"),false);
  assert.equal(matchesHmacSha256(Buffer.from(raw.toString()+" "),secret,signature),false);
});

test("payment webhook payload validation rejects unsupported and malformed events",()=>{
  const payment={id:"pay_test",order_id:"order_test",amount:100};
  assert.deepEqual(parseRazorpayPaymentEvent({event:"payment.captured",payload:{payment:{entity:payment}}}),payment);
  assert.equal(parseRazorpayPaymentEvent({event:"payment.failed",payload:{payment:{entity:payment}}}),null);
  assert.equal(parseRazorpayPaymentEvent({event:"order.paid",payload:{payment:{entity:{...payment,amount:"100"}}}}),null);
  assert.equal(paymentAlreadyHandled("paid"),true);
  assert.equal(paymentAlreadyHandled("pending"),false);
});

test("supplier callback is signed, uses stable idempotency headers and refuses non-HTTPS URLs",async()=>{
  const body={event:"order.created",event_id:"order:SK1:supplier:2:created"},secret="test-secret",mock=mockedHttps();
  const options={requestImpl:mock.requestImpl,lookup:async()=>[{address:"93.184.216.34",family:4}]};
  const result=await deliverSupplierEvent({url:"https://supplier.example/events",eventId:body.event_id,payload:body,secret,...options});
  assert.equal(result.ok,true);
  assert.equal(result.attempts,1);
  const raw=mock.calls[0].body;
  assert.equal(mock.calls[0].options.headers["X-SeasonKart-Signature"],signatureFor(raw,secret));
  assert.equal(mock.calls[0].options.headers["X-SeasonKart-Event-Id"],body.event_id);
  assert.equal(mock.calls[0].options.headers["Idempotency-Key"],body.event_id);
  const duplicate=await deliverSupplierEvent({url:"https://supplier.example/events",eventId:body.event_id,payload:body,secret,...options});
  assert.equal(duplicate.ok,true);
  assert.equal((await deliverSupplierEvent({url:"http://supplier.example",eventId:"evt",payload:{},secret})).reason,"unsafe_url");
  assert.equal((await deliverSupplierEvent({url:"https://127.0.0.1/secret",eventId:"evt",payload:{},secret})).reason,"unsafe_destination");
});

test("supplier callbacks retry transient errors with a limit but do not retry permanent responses",async()=>{
  const delays=[],statuses=[503,429,204],calls=[];
  const requestImpl=(url,options,callback)=>{
    const request=new EventEmitter();
    request.setTimeout=()=>{};
    request.destroy=()=>{};
    request.end=body=>{
      calls.push(body);
      const response=new EventEmitter();
      response.statusCode=statuses.shift();
      response.destroy=()=>{};
      callback(response);
      queueMicrotask(()=>response.emit("end"));
    };
    return request;
  };
  const ok=await deliverSupplierEvent({url:"https://supplier.example",eventId:"evt-1",payload:{},secret:"secret",requestImpl,lookup:async()=>[{address:"93.184.216.34",family:4}],sleep:async n=>delays.push(n),random:()=>0});
  assert.equal(ok.ok,true);
  assert.equal(ok.attempts,3);
  assert.deepEqual(delays,[125,250]);
  let attempts=0;
  const permanent=mockedHttps(400),permanentRequest=(...args)=>{attempts++;return permanent.requestImpl(...args)};
  const rejected=await deliverSupplierEvent({url:"https://supplier.example",eventId:"evt-2",payload:{},secret:"secret",requestImpl:permanentRequest,lookup:async()=>[{address:"93.184.216.34",family:4}],sleep:async()=>{}});
  assert.equal(rejected.reason,"http_400");
  assert.equal(attempts,1);
  const redirect=mockedHttps(302);
  const redirectResult=await deliverSupplierEvent({url:"https://supplier.example",eventId:"evt-3",payload:{},secret:"secret",requestImpl:redirect.requestImpl,lookup:async()=>[{address:"93.184.216.34",family:4}],sleep:async()=>{}});
  assert.equal(redirectResult.reason,"http_302");
  assert.equal(redirect.calls.length,1);
});

test("supplier callback timeout and size limits fail safely",async()=>{
  let attempts=0;
  const requestImpl=()=>{
    attempts++;
    const request=new EventEmitter();
    request.setTimeout=()=>{};
    request.end=()=>request.emit("error",Object.assign(new Error("timeout"),{code:"ETIMEDOUT"}));
    request.destroy=()=>{};
    return request;
  };
  const result=await deliverSupplierEvent({url:"https://supplier.example",eventId:"evt",payload:{},secret:"secret",maxAttempts:2,requestImpl,lookup:async()=>[{address:"93.184.216.34",family:4}],sleep:async()=>{}});
  assert.equal(result.reason,"ETIMEDOUT");
  assert.equal(attempts,2);
  const large=await deliverSupplierEvent({url:"https://supplier.example",eventId:"evt",payload:{data:"long"},secret:"secret",maxBodyBytes:2});
  assert.equal(large.reason,"body_too_large");
  const oversized=mockedHttps(200,["response too large"]);
  const response=await deliverSupplierEvent({url:"https://supplier.example",eventId:"evt",payload:{},secret:"secret",maxResponseBytes:2,requestImpl:oversized.requestImpl,lookup:async()=>[{address:"93.184.216.34",family:4}]});
  assert.equal(response.reason,"response_too_large");
});

test("supplier callback blocks private and mixed public/private DNS answers",async()=>{
  for(const address of ["0.0.0.0","10.0.0.1","100.64.0.1","127.0.0.1","169.254.1.1","172.16.0.1","192.168.1.1","224.0.0.1","::1","fc00::1","fe80::1","2001:db8::1"])assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress("93.184.216.34"),true);
  let calls=0;
  const result=await deliverSupplierEvent({url:"https://supplier.example/hook",eventId:"evt",payload:{},secret:"secret",lookup:async()=>[{address:"93.184.216.34",family:4},{address:"169.254.169.254",family:4}],requestImpl:()=>{calls++;throw new Error("must not connect")}});
  assert.equal(result.reason,"unsafe_destination");
  assert.equal(calls,0);
  const timedOut=await deliverSupplierEvent({url:"https://supplier.example",eventId:"evt-timeout",payload:{},secret:"secret",dnsTimeoutMs:5,lookup:()=>new Promise(()=>{}),maxAttempts:1});
  assert.equal(timedOut.reason,"ETIMEDOUT");
});

test("image upload processing emits resized WebP, thumbnail and JPEG fixtures without external services",async t=>{
  const uploadDir=fs.mkdtempSync(path.join(os.tmpdir(),"seasonkart-image-test-"));
  t.after(()=>fs.rmSync(uploadDir,{recursive:true,force:true}));
  const app={get(){},post(){},patch(){},delete(){},put(){}};
  const catalog=registerCatalog({app,db:{},h:fn=>fn,auth(){},UP:uploadDir});
  const buffer=await sharp({create:{width:1600,height:800,channels:3,background:"#2457d6"}}).png().toBuffer();
  const[image]=await catalog.prepAll([{buffer,mimetype:"image/png",originalname:"fixture.png"}]);
  const files=[image.url,image.thumb,image.share].map(url=>path.join(uploadDir,path.basename(url)));
  assert.ok(files.every(file=>fs.existsSync(file)));
  assert.equal((await sharp(files[0]).metadata()).format,"webp");
  assert.equal((await sharp(files[1]).metadata()).width,420);
  assert.equal((await sharp(files[2]).metadata()).format,"jpeg");
  catalog.rm(image);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.ok(files.every(file=>!fs.existsSync(file)));
});

test("email generation uses a memory-only transport and sends no real email",async()=>{
  const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:"unix"});
  const result=await transport.sendMail({from:"test@example.invalid",to:"recipient@example.invalid",subject:"SeasonKart test",text:"Local fixture only"});
  assert.ok(result.message.toString().includes("Local fixture only"));
  assert.equal(result.envelope.to[0],"recipient@example.invalid");
  transport.close();
});

test("product prices are finite, positive, and MRP is not below selling price",()=>{
  assert.equal(validPricePair(599,1299),true);
  assert.equal(validPricePair(1299,599),false);
  assert.equal(validPricePair(Infinity,Infinity),false);
  assert.equal(validPricePair(0,100),false);
  assert.equal(validPricePair(12.5,20),false);
});

test("configured category tax rules are enforced",()=>{
  const category={gst_rate:18,hsn:"8518"};
  assert.equal(taxMatchesCategory(category,18,"8518"),true);
  assert.equal(taxMatchesCategory(category,5,"8518"),false);
  assert.equal(taxMatchesCategory(category,18,"6110"),false);
  assert.equal(taxMatchesCategory({gst_rate:5,hsn:""},5,""),false);
});

test("invoices use explicit saved item and shipping tax values and refuse guessed values",()=>{
  const order={discount:0,total:599,state:"Maharashtra"};
  assert.equal(taxLines(order,[{name:"Fixture",price:599,qty:1,gst_rate:5,hsn:"6110"}])[0].rate,5);
  assert.throws(()=>taxLines(order,[{name:"Legacy fixture",price:599,qty:1}]),/Tax rate or HSN/);
});

test("supplier payout calculation allocates coupon discount and retains exactly 20% commission",()=>{
  assert.deepEqual(calculateSupplierPayout(1000,2000,200),{gross:1000,discount:100,base:900,commission:180,payable:720});
  assert.deepEqual(calculateSupplierPayout(0,0,500),{gross:0,discount:0,base:0,commission:0,payable:0});
  assert.throws(()=>calculateSupplierPayout(Infinity,1,0),/finite/);
});

test("payout eligibility waits seven days and requires verified COD remittance",()=>{
  const common={status:"Delivered",payment_method:"online",payment_status:"paid",delivered_at:"2026-10-01T00:00:00Z",now:"2026-10-08T00:00:00Z"};
  assert.equal(isPayoutEligible(common),true);
  assert.equal(isPayoutEligible({...common,now:"2026-10-07T23:59:59Z"}),false);
  assert.equal(isPayoutEligible({...common,payment_method:"cod",payment_status:"cod"}),false);
  assert.equal(isPayoutEligible({...common,payment_method:"cod",payment_status:"cod",cod_remitted_at:"2026-10-04"}),true);
  assert.equal(isPayoutEligible({...common,return_status:"requested"}),false);
  assert.equal(isPayoutEligible({...common,return_status:"approved"}),false);
  assert.equal(isPayoutEligible({...common,return_status:"refunded"}),false);
  assert.equal(isPayoutEligible({...common,return_status:"rejected"}),true);
  assert.equal(isPayoutEligible({...common,status:"Processing"}),false);
});

test("payout adjustments have explicit direction, cents precision, and bounded debit balances",()=>{
  assert.equal(isValidPayoutAdjustment({amount:1.15,direction:"debit",reason:"approved clawback",available:1.15}),true);
  assert.equal(isValidPayoutAdjustment({amount:1.155,direction:"debit",reason:"approved clawback",available:2}),false);
  assert.equal(isValidPayoutAdjustment({amount:2,direction:"debit",reason:"approved clawback",available:1}),false);
  assert.equal(isValidPayoutAdjustment({amount:2,direction:"credit",reason:"manual reconciliation",available:0}),true);
  assert.equal(netPayoutAdjustments([{direction:"debit",amount:25},{direction:"credit",amount:5}]),-20);
});

test("order rules prevent supplier delivery claims and backward transitions",()=>{
  assert.equal(canSupplierTransition("New","Accepted"),true);
  assert.equal(canSupplierTransition("Shipped","Processing"),false);
  assert.equal(canSupplierTransition("Processing","Delivered"),false);
  assert.equal(canSupplierTransition("Delivered","Shipped"),false);
  assert.equal(canAdminTransition("Processing","Shipped"),true);
  assert.equal(canAdminTransition("Delivered","Processing"),false);
  assert.equal(canVerifyDelivery("Shipped",false),true);
  assert.equal(canVerifyDelivery("Delivered",true),false);
});

test("demo seeding refuses production and requires explicit disposable-development opt-in",()=>{
  assert.throws(()=>assertSafeDemoSeed({NODE_ENV:"production",SEASONKART_ALLOW_DEMO_SEED:"1",DB_NAME:"seasonkart",DB_USER:"dev"}),/disabled/);
  assert.throws(()=>assertSafeDemoSeed({NODE_ENV:"development",SEASONKART_ALLOW_DEMO_SEED:"1",DB_NAME:"seasonkart_live",DB_USER:"dev"}),/production or live/);
  assert.equal(assertSafeDemoSeed({NODE_ENV:"development",SEASONKART_ALLOW_DEMO_SEED:"1",DB_NAME:"seasonkart_scratch",DB_USER:"dev"}),true);
});

test("fresh schema and migration contract include supplier payout, remittance, and foreign keys",()=>{
  const schema=parseSchema(),files=migrationFiles();
  assert.equal(files.length,23);
  assert.deepEqual(files.map(file=>file.number),Array.from({length:23},(_,i)=>i+1));
  assert.deepEqual(requirements(Infinity,true).contractErrors,[]);
  assert.ok(schema.get("supplier_payouts").columns.has("amount"));
  assert.ok(schema.get("orders").columns.has("cod_remitted_at"));
  assert.ok(schema.get("products").constraints.has("products_supplier_id_fk"));
  assert.ok(schema.get("order_items").constraints.has("order_items_order_id_fk"));
  assert.ok(schema.get("supplier_webhook_outbox").indexes.has("PRIMARY"));
  assert.ok(schema.get("order_status_audit").columns.has("evidence_reference"));
  assert.ok(schema.get("supplier_shipments").indexes.has("supplier_order_shipment_unique"));
  assert.ok(schema.get("supplier_payout_adjustments").columns.has("amount"));
  assert.ok(schema.get("supplier_payout_adjustments").columns.has("direction"));
});
