// Step 7: photo optimisation (sharp -> WebP), multiple photos per product, size/colour variants with per-variant stock.
const multer=require("multer"),path=require("path"),fs=require("fs"),crypto=require("crypto");
const {validPricePair}=require("./product-rules");
let sharp=null;try{sharp=require("sharp")}catch(e){console.warn("WARNING: 'sharp' is not installed - photos will be saved without resizing. Run: npm install")}
const MAXPH=8,MAXVAR=60;
module.exports=({app,db,h,auth,UP})=>{
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:6*1024*1024,files:MAXPH}});
 const upMany=(q,s,n)=>upload.array("images",MAXPH)(q,s,e=>e?s.status(400).json({error:e.code==="LIMIT_FILE_SIZE"?"Each photo must be under 6 MB":e.code==="LIMIT_UNEXPECTED_FILE"||e.code==="LIMIT_FILE_COUNT"?"You can upload at most "+MAXPH+" photos at once":e.message}):n());

 // Resize + compress to WebP (max 1000px) plus a 420px thumbnail; EXIF/GPS metadata is stripped.
 async function prep(file){
  const id="p"+crypto.randomBytes(8).toString("hex");
  if(!sharp){const ext={"image/jpeg":".jpg","image/png":".png","image/webp":".webp"}[file.mimetype];if(!ext)throw new Error("Only JPG, PNG or WEBP photos are allowed");
   fs.writeFileSync(path.join(UP,id+ext),file.buffer);return{url:"/uploads/"+id+ext,thumb:"/uploads/"+id+ext,share:"/uploads/"+id+ext}}
  const meta=await sharp(file.buffer,{limitInputPixels:40e6}).metadata().catch(()=>null);
  if(!meta||!["jpeg","png","webp"].includes(meta.format))throw new Error("Only JPG, PNG or WEBP photos are allowed ("+(file.originalname||"file")+")");
  const base=()=>sharp(file.buffer,{limitInputPixels:40e6}).rotate();
  await base().resize(1000,1000,{fit:"inside",withoutEnlargement:true}).webp({quality:80}).toFile(path.join(UP,id+".webp"));
  await base().resize(420,420,{fit:"cover"}).webp({quality:75}).toFile(path.join(UP,id+"-t.webp"));
  await base().resize(1200,1200,{fit:"inside",withoutEnlargement:true}).flatten({background:"#ffffff"}).jpeg({quality:82,mozjpeg:true}).toFile(path.join(UP,id+"-s.jpg")); // social-preview copy (WhatsApp/Facebook read JPEG most reliably)
  return{url:"/uploads/"+id+".webp",thumb:"/uploads/"+id+"-t.webp",share:"/uploads/"+id+"-s.jpg"}}
 const prepAll=async files=>{const out=[];try{for(const f of files||[])out.push(await prep(f))}catch(e){out.forEach(rm);throw e}return out};
 const rm=im=>[im.url,im.thumb,im.share].filter((u,i,a)=>u&&a.indexOf(u)===i).forEach(u=>{if(String(u).startsWith("/uploads/"))fs.unlink(path.join(UP,path.basename(u)),()=>{})});
 const sync=async pid=>{await db.query("UPDATE products SET image=(SELECT url FROM product_images WHERE product_id=? ORDER BY position,id LIMIT 1) WHERE id=?",[pid,pid])};
 async function attach(pid,list){
  const[[c]]=await db.query("SELECT COUNT(*) n,IFNULL(MAX(position),-1) mx FROM product_images WHERE product_id=?",[pid]);
  if(+c.n+list.length>MAXPH){list.forEach(rm);throw new Error("A product can have at most "+MAXPH+" photos")}
  let pos=+c.mx+1;for(const im of list)await db.query("INSERT INTO product_images(product_id,url,thumb,share,position) VALUES(?,?,?,?,?)",[pid,im.url,im.thumb,im.share||null,pos++]);
  await sync(pid)}

 app.get("/api/products/:id/images",auth,h(async(q,s)=>{const[r]=await db.query("SELECT id,url,thumb FROM product_images WHERE product_id=? ORDER BY position,id",[q.params.id]);s.json(r)}));
 app.post("/api/products/:id/images",auth,upMany,h(async(q,s)=>{
  if(!q.files||!q.files.length)return s.status(400).json({error:"Choose at least one photo"});
  const[[p]]=await db.query("SELECT id FROM products WHERE id=?",[q.params.id]);if(!p)return s.status(404).json({error:"Product not found"});
  try{await attach(p.id,await prepAll(q.files))}catch(e){return s.status(400).json({error:e.message})}s.json({ok:1})}));
 app.patch("/api/products/:id/images/:img/main",auth,h(async(q,s)=>{
  const[[i]]=await db.query("SELECT id FROM product_images WHERE id=? AND product_id=?",[q.params.img,q.params.id]);if(!i)return s.status(404).json({error:"Photo not found"});
  await db.query("UPDATE product_images SET position=position+1 WHERE product_id=?",[q.params.id]);await db.query("UPDATE product_images SET position=0 WHERE id=?",[i.id]);await sync(q.params.id);s.json({ok:1})}));
 app.delete("/api/products/:id/images/:img",auth,h(async(q,s)=>{
  const[[i]]=await db.query("SELECT id,url,thumb,share FROM product_images WHERE id=? AND product_id=?",[q.params.img,q.params.id]);if(!i)return s.status(404).json({error:"Photo not found"});
  await db.query("DELETE FROM product_images WHERE id=?",[i.id]);rm(i);await sync(q.params.id);s.json({ok:1})}));

 app.patch("/api/products/:id/description",auth,h(async(q,s)=>{const t=String(q.body.text||"").trim().slice(0,2000);
  const[r]=await db.query("UPDATE products SET description=? WHERE id=?",[t||null,q.params.id]);if(!r.affectedRows)return s.status(404).json({error:"Product not found"});s.json({ok:1})}));

 // ---------- variants ----------
 const SIZE=/^[A-Za-z0-9 .+\/-]{1,12}$/,COLOR=/^[A-Za-z0-9 .\/-]{0,30}$/;
 const money=x=>{if(x===""||x==null)return null;const n=Number(x);return Number.isInteger(n)&&n>0&&n<=10000000?n:NaN};
 const stock=x=>{const n=parseInt(x);return Number.isInteger(n)&&n>=0&&n<=100000?n:null};
 const countV=async pid=>(await db.query("SELECT COUNT(*) n FROM product_variants WHERE product_id=? AND active=1",[pid]))[0][0].n;
 app.get("/api/products/:id/variants",auth,h(async(q,s)=>{const[r]=await db.query("SELECT id,size,color,stock,price,mrp FROM product_variants WHERE product_id=? AND active=1 ORDER BY id",[q.params.id]);s.json(r)}));
 app.post("/api/products/:id/variants",auth,h(async(q,s)=>{
  const size=String(q.body.size||"").trim(),color=String(q.body.color||"").trim(),st=stock(q.body.stock),pr=money(q.body.price),mr=money(q.body.mrp);
  if(Number.isNaN(pr)||Number.isNaN(mr))return s.status(400).json({error:"Price must be a positive whole number and MRP cannot be lower than the price"});
  if(!SIZE.test(size))return s.status(400).json({error:"Enter a size (up to 12 letters/numbers), e.g. M, XL, 28 or Free Size"});
  if(!COLOR.test(color))return s.status(400).json({error:"Colour can only have letters, numbers, spaces and - / ."});
  if(st===null)return s.status(400).json({error:"Stock must be a whole number (0 or more)"});
  const[[p]]=await db.query("SELECT id,price,mrp FROM products WHERE id=?",[q.params.id]);if(!p)return s.status(404).json({error:"Product not found"});
  if(!validPricePair(pr??Number(p.price),mr??Number(p.mrp)))return s.status(400).json({error:"Variant price must be positive and MRP cannot be lower than its selling price"});
  if(await countV(p.id)>=MAXVAR)return s.status(400).json({error:"At most "+MAXVAR+" size/colour combinations per product"});
  await db.query("INSERT INTO product_variants(product_id,size,color,stock,price,mrp) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE stock=VALUES(stock),price=VALUES(price),mrp=VALUES(mrp),active=1",[p.id,size,color,st,pr,mr]);s.json({ok:1})}));
 app.post("/api/products/:id/variants/bulk",auth,h(async(q,s)=>{
  const list=x=>[...new Set(String(x||"").split(",").map(v=>v.trim()).filter(Boolean))],sizes=list(q.body.sizes),colors=list(q.body.colors),st=stock(q.body.stock);
  if(!sizes.length)return s.status(400).json({error:"Enter sizes separated by commas, e.g. S,M,L,XL"});
  if(sizes.some(v=>!SIZE.test(v))||colors.some(v=>!COLOR.test(v)))return s.status(400).json({error:"Sizes/colours contain unsupported characters"});
  if(st===null)return s.status(400).json({error:"Stock must be a whole number (0 or more)"});
  const cols=colors.length?colors:[""],rows=[];sizes.forEach(z=>cols.forEach(c=>rows.push([+q.params.id,z,c,st])));
  const[[p]]=await db.query("SELECT id FROM products WHERE id=?",[q.params.id]);if(!p)return s.status(404).json({error:"Product not found"});
  if(rows.length>MAXVAR)return s.status(400).json({error:"That would create "+rows.length+" combinations; the limit is "+MAXVAR});
  await db.query("INSERT INTO product_variants(product_id,size,color,stock) VALUES ? ON DUPLICATE KEY UPDATE active=1",[rows]);s.json({ok:1,created:rows.length})}));
 app.put("/api/variants/:id",auth,h(async(q,s)=>{const st=stock(q.body.stock),pr=money(q.body.price),mr=money(q.body.mrp);if(st===null)return s.status(400).json({error:"Stock must be a whole number (0 or more)"});
  if(Number.isNaN(pr)||Number.isNaN(mr))return s.status(400).json({error:"Price must be a positive whole number and MRP cannot be lower than the price"});
  const[[v]]=await db.query("SELECT p.price,p.mrp FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND v.active=1",[q.params.id]);if(!v)return s.status(404).json({error:"Variant not found"});
  if(!validPricePair(pr??Number(v.price),mr??Number(v.mrp)))return s.status(400).json({error:"Variant price must be positive and MRP cannot be lower than its selling price"});
  const[r]=await db.query("UPDATE product_variants SET stock=?,price=?,mrp=? WHERE id=?",[st,pr,mr,q.params.id]);if(!r.affectedRows)return s.status(404).json({error:"Not found"});s.json({ok:1})}));
 app.delete("/api/variants/:id",auth,h(async(q,s)=>{await db.query("UPDATE product_variants SET active=0,stock=0 WHERE id=?",[q.params.id]);s.json({ok:1})}));

 return{upMany,prepAll,attach,rm};
};
