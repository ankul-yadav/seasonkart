// Step 6: Shiprocket (pincode check, shipment + AWB, label) and manual tracking entry.
// Everything degrades gracefully: without SHIPROCKET_* in .env the shop still works and admin can enter tracking by hand.
module.exports=({app,db,h,rl,auth,N,E})=>{
 const BASE="https://apiv2.shiprocket.in/v1/external",on=!!(E.SHIPROCKET_EMAIL&&E.SHIPROCKET_PASSWORD);
 let tk=null,tkAt=0,lp=null;
 async function login(){const r=await fetch(BASE+"/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:E.SHIPROCKET_EMAIL,password:E.SHIPROCKET_PASSWORD}),signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.token)throw new Error("Shiprocket login failed; verify API user credentials and availability.");tk=j.token;tkAt=Date.now()}
 async function api(path,{method="GET",body}={},retry=true){
  if(!tk||Date.now()-tkAt>8*3600e3)await(lp||(lp=login().finally(()=>{lp=null})));
  const r=await fetch(BASE+path,{method,headers:{"Content-Type":"application/json",Authorization:"Bearer "+tk},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  if(r.status===401&&retry){tk=null;return api(path,{method,body},false)}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const e=new Error("Shiprocket request failed with status "+r.status);e.status=r.status;throw e}
  return j}

 // ---------- pincode serviceability (cached 6h; fails OPEN if Shiprocket is down so sales never stop) ----------
 const cache=new Map();
 async function checkPin(pin){
  if(!/^[1-9]\d{5}$/.test(pin))return{serviceable:false,days:null,cod:false,bad:true};
  if(!on||!E.PICKUP_PINCODE)return{serviceable:true,days:null,cod:true,generic:true};
  const hit=cache.get(pin);if(hit&&Date.now()-hit.t<6*3600e3)return hit.v;
  try{
   const q=c=>api(`/courier/serviceability/?pickup_postcode=${E.PICKUP_PINCODE}&delivery_postcode=${pin}&weight=0.5&cod=${c}`).catch(e=>e.status===404?{data:{available_courier_companies:[]}}:Promise.reject(e));
   const[pre,cod]=await Promise.all([q(0),q(1)]),list=x=>(x&&x.data&&x.data.available_courier_companies)||[],a=list(pre),b=list(cod);
   const ds=a.map(c=>+c.estimated_delivery_days).filter(n=>n>0),v={serviceable:a.length>0||b.length>0,days:ds.length?Math.min(...ds):null,cod:b.length>0};
   cache.set(pin,{t:Date.now(),v});return v}
  catch(e){console.error("pincode check failed:",e.status||e.name||"provider_error");return{serviceable:true,days:null,cod:true,generic:true}}}
 app.get("/api/pincode/:pin",rl(60,15,"Too many pincode checks. Please wait a few minutes."),h(async(q,s)=>{const v=await checkPin(q.params.pin);
  s.json({serviceable:v.serviceable,days:v.days!=null?v.days+(+E.HANDLING_DAYS||1):null,cod:v.cod,bad:!!v.bad})}));

 // ---------- create shipment at Shiprocket ----------
 async function createShipment(code){
  const[[o]]=await db.query("SELECT * FROM orders WHERE code=?",[code]);
  if(!o)return{err:"Order not found",status:404};
  if(o.status!=="Processing")return{err:"Only orders in Processing can get a new shipment (this one is "+o.status+")",status:400};
  if(o.awb)return{err:"This order already has AWB "+o.awb,status:400};
  if(o.payment_method==="online"&&o.payment_status!=="paid")return{err:"Online payment has not been received for this order",status:400};
  const m=String(o.address||"").match(/^(.*), ([^,]+), [^,]+ - (\d{6})$/),city=o.city||(m&&m[2]),pin=o.pincode||(m&&m[3]);
  if(!city||!pin||!o.state)return{err:"This older order has no city/pincode saved - create the shipment in the Shiprocket panel and enter the AWB here manually",status:400};
  let shipId=o.sr_shipment_id;
  if(!shipId){
   const[it]=await db.query("SELECT oi.product_id,oi.variant_id,oi.name,oi.price,oi.qty,oi.hsn,p.weight_g,p.pkg_l,p.pkg_b,p.pkg_h FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?",[o.id]);
   const parts=String(o.customer_name).trim().split(/\s+/),weight=Math.max(.1,Math.round(it.reduce((a,i)=>a+(i.weight_g||500)*i.qty,0)/10)/100);
   const body={order_id:o.code,order_date:new Date(o.created_at).toLocaleString("sv-SE",{timeZone:"Asia/Kolkata"}).slice(0,16),pickup_location:E.SHIPROCKET_PICKUP_LOCATION||"Primary",
    billing_customer_name:parts[0],billing_last_name:parts.slice(1).join(" "),billing_address:o.address,billing_city:city,billing_pincode:pin,billing_state:o.state,billing_country:"India",
    billing_email:o.email||E.STORE_EMAIL||"orders@example.com",billing_phone:o.phone,shipping_is_billing:true,
    order_items:it.map(i=>({name:i.name,sku:"SK-"+i.product_id+(i.variant_id?"-"+i.variant_id:""),units:i.qty,selling_price:i.price,...(i.hsn?{hsn:i.hsn}:{})})),
    payment_method:o.payment_method==="cod"?"COD":"Prepaid",sub_total:o.total, // for COD this is the amount the courier collects
    length:Math.max(...it.map(i=>i.pkg_l||0),+E.PKG_LENGTH||25),breadth:Math.max(...it.map(i=>i.pkg_b||0),+E.PKG_BREADTH||20),height:Math.max(it.reduce((a,i)=>a+(i.pkg_h||0)*i.qty,0),+E.PKG_HEIGHT||5),weight};
   const r=await api("/orders/create/adhoc",{method:"POST",body});
   if(!r.shipment_id)throw new Error("Shiprocket did not return a shipment id");
   shipId=String(r.shipment_id);await db.query("UPDATE orders SET sr_order_id=?,sr_shipment_id=?,ship_status='Created at courier - AWB pending' WHERE id=?",[String(r.order_id),shipId,o.id])}
  const a=await api("/courier/assign/awb",{method:"POST",body:{shipment_id:shipId}}),d=(a.response&&a.response.data)||a.data||a;
  if(!d.awb_code)throw new Error("AWB was not assigned; check your Shiprocket wallet balance and courier settings, then try again.");
  await db.query("UPDATE orders SET awb=?,courier_name=?,tracking_url=?,ship_status='AWB assigned' WHERE id=?",[String(d.awb_code),String(d.courier_name||"Courier").slice(0,60),"https://shiprocket.co/tracking/"+d.awb_code,o.id]);
  try{await api("/courier/generate/pickup",{method:"POST",body:{shipment_id:[shipId]}});await db.query("UPDATE orders SET ship_status='Pickup requested' WHERE id=?",[o.id])}catch(e){console.error("pickup request:",e.status||e.name||"provider_error")}
  return{ok:true,awb:String(d.awb_code),courier:d.courier_name||""}}
 app.post("/api/orders/:code/shipment",auth,h(async(q,s)=>{if(!on)return s.status(400).json({error:"Shiprocket is not configured in .env"});
  try{const r=await createShipment(q.params.code);if(r.err)return s.status(r.status).json({error:r.err});s.json(r)}catch(e){console.error("shipment failed",q.params.code,e.status||e.name||"provider_error");s.status(502).json({error:"Courier shipment request failed; check the Shiprocket dashboard and try again."})}}));
 app.get("/api/orders/:code/label",auth,h(async(q,s)=>{const[[o]]=await db.query("SELECT sr_shipment_id FROM orders WHERE code=?",[q.params.code]);
  if(!on||!o||!o.sr_shipment_id)return s.status(400).json({error:"No Shiprocket shipment for this order"});
  try{const r=await api("/courier/generate/label",{method:"POST",body:{shipment_id:[+o.sr_shipment_id]}});if(!r.label_url)return s.status(502).json({error:"Label is not ready yet - try again in a minute"});s.json({url:r.label_url})}catch(e){s.status(502).json({error:"Courier label request failed; check the Shiprocket dashboard and try again."})}}));
 const srCancel=id=>{if(on&&id)api("/orders/cancel",{method:"POST",body:{ids:[+id]}}).catch(e=>console.error("courier cancel failed:",e.status||e.name||"provider_error"))};

 // ---------- manual tracking (supplier-shipped orders or any courier) ----------
 app.post("/api/orders/:code/tracking",auth,h(async(q,s)=>{
  const courier=String(q.body.courier||"").trim().slice(0,60),awb=String(q.body.awb||"").trim().slice(0,40),url=String(q.body.url||"").trim().slice(0,255);
  if(!courier||!/^[A-Za-z0-9\-]{4,40}$/.test(awb))return s.status(400).json({error:"Enter the courier name and a valid tracking / AWB number"});
  if(url&&!/^https?:\/\//i.test(url))return s.status(400).json({error:"Tracking link must start with http:// or https://"});
  const[[o]]=await db.query("SELECT status FROM orders WHERE code=?",[q.params.code]);
  if(!o)return s.status(404).json({error:"Order not found"});if(!["Processing","Shipped"].includes(o.status))return s.status(400).json({error:"Order is "+o.status});
  await db.query("UPDATE orders SET courier_name=?,awb=?,tracking_url=?,ship_status='Handed to courier' WHERE code=?",[courier,awb,url||null,q.params.code]);
  if(o.status==="Processing"){await db.query("UPDATE orders SET status='Shipped' WHERE code=?",[q.params.code]);N.statusChanged(q.params.code,"Shipped")}
  s.json({ok:1})}));

 // Shiprocket currently documents a configurable x-api-key, not a verifiable body signature.
 // Do not process deliveries until its signature algorithm and event-id contract are documented.
 app.post("/api/courier/updates",(q,s)=>s.status(503).json({error:"Courier webhook processing is disabled until a documented signature scheme can be verified. Use manual tracking updates."}));

 return{on,checkPin,srCancel};
};
