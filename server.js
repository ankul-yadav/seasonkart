require("dotenv").config();
const express=require("express"),mysql=require("mysql2/promise"),jwt=require("jsonwebtoken"),bcrypt=require("bcryptjs"),crypto=require("crypto"),Razorpay=require("razorpay"),helmet=require("helmet"),rateLimit=require("express-rate-limit"),multer=require("multer"),path=require("path"),fs=require("fs"),notify=require("./notify");
const {matchesHmacSha256,parseRazorpayPaymentEvent,paymentAlreadyHandled}=require("./webhook-security"),{validPricePair,taxMatchesCategory}=require("./product-rules");
const {deliverSupplierEvent}=require("./supplier-delivery");
const {calculateSupplierPayout,isValidPayoutAdjustment}=require("./payout-rules");
const {canSupplierTransition,canAdminTransition,canVerifyDelivery}=require("./order-rules");
const app=express(),PROD=process.env.NODE_ENV==="production",BASE=(process.env.BASE_URL||"").replace(/\/$/,"");
if((process.env.JWT_SECRET||"").length<32||/change-this/i.test(process.env.JWT_SECRET)){console.error("STOP: set JWT_SECRET in .env to a random string of 32+ characters (e.g. run: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\")");process.exit(1)}
if(process.env.ADMIN_PASSWORD&&process.env.ADMIN_PASSWORD.length<10)console.warn("WARNING: ADMIN_PASSWORD is short - use 10+ characters");
const WEBHOOK_TIMEOUT_MS=Number(process.env.WEBHOOK_TIMEOUT_MS||10000),WEBHOOK_BODY_LIMIT_BYTES=Number(process.env.WEBHOOK_BODY_LIMIT_BYTES||65536),WEBHOOK_RESPONSE_LIMIT_BYTES=Number(process.env.WEBHOOK_RESPONSE_LIMIT_BYTES||16384);
if(!Number.isInteger(WEBHOOK_TIMEOUT_MS)||WEBHOOK_TIMEOUT_MS<1000||WEBHOOK_TIMEOUT_MS>60000||!Number.isInteger(WEBHOOK_BODY_LIMIT_BYTES)||WEBHOOK_BODY_LIMIT_BYTES<1024||WEBHOOK_BODY_LIMIT_BYTES>102400||!Number.isInteger(WEBHOOK_RESPONSE_LIMIT_BYTES)||WEBHOOK_RESPONSE_LIMIT_BYTES<1024||WEBHOOK_RESPONSE_LIMIT_BYTES>65536){console.error("STOP: invalid webhook timeout or request/response body limit");process.exit(1)}
const RETURN_WINDOW_DAYS=Number(process.env.RETURN_DAYS===undefined?7:process.env.RETURN_DAYS);
if(!Number.isInteger(RETURN_WINDOW_DAYS)||RETURN_WINDOW_DAYS<0||RETURN_WINDOW_DAYS>60){console.error("STOP: RETURN_DAYS must be a whole number from 0 to 60");process.exit(1)}
const PAYOUT_WAIT_DAYS=Math.max(7,RETURN_WINDOW_DAYS);
if(process.env.TRUST_PROXY)app.set("trust proxy",isNaN(+process.env.TRUST_PROXY)?process.env.TRUST_PROXY:+process.env.TRUST_PROXY); // set 1 behind nginx/Render/Railway so rate limits see real IPs
if(process.env.FORCE_HTTPS==="1")app.use((q,s,n)=>q.secure?n():s.redirect(301,"https://"+q.headers.host+q.originalUrl));
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","'unsafe-inline'","https://*.razorpay.com"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:","https:"],fontSrc:["'self'","data:","https://*.razorpay.com"],connectSrc:["'self'","https://*.razorpay.com"],frameSrc:["https://*.razorpay.com"],objectSrc:["'none'"],baseUri:["'self'"],formAction:["'self'"],upgradeInsecureRequests:PROD?[]:null}}}));
app.use(["/api/payment/webhook","/api/courier/updates"],(q,s,n)=>{
 const length=q.headers["content-length"];
 if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)>WEBHOOK_BODY_LIMIT_BYTES))return s.status(413).json({error:"Webhook request body is too large"});
 const timer=setTimeout(()=>{
  if(!s.headersSent){s.status(408).end();q.destroy()}
 },WEBHOOK_TIMEOUT_MS);
 timer.unref();
 s.once("finish",()=>clearTimeout(timer));q.once("aborted",()=>clearTimeout(timer));
 n();
});
app.use(express.json({limit:"100kb",verify:(q,s,b)=>{
 if(["/api/payment/webhook","/api/courier/updates"].includes(q.path)&&b.length>WEBHOOK_BODY_LIMIT_BYTES){const e=new Error("Webhook body too large");e.status=413;throw e}
 q.raw=b;
}}));
const rl=(max,mins,msg,o={})=>rateLimit({windowMs:mins*60*1000,max,standardHeaders:true,legacyHeaders:false,message:{error:msg},...o});
const byEmail=p=>q=>p+String((q.body&&q.body.email)||"").toLowerCase().slice(0,120);
const loginLim=[rl(10,15,"Too many login attempts. Please try again in 15 minutes.",{skipSuccessfulRequests:true}),rl(6,15,"Too many login attempts for this account. Please try again in 15 minutes.",{skipSuccessfulRequests:true,keyGenerator:byEmail("l:")})];
app.use("/api",rl(600,15,"Too many requests. Please slow down.",{skip:q=>q.path==="/payment/webhook"||q.path==="/courier/updates"}));
const UP=process.env.UPLOAD_DIR?path.resolve(process.env.UPLOAD_DIR):path.join(__dirname,"public","uploads");fs.mkdirSync(UP,{recursive:true});
app.use("/uploads",express.static(UP,{setHeaders:res=>res.setHeader("Cache-Control","public, max-age=2592000, immutable")}));
app.use(express.static(path.join(__dirname,"public"),{index:false,setHeaders:(res,fp)=>{if(fp.includes(path.sep+"uploads"+path.sep))res.setHeader("Cache-Control","public, max-age=2592000, immutable")}}));
const db=mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME,waitForConnections:true,connectionLimit:10,queueLimit:0,connectTimeout:10000,enableKeepAlive:true,keepAliveInitialDelay:10000,maxIdle:10,idleTimeout:60000});
const N=notify(db);
const rz=process.env.RAZORPAY_KEY_ID?new Razorpay({key_id:process.env.RAZORPAY_KEY_ID,key_secret:process.env.RAZORPAY_KEY_SECRET}):null;
const safeErrorCode=e=>typeof e?.code==="string"&&/^[A-Z0-9_]{1,40}$/.test(e.code)?e.code:typeof e?.name==="string"&&/^[A-Za-z]+$/.test(e.name)?e.name:"application_error";
const h=fn=>(q,s)=>fn(q,s).catch(e=>{const safe=Object.assign(new Error("Request failed"),{code:safeErrorCode(e)});console.error("request failed:",q.method,q.path,safe.code);OPS.alert(safe,q.method+" "+q.path);s.status(500).json({error:"Server error"})});
const tok=q=>(q.headers.authorization||"").replace("Bearer ","");
const auth=(q,s,n)=>{try{const v=jwt.verify(tok(q),process.env.JWT_SECRET);if(v.role!=="admin")throw 0;q.authAdminId=Number.isInteger(+v.id)?+v.id:null;n()}catch{s.status(401).json({error:"Login required"})}};
const cauth=(q,s,n)=>{try{const v=jwt.verify(tok(q),process.env.JWT_SECRET);if(v.role!=="customer")throw 0;q.cid=v.id;n()}catch{s.status(401).json({error:"Please log in"})}};
const X=require("./extras")({app,db,h,rl,auth,cauth,jwt,tok});
const C=require("./courier")({app,db,h,rl,auth,N,E:process.env});
const K=require("./catalog")({app,db,h,auth,UP});
const ST=require("./store")({app,db,h,auth});
const SEO=require("./seo")({app,db,h,rl,E:process.env,PROD,BASE});
const O=require("./otp")({app,db,h,rl,cauth,jwt,N,E:process.env,BASE});
const OPS=require("./ops")({app,db,auth,h,rl,N,E:process.env,BASE});
if(PROD){if(BASE&&!/^https:/.test(BASE))console.warn("WARNING: BASE_URL should start with https:// in production");if(process.env.DB_USER==="root")console.warn("WARNING: the app connects to MySQL as root - create a limited database user (see DEPLOY.md)")}
const SZ="CONCAT_WS(' / ',NULLIF(size,''),NULLIF(color,''))";

// ---------- public ----------
app.get("/api/products",h(async(q,s)=>{const[r]=await db.query("SELECT p.id,p.supplier_id,p.name n,p.category c,p.price p,p.mrp m,p.rating r,p.review_count rc,p.emoji e,p.image i,IFNULL((SELECT thumb FROM product_images WHERE product_id=p.id ORDER BY position,id LIMIT 1),p.image) t,(SELECT GROUP_CONCAT(CONCAT(url,'~',thumb) ORDER BY position,id SEPARATOR '|') FROM product_images WHERE product_id=p.id) ims,IF(EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1),(SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id=p.id AND v.active=1),p.stock) st,(SELECT GROUP_CONCAT(CONCAT_WS('~',v.id,v.size,v.color,v.stock,IFNULL(v.price,''),IFNULL(v.mrp,'')) ORDER BY v.id SEPARATOR '|') FROM product_variants v WHERE v.product_id=p.id AND v.active=1) vs,p.description d,p.sku sku,p.brand b,p.specs sp,p.origin og,p.maker mk,p.opt1 o1,p.opt2 o2,p.ret_days rd,p.cod_ok cod,p.pkg_l pl,p.pkg_b pb,p.pkg_h pht,p.gst_rate g,p.hsn hs,p.weight_g wg,IFNULL(s.name,'') s FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.active=1 ORDER BY p.id");s.json(r.map(x=>({...x,r:x.rc?+x.r:0,st:+x.st,ims:x.ims?x.ims.split('|').map(z=>{const[u,t]=z.split('~');return{u,t}}):[],vs:x.vs?x.vs.split('|').map(z=>{const[id,sz,c,st,vp,vm]=z.split('~');return{id:+id,s:sz,c:c||'',st:+st,p:+vp||0,m:+vm||0}}):[]})))}));

async function applyCoupon(conn,code,sub,phone){
 code=String(code||"").trim().toUpperCase();if(!code)return{discount:0};
 const[[c]]=await conn.query("SELECT * FROM coupons WHERE code=? AND active=1",[code]);
 if(!c)return{error:"Invalid coupon code"};
 if(c.expires_at&&new Date(c.expires_at)<new Date())return{error:"This coupon has expired"};
 if(sub<c.min_order)return{error:"Add items worth Rs."+(c.min_order-sub)+" more to use this coupon (minimum order Rs."+c.min_order+")"};
 if(c.usage_limit!=null&&c.uses>=c.usage_limit)return{error:"This coupon has been fully claimed"};
 if(c.one_per_phone&&/^\d{10}$/.test(phone||"")){const[[u]]=await conn.query("SELECT COUNT(*) n FROM orders WHERE coupon_code=? AND phone=? AND status<>'Cancelled'",[c.code,phone]);if(u.n)return{error:"You have already used this coupon"}}
 let d=c.type==="percent"?Math.floor(sub*c.value/100):c.value;if(c.max_discount)d=Math.min(d,c.max_discount);
 return{discount:Math.max(0,Math.min(d,sub)),code:c.code,id:c.id}}
const cartSub=async items=>{if(!Array.isArray(items)||!items.length)return 0;
 const[rows]=await db.query("SELECT id,price FROM products WHERE active=1 AND id IN (?)",[items.map(i=>+i.id)]),vids=items.map(i=>+i.vid).filter(Boolean),[vr]=vids.length?await db.query("SELECT id,product_id,price FROM product_variants WHERE active=1 AND id IN (?)",[vids]):[[]];
 return items.reduce((a,i)=>{const p=rows.find(r=>r.id==i.id);if(!p)return a;const v=vr.find(z=>z.id==i.vid&&z.product_id===p.id);return a+((v&&v.price)||p.price)*Math.min(Math.max(+i.qty||1,1),20)},0)};
app.post("/api/coupon/check",rl(30,15,"Too many coupon attempts. Please wait a few minutes."),h(async(q,s)=>{
 const sub=await cartSub(q.body.items);if(!sub)return s.status(400).json({error:"Your cart is empty"});
 const r=await applyCoupon(db,q.body.code,sub,String(q.body.phone||""));if(r.error)return s.status(400).json({error:r.error});
 if(!r.code)return s.status(400).json({error:"Enter a coupon code"});s.json({code:r.code,discount:r.discount})}));
app.post("/api/checkout",rl(20,60,"Too many orders from this network. Please try again later."),h(async(q,s)=>{
 const{name,phone,method,items}=q.body,email=String(q.body.email||"").trim().toLowerCase().slice(0,120);
 if(email&&!/^\S+@\S+\.\S+$/.test(email))return s.status(400).json({error:"Enter a valid email or leave it blank"});
 let cid=null;try{const v=jwt.verify(tok(q),process.env.JWT_SECRET);if(v.role==="customer")cid=v.id}catch{}
 const ck=X.chkAddr({name,phone,line:q.body.line,city:q.body.city,state:q.body.state,pincode:q.body.pincode});if(ck.error)return s.status(400).json({error:ck.error});
 if(!Array.isArray(items)||!items.length)return s.status(400).json({error:"Your cart is empty"});
 const A=ck.a,address=`${A.line}, ${A.city}, ${A.state} - ${A.pincode}`;
 const pc=await C.checkPin(A.pincode);if(!pc.serviceable)return s.status(400).json({error:"Sorry, we do not deliver to pincode "+A.pincode+" yet."});
 if(method!=="online"&&!pc.cod)return s.status(400).json({error:"Cash on delivery is not available for this pincode. Please choose online payment."});
 let otpId=null;if(method!=="online"&&O.enabled&&!(await O.trusted(cid))){const ot=await O.check(q.body.otp,A.phone);if(ot.error)return s.status(400).json({error:ot.error,need:"otp"});otpId=ot.id}
 const[rows]=await db.query("SELECT * FROM products WHERE active=1 AND id IN (?)",[items.map(i=>+i.id)]);
 const pids=[...new Set(items.map(i=>+i.id))],[hv]=await db.query("SELECT DISTINCT product_id FROM product_variants WHERE active=1 AND product_id IN (?)",[pids]),hasV=new Set(hv.map(x=>x.product_id));
 const vids=items.map(i=>+i.vid).filter(Boolean),[vr]=vids.length?await db.query("SELECT * FROM product_variants WHERE active=1 AND id IN (?)",[vids]):[[]];
 let sub=0;const lines=[];
 const categoryCache=new Map();
 for(const i of items){const p=rows.find(r=>r.id==i.id);if(!p)continue;const qty=Math.min(Math.max(+i.qty||1,1),20);let v=null;
  if(!validPricePair(Number(p.price),Number(p.mrp)))return s.status(400).json({error:"A product price is invalid; please contact the store"});
  if(!categoryCache.has(p.category))categoryCache.set(p.category,await ST.catInfo(p.category));
  if(!taxMatchesCategory(categoryCache.get(p.category),Number(p.gst_rate),String(p.hsn||"")))return s.status(400).json({error:"A product's tax category is not configured correctly; please contact the store"});
  if(hasV.has(p.id)){v=vr.find(z=>z.id==i.vid&&z.product_id===p.id);if(!v)return s.status(400).json({error:"Please choose a size"+(p.name?" for "+p.name:"")+" (an item in your cart is no longer available in that size - remove it and add it again)"})}
  if(v&&!validPricePair(v.price==null?Number(p.price):Number(v.price),v.mrp==null?Number(p.mrp):Number(v.mrp)))return s.status(400).json({error:"A selected variant has invalid prices; please contact the store"});
  const unit=(v&&v.price)||p.price;sub+=unit*qty;lines.push({p,qty,v,unit,size:v?v.size:"",color:v?v.color:""})}
 if(!lines.length)return s.status(400).json({error:"Cart has no valid items"});
 const cp=await applyCoupon(db,q.body.coupon,sub,phone);if(cp.error)return s.status(400).json({error:cp.error});
 const total=sub-cp.discount+(sub<999?60:0),online=method==="online"&&total>0;if(online&&!rz)return s.status(400).json({error:"Online payment is not set up yet"});
 if(!online){const nb=lines.find(l=>l.p.cod_ok===0);if(nb)return s.status(400).json({error:"Cash on delivery is not available for "+nb.p.name+". Please choose online payment."});const mx=parseInt(process.env.COD_MAX)||0;if(mx&&total>mx)return s.status(400).json({error:"Cash on delivery is available only for orders up to Rs."+mx+". Please choose online payment."})}
 const code="SK"+Date.now().toString().slice(-7),c=await db.getConnection();
 let oos=null;
try{await c.beginTransaction();
  const needP={},needV={};lines.forEach(l=>{if(l.v)needV[l.v.id]=(needV[l.v.id]||0)+l.qty;else needP[l.p.id]=(needP[l.p.id]||0)+l.qty});
  for(const id in needV){const[u]=await c.query("UPDATE product_variants SET stock=stock-? WHERE id=? AND active=1 AND stock>=?",[needV[id],id,needV[id]]);if(!u.affectedRows){const l=lines.find(z=>z.v&&z.v.id==id);oos=l.p.name+" ("+[l.size,l.color].filter(Boolean).join(" / ")+")";throw new Error("out of stock")}}
  for(const id in needP){const[u]=await c.query("UPDATE products SET stock=stock-? WHERE id=? AND stock>=?",[needP[id],id,needP[id]]);if(!u.affectedRows){oos=lines.find(l=>l.p.id==id).p.name;throw new Error("out of stock")}}
  if(otpId){const[ou]=await c.query("UPDATE otps SET used=1 WHERE id=? AND verified=1 AND used=0",[otpId]);if(!ou.affectedRows){oos="__otp";throw new Error("otp")}}
  if(cp.id){const[cu]=await c.query("UPDATE coupons SET uses=uses+1 WHERE id=? AND (usage_limit IS NULL OR uses<usage_limit)",[cp.id]);if(!cu.affectedRows){oos="__coupon";throw new Error("coupon")}}
  const gstSnapshot=lines.map(l=>({product_id:l.p.id,name:l.p.name,price:l.unit,qty:l.qty,size:[l.size,l.color].filter(Boolean).join(" / "),gst_rate:Number(l.p.gst_rate),hsn:String(l.p.hsn||"")}));
  const[r]=await c.query("INSERT INTO orders(code,customer_name,phone,email,customer_id,coupon_code,discount,address,state,city,pincode,total,payment_method,payment_status,gst_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[code,A.name,A.phone,email||null,cid,cp.code||null,cp.discount,address,A.state,A.city,A.pincode,total,online?"online":"cod",online?"pending":"cod",JSON.stringify(gstSnapshot)]);
  await c.query("INSERT INTO order_items(order_id,product_id,variant_id,name,price,qty,size,color,supplier_id,gst_rate,hsn,ret_days) VALUES ?",[lines.map(l=>[r.insertId,l.p.id,l.v?l.v.id:null,l.p.name,l.unit,l.qty,l.size,l.color,l.p.supplier_id,l.p.gst_rate,l.p.hsn,l.p.ret_days])]);
  if(!online)await enqueueSupplierEvents(c,r.insertId,code,"order.created");
  await c.commit()}catch(e){await c.rollback();if(oos==="__otp")return s.status(400).json({error:"This OTP was already used. Please verify again.",need:"otp"});if(oos==="__coupon")return s.status(400).json({error:"This coupon has just been fully claimed"});if(oos)return s.status(400).json({error:oos+" is out of stock or has fewer units than you selected"});throw e}finally{c.release()}
 if(!online){void processSupplierWebhookQueue();N.orderPlaced(code);return s.json({code})}
 const o=await rz.orders.create({amount:total*100,currency:"INR",receipt:code});
 await db.query("UPDATE orders SET rz_order_id=? WHERE code=?",[o.id,code]);
 s.json({code,rz:o,key:process.env.RAZORPAY_KEY_ID});
}));

app.post("/api/payment/verify",h(async(q,s)=>{
 const{code,razorpay_order_id:o,razorpay_payment_id:p,razorpay_signature:g}=q.body;
 const[[ord]]=await db.query("SELECT id FROM orders WHERE code=? AND rz_order_id=?",[code,o]);
 if(!ord)return s.status(404).json({error:"Order not found"});
 if(!matchesHmacSha256(Buffer.from(o+"|"+p),process.env.RAZORPAY_KEY_SECRET,g))return s.status(400).json({error:"Payment verification failed"});
 const r=await markPaid(ord,p);if(r==="cancelled")return s.status(409).json({error:"This order timed out before payment completed. Your money will be refunded automatically - please place the order again."});s.json({ok:true});
}));

// Sends each supplier their part of the order (webhook if api_url is set)
// ---------- payments, cancellation, refunds ----------
async function refundOrder(code){ // returns true if refund was issued
 const[[o]]=await db.query("SELECT id,total,rz_payment_id,payment_status FROM orders WHERE code=?",[code]);
 if(!o||o.payment_status==="refunded")return true;
 if(!rz||!o.rz_payment_id){await db.query("UPDATE orders SET payment_status='refund_pending' WHERE id=?",[o.id]);return false}
 try{const r=await rz.payments.refund(o.rz_payment_id,{amount:o.total*100,speed:"normal",notes:{order:code}});
  await db.query("UPDATE orders SET payment_status='refunded',refund_id=? WHERE id=?",[r.id,o.id]);return true}
 catch(e){console.error("refund failed",code,safeErrorCode(e));await db.query("UPDATE orders SET payment_status='refund_pending' WHERE id=?",[o.id]);return false}}
async function markPaid(ord,payId){
 const conn=await db.getConnection();let code=null,notify=false,cancelled=false;
 try{
  await conn.beginTransaction();
  const[[o]]=await conn.query("SELECT id,code,status,payment_status FROM orders WHERE id=? FOR UPDATE",[ord.id]);
  if(!o){await conn.rollback();return "missing"}
  code=o.code;
  if(paymentAlreadyHandled(o.payment_status)){await conn.commit();return "ok"}
  if(o.status==="Cancelled"){
   await conn.query("UPDATE orders SET payment_status='paid',rz_payment_id=? WHERE id=?",[payId,o.id]);
   cancelled=true;
  }else{
   const[u]=await conn.query("UPDATE orders SET payment_status='paid',rz_payment_id=? WHERE id=? AND payment_status='pending'",[payId,o.id]);
   if(u.affectedRows){await enqueueSupplierEvents(conn,o.id,o.code,"order.created");notify=true}
  }
  await conn.commit();
 }catch(error){await conn.rollback();throw error}finally{conn.release()}
 if(cancelled){await refundOrder(code);return "cancelled"}
 if(notify){void processSupplierWebhookQueue();N.orderPlaced(code)}
 return "ok"}
app.post("/api/payment/webhook",h(async(q,s)=>{
 const sec=process.env.RAZORPAY_WEBHOOK_SECRET;if(!sec)return s.status(503).end();
 if(!matchesHmacSha256(q.raw,sec,String(q.headers["x-razorpay-signature"]||"")))return s.status(401).end();
 const pay=parseRazorpayPaymentEvent(q.body);
 if(!pay)return s.status(400).json({error:"Unsupported or malformed payment event"});
 const[[o]]=await db.query("SELECT id,total FROM orders WHERE rz_order_id=?",[pay.order_id]);
 if(o&&o.total*100!==pay.amount)return s.status(400).json({error:"Payment amount does not match the order"});
 if(o)await markPaid(o,pay.id);
 s.json({ok:1})}));
async function cancelOrder(code,reason,actorRole="admin",actorId=null){
 const c=await db.getConnection();let o=null;
 try{await c.beginTransaction();
  const[[row]]=await c.query("SELECT * FROM orders WHERE code=? FOR UPDATE",[code]);o=row;
  if(!o){await c.rollback();return{error:"Order not found",status:404}}
  if(o.status!=="Processing"){await c.rollback();return{error:o.status==="Cancelled"?"This order is already cancelled":"This order is already "+o.status.toLowerCase()+" and can no longer be cancelled",status:400}}
  const[it]=await c.query("SELECT product_id,variant_id,qty FROM order_items WHERE order_id=?",[o.id]);
  for(const i of it)i.variant_id?await c.query("UPDATE product_variants SET stock=stock+? WHERE id=?",[i.qty,i.variant_id]):await c.query("UPDATE products SET stock=stock+? WHERE id=?",[i.qty,i.product_id]);
  if(o.coupon_code)await c.query("UPDATE coupons SET uses=GREATEST(uses-1,0) WHERE code=?",[o.coupon_code]);
  const paid=o.payment_status==="paid";
  await c.query("UPDATE orders SET status='Cancelled',cancel_reason=?,cancelled_at=NOW(),payment_status=? WHERE id=?",[String(reason||"Cancelled").slice(0,200),paid?"paid":"cancelled",o.id]);
  await c.query("INSERT INTO order_status_audit(order_id,order_code,from_status,to_status,actor_role,actor_id,source) VALUES(?,?,?,?,?,?,?)",[o.id,o.code,o.status,"Cancelled",actorRole,actorId,actorRole==="system"?"unpaid_timeout":"cancel"]);
  if(o.payment_method==="cod"||paid)await enqueueSupplierEvents(c,o.id,o.code,"order.cancelled");
  await c.commit()}catch(e){await c.rollback();throw e}finally{c.release()}
 void processSupplierWebhookQueue();
 if(o.sr_order_id)C.srCancel(o.sr_order_id);
 const real=o.payment_method==="cod"||o.payment_status==="paid",online=o.payment_method==="online"&&o.payment_status==="paid";
 let refunded=false;if(online)refunded=await refundOrder(code);
 if(real){N.orderCancelled(code,online)}
 return{ok:true,refunded}}
let supplierWebhookQueueRunning=false;
async function processSupplierWebhookQueue(){
 if(supplierWebhookQueueRunning)return;
 supplierWebhookQueueRunning=true;
 try{
  const[events]=await db.query("SELECT event_id,supplier_id,order_code,event_type,endpoint_url,payload_json,attempts FROM supplier_webhook_outbox WHERE status='pending' AND next_attempt_at<=NOW() AND (locked_until IS NULL OR locked_until<NOW()) AND attempts<8 ORDER BY created_at LIMIT 10");
  for(const event of events){
   const lockSeconds=Math.ceil(WEBHOOK_TIMEOUT_MS*Math.min(4,8-Number(event.attempts))/1000)+30;
   const[claim]=await db.query("UPDATE supplier_webhook_outbox SET locked_until=DATE_ADD(NOW(),INTERVAL ? SECOND) WHERE event_id=? AND status='pending' AND next_attempt_at<=NOW() AND (locked_until IS NULL OR locked_until<NOW())",[lockSeconds,event.event_id]);
   if(!claim.affectedRows)continue;
   let payload;
   try{payload=JSON.parse(event.payload_json)}catch{
    await db.query("UPDATE supplier_webhook_outbox SET status='failed',last_error='invalid_payload',locked_until=NULL WHERE event_id=?",[event.event_id]);
    continue;
   }
   const remaining=Math.max(1,8-Number(event.attempts));
   const result=await deliverSupplierEvent({url:event.endpoint_url,eventId:event.event_id,payload,secret:process.env.SUPPLIER_WEBHOOK_SECRET,timeoutMs:WEBHOOK_TIMEOUT_MS,maxBodyBytes:WEBHOOK_BODY_LIMIT_BYTES,maxResponseBytes:WEBHOOK_RESPONSE_LIMIT_BYTES,maxAttempts:Math.min(4,remaining)});
   const attempts=Number(event.attempts)+result.attempts,retry=result.retryable&&attempts<8;
   const backoff=Math.min(900,15*2**Math.min(attempts,6)),delay=Math.ceil(backoff*(0.5+Math.random()));
   await db.query("UPDATE supplier_webhook_outbox SET status=?,attempts=?,last_error=?,next_attempt_at=IF(?='pending',DATE_ADD(NOW(),INTERVAL ? SECOND),next_attempt_at),sent_at=IF(?='sent',NOW(),sent_at),locked_until=NULL WHERE event_id=? AND status='pending'",[result.ok?"sent":retry?"pending":"failed",attempts,result.ok?null:result.reason,retry?"pending":result.ok?"sent":"failed",delay,result.ok?"sent":"failed",event.event_id]);
   if(!result.ok)console.error("supplier webhook delivery failed:",event.event_id,result.reason);
  }
 }catch(error){console.error("supplier webhook queue failed:",error.code||"database_error")}
 finally{supplierWebhookQueueRunning=false}
}
setInterval(processSupplierWebhookQueue,10000).unref();
async function enqueueSupplierEvents(conn,orderId,orderCode,eventType){
 const[rows]=await conn.query(`SELECT oi.supplier_id,sp.api_url,o.customer_name,o.phone,o.address,oi.name,oi.qty,CONCAT_WS(' / ',NULLIF(oi.size,''),NULLIF(oi.color,'')) size
 FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN suppliers sp ON sp.id=oi.supplier_id
 WHERE oi.order_id=? AND sp.api_url IS NOT NULL AND sp.api_url<>'' ORDER BY oi.supplier_id,oi.id`,[orderId]);
 const groups=new Map();
 for(const row of rows){
  if(!groups.has(row.supplier_id))groups.set(row.supplier_id,{url:row.api_url,customer:row.customer_name,phone:row.phone,address:row.address,items:[]});
  groups.get(row.supplier_id).items.push({name:row.name,qty:row.qty,size:row.size});
 }
 for(const[supplierId,group]of groups){
  const eventId=`order:${orderCode}:supplier:${supplierId}:${eventType==="order.cancelled"?"cancelled":"created"}`;
  const payload=eventType==="order.cancelled"?{order:orderCode,cancelled:true}:{order:orderCode,customer:group.customer,phone:group.phone,address:group.address,items:group.items};
  await conn.query("INSERT IGNORE INTO supplier_webhook_outbox(event_id,supplier_id,order_code,event_type,endpoint_url,payload_json) VALUES(?,?,?,?,?,?)",[eventId,supplierId,orderCode,eventType,group.url,JSON.stringify({...payload,event:eventType,event_id:eventId})]);
 }
}
// unpaid online orders: release stock after UNPAID_MINUTES (default 30)
setInterval(async()=>{try{const[r]=await db.query("SELECT code FROM orders WHERE payment_method='online' AND payment_status='pending' AND status='Processing' AND created_at<NOW()-INTERVAL ? MINUTE LIMIT 50",[parseInt(process.env.UNPAID_MINUTES)||30]);
 for(const x of r)await cancelOrder(x.code,"Payment not completed in time","system")}catch(e){console.error("cleanup:",safeErrorCode(e))}},10*60*1000);

// ---------- customer accounts & tracking ----------
const mk=c=>jwt.sign({id:c.id,role:"customer"},process.env.JWT_SECRET,{expiresIn:"30d"});
const pub=c=>({id:c.id,name:c.name,email:c.email,phone:c.phone,verified:!!c.email_verified});
const withItems=async rows=>{
 if(!rows.length)return[];
 const ids=rows.map(r=>r.id),[items]=await db.query("SELECT order_id,name,qty,"+SZ+" size,price,ret_days FROM order_items WHERE order_id IN (?)",[ids]),[shipments]=await db.query("SELECT ss.order_id,ss.supplier_id,sp.name supplier,ss.courier_name,ss.awb,ss.tracking_url,ss.status,ss.created_at FROM supplier_shipments ss JOIN suppliers sp ON sp.id=ss.supplier_id WHERE ss.order_id IN (?) ORDER BY ss.order_id,ss.id",[ids]);
 return rows.map(({id,...o})=>{const its=items.filter(i=>i.order_id===id),rw=its.some(i=>i.ret_days===0)?0:Math.min(RDAYS,...its.map(i=>i.ret_days==null?RDAYS:i.ret_days));return{...o,ret_window:rw,items:its.map(({ret_days,...x})=>x),shipments:shipments.filter(x=>x.order_id===id).map(({order_id,...x})=>x)}});
};
const OCOLS="id,code,total,status,payment_method,payment_status,created_at,cancel_reason,return_status,return_reason,delivered_at,coupon_code,discount,courier_name,awb,tracking_url,ship_status";
const RDAYS=parseInt(process.env.RETURN_DAYS)||7;
app.post("/api/customer/register",rl(10,60,"Too many sign-ups from this network. Try again later."),h(async(q,s)=>{const{name,phone,password}=q.body,email=String(q.body.email||"").trim().toLowerCase();
 if(!name||!/^\S+@\S+\.\S+$/.test(email)||!/^\d{10}$/.test(phone||"")||(password||"").length<8)return s.status(400).json({error:"Enter name, valid email, 10-digit phone and a password of 8+ characters"});
 const[[ex]]=await db.query("SELECT id FROM customers WHERE email=?",[email]);if(ex)return s.status(400).json({error:"This email is already registered. Please log in."});
 const[r]=await db.query("INSERT INTO customers(name,email,phone,password_hash) VALUES(?,?,?,?)",[name.trim().slice(0,80),email,phone,await bcrypt.hash(password,10)]);
 const c={id:r.insertId,name:name.trim().slice(0,80),email,phone};O.sendVerify(c);s.json({token:mk(c),user:pub(c)})}));
const sha=x=>crypto.createHash("sha256").update(x).digest("hex");
app.get("/api/config",(q,s)=>{const e=process.env;s.json({name:e.STORE_NAME||"SeasonKart",email:e.STORE_EMAIL||"",phone:e.STORE_PHONE||"",address:e.STORE_ADDRESS||"",gstin:e.STORE_GSTIN||"",officer:e.GRIEVANCE_OFFICER||"",returnDays:parseInt(e.RETURN_DAYS)||7,shipDays:e.SHIP_DAYS||"5-9",freeShipAbove:999,shipFee:60,states:X.STATES,courier:C.on,codOtp:O.enabled,codMax:parseInt(process.env.COD_MAX)||0})});
app.post("/api/customer/forgot",rl(8,60,"Too many reset requests. Please try again later."),rl(3,60,"A reset link was already requested for this email. Check your inbox or try again in an hour.",{keyGenerator:byEmail("f:")}),h(async(q,s)=>{
 const[[c]]=await db.query("SELECT id,name,email FROM customers WHERE email=?",[String(q.body.email||"").trim().toLowerCase()]);
 if(c){const t=crypto.randomBytes(32).toString("hex");
  await db.query("UPDATE customers SET reset_hash=?,reset_expires=DATE_ADD(NOW(),INTERVAL 1 HOUR) WHERE id=?",[sha(t),c.id]);
  if(!BASE)console.error("Set BASE_URL in .env - password reset links cannot be created without it");else N.passwordReset(c.email,c.name,BASE+"/#reset-"+t)}
 s.json({ok:1})})); // same answer whether or not the email exists
app.post("/api/customer/reset",rl(10,60,"Too many attempts. Please try again later."),h(async(q,s)=>{const{token,password}=q.body;
 if(!/^[a-f0-9]{64}$/.test(token||"")||(password||"").length<8)return s.status(400).json({error:"Password must be at least 8 characters"});
 const[u]=await db.query("UPDATE customers SET password_hash=?,reset_hash=NULL,reset_expires=NULL WHERE reset_hash=? AND reset_expires>NOW()",[await bcrypt.hash(password,10),sha(token)]);
 if(!u.affectedRows)return s.status(400).json({error:"This reset link is invalid or has expired. Please request a new one."});s.json({ok:1})}));
app.post("/api/customer/login",loginLim,h(async(q,s)=>{const[[c]]=await db.query("SELECT * FROM customers WHERE email=?",[String(q.body.email||"").trim().toLowerCase()]);
 if(!c||!(await bcrypt.compare(q.body.password||"",c.password_hash)))return s.status(400).json({error:"Wrong email or password"});
 s.json({token:mk(c),user:pub(c)})}));
app.get("/api/customer/me",cauth,h(async(q,s)=>{const[[c]]=await db.query("SELECT * FROM customers WHERE id=?",[q.cid]);if(!c)return s.status(401).json({error:"Please log in"});s.json(pub(c))}));
app.get("/api/customer/orders",cauth,h(async(q,s)=>{const[r]=await db.query(`SELECT ${OCOLS} FROM orders WHERE customer_id=? ORDER BY id DESC LIMIT 100`,[q.cid]);s.json(await withItems(r))}));
app.post("/api/customer/orders/:code/cancel",cauth,h(async(q,s)=>{const[[o]]=await db.query("SELECT id FROM orders WHERE code=? AND customer_id=?",[q.params.code,q.cid]);
 if(!o)return s.status(404).json({error:"Order not found"});const r=await cancelOrder(q.params.code,"Cancelled by customer","customer",q.cid);if(r.error)return s.status(r.status).json({error:r.error});s.json(r)}));
app.post("/api/customer/orders/:code/return",cauth,h(async(q,s)=>{const reason=String(q.body.reason||"").trim();if(reason.length<5)return s.status(400).json({error:"Please tell us why you want to return (a few words)"});
 const[[o]]=await db.query("SELECT id,delivered_at FROM orders WHERE code=? AND customer_id=? AND status='Delivered' AND return_status IS NULL",[q.params.code,q.cid]);
 if(!o)return s.status(400).json({error:"A return can be requested once, for a delivered order"});
 const[it]=await db.query("SELECT ret_days FROM order_items WHERE order_id=?",[o.id]);
 if(it.some(i=>i.ret_days===0))return s.status(400).json({error:"Some items in this order cannot be returned. If an item is damaged or wrong, please contact us."});
 const win=Math.min(RDAYS,...it.map(i=>i.ret_days==null?RDAYS:i.ret_days));
 if(!o.delivered_at||Date.now()-new Date(o.delivered_at).getTime()>win*864e5)return s.status(400).json({error:"Returns are accepted only within "+win+" days of delivery"});
 const[updated]=await db.query("UPDATE orders SET return_status='requested',return_reason=? WHERE id=? AND return_status IS NULL",[reason.slice(0,300),o.id]);
 if(!updated.affectedRows)return s.status(409).json({error:"A return request has already been recorded"});
 N.admin("Return requested - "+q.params.code,"Order "+q.params.code+"\nReason: "+reason);s.json({ok:1})}));
app.post("/api/track",rl(30,15,"Too many tracking attempts. Please wait a few minutes."),h(async(q,s)=>{const[r]=await db.query(`SELECT ${OCOLS} FROM orders WHERE code=? AND phone=?`,[String(q.body.code||"").trim().toUpperCase(),String(q.body.phone||"").trim()]);
 if(!r.length)return s.status(404).json({error:"No order found with this ID and phone number"});s.json((await withItems(r))[0])}));

// ---------- reviews ----------
const refreshRating=async pid=>{const[[a]]=await db.query("SELECT COUNT(*) n,IFNULL(AVG(stars),0) v FROM reviews WHERE product_id=?",[pid]);await db.query("UPDATE products SET rating=?,review_count=? WHERE id=?",[Math.round(a.v*10)/10,a.n,pid])};
const bought=async(cid,pid)=>{const[[x]]=await db.query("SELECT 1 f FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.customer_id=? AND oi.product_id=? AND o.status='Delivered' AND (o.return_status IS NULL OR o.return_status<>'refunded') LIMIT 1",[cid,pid]);return !!x};
app.get("/api/products/:id/reviews",h(async(q,s)=>{
 let cid=null;try{const v=jwt.verify(tok(q),process.env.JWT_SECRET);if(v.role==="customer")cid=v.id}catch{}
 const[list]=await db.query("SELECT r.id,r.stars,r.body,r.created_at,SUBSTRING_INDEX(c.name,' ',1) name,r.customer_id=? mine FROM reviews r JOIN customers c ON c.id=r.customer_id WHERE r.product_id=? ORDER BY r.id DESC LIMIT 50",[cid||0,q.params.id]);
 const mine=list.find(r=>r.mine);s.json({list:list.map(({mine,...r})=>r),can:cid?await bought(cid,q.params.id):false,mine:mine?{stars:mine.stars,body:mine.body}:null})}));
app.post("/api/products/:id/reviews",cauth,rl(20,60,"Too many reviews. Please try later."),h(async(q,s)=>{
 const stars=parseInt(q.body.stars),body=String(q.body.body||"").trim().slice(0,1000);
 if(!(stars>=1&&stars<=5))return s.status(400).json({error:"Choose 1 to 5 stars"});
 if(!(await bought(q.cid,q.params.id)))return s.status(403).json({error:"Only customers who received this product can review it"});
 await db.query("INSERT INTO reviews(product_id,customer_id,stars,body) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE stars=VALUES(stars),body=VALUES(body)",[q.params.id,q.cid,stars,body]);
 await refreshRating(q.params.id);s.json({ok:1})}));

// ---------- supplier portal (kept separate from admin auth) ----------
const sauth=(q,s,n)=>{
 try{
  const v=jwt.verify(tok(q),process.env.JWT_SECRET);
  if(v.role!=="supplier"||!Number.isInteger(+v.id)||+v.id<1)throw 0;
  q.sid=+v.id;
  db.query("SELECT active FROM suppliers WHERE id=?",[q.sid]).then(([[supplier]])=>{
   if(!supplier||!supplier.active)return s.status(401).json({error:"Supplier account inactive"});
   n();
  }).catch(error=>{const safe=Object.assign(new Error("Supplier authorization unavailable"),{code:safeErrorCode(error)});console.error("supplier authorization lookup failed:",safe.code);OPS.alert(safe,"supplier authorization");s.status(500).json({error:"Supplier authorization unavailable"})});
 }catch{s.status(401).json({error:"Supplier login required"})}
};
app.post("/api/supplier/login",loginLim,h(async(q,s)=>{
 const email=String(q.body.email||"").trim().toLowerCase();
 const[[sp]]=await db.query("SELECT id,name,email,password_hash,active FROM suppliers WHERE email=? LIMIT 1",[email]);
 if(!sp||!sp.active||!sp.password_hash||!(await bcrypt.compare(String(q.body.password||""),sp.password_hash)))return s.status(401).json({error:"Wrong login details or supplier account is inactive"});
 s.json({token:jwt.sign({id:sp.id,role:"supplier"},process.env.JWT_SECRET,{expiresIn:"12h"}),supplier:{id:sp.id,name:sp.name,email:sp.email}});
}));
app.get("/api/supplier/me",sauth,h(async(q,s)=>{const[[sp]]=await db.query("SELECT id,name,email,category,location,payout_method,payout_upi_id,payout_account_name,payout_account_number,payout_ifsc,payout_bank_name,payout_updated_at FROM suppliers WHERE id=? AND active=1",[q.sid]);if(!sp)return s.status(401).json({error:"Supplier account inactive"});s.json(sp)}));
// Supplier can save/update their own payout destination. Never expose password hashes.
app.put("/api/supplier/payout-details",sauth,h(async(q,s)=>{
 const method=String(q.body.method||"").trim();
 const upi=String(q.body.upi_id||"").trim().slice(0,120);
 const holder=String(q.body.account_name||"").trim().slice(0,120);
 const account=String(q.body.account_number||"").replace(/\s/g,"").slice(0,40);
 const ifsc=String(q.body.ifsc||"").trim().toUpperCase().slice(0,11);
 const bank=String(q.body.bank_name||"").trim().slice(0,120);
 if(method==="upi"&&!/^[\w.\-]{2,100}@[\w]{2,50}$/.test(upi))return s.status(400).json({error:"Enter a valid UPI ID, e.g. name@bank"});
 if(method==="bank"&&(!holder||account.length<6||account.length>40||!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)||!bank))return s.status(400).json({error:"Enter account holder, account number, bank name and valid IFSC"});
 if(!["upi","bank"].includes(method))return s.status(400).json({error:"Choose UPI or bank transfer"});
 await db.query("UPDATE suppliers SET payout_method=?,payout_upi_id=?,payout_account_name=?,payout_account_number=?,payout_ifsc=?,payout_bank_name=?,payout_updated_at=NOW() WHERE id=?",[method,method==="upi"?upi:null,method==="bank"?holder:null,method==="bank"?account:null,method==="bank"?ifsc:null,method==="bank"?bank:null,q.sid]);
 s.json({ok:1,message:"Payout details saved"});
}));
app.get("/api/supplier/orders",sauth,h(async(q,s)=>{
 const[rows]=await db.query(`SELECT o.id order_pk,o.code,o.created_at,o.status order_status,o.payment_method,o.payment_status,o.customer_name,o.phone,o.address,oi.id item_id,oi.name item_name,oi.qty,oi.price,oi.size,oi.color,oi.supplier_status
 FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.supplier_id=? AND o.status<>'Cancelled' AND (o.payment_method='cod' OR o.payment_status='paid') ORDER BY o.id DESC,oi.id`,[q.sid]);
 const out=[];for(const r of rows){let o=out[out.length-1];if(!o||o.code!==r.code){o={code:r.code,created_at:r.created_at,order_status:r.order_status,payment_method:r.payment_method,payment_status:r.payment_status,customer_name:r.customer_name,phone:r.phone,address:r.address,items:[]};out.push(o)}o.items.push({id:r.item_id,name:r.item_name,qty:r.qty,price:r.price,size:r.size,color:r.color,status:r.supplier_status})}s.json(out);
}));
app.patch("/api/supplier/items/:id/status",sauth,h(async(q,s)=>{
 const status=String(q.body.status||"");if(!["Accepted","Processing","Shipped"].includes(status))return s.status(400).json({error:"Suppliers may accept, process, or ship items. Delivery must be verified by an administrator."});
 const conn=await db.getConnection();let orderCode=null,nextOrderStatus=null;
 try{await conn.beginTransaction();
  const[[item]]=await conn.query("SELECT oi.order_id,oi.supplier_status item_status,o.code,o.status,o.payment_method,o.payment_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=? AND oi.supplier_id=? FOR UPDATE",[q.params.id,q.sid]);
  if(!item){await conn.rollback();return s.status(404).json({error:"Order item not found"})}
  if(item.payment_method==="online"&&item.payment_status!=="paid"){await conn.rollback();return s.status(403).json({error:"Order fulfillment is unavailable until online payment is verified"})}
  if(item.status==="Cancelled"||item.status==="Delivered"){await conn.rollback();return s.status(400).json({error:"Cancelled or delivered orders cannot be changed"})}
  if(!canSupplierTransition(item.item_status,status)){await conn.rollback();return s.status(400).json({error:"Supplier item status cannot move backwards, mark delivery, or use an invalid state"})}
  if(status===item.item_status){await conn.commit();return s.json({ok:1,status,order_status:item.status})}
  await conn.query("UPDATE order_items SET supplier_status=? WHERE id=? AND supplier_id=?",[status,q.params.id,q.sid]);
  await conn.query("INSERT INTO order_status_audit(order_id,order_code,from_status,to_status,actor_role,actor_id,source) VALUES(?,?,?,?,? ,?,'supplier_item')",[item.order_id,item.code,item.item_status,status,"supplier",q.sid]);
  const[[agg]]=await conn.query("SELECT COUNT(*) total,SUM(supplier_status='Shipped') shipped FROM order_items WHERE order_id=?",[item.order_id]);
  if(+agg.shipped>0&&item.status==="Processing"){
   nextOrderStatus="Shipped";
   await conn.query("UPDATE orders SET status='Shipped' WHERE id=? AND status='Processing'",[item.order_id]);
   await conn.query("INSERT INTO order_status_audit(order_id,order_code,from_status,to_status,actor_role,actor_id,source) VALUES(?,?,?,'Shipped','supplier',?,'supplier_shipment')",[item.order_id,item.code,item.status,q.sid]);
  }
  orderCode=item.code;await conn.commit();
 }catch(e){await conn.rollback();throw e}finally{conn.release()}
 if(nextOrderStatus)N.statusChanged(orderCode,nextOrderStatus);s.json({ok:1,status,order_status:nextOrderStatus});
}));
app.post("/api/supplier/orders/:code/tracking",sauth,h(async(q,s)=>{
 const courier=String(q.body.courier||"").trim().slice(0,60),awb=String(q.body.awb||"").trim().slice(0,40),trackingUrl=String(q.body.url||"").trim().slice(0,1000);
 if(!courier||!/^[A-Za-z0-9-]{4,40}$/.test(awb))return s.status(400).json({error:"Enter courier name and a valid tracking/AWB number"});
 if(trackingUrl){try{const u=new URL(trackingUrl);if(u.protocol!=="https:"||u.username||u.password)return s.status(400).json({error:"Tracking URL must be a public HTTPS link"})}catch{return s.status(400).json({error:"Tracking URL must be a public HTTPS link"})}}
 const conn=await db.getConnection();let orderId=null,changed=false;
 try{
 await conn.beginTransaction();
 const[[order]]=await conn.query("SELECT id,status,payment_method,payment_status FROM orders WHERE code=? FOR UPDATE",[q.params.code]);
 if(!order){await conn.rollback();return s.status(404).json({error:"Order not found"})}
 if(order.status==="Cancelled"||order.status==="Delivered"){await conn.rollback();return s.status(400).json({error:"Cancelled or delivered orders cannot be shipped"})}
 if(order.payment_method==="online"&&order.payment_status!=="paid"){await conn.rollback();return s.status(403).json({error:"Shipment tracking is unavailable until online payment is verified"})}
 const[[items]]=await conn.query("SELECT COUNT(*) total FROM order_items WHERE order_id=? AND supplier_id=?",[order.id,q.sid]);
 if(!Number(items.total)){await conn.rollback();return s.status(404).json({error:"Order not found for this supplier"})}
 const[insert]=await conn.query("INSERT INTO supplier_shipments(order_id,supplier_id,courier_name,awb,tracking_url) VALUES(?,?,?,?,?)",[order.id,q.sid,courier,awb,trackingUrl||null]);
 await conn.query("UPDATE order_items SET supplier_status='Shipped' WHERE order_id=? AND supplier_id=? AND supplier_status<>'Delivered'",[order.id,q.sid]);
 if(order.status==="Processing"){
  await conn.query("UPDATE orders SET status='Shipped' WHERE id=? AND status='Processing'",[order.id]);
  await conn.query("INSERT INTO order_status_audit(order_id,order_code,from_status,to_status,actor_role,actor_id,source) VALUES(?,?,?,'Shipped','supplier',?,'supplier_shipment')",[order.id,q.params.code,order.status,q.sid]);
  changed=true;
 }
 orderId=insert.insertId;
 await conn.commit();
 }catch(error){await conn.rollback();if(error.code==="ER_DUP_ENTRY")return s.status(409).json({error:"A supplier shipment is already recorded for this order"});throw error}finally{conn.release()}
 if(changed)N.statusChanged(q.params.code,"Shipped");
 s.status(201).json({ok:1,shipment_id:orderId,message:"Supplier shipment tracking saved"});
}));
app.get("/api/supplier/orders/:code/shipments",sauth,h(async(q,s)=>{
 const[rows]=await db.query("SELECT ss.id,ss.order_id,ss.courier_name,ss.awb,ss.tracking_url,ss.status,ss.created_at FROM supplier_shipments ss JOIN order_items oi ON oi.order_id=ss.order_id AND oi.supplier_id=ss.supplier_id JOIN orders o ON o.id=ss.order_id WHERE ss.supplier_id=? AND o.code=? AND (o.payment_method='cod' OR o.payment_status='paid') GROUP BY ss.id",[q.sid,q.params.code]);
 if(!rows.length)return s.status(404).json({error:"No shipment found for this supplier order"});
 s.json(rows);
}));
app.get("/api/supplier/orders.csv",sauth,h(async(q,s)=>{
 const[rows]=await db.query(`SELECT o.code,o.created_at,o.status order_status,o.payment_method,o.payment_status,o.customer_name,o.phone,o.address,oi.name item_name,oi.qty,oi.price,oi.size,oi.color,oi.supplier_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.supplier_id=? AND o.status<>'Cancelled' AND (o.payment_method='cod' OR o.payment_status='paid') ORDER BY o.id DESC,oi.id`,[q.sid]);
 const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const lines=[['Order','Created','Order status','Payment method','Payment status','Customer','Phone','Delivery address','Product','Qty','Unit price','Size','Colour','Supplier item status'].map(cell).join(','),...rows.map(r=>[r.code,r.created_at,r.order_status,r.payment_method,r.payment_status,r.customer_name,r.phone,r.address,r.item_name,r.qty,r.price,r.size,r.color,r.supplier_status].map(cell).join(','))];
 s.setHeader('Content-Type','text/csv; charset=utf-8');s.setHeader('Content-Disposition','attachment; filename="seasonkart-supplier-orders.csv"');s.send('\ufeff'+lines.join('\r\n'));
}));
app.get("/api/supplier/payouts",sauth,h(async(q,s)=>{const[r]=await db.query("SELECT p.id,p.order_id,o.code order_code,p.amount,p.status,p.payment_reference,p.notes,p.created_at,p.paid_at,COALESCE((SELECT SUM(CASE WHEN a.direction='debit' THEN -a.amount ELSE a.amount END) FROM supplier_payout_adjustments a WHERE a.payout_id=p.id),0) adjustment_amount FROM supplier_payouts p JOIN orders o ON o.id=p.order_id WHERE p.supplier_id=? ORDER BY p.id DESC LIMIT 300",[q.sid]);s.json(r)}));
// New payout basis: item value less proportional order coupon discount; delivery is excluded.
// Existing ledger amounts (especially paid rows) are never recalculated or overwritten.
app.get("/api/admin/supplier-payouts",auth,h(async(q,s)=>{
 const[eligible]=await db.query(`SELECT sp.id supplier_id,sp.name supplier_name,sp.payout_method,sp.payout_upi_id,sp.payout_account_name,sp.payout_account_number,sp.payout_ifsc,sp.payout_bank_name,sp.payout_updated_at,o.id order_id,o.code order_code,o.delivered_at,o.cod_remitted_at,o.cod_remittance_reference,
 ROUND(SUM(oi.price*oi.qty),2) gross_amount,
 ROUND(LEAST(SUM(oi.price*oi.qty),IFNULL(o.discount,0)*SUM(oi.price*oi.qty)/NULLIF((SELECT SUM(oi2.price*oi2.qty) FROM order_items oi2 WHERE oi2.order_id=o.id),0)),2) discount_share,
 ROUND(GREATEST(0,SUM(oi.price*oi.qty)-LEAST(SUM(oi.price*oi.qty),IFNULL(o.discount,0)*SUM(oi.price*oi.qty)/NULLIF((SELECT SUM(oi2.price*oi2.qty) FROM order_items oi2 WHERE oi2.order_id=o.id),0))),2) commission_base,
 ROUND(GREATEST(0,SUM(oi.price*oi.qty)-LEAST(SUM(oi.price*oi.qty),IFNULL(o.discount,0)*SUM(oi.price*oi.qty)/NULLIF((SELECT SUM(oi2.price*oi2.qty) FROM order_items oi2 WHERE oi2.order_id=o.id),0)))*0.20,2) commission_amount,
 COALESCE(MAX(p.amount),ROUND(GREATEST(0,SUM(oi.price*oi.qty)-LEAST(SUM(oi.price*oi.qty),IFNULL(o.discount,0)*SUM(oi.price*oi.qty)/NULLIF((SELECT SUM(oi2.price*oi2.qty) FROM order_items oi2 WHERE oi2.order_id=o.id),0)))*0.80,2)) amount,
 MAX(p.status) payout_status,MAX(p.id) payout_id,COALESCE(MAX(adj.adjustment_amount),0) adjustment_amount
 FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN suppliers sp ON sp.id=oi.supplier_id
 LEFT JOIN supplier_payouts p ON p.supplier_id=sp.id AND p.order_id=o.id
 LEFT JOIN (SELECT payout_id,SUM(CASE WHEN direction='debit' THEN -amount ELSE amount END) adjustment_amount FROM supplier_payout_adjustments GROUP BY payout_id) adj ON adj.payout_id=p.id
 WHERE o.status='Delivered' AND o.delivery_verified_at IS NOT NULL AND o.payment_status IN ('paid','cod') AND o.payment_method IN ('online','cod') AND (o.return_status IS NULL OR o.return_status='rejected')
 AND (o.payment_method<>'cod' OR o.cod_remitted_at IS NOT NULL)
 GROUP BY sp.id,sp.name,sp.payout_method,sp.payout_upi_id,sp.payout_account_name,sp.payout_account_number,sp.payout_ifsc,sp.payout_bank_name,sp.payout_updated_at,o.id,o.code,o.delivered_at,o.cod_remitted_at,o.cod_remittance_reference,o.discount
 HAVING o.delivered_at IS NOT NULL AND DATE_ADD(o.delivered_at,INTERVAL MAX(GREATEST(COALESCE(oi.ret_days,?),?)) DAY)<=NOW() ORDER BY o.id DESC LIMIT 1000`,[PAYOUT_WAIT_DAYS,PAYOUT_WAIT_DAYS]);
 s.json(eligible.map(x=>({...x,gross_amount:+x.gross_amount,discount_share:+x.discount_share,commission_base:+x.commission_base,commission_amount:+x.commission_amount,amount:+x.amount,payout_id:x.payout_id?+x.payout_id:null})));
}));
app.post("/api/admin/orders/:code/cod-remittance",auth,h(async(q,s)=>{
 const reference=String(q.body.reference||"").trim().slice(0,120);
 if(!/^[A-Za-z0-9._/-]{4,120}$/.test(reference))return s.status(400).json({error:"Enter the verified courier remittance reference"});
 const conn=await db.getConnection();
 try{
  await conn.beginTransaction();
  const[[order]]=await conn.query("SELECT id,code FROM orders WHERE code=? AND status='Delivered' AND delivery_verified_at IS NOT NULL AND payment_method='cod' AND payment_status='cod' AND cod_remitted_at IS NULL FOR UPDATE",[q.params.code]);
  if(!order){await conn.rollback();return s.status(400).json({error:"Only admin-verified delivered COD orders without a prior remittance record can be reconciled"})}
  await conn.query("UPDATE orders SET cod_remitted_at=NOW(),cod_remittance_reference=?,cod_remitted_by=? WHERE id=? AND cod_remitted_at IS NULL",[reference,q.authAdminId,order.id]);
  await conn.query("INSERT INTO cod_remittance_audit(order_id,order_code,actor_id,reference) VALUES(?,?,?,?)",[order.id,order.code,q.authAdminId,reference]);
  await conn.commit();
 }catch(error){await conn.rollback();throw error}finally{conn.release()}
 s.json({ok:1,message:"Courier remittance recorded; supplier payout eligibility still waits for the return window"});
}));
app.get("/api/admin/cod-remittances",auth,h(async(q,s)=>{
 const[rows]=await db.query("SELECT id,code,total,delivered_at,delivery_reference FROM orders WHERE status='Delivered' AND delivery_verified_at IS NOT NULL AND payment_method='cod' AND payment_status='cod' AND cod_remitted_at IS NULL ORDER BY delivered_at DESC LIMIT 300");
 s.json(rows);
}));
app.post("/api/admin/orders/:code/verify-delivery",auth,h(async(q,s)=>{
 const reference=String(q.body.reference||"").trim().slice(0,120);
 if(!/^[A-Za-z0-9._/-]{4,120}$/.test(reference))return s.status(400).json({error:"Enter a verified courier delivery reference"});
 const conn=await db.getConnection();
 try{
  await conn.beginTransaction();
  const[[order]]=await conn.query("SELECT id,code,status,delivery_verified_at FROM orders WHERE code=? FOR UPDATE",[q.params.code]);
  if(!order){await conn.rollback();return s.status(404).json({error:"Order not found"})}
  if(!canVerifyDelivery(order.status,!!order.delivery_verified_at)){await conn.rollback();return s.status(409).json({error:"Only unverified shipped or previously delivered orders can be verified"})}
  const previous=order.status;
  await conn.query("UPDATE orders SET status='Delivered',delivered_at=COALESCE(delivered_at,NOW()),delivery_verified_at=NOW(),delivery_verified_by=?,delivery_reference=? WHERE id=?",[q.authAdminId,reference,order.id]);
  await conn.query("UPDATE order_items SET supplier_status='Delivered' WHERE order_id=?",[order.id]);
  await conn.query("INSERT INTO order_status_audit(order_id,order_code,from_status,to_status,actor_role,actor_id,source,evidence_reference) VALUES(?,?,?,'Delivered','admin',?,'admin_delivery_verification',?)",[order.id,order.code,previous,q.authAdminId,reference]);
  await conn.commit();
 }catch(error){await conn.rollback();throw error}finally{conn.release()}
 N.statusChanged(q.params.code,"Delivered");
 s.json({ok:1,message:"Delivery evidence recorded and order marked delivered"});
}));
app.post("/api/admin/supplier-payouts",auth,h(async(q,s)=>{
 const orderId=Number(q.body.order_id),supplierId=Number(q.body.supplier_id);if(!Number.isInteger(orderId)||!Number.isInteger(supplierId))return s.status(400).json({error:"Invalid order or supplier"});
 const conn=await db.getConnection();let payout=null,row=null;
 try{
  await conn.beginTransaction();
  const[[locked]]=await conn.query("SELECT id FROM orders WHERE id=? FOR UPDATE",[orderId]);
  if(!locked){await conn.rollback();return s.status(404).json({error:"Order not found"})}
  const[[r]]=await conn.query(`SELECT o.id,o.code,o.status,o.payment_status,o.payment_method,o.cod_remitted_at,o.delivered_at,o.return_status,
 SUM(oi.price*oi.qty) gross_amount,IFNULL(o.discount,0) order_discount,
 (SELECT SUM(oi2.price*oi2.qty) FROM order_items oi2 WHERE oi2.order_id=o.id) order_gross
 FROM orders o JOIN order_items oi ON oi.order_id=o.id AND oi.supplier_id=? WHERE o.id=? AND (o.payment_method<>'cod' OR o.cod_remitted_at IS NOT NULL) AND (o.return_status IS NULL OR o.return_status='rejected')
 GROUP BY o.id,o.code,o.status,o.payment_status,o.payment_method,o.cod_remitted_at,o.delivered_at,o.discount,o.return_status
 HAVING o.status='Delivered' AND o.delivery_verified_at IS NOT NULL AND o.payment_status IN ('paid','cod') AND o.delivered_at IS NOT NULL AND DATE_ADD(o.delivered_at,INTERVAL MAX(GREATEST(COALESCE(oi.ret_days,?),?)) DAY)<=NOW()`,[supplierId,orderId,PAYOUT_WAIT_DAYS,PAYOUT_WAIT_DAYS]);
  if(!r){await conn.rollback();return s.status(400).json({error:`Payout requires verified delivery, payment, no open return, expiry of the ${PAYOUT_WAIT_DAYS}-day return window, and courier remittance for COD`})}
  row=r;
  payout=calculateSupplierPayout(Number(r.gross_amount)||0,Number(r.order_gross)||0,Number(r.order_discount)||0);
  const notes=`Commission 20%; supplier share 80%. Gross items ₹${payout.gross.toFixed(2)}, coupon discount allocation ₹${payout.discount.toFixed(2)}, commission base ₹${payout.base.toFixed(2)}. Delivery excluded.`;
  const[insert]=await conn.query("INSERT INTO supplier_payouts(supplier_id,order_id,amount,status,notes) VALUES(?,?,?,'pending',?)",[supplierId,orderId,payout.payable,notes]);
  await conn.query("INSERT INTO supplier_payout_audit(payout_id,supplier_id,order_id,action,actor_id,notes) VALUES(?,?,?,'created',?,?)",[insert.insertId,supplierId,orderId,q.authAdminId,notes]);
  await conn.commit();
 }catch(error){await conn.rollback();if(error.code==="ER_DUP_ENTRY")return s.status(409).json({error:"This order is already in the payout ledger"});throw error}finally{conn.release()}
 s.status(201).json({ok:1,amount:payout.payable,gross_amount:payout.gross,discount_share:payout.discount,commission_amount:payout.commission,order_code:row.code});
}));
app.patch("/api/admin/supplier-payouts/:id/paid",auth,h(async(q,s)=>{
 const ref=String(q.body.reference||'').trim().slice(0,120),notes=String(q.body.notes||'').trim().slice(0,500);if(!ref)return s.status(400).json({error:"Enter bank/UPI transaction reference after you have actually paid"});
 const conn=await db.getConnection();
 try{
  await conn.beginTransaction();
  const[[payout]]=await conn.query("SELECT id,supplier_id,order_id FROM supplier_payouts WHERE id=? AND status='pending' FOR UPDATE",[q.params.id]);
  if(!payout){await conn.rollback();return s.status(404).json({error:"Pending payout not found"})}
  await conn.query("UPDATE supplier_payouts SET status='paid',payment_reference=?,notes=?,paid_at=NOW() WHERE id=? AND status='pending'",[ref,notes||null,payout.id]);
  await conn.query("INSERT INTO supplier_payout_audit(payout_id,supplier_id,order_id,action,actor_id,payment_reference,notes) VALUES(?,?,?,'paid',?,?,?)",[payout.id,payout.supplier_id,payout.order_id,q.authAdminId,ref,notes||null]);
  await conn.commit();
 }catch(error){await conn.rollback();throw error}finally{conn.release()}
 s.json({ok:1});
}));
app.post("/api/admin/supplier-payouts/:id/adjustments",auth,h(async(q,s)=>{
 const amount=Number(q.body.amount),direction=String(q.body.direction||""),reason=String(q.body.reason||"").trim().slice(0,500),reference=String(q.body.reference||"").trim().slice(0,120)||null;
 const cents=Math.round(amount*100);
 if(!isValidPayoutAdjustment({amount,direction,reason,available:Infinity}))return s.status(400).json({error:"Enter a positive adjustment amount with at most two decimal places, choose debit or credit, and provide a clear reason"});
 const conn=await db.getConnection();
 try{
  await conn.beginTransaction();
  const[[payout]]=await conn.query("SELECT id,supplier_id,order_id,amount,status FROM supplier_payouts WHERE id=? FOR UPDATE",[q.params.id]);
  if(!payout){await conn.rollback();return s.status(404).json({error:"Payout not found"})}
  if(payout.status!=="paid"){await conn.rollback();return s.status(400).json({error:"Only a paid payout can receive a post-payment adjustment"})}
  const[[prior]]=await conn.query("SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN -amount ELSE amount END),0) net FROM supplier_payout_adjustments WHERE payout_id=?",[payout.id]);
  const available=Math.max(0,Number(payout.amount)+Number(prior.net));
  if(!isValidPayoutAdjustment({amount,direction,reason,available})){await conn.rollback();return s.status(400).json({error:"A debit cannot exceed the remaining paid payout balance"})}
  const[insert]=await conn.query("INSERT INTO supplier_payout_adjustments(payout_id,supplier_id,order_id,direction,amount,reason,reference,actor_id) VALUES(?,?,?,?,?,?,?,?)",[payout.id,payout.supplier_id,payout.order_id,direction,cents/100,reason,reference,q.authAdminId]);
  await conn.query("INSERT INTO supplier_payout_audit(payout_id,supplier_id,order_id,action,actor_id,payment_reference,notes) VALUES(?,?,?,'adjustment',?,?,?)",[payout.id,payout.supplier_id,payout.order_id,q.authAdminId,reference,reason]);
  await conn.commit();
  s.status(201).json({ok:1,adjustment_id:insert.insertId,message:`${direction} recorded for manual reconciliation; no transfer was initiated`});
 }catch(error){await conn.rollback();throw error}finally{conn.release()}
}));
app.get("/api/admin/supplier-payouts/:id/audit",auth,h(async(q,s)=>{
 const[rows]=await db.query("SELECT action,actor_id,payment_reference,notes,created_at FROM supplier_payout_audit WHERE payout_id=? ORDER BY id",[q.params.id]);
 const[adjustments]=await db.query("SELECT direction,amount,reason,reference,actor_id,created_at FROM supplier_payout_adjustments WHERE payout_id=? ORDER BY id",[q.params.id]);
 s.json({events:rows,adjustments});
}));
// Suppliers can manage only products assigned to their own supplier account.
app.get("/api/supplier/products",sauth,h(async(q,s)=>{
 const[rows]=await db.query("SELECT p.id,p.name,p.category,p.price,p.mrp,p.stock,p.description,p.active,p.emoji,p.image,IFNULL((SELECT thumb FROM product_images WHERE product_id=p.id ORDER BY position,id LIMIT 1),p.image) thumb,(SELECT COUNT(*) FROM product_images WHERE product_id=p.id) photos FROM products p WHERE p.supplier_id=? ORDER BY p.id DESC",[q.sid]);
 s.json(rows.map(p=>({...p,price:+p.price,mrp:+p.mrp,stock:+p.stock,active:!!p.active,photos:+p.photos})));
}));
app.post("/api/supplier/products",sauth,K.upMany,h(async(q,s)=>{
 const name=String(q.body.name||q.body.n||"").trim().slice(0,120),category=String(q.body.category||q.body.c||"General").trim().slice(0,40)||"General";
 const price=Number(q.body.price??q.body.p),mrpRaw=q.body.mrp??q.body.m, mrp=mrpRaw===""||mrpRaw==null?price:Number(mrpRaw),stockRaw=q.body.stock??q.body.st,stock=stockRaw===""||stockRaw==null?0:Number(stockRaw);
 const description=String(q.body.description||q.body.d||"").trim().slice(0,2000),emoji=String(q.body.emoji||q.body.e||"📦").slice(0,8);
 if(name.length<2)return s.status(400).json({error:"Product name must contain at least 2 characters"});
 if(!validPricePair(price,mrp))return s.status(400).json({error:"Enter finite, positive whole-number prices; MRP must be equal to or higher than price"});
 if(!Number.isInteger(stock)||stock<0||stock>100000)return s.status(400).json({error:"Stock must be a whole number from 0 to 100000"});
 const categoryRules=await ST.ensureCat(category);if(!categoryRules||!taxMatchesCategory(categoryRules,categoryRules.gst_rate,categoryRules.hsn))return s.status(400).json({error:"Configure this category's GST rate and HSN before submitting products"});
 const gst=categoryRules.gst_rate,hsn=categoryRules.hsn;
 let images=[];try{images=await K.prepAll(q.files)}catch(e){return s.status(400).json({error:e.message})}
 const conn=await db.getConnection();let id;
 try{await conn.beginTransaction();const[ins]=await conn.query("INSERT INTO products(name,category,price,mrp,stock,description,emoji,supplier_id,active,gst_rate,hsn) VALUES(?,?,?,?,?,?,?,?,0,?,?)",[name,category,price,mrp,stock,description||null,emoji,q.sid,gst,hsn]);id=ins.insertId;await conn.commit()}catch(e){await conn.rollback();images.forEach(K.rm);throw e}finally{conn.release()}
 try{if(images.length)await K.attach(id,images)}catch(e){await db.query("UPDATE products SET active=0 WHERE id=? AND supplier_id=?",[id,q.sid]);return s.status(400).json({error:"Product saved but photos could not be attached: "+e.message})}
 s.status(201).json({ok:1,id,message:"Product submitted for admin review"});
}));
// Supplier-owned multi-photo upload for existing products. Keeps the shared product_images gallery.
app.post("/api/supplier/products/:id/images",sauth,K.upMany,h(async(q,s)=>{
 const id=Number(q.params.id);
 if(!Number.isInteger(id)||id<1)return s.status(400).json({error:"Invalid product"});
 if(!q.files||!q.files.length)return s.status(400).json({error:"Choose one or more photos"});
 if(q.files.length>8)return s.status(400).json({error:"Choose at most 8 photos at once"});
 const[[p]]=await db.query("SELECT id FROM products WHERE id=? AND supplier_id=? AND active=1",[id,q.sid]);
 if(!p)return s.status(404).json({error:"Active product not found in your catalogue"});
 try{await K.attach(id,await K.prepAll(q.files));}catch(e){return s.status(400).json({error:e.message})}
 s.json({ok:1,message:"Photos added",count:q.files.length});
}));
app.put("/api/supplier/products/:id",sauth,h(async(q,s)=>{
 const id=Number(q.params.id),price=Number(q.body.price),mrp=Number(q.body.mrp),stock=Number(q.body.stock),name=String(q.body.name||"").trim().slice(0,120),category=String(q.body.category||"General").trim().slice(0,40)||"General",description=String(q.body.description||"").trim().slice(0,2000);
 if(!Number.isInteger(id)||id<1)return s.status(400).json({error:"Invalid product"});
 if(name.length<2||!validPricePair(price,mrp)||!Number.isInteger(stock)||stock<0||stock>100000)return s.status(400).json({error:"Check product name, positive prices, MRP and stock"});
 const categoryRules=await ST.ensureCat(category);
 if(!categoryRules||!taxMatchesCategory(categoryRules,categoryRules.gst_rate,categoryRules.hsn))return s.status(400).json({error:"Configure this category's GST rate and HSN before editing products"});
 const[r]=await db.query("UPDATE products SET name=?,category=?,price=?,mrp=?,stock=?,description=?,gst_rate=?,hsn=? WHERE id=? AND supplier_id=? AND active=1",[name,category,price,mrp,stock,description||null,categoryRules.gst_rate,categoryRules.hsn||"",id,q.sid]);
 if(!r.affectedRows){const[[own]]=await db.query("SELECT id FROM products WHERE id=? AND supplier_id=?",[id,q.sid]);return s.status(404).json({error:own?"Product is inactive":"Product not found in your catalogue"})}s.json({ok:1});
}));
app.delete("/api/supplier/products/:id",sauth,h(async(q,s)=>{
 const[r]=await db.query("UPDATE products SET active=0 WHERE id=? AND supplier_id=? AND active=1",[q.params.id,q.sid]);if(!r.affectedRows)return s.status(404).json({error:"Product not found in your catalogue"});s.json({ok:1});
}));

// ---------- admin ----------
app.post("/api/login",loginLim,h(async(q,s)=>{const[[a]]=await db.query("SELECT * FROM admins WHERE email=?",[q.body.email||""]);
 if(!a||!(await bcrypt.compare(q.body.password||"",a.password_hash)))return s.status(401).json({error:"Wrong email or password"});
 s.json({token:jwt.sign({id:a.id,role:"admin"},process.env.JWT_SECRET,{expiresIn:"12h"})})}));
app.use("/api",auth);
app.get("/api/admin/supplier-webhooks",h(async(q,s)=>{
 const status=["pending","sent","failed"].includes(q.query.status)?q.query.status:null;
 const[rows]=await db.query("SELECT event_id,supplier_id,order_code,event_type,status,attempts,last_error,next_attempt_at,created_at,sent_at FROM supplier_webhook_outbox WHERE (? IS NULL OR status=?) ORDER BY created_at DESC LIMIT 200",[status,status]);
 s.json(rows);
}));
app.post("/api/admin/supplier-webhooks/:id/retry",h(async(q,s)=>{
 const[r]=await db.query("UPDATE supplier_webhook_outbox SET status='pending',attempts=0,last_error=NULL,next_attempt_at=NOW(),locked_until=NULL WHERE event_id=? AND status='failed'",[q.params.id]);
 if(!r.affectedRows)return s.status(404).json({error:"Failed supplier event not found"});
 void processSupplierWebhookQueue();
 s.json({ok:1,message:"Supplier callback queued for a fresh bounded retry"});
}));
app.get("/api/suppliers",h(async(q,s)=>{const[r]=await db.query("SELECT id,name n,category c,location l,active a,email,password_hash IS NOT NULL login_enabled FROM suppliers");s.json(r)}));
app.get("/api/admin/products/pending",h(async(q,s)=>{
 const[rows]=await db.query("SELECT id,name,category,price,mrp,gst_rate,hsn,stock,supplier_id FROM products WHERE active=0 AND is_demo=0 AND supplier_id IS NOT NULL ORDER BY id");
 s.json(rows);
}));
app.post("/api/admin/products/:id/approve",h(async(q,s)=>{
 const[[p]]=await db.query("SELECT id,price,mrp,category,gst_rate,hsn FROM products WHERE id=? AND active=0 AND is_demo=0",[q.params.id]);
 if(!p)return s.status(404).json({error:"Pending product not found"});
 const category=await ST.ensureCat(p.category),price=Number(p.price),mrp=Number(p.mrp);
 if(!validPricePair(price,mrp)||!taxMatchesCategory(category,Number(p.gst_rate),String(p.hsn||"")))return s.status(400).json({error:"Product prices or category tax details need correction before approval"});
 await db.query("UPDATE products SET active=1 WHERE id=? AND active=0 AND is_demo=0",[p.id]);
 s.json({ok:1,message:"Product approved"});
}));
app.post("/api/suppliers",h(async(q,s)=>{const{n,c,l,api_url,email,password}=q.body;if(!n)return s.status(400).json({error:"Supplier name needed"});const em=String(email||"").trim().toLowerCase();if((em||password)&&(!/^\S+@\S+\.\S+$/.test(em)||String(password||"").length<10))return s.status(400).json({error:"Supplier login requires a valid email and password of at least 10 characters"});try{await db.query("INSERT INTO suppliers(name,category,location,api_url,email,password_hash) VALUES(?,?,?,?,?,?)",[String(n).trim().slice(0,80),c||"",l||"",api_url||null,em||null,password?await bcrypt.hash(String(password),10):null]);}catch(e){if(e.code==="ER_DUP_ENTRY")return s.status(400).json({error:"That supplier email is already used"});throw e}s.json({ok:1})}));
app.put("/api/suppliers/:id/credentials",h(async(q,s)=>{const email=String(q.body.email||"").trim().toLowerCase(),password=String(q.body.password||"");if(!/^\S+@\S+\.\S+$/.test(email)||password.length<10)return s.status(400).json({error:"Enter a valid email and password of at least 10 characters"});try{const[r]=await db.query("UPDATE suppliers SET email=?,password_hash=? WHERE id=?",[email,await bcrypt.hash(password,10),q.params.id]);if(!r.affectedRows)return s.status(404).json({error:"Supplier not found"});s.json({ok:1})}catch(e){if(e.code==="ER_DUP_ENTRY")return s.status(400).json({error:"That supplier email is already used"});throw e}}));
app.patch("/api/suppliers/:id",h(async(q,s)=>{await db.query("UPDATE suppliers SET active=1-active WHERE id=?",[q.params.id]);s.json({ok:1})}));
app.delete("/api/suppliers/:id",h(async(q,s)=>{
 const[r]=await db.query("UPDATE suppliers SET active=0 WHERE id=? AND active<>0",[q.params.id]);
 if(!r.affectedRows){const[[supplier]]=await db.query("SELECT id FROM suppliers WHERE id=?",[q.params.id]);if(!supplier)return s.status(404).json({error:"Supplier not found"})}
 s.json({ok:1,deactivated:true,message:"Supplier access disabled; historical orders and payout records are retained"});
}));
app.post("/api/products",K.upMany,h(async(q,s)=>{const{n,c,p,m,e}=q.body,price=Number(p),mrp=m===""||m==null?price:Number(m),stock=q.body.st===""||q.body.st==null?0:Number(q.body.st),supplierId=q.body.supplier_id===""||q.body.supplier_id==null?null:Number(q.body.supplier_id);if(!n||!validPricePair(price,mrp))return s.status(400).json({error:"Enter a name and finite, positive whole-number prices; MRP must be at least the price"});
 if(!Number.isInteger(stock)||stock<0||stock>100000)return s.status(400).json({error:"Stock must be a whole number from 0 to 100000"});
 if(supplierId!==null){if(!Number.isInteger(supplierId)||supplierId<1)return s.status(400).json({error:"Invalid supplier ID"});const[[sp]]=await db.query("SELECT id FROM suppliers WHERE id=? AND active=1",[supplierId]);if(!sp)return s.status(400).json({error:"Select an active supplier"})}
 let ims=[];try{ims=await K.prepAll(q.files)}catch(er){return s.status(400).json({error:er.message})}
 const cat=String(c||"General").trim().slice(0,60)||"General",cd=await ST.ensureCat(cat);
 if(!cd||!taxMatchesCategory(cd,cd.gst_rate,cd.hsn))return s.status(400).json({error:"Configure this category's GST rate and HSN before adding products"});
 const[ins]=await db.query("INSERT INTO products(name,category,price,mrp,stock,hsn,gst_rate,emoji,supplier_id) VALUES(?,?,?,?,?,?,?,?,?)",[String(n).trim().slice(0,120),cat,price,mrp,stock,cd.hsn,cd.gst_rate,cd.emoji||e||"📦",supplierId]);
 if(ims.length)await K.attach(ins.insertId,ims);s.json({ok:1,id:ins.insertId})}));

app.delete("/api/reviews/:id",h(async(q,s)=>{const[[r]]=await db.query("SELECT product_id FROM reviews WHERE id=?",[q.params.id]);if(!r)return s.status(404).json({error:"Review not found"});
 await db.query("DELETE FROM reviews WHERE id=?",[q.params.id]);await refreshRating(r.product_id);s.json({ok:1})}));
app.get("/api/coupons",h(async(q,s)=>{const[r]=await db.query("SELECT id,code,type,value,min_order,max_discount,usage_limit,uses,one_per_phone,expires_at,active FROM coupons ORDER BY id DESC");s.json(r)}));
app.post("/api/coupons",h(async(q,s)=>{const b=q.body,code=String(b.code||"").trim().toUpperCase(),val=parseInt(b.value);
 if(!/^[A-Z0-9]{3,20}$/.test(code))return s.status(400).json({error:"Code: 3-20 letters/numbers, no spaces"});
 if(!["percent","flat"].includes(b.type)||!(val>0)||(b.type==="percent"&&val>90))return s.status(400).json({error:"Enter a valid discount (percent can be at most 90)"});
 const n=x=>x===""||x==null?null:Math.max(0,parseInt(x)||0);
 try{await db.query("INSERT INTO coupons(code,type,value,min_order,max_discount,usage_limit,one_per_phone,expires_at) VALUES(?,?,?,?,?,?,?,?)",[code,b.type,val,n(b.min_order)||0,b.type==="percent"?n(b.max_discount):null,n(b.usage_limit),b.one_per_phone?1:0,b.expires_at?b.expires_at+" 23:59:59":null])}
 catch(e){if(e.code==="ER_DUP_ENTRY")return s.status(400).json({error:"This code already exists"});throw e}s.json({ok:1})}));
app.patch("/api/coupons/:id",h(async(q,s)=>{await db.query("UPDATE coupons SET active=1-active WHERE id=?",[q.params.id]);s.json({ok:1})}));
app.delete("/api/coupons/:id",h(async(q,s)=>{await db.query("DELETE FROM coupons WHERE id=?",[q.params.id]);s.json({ok:1})}));
app.put("/api/products/:id",h(async(q,s)=>{const{n,c,p,m,st}=q.body,price=Number(p),mrp=Number(m),stock=Number(st),g=Number(q.body.g),hs=String(q.body.h||"").trim(),w=Number(q.body.w),supplierId=q.body.supplier_id===""||q.body.supplier_id==null?null:Number(q.body.supplier_id),category=String(c||"General").trim().slice(0,60)||"General";
 if(!(w>=1&&w<=100000))return s.status(400).json({error:"Weight must be between 1 and 100000 grams"});
 if(!n||!String(n).trim()||!validPricePair(price,mrp)||!Number.isInteger(stock)||stock<0||stock>100000)return s.status(400).json({error:"Check name, positive prices, MRP (must be >= price) and stock (whole number, 0 or more)"});
 const cd=await ST.ensureCat(category);
 if(!cd)return s.status(400).json({error:"Category tax configuration is missing"});
 if(!taxMatchesCategory(cd,g,hs))return s.status(400).json({error:"GST and HSN must match the configured category rules"});
 if(supplierId!==null){if(!Number.isInteger(supplierId)||supplierId<1)return s.status(400).json({error:"Invalid supplier ID"});const[[sp]]=await db.query("SELECT id FROM suppliers WHERE id=? AND active=1",[supplierId]);if(!sp)return s.status(400).json({error:"Select an active supplier"})}
 const[r]=await db.query("UPDATE products SET name=?,category=?,price=?,mrp=?,stock=?,gst_rate=?,hsn=?,weight_g=?,supplier_id=? WHERE id=?",[n.trim().slice(0,120),category,price,mrp,stock,g,hs,w,supplierId,q.params.id]);
 if(!r.affectedRows)return s.status(404).json({error:"Product not found"});s.json({ok:1})}));
app.delete("/api/products/:id",h(async(q,s)=>{await db.query("UPDATE products SET active=0 WHERE id=?",[q.params.id]);s.json({ok:1})}));
app.get("/api/orders",h(async(q,s)=>{const[r]=await db.query("SELECT o.code id,o.customer_name u,o.total a,o.status s,o.delivery_verified_at dv,GROUP_CONCAT(oi.name SEPARATOR ', ') it,GROUP_CONCAT(DISTINCT sp.name SEPARATOR ', ') sp,o.payment_method pm,o.payment_status ps FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN suppliers sp ON sp.id=oi.supplier_id GROUP BY o.id ORDER BY o.id DESC LIMIT 200");s.json(r)}));
app.get("/api/orders/:code",h(async(q,s)=>{const[[o]]=await db.query("SELECT id,code,customer_name,phone,email,address,total,status,payment_method,payment_status,created_at,cancel_reason,return_status,return_reason,delivered_at,delivery_verified_at,delivery_reference,coupon_code,discount,courier_name,awb,tracking_url,ship_status,sr_shipment_id FROM orders WHERE code=?",[q.params.code]);
 if(!o)return s.status(404).json({error:"Order not found"});
 const[it]=await db.query("SELECT oi.name,oi.qty,CONCAT_WS(' / ',NULLIF(oi.size,''),NULLIF(oi.color,'')) size,oi.price,sp.name sup FROM order_items oi LEFT JOIN suppliers sp ON sp.id=oi.supplier_id WHERE oi.order_id=?",[o.id]);
 const[shipments]=await db.query("SELECT ss.supplier_id,sp.name supplier,ss.courier_name,ss.awb,ss.tracking_url,ss.status,ss.created_at FROM supplier_shipments ss JOIN suppliers sp ON sp.id=ss.supplier_id WHERE ss.order_id=? ORDER BY ss.id",[o.id]);
 delete o.id;s.json({...o,items:it,shipments})}));
app.post("/api/orders/:code/cancel",h(async(q,s)=>{const r=await cancelOrder(q.params.code,String(q.body.reason||"").trim()||"Cancelled by store");if(r.error)return s.status(r.status).json({error:r.error});s.json(r)}));
app.post("/api/orders/:code/refund",h(async(q,s)=>{const[[o]]=await db.query("SELECT payment_status,return_status FROM orders WHERE code=?",[q.params.code]);
 if(!o||o.payment_status!=="refund_pending")return s.status(400).json({error:"No pending refund on this order"});
 const ok=await refundOrder(q.params.code);if(ok&&o.return_status==="approved")await db.query("UPDATE orders SET return_status='refunded' WHERE code=?",[q.params.code]);
 s.json({ok,message:ok?"Refund issued":"Refund still failing - check Razorpay dashboard / server logs"})}));
app.post("/api/orders/:code/return",h(async(q,s)=>{const act=q.body.action,[[o]]=await db.query("SELECT payment_method,payment_status,return_status FROM orders WHERE code=?",[q.params.code]);
 if(!o)return s.status(404).json({error:"Order not found"});
 if(act==="reject"&&o.return_status==="requested"){await db.query("UPDATE orders SET return_status='rejected' WHERE code=?",[q.params.code]);N.returnUpdate(q.params.code,"rejected");return s.json({ok:1})}
 if(act==="approve"&&o.return_status==="requested"){let ns="approved";
  if(o.payment_method==="online"&&o.payment_status==="paid"&&await refundOrder(q.params.code))ns="refunded";
  await db.query("UPDATE orders SET return_status=? WHERE code=?",[ns,q.params.code]);N.returnUpdate(q.params.code,ns);return s.json({ok:1,refunded:ns==="refunded"})}
 if(act==="refunded"&&o.return_status==="approved"){await db.query("UPDATE orders SET return_status='refunded' WHERE code=?",[q.params.code]);N.returnUpdate(q.params.code,"refunded");return s.json({ok:1})}
 s.status(400).json({error:"That action is not valid for this return"})}));
app.patch("/api/orders/:code/status",auth,h(async(q,s)=>{
 const next=String(q.body.status||""),evidence=String(q.body.delivery_reference||"").trim().slice(0,120);
 if(!["Processing","Shipped","Delivered"].includes(next))return s.status(400).json({error:"Bad status"});
 if(next==="Delivered"&&!/^[A-Za-z0-9._/-]{4,120}$/.test(evidence))return s.status(400).json({error:"A verified courier delivery reference is required for manual delivery verification"});
 const conn=await db.getConnection();let previous=null,orderId=null;
 try{
  await conn.beginTransaction();
  const[[order]]=await conn.query("SELECT id,code,status FROM orders WHERE code=? FOR UPDATE",[q.params.code]);
  if(!order){await conn.rollback();return s.status(404).json({error:"Order not found"})}
  previous=order.status;orderId=order.id;
  if(previous==="Cancelled"||previous==="Delivered"){await conn.rollback();return s.status(400).json({error:"Cancelled or delivered orders cannot be changed"})}
  if(previous===next){await conn.commit();return s.json({ok:1})}
  if(!canAdminTransition(previous,next)){await conn.rollback();return s.status(400).json({error:"That order status transition is not allowed"})}
  await conn.query("UPDATE orders SET status=?,delivered_at=IF(?='Delivered',NOW(),delivered_at),delivery_verified_at=IF(?='Delivered',NOW(),delivery_verified_at),delivery_verified_by=IF(?='Delivered',?,delivery_verified_by),delivery_reference=IF(?='Delivered',?,delivery_reference) WHERE id=?",[next,next,next,next,q.authAdminId,next,next==="Delivered"?evidence:null,orderId]);
  if(next==="Delivered")await conn.query("UPDATE order_items SET supplier_status='Delivered' WHERE order_id=?",[orderId]);
  else if(next==="Shipped")await conn.query("UPDATE order_items SET supplier_status='Shipped' WHERE order_id=? AND supplier_status NOT IN ('Delivered','Shipped')",[orderId]);
  await conn.query("INSERT INTO order_status_audit(order_id,order_code,from_status,to_status,actor_role,actor_id,source,evidence_reference) VALUES(?,?,?,?,?,?,?,?)",[orderId,order.code,previous,next,"admin",q.authAdminId||null,"admin_manual",next==="Delivered"?evidence:null]);
  await conn.commit();
 }catch(error){await conn.rollback();throw error}finally{conn.release()}
 N.statusChanged(q.params.code,next);s.json({ok:1});
}));
app.get("/api/stats",h(async(q,s)=>{const[r]=await db.query("SELECT DATE(created_at) d,SUM(total) t FROM orders GROUP BY d ORDER BY d DESC LIMIT 8");
 const v=r.reverse().map(x=>+x.t/50);while(v.length<8)v.unshift(0);s.json({sales:v})}));

app.use((e,q,s,n)=>{if(e&&e.status<500)return s.status(e.status).json({error:e.status===413?"Request too large":"Bad request"});const safe=Object.assign(new Error("Request failed"),{code:safeErrorCode(e)});console.error("request failed:",q.method,q.path,safe.code);OPS.alert(safe,q.method+" "+q.path);s.status(500).json({error:"Server error"})});
(async()=>{ // create first admin from .env
 const[[a]]=await db.query("SELECT COUNT(*) n FROM admins");
 if(!a.n&&process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD){if(PROD&&(/change-this/i.test(process.env.ADMIN_PASSWORD)||process.env.ADMIN_PASSWORD.length<10)){console.error("STOP: choose a real ADMIN_PASSWORD (10+ characters) in .env before the first start in production");process.exit(1)}await db.query("INSERT INTO admins(email,password_hash) VALUES(?,?)",[process.env.ADMIN_EMAIL,await bcrypt.hash(process.env.ADMIN_PASSWORD,10)]);console.log("Admin created:",process.env.ADMIN_EMAIL)}
 const srv=app.listen(process.env.PORT||3000,()=>console.log("SeasonKart running on port",process.env.PORT||3000));OPS.graceful(srv);
})();
