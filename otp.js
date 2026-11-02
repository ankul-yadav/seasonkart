// Step 9: COD phone-OTP (stops fake cash-on-delivery orders) + customer email verification.
const crypto=require("crypto");
module.exports=({app,db,h,rl,cauth,jwt,N,E,BASE})=>{
 const sec=E.JWT_SECRET,enabled=E.COD_OTP==="1"&&!!N.canOtp,DAILY=parseInt(E.OTP_DAILY_LIMIT)||300;
 if(E.COD_OTP==="1"&&!N.canOtp)console.error("WARNING: COD_OTP=1 but neither WhatsApp (WA_*) nor Twilio SMS is configured - the COD OTP check stays OFF until one is set up");
 const hmac=(phone,code)=>crypto.createHmac("sha256",sec).update(phone+":"+code).digest("hex");
 const sha=x=>crypto.createHash("sha256").update(x).digest("hex");

 // ---------- COD OTP ----------
 app.post("/api/otp/send",rl(10,60,"Too many OTP requests from this network. Please try again later."),h(async(q,s)=>{
  if(!enabled)return s.status(400).json({error:"OTP is not enabled"});
  const phone=String(q.body.phone||"").trim();if(!/^[6-9]\d{9}$/.test(phone))return s.status(400).json({error:"Enter a valid 10-digit mobile number"});
  const[[d]]=await db.query("SELECT COUNT(*) n FROM otps WHERE created_at>NOW()-INTERVAL 1 DAY");
  if(d.n>=DAILY)return s.status(429).json({error:"Cash on delivery verification is busy right now. Please pay online or try later."});
  const[[a]]=await db.query("SELECT SUM(created_at>NOW()-INTERVAL 30 SECOND) recent,COUNT(*) hour FROM otps WHERE phone=? AND created_at>NOW()-INTERVAL 1 HOUR",[phone]);
  if(+a.recent)return s.status(429).json({error:"Please wait 30 seconds before asking for another OTP"});
  if(+a.hour>=3)return s.status(429).json({error:"Too many OTPs for this number. Please try again in an hour or pay online."});
  const code=String(crypto.randomInt(0,1000000)).padStart(6,"0");
  await db.query("INSERT INTO otps(phone,code_hash,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))",[phone,hmac(phone,code)]);
  if(!(await N.otp(phone,code)))return s.status(502).json({error:"We could not send the OTP right now. Please try again or pay online."});
  s.json({ok:1})}));
 app.post("/api/otp/verify",rl(30,60,"Too many attempts. Please try again later."),h(async(q,s)=>{
  const phone=String(q.body.phone||"").trim(),code=String(q.body.code||"").trim();
  const[[o]]=await db.query("SELECT id,code_hash,attempts FROM otps WHERE phone=? AND verified=0 AND used=0 AND expires_at>NOW() ORDER BY id DESC LIMIT 1",[phone]);
  if(!o)return s.status(400).json({error:"This OTP has expired or was not requested. Please request a new one."});
  if(o.attempts>=5)return s.status(400).json({error:"Too many wrong attempts. Please request a new OTP."});
  await db.query("UPDATE otps SET attempts=attempts+1 WHERE id=?",[o.id]);
  const a=Buffer.from(hmac(phone,code)),b=Buffer.from(o.code_hash);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return s.status(400).json({error:"Wrong OTP. Please check and try again."});
  await db.query("UPDATE otps SET verified=1 WHERE id=?",[o.id]);
  s.json({token:jwt.sign({oid:o.id,ph:phone,pu:"cod"},sec,{expiresIn:"30m"})})}));
 // checkout calls these: check() validates the token (it is consumed inside the order transaction)
 const check=async(token,phone)=>{
  if(!token)return{error:"Please verify your phone number with an OTP to place a Cash on delivery order"};
  let v;try{v=jwt.verify(token,sec)}catch{return{error:"Your OTP verification expired. Please verify again."}}
  if(v.pu!=="cod"||v.ph!==phone)return{error:"The OTP was for a different phone number. Please verify again."};
  const[[o]]=await db.query("SELECT id FROM otps WHERE id=? AND phone=? AND verified=1 AND used=0",[v.oid,phone]);
  return o?{id:o.id}:{error:"This OTP was already used. Please verify again."}};
 const trusted=async cid=>{if(!cid)return false;const[[x]]=await db.query("SELECT 1 f FROM orders WHERE customer_id=? AND status='Delivered' LIMIT 1",[cid]);return !!x}; // repeat customers skip the OTP
 setInterval(()=>db.query("DELETE FROM otps WHERE created_at<NOW()-INTERVAL 2 DAY").catch(()=>{}),6*3600e3).unref();

 // ---------- email verification ----------
 async function sendVerify(c){try{
  const t=crypto.randomBytes(32).toString("hex");
  await db.query("UPDATE customers SET verify_hash=?,verify_expires=DATE_ADD(NOW(),INTERVAL 48 HOUR) WHERE id=?",[sha(t),c.id]);
  if(!BASE)console.error("Set BASE_URL in .env - email verification links cannot be created without it");else N.verifyEmail(c.email,c.name,BASE+"/#verify-"+t)}
  catch(e){console.error("sendVerify:",e.code||e.name||"application_error")}}
 app.post("/api/customer/verify",rl(20,60,"Too many attempts. Please try again later."),h(async(q,s)=>{
  const t=String(q.body.token||"");if(!/^[a-f0-9]{64}$/.test(t))return s.status(400).json({error:"This verification link is not valid."});
  const[u]=await db.query("UPDATE customers SET email_verified=1,verify_hash=NULL,verify_expires=NULL WHERE verify_hash=? AND verify_expires>NOW()",[sha(t)]);
  if(!u.affectedRows)return s.status(400).json({error:"This verification link is invalid or has expired. Log in and press 'Resend link'."});s.json({ok:1})}));
 app.post("/api/customer/verify/resend",cauth,rl(3,60,"Too many requests. Please try again in an hour."),h(async(q,s)=>{
  const[[c]]=await db.query("SELECT id,name,email,email_verified FROM customers WHERE id=?",[q.cid]);if(!c)return s.status(404).json({error:"Account not found"});
  if(!c.email_verified)await sendVerify(c);s.json({ok:1})}));

 return{enabled,check,trusted,sendVerify};
};
