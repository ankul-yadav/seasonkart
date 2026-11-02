// "Is my setup OK?"  ->  npm run doctor      (checks Node, packages, .env, MySQL, tables and which optional services are on)
try{require("dotenv").config()}catch(e){}
const fs=require("fs"),path=require("path"),E=process.env;let fails=0,warns=0;
const ok=m=>console.log("  ✅ "+m),bad=(m,fix)=>{fails++;console.log("  ❌ "+m+(fix?"\n     -> "+fix:""))},warn=(m,why)=>{warns++;console.log("  ⚠️  "+m+(why?"\n     "+why:""))};
const ROOT=path.join(__dirname,"..");process.chdir(ROOT);const UPLOAD_ROOT=path.resolve(E.UPLOAD_DIR||path.join(ROOT,"public","uploads"));
(async()=>{
 console.log("\nSeasonKart setup check\n\n1. Node.js");
 const[ma,mi]=process.versions.node.split(".").map(Number);(ma>20||(ma===20&&mi>=9))?ok("Node.js "+process.version):bad("Node.js "+process.version+" is too old","Install Node.js 20.9 or newer from https://nodejs.org");
 console.log("\n2. Packages");
 const miss=["express","mysql2","jsonwebtoken","bcryptjs","razorpay","helmet","express-rate-limit","multer","nodemailer","pdfkit","dotenv","sharp"].filter(m=>{try{require.resolve(m);return false}catch{return true}});
 miss.length?bad("Not installed: "+miss.join(", "),"Open the terminal in this folder and run:  npm install"):ok("All required packages are installed");
 try{require.resolve("sharp");ok("sharp (photo compression) is installed")}catch{warn("sharp is not installed","Photos will still upload but will not be compressed. Run: npm install")}
 console.log("\n3. Settings (.env)");
 if(!fs.existsSync(".env")&&!E.JWT_SECRET)bad(".env file not found","Copy .env.local.example to .env  (Windows: copy .env.local.example .env)");
 else{
  (E.JWT_SECRET||"").length>=32&&!/change-this/i.test(E.JWT_SECRET)?ok("JWT_SECRET is set"):bad("JWT_SECRET is missing or too short (needs 32+ characters)","Put any long text after JWT_SECRET= in .env");
  E.ADMIN_EMAIL&&E.ADMIN_PASSWORD?ok("Admin login will be "+E.ADMIN_EMAIL):warn("ADMIN_EMAIL / ADMIN_PASSWORD not set","The first admin is created from these on first start. Set them, or later run: node scripts/admin.js you@example.com 'password-of-10-chars'");
  E.DB_NAME&&E.DB_USER?ok("Database: "+E.DB_USER+"@"+(E.DB_HOST||"localhost")+"/"+E.DB_NAME):bad("DB_USER / DB_NAME missing in .env");
  if(E.NODE_ENV==="production"&&!/^https:\/\//i.test(E.BASE_URL||""))warn("BASE_URL is not set to an HTTPS public URL","Set it to the final Render or custom-domain URL before launch.");
  if(E.NODE_ENV==="production"&&E.DB_USER==="root")warn("The app connects to MySQL as root","Create a limited database user for the live service (see DEPLOY.md).");
 }
 console.log("\n4. MySQL database");
 try{
  const my=require("mysql2/promise"),c=await my.createConnection({host:E.DB_HOST||"localhost",user:E.DB_USER,password:E.DB_PASS,database:E.DB_NAME,connectTimeout:6000});
  const[[v]]=await c.query("SELECT VERSION() v");ok("Connected to MySQL "+v.v);
  const have=new Set((await c.query("SHOW TABLES"))[0].map(r=>Object.values(r)[0])),need=["admins","suppliers","products","orders","order_items","customers","coupons","reviews","addresses","wishlist","product_images","product_variants","categories","settings","otps"],lack=need.filter(t=>!have.has(t));
  lack.length?bad("Missing tables: "+lack.join(", "),have.size?"Your database is older than this version. Run:  npm run migrate":"The tables are not created yet. Import schema.sql (see LOCAL-SETUP.md step 4)"):ok("All tables exist");
  if(!lack.length){const[[a]]=await c.query("SELECT COUNT(*) n FROM admins"),[[p]]=await c.query("SELECT COUNT(*) n FROM products");
   a.n?ok(a.n+" admin account(s)"):warn("No admin account yet","It is created automatically the first time you run: npm start");ok(p.n+" product(s) in the shop"+(p.n?" (schema.sql adds a few demo ones - delete them before going live)":""));
   const[images]=await c.query("SELECT image path FROM products WHERE active=1 AND image LIKE '/uploads/%' UNION SELECT pi.url path FROM product_images pi JOIN products p ON p.id=pi.product_id WHERE p.active=1 AND pi.url LIKE '/uploads/%' UNION SELECT pi.thumb path FROM product_images pi JOIN products p ON p.id=pi.product_id WHERE p.active=1 AND pi.thumb LIKE '/uploads/%'");
   const missing=[...new Set(images.map(r=>r.path).filter(u=>!fs.existsSync(path.resolve(UPLOAD_ROOT,path.basename(u)))))];
   missing.length?warn(missing.length+" product image file(s) are missing","Upload the real product photos in Admin > Products before launch. The storefront uses a placeholder for missing files."):ok("All referenced product image files are present")}
  await c.end();
 }catch(e){
  const m={ECONNREFUSED:"MySQL is not running (or DB_HOST is wrong). Start MySQL (Windows: Services > MySQL > Start, or XAMPP > Start MySQL).",ER_ACCESS_DENIED_ERROR:"Wrong DB_USER or DB_PASS in .env.",ER_BAD_DB_ERROR:"The database '"+E.DB_NAME+"' does not exist yet. Import schema.sql (LOCAL-SETUP.md step 4).",ENOTFOUND:"DB_HOST could not be found."}[e.code];
  bad("Cannot use MySQL: "+(e.code||e.message),m||e.message);
 }
 console.log("\n5. Optional services (the shop works without them)");
 const on=(c,n,off)=>c?ok(n+" is configured"):warn(n+" is off",off);
 on(E.RAZORPAY_KEY_ID&&E.RAZORPAY_KEY_SECRET,"Online payment (Razorpay)","Only Cash on delivery works. Add Razorpay TEST keys to try online payment.");
 on(E.SMTP_HOST,"Email","Emails are printed in this terminal instead of being sent (so you can still click verification / password-reset links).");
 on((E.TWILIO_SID&&E.TWILIO_TOKEN)||(E.WA_TOKEN&&E.WA_PHONE_ID),"SMS / WhatsApp","No SMS or WhatsApp messages and no COD OTP.");
 on(E.SHIPROCKET_EMAIL,"Shiprocket courier","Enter courier tracking by hand in the order page.");
 console.log(fails?"\n❌ "+fails+" problem(s) above. Fix them and run again:  npm run doctor\n":warns?"\n⚠️  Setup checks passed with "+warns+" warning(s). Review them before launch.  Start the shop:  npm start   then open http://localhost:"+(E.PORT||3000)+"\n":"\n✅ Everything needed is ready.  Start the shop:  npm start   then open http://localhost:"+(E.PORT||3000)+"\n");
 process.exit(fails?1:0);
})();
