// Step 10: health check for uptime monitors, error alerts by email, graceful shutdown, admin system status.
const fs=require("fs"),path=require("path");
module.exports=({app,db,auth,h,rl,N,E,BASE})=>{
 const pkg=require("./package.json"),BDIR=path.resolve(E.BACKUP_DIR||path.join(__dirname,"backups"));
 const seen=new Map();let day={d:"",n:0};
 const safeError=err=>{
  const code=typeof err?.code==="string"&&/^[A-Z0-9_]{1,40}$/.test(err.code)?err.code:null;
  const name=typeof err?.name==="string"&&/^[A-Za-z]+$/.test(err.name)?err.name:"Error";
  return code?`${name} (${code})`:name;
 };

 // Email the owner when the server hits an unexpected error (same error at most once per 10 minutes, max 20 emails a day)
 async function alert(err,ctx,force){try{
  const summary=safeError(err),key=summary,now=Date.now(),today=new Date().toISOString().slice(0,10);
  if(day.d!==today)day={d:today,n:0};
  if(!force&&(day.n>=20||(seen.get(key)||0)>now-10*60e3))return;
  if(seen.size>200)seen.clear();seen.set(key,now);day.n++;
  await N.admin("["+(E.STORE_NAME||"SeasonKart")+"] Server error"+(ctx?": "+ctx:""),`${summary}\n\nTime: ${new Date().toISOString()}\nServer: ${require("os").hostname()}`)}catch(e){}}
 process.on("unhandledRejection",e=>{console.error("unhandledRejection:",safeError(e));alert(e,"unhandled promise rejection")});
 process.on("uncaughtException",e=>{console.error("uncaughtException:",safeError(e));Promise.race([alert(e,"uncaught exception - server restarting",true),new Promise(r=>setTimeout(r,4000))]).finally(()=>process.exit(1))}); // the process manager (PM2/systemd) starts it again

 // Finish in-flight requests, close the DB pool, then exit (used by `pm2 reload` / deployments)
 function graceful(server){const stop=sig=>{console.log(sig,"received - shutting down gracefully");server.close(()=>db.end().catch(()=>{}).finally(()=>process.exit(0)));setTimeout(()=>process.exit(1),10000).unref()};["SIGTERM","SIGINT"].forEach(g=>process.on(g,()=>stop(g)))}

 // Point UptimeRobot / Better Stack / Freshping at https://yourshop.com/health (reveals nothing sensitive)
 app.get("/health",rl(60,1,"Too many requests"),async(q,s)=>{
  try{await Promise.race([db.query("SELECT 1"),new Promise((_,r)=>setTimeout(()=>r(new Error("db timeout")),3000))]);s.set("Cache-Control","no-store").json({ok:true})}
  catch(e){console.error("health check failed:",safeError(e));s.status(503).set("Cache-Control","no-store").json({ok:false})}});

 // Admin dashboard: is the server, database, disk and backup job healthy?
 app.get("/api/system",auth,h(async(q,s)=>{
  const t0=Date.now();await db.query("SELECT 1");const dbMs=Date.now()-t0;
  let disk=null;try{const st=await fs.promises.statfs(__dirname);disk={freeGb:+(st.bavail*st.bsize/1e9).toFixed(1),totalGb:+(st.blocks*st.bsize/1e9).toFixed(1)}}catch{}
  let backup={lastAt:null,ageH:null};try{const m=fs.statSync(path.join(BDIR,".last_ok")).mtimeMs;backup={lastAt:new Date(m).toISOString(),ageH:+((Date.now()-m)/36e5).toFixed(1)}}catch{}
  const[[pr]]=await db.query("SELECT COUNT(*) n FROM orders WHERE payment_status='refund_pending'");
  const[[st]]=await db.query("SELECT COUNT(*) n FROM orders WHERE payment_method='online' AND payment_status='pending' AND status='Processing' AND created_at<NOW()-INTERVAL 2 HOUR");
  s.json({version:pkg.version,node:process.version,uptimeH:+(process.uptime()/3600).toFixed(1),dbMs,memMb:Math.round(process.memoryUsage().rss/1e6),disk,backup,pendingRefunds:+pr.n,stuckPayments:+st.n,email:!!E.SMTP_HOST,https:/^https:/.test(BASE||"")})}));
 return{alert,graceful};
};
