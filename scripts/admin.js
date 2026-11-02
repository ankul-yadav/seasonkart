// Create an admin or reset an admin password from the server console:
//   node scripts/admin.js you@example.com 'A-long-new-password'
try{require("dotenv").config()}catch(e){}
const mysql=require("mysql2/promise"),bcrypt=require("bcryptjs");
(async()=>{
 const[email,pw]=process.argv.slice(2);
 if(!/^\S+@\S+\.\S+$/.test(email||"")||(pw||"").length<10){console.log("Usage: node scripts/admin.js <email> <password of 10+ characters>");process.exit(1)}
 const c=await mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASS,database:process.env.DB_NAME}),hash=await bcrypt.hash(pw,10);
 const[[a]]=await c.query("SELECT id FROM admins WHERE email=?",[email]);
 if(a){await c.query("UPDATE admins SET password_hash=? WHERE id=?",[hash,a.id]);console.log("Password updated for "+email)}
 else{await c.query("INSERT INTO admins(email,password_hash) VALUES(?,?)",[email,hash]);console.log("Admin created: "+email)}
 await c.end()
})().catch(e=>{console.error(e.message);process.exit(1)});
