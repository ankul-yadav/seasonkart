// Email (SMTP via nodemailer) + WhatsApp (Meta Cloud API templates) + SMS (Twilio). WhatsApp is tried first, SMS is the fallback.
// Each channel skips if not configured without logging recipient or message data.
const nodemailer=require("nodemailer");
const E=process.env,rs=n=>"Rs."+Number(n).toLocaleString("en-IN");
const mailer=E.SMTP_HOST?nodemailer.createTransport({host:E.SMTP_HOST,port:+E.SMTP_PORT||587,secure:+E.SMTP_PORT===465,auth:{user:E.SMTP_USER,pass:E.SMTP_PASS}}):null;

async function sendMail(to,subject,text){
 if(!to)return;
 if(!mailer){console.log("[email skipped - SMTP not set]");return}
 await mailer.sendMail({from:E.MAIL_FROM||E.SMTP_USER,to,subject,text})}

async function sendSMS(phone,body){
 if(!/^\d{10}$/.test(phone||""))return;
 if(!E.TWILIO_SID||!E.TWILIO_TOKEN||!E.TWILIO_FROM){console.log("[sms skipped - Twilio not set]");return}
 const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${E.TWILIO_SID}/Messages.json`,{method:"POST",
  headers:{Authorization:"Basic "+Buffer.from(E.TWILIO_SID+":"+E.TWILIO_TOKEN).toString("base64"),"Content-Type":"application/x-www-form-urlencoded"},
  body:new URLSearchParams({To:"+91"+phone,From:E.TWILIO_FROM,Body:body})});
 if(!r.ok)throw new Error("Twilio request failed with status "+r.status)}

const waOn=!!(E.WA_TOKEN&&E.WA_PHONE_ID),smsOn=!!(E.TWILIO_SID&&E.TWILIO_TOKEN&&E.TWILIO_FROM);
const clean=t=>String(t).replace(/[\n\t\r]+/g," ").replace(/ {2,}/g," ").slice(0,900);
async function sendWA(phone,template,params=[],otp){
 const comps=otp?[{type:"body",parameters:[{type:"text",text:otp}]},{type:"button",sub_type:"url",index:"0",parameters:[{type:"text",text:otp}]}]
  :(params.length?[{type:"body",parameters:params.map(t=>({type:"text",text:clean(t)}))}]:[]);
 const r=await fetch(`https://graph.facebook.com/${E.WA_API_VERSION||"v23.0"}/${E.WA_PHONE_ID}/messages`,{method:"POST",headers:{Authorization:"Bearer "+E.WA_TOKEN,"Content-Type":"application/json"},
  body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to:"91"+phone,type:"template",template:{name:template,language:{code:E.WA_LANG||"en"},components:comps}}),signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error("WhatsApp request failed with status "+r.status)}
// order updates: WhatsApp template if configured (WA_TEMPLATE_<KEY>), otherwise / on failure SMS
async function chat(phone,key,params,smsText){
 if(!/^\d{10}$/.test(phone||""))return;
 const tpl=key&&E["WA_TEMPLATE_"+key];
 if(waOn&&tpl){try{await sendWA(phone,tpl,params);return}catch(e){console.error("WhatsApp failed, falling back to SMS:",e.code||e.name||"provider_error")}}
 await sendSMS(phone,smsText)}

module.exports=db=>{
 const get=async code=>{const[[o]]=await db.query("SELECT * FROM orders WHERE code=?",[code]);if(!o)return null;
  const[it]=await db.query("SELECT name,qty,CONCAT_WS(' / ',NULLIF(size,''),NULLIF(color,'')) size FROM order_items WHERE order_id=?",[o.id]);return{o,it}};
 const track=E.BASE_URL?E.BASE_URL.replace(/\/$/,"")+"/#track":"";
 const run=async(jobs)=>{(await Promise.allSettled(jobs)).forEach(r=>r.status==="rejected"&&console.error("notify failed:",r.reason&&(r.reason.code||r.reason.name)||"provider_error"))};

 return{
  async orderPlaced(code){try{const x=await get(code);if(!x)return;const{o,it}=x;
   const lines=it.map(i=>`- ${i.name} x${i.qty}${i.size?" (size "+i.size+")":""}`).join("\n");
   const pay=o.payment_method==="cod"?"Cash on delivery":"Paid online";
   const body=`Hi ${o.customer_name},\n\nThank you for shopping with SeasonKart! Your order ${code} is confirmed.\n\n${lines}\n\n${o.discount?`Discount (${o.coupon_code}): -${rs(o.discount)}\n`:""}Total: ${rs(o.total)} (${pay})\nDelivery to: ${o.address}\n${track?"\nTrack your order: "+track+"\n":""}\n- Team SeasonKart`;
   await run([sendMail(o.email,`Order ${code} confirmed - SeasonKart`,body),
    chat(o.phone,"ORDER_CONFIRMED",[o.customer_name,code,rs(o.total),track||"our website"],`SeasonKart: Order ${code} confirmed. Total ${rs(o.total)} (${pay}).${track?" Track: "+track:""}`),
    E.ADMIN_NOTIFY_EMAIL?sendMail(E.ADMIN_NOTIFY_EMAIL,`New order ${code} - ${rs(o.total)}`,`${o.customer_name} (${o.phone})\n${o.address}\n\n${lines}\n\nTotal ${rs(o.total)} (${pay})`):null])
  }catch(e){console.error("orderPlaced notify:",e.code||e.name||"notify_error")}},

  async orderCancelled(code,refund){try{const x=await get(code);if(!x)return;const{o}=x;
   const note=refund?`Your payment of ${rs(o.total)} will be refunded to the original payment method in 5-7 working days.`:"No payment is due for this order.";
   await run([sendMail(o.email,`Order ${code} cancelled - SeasonKart`,`Hi ${o.customer_name},\n\nYour SeasonKart order ${code} has been cancelled.\n${note}\n\n- Team SeasonKart`),
    chat(o.phone,"CANCELLED",[o.customer_name,code,note],`SeasonKart: Order ${code} cancelled. ${refund?"Refund of "+rs(o.total)+" in 5-7 working days.":""}`)])}catch(e){console.error("orderCancelled notify:",e.code||e.name||"notify_error")}},

  async returnUpdate(code,state){try{const x=await get(code);if(!x)return;const{o}=x;
   const msg={approved:"has been approved. We will refund you shortly.",rejected:"could not be approved. Please contact us for details.",refunded:"is complete and your refund has been issued (5-7 working days to reflect)."}[state];if(!msg)return;
   await run([sendMail(o.email,`Return update for order ${code}`,`Hi ${o.customer_name},\n\nYour return request for order ${code} ${msg}\n\n- Team SeasonKart`),chat(o.phone,"RETURN",[o.customer_name,code,msg],`SeasonKart: Return for order ${code} ${msg}`)])}catch(e){console.error("returnUpdate notify:",e.code||e.name||"notify_error")}},

  async admin(subject,text){try{await run([sendMail(E.ADMIN_NOTIFY_EMAIL,subject,text)])}catch(e){}},

  canOtp:(waOn&&!!E.WA_TEMPLATE_OTP)||smsOn,
  async otp(phone,code){ // returns true if the code was handed to a channel
   if(waOn&&E.WA_TEMPLATE_OTP){try{await sendWA(phone,E.WA_TEMPLATE_OTP,[],code);return true}catch(e){console.error("WhatsApp OTP failed:",e.code||e.name||"provider_error")}}
   if(smsOn){try{await sendSMS(phone,`${code} is your SeasonKart verification code. Valid for 10 minutes. Do not share it with anyone.`);return true}catch(e){console.error("SMS OTP failed:",e.code||e.name||"provider_error")}}
   return false},
  async verifyEmail(to,name,link){try{await sendMail(to,"Verify your email - SeasonKart",`Hi ${name},\n\nWelcome to SeasonKart! Please confirm your email address by opening this link (valid for 48 hours):\n${link}\n\nIf you did not create an account, you can ignore this email.\n\n- Team SeasonKart`)}catch(e){console.error("verifyEmail mail:",e.code||e.name||"provider_error")}},

  async passwordReset(to,name,link){try{await sendMail(to,"Reset your SeasonKart password",`Hi ${name},\n\nWe received a request to reset your password. Open this link within 1 hour to choose a new one:\n${link}\n\nIf you did not ask for this, you can ignore this email - your password will not change.\n\n- Team SeasonKart`)}catch(e){console.error("passwordReset mail:",e.code||e.name||"provider_error")}},

  async statusChanged(code,status){try{const x=await get(code);if(!x)return;const{o}=x;
   const msg={Shipped:"has been shipped and is on its way",Delivered:"has been delivered. Hope you love it!",Processing:"is being processed"}[status];if(!msg)return;
   const tpl=status==="Shipped"?"SHIPPED":status==="Delivered"?"DELIVERED":null;
   await run([sendMail(o.email,`Order ${code} ${status.toLowerCase()} - SeasonKart`,`Hi ${o.customer_name},\n\nYour SeasonKart order ${code} ${msg}.\n${status==="Shipped"&&o.awb?`\nCourier: ${o.courier_name||"-"}\nTracking no: ${o.awb}${o.tracking_url?"\nTrack shipment: "+o.tracking_url:""}\n`:""}${track?"\nYour orders: "+track+"\n":""}\n- Team SeasonKart`),
    chat(o.phone,tpl,tpl==="SHIPPED"?[o.customer_name,code,o.courier_name||"our courier partner",o.awb||"will be shared soon"]:[o.customer_name,code],`SeasonKart: Order ${code} ${msg}.${status==="Shipped"&&o.awb?" "+(o.courier_name||"Courier")+" AWB "+o.awb+".":""}`)])
  }catch(e){console.error("statusChanged notify:",e.code||e.name||"notify_error")}}
 }};
