// Step 11: sell any kind of product - admin categories, home banners/settings, product details (brand, specs, origin, return/COD rules, parcel size), CSV import.
const {validPricePair,taxMatchesCategory}=require("./product-rules");
module.exports=({app,db,h,auth})=>{
 const GST=[0,5,12,18,28],clip=(x,n)=>String(x??"").trim().slice(0,n);
 const LINKS=["df","u500","rt","new"];

 const catInfo=async name=>{const[[c]]=await db.query("SELECT emoji,gst_rate,hsn FROM categories WHERE name=?",[name]);return c||null};
 const ensureCat=async name=>catInfo(name);

 // ---------- categories ----------
 app.get("/api/categories",h(async(q,s)=>{const[r]=await db.query("SELECT c.name,c.emoji FROM categories c WHERE c.active=1 AND EXISTS(SELECT 1 FROM products p WHERE p.active=1 AND p.category=c.name) ORDER BY c.sort,c.name");s.set("Cache-Control","public, max-age=60").json(r)}));
 app.get("/api/admin/categories",auth,h(async(q,s)=>{const[r]=await db.query("SELECT c.id,c.name,c.emoji,c.gst_rate,c.hsn,c.sort,(SELECT COUNT(*) FROM products p WHERE p.category=c.name) n FROM categories c ORDER BY c.sort,c.name");s.json(r.map(x=>({...x,n:+x.n})))}));
 const catBody=b=>{const name=clip(b.name,60),emoji=clip(b.emoji,8)||"📦",g=parseInt(b.gst_rate),hsn=clip(b.hsn,8),sort=parseInt(b.sort);
  if(!name)return{error:"Category name is required"};if(/[\/\\?#%]/.test(name))return{error:"Category name cannot contain / \\ ? # %"};
  if(!GST.includes(g))return{error:"GST must be 0, 5, 12, 18 or 28"};if(!/^\d{4,8}$/.test(hsn))return{error:"A configured 4 to 8 digit HSN is required"};
  return{v:[name,emoji,g,hsn,Number.isInteger(sort)?sort:99]}};
 app.post("/api/admin/categories",auth,h(async(q,s)=>{const c=catBody(q.body);if(c.error)return s.status(400).json({error:c.error});
  try{await db.query("INSERT INTO categories(name,emoji,gst_rate,hsn,sort) VALUES(?,?,?,?,?)",c.v)}catch(e){if(e.code==="ER_DUP_ENTRY")return s.status(400).json({error:"This category already exists"});throw e}s.json({ok:1})}));
 app.put("/api/admin/categories/:id",auth,h(async(q,s)=>{const c=catBody(q.body);if(c.error)return s.status(400).json({error:c.error});
  const[[o]]=await db.query("SELECT name FROM categories WHERE id=?",[q.params.id]);if(!o)return s.status(404).json({error:"Category not found"});
  try{await db.query("UPDATE categories SET name=?,emoji=?,gst_rate=?,hsn=?,sort=? WHERE id=?",[...c.v,q.params.id])}catch(e){if(e.code==="ER_DUP_ENTRY")return s.status(400).json({error:"Another category already has this name"});throw e}
  await db.query("UPDATE products SET category=?,gst_rate=?,hsn=? WHERE category=?",[c.v[0],c.v[2],c.v[3],o.name]);
  s.json({ok:1})}));
 app.delete("/api/admin/categories/:id",auth,h(async(q,s)=>{const[[o]]=await db.query("SELECT name FROM categories WHERE id=?",[q.params.id]);if(!o)return s.status(404).json({error:"Category not found"});
  const[[n]]=await db.query("SELECT COUNT(*) n FROM products WHERE category=?",[o.name]);if(n.n>0)return s.status(400).json({error:n.n+" product(s) are in this category. Move or delete them first."});
  await db.query("DELETE FROM categories WHERE id=?",[q.params.id]);s.json({ok:1})}));

 // ---------- home banners ----------
 app.get("/api/settings",h(async(q,s)=>{const[[r]]=await db.query("SELECT v FROM settings WHERE k='banners'");let b=null;try{b=r&&JSON.parse(r.v)}catch{}s.set("Cache-Control","public, max-age=60").json({banners:Array.isArray(b)&&b.length?b:null})}));
 app.put("/api/settings",auth,h(async(q,s)=>{
  const hex=x=>/^#[0-9a-fA-F]{6}$/.test(x||"")?x:null,out=[];
  for(const b of(Array.isArray(q.body.banners)?q.body.banners:[]).slice(0,4)){const t=clip(b.t,80);if(!t)continue;
   const l=clip(b.l,70),ok=l===""||/^cat:.+/.test(l)||(/^see:/.test(l)&&LINKS.includes(l.slice(4)));if(!ok)return s.status(400).json({error:"Banner link is not valid"});
   out.push({t,x:clip(b.x,160),b:clip(b.b,30)||"Shop now",l,c1:hex(b.c1)||"#2457d6",c2:hex(b.c2)||"#173f9e"})}
  if(!out.length)await db.query("DELETE FROM settings WHERE k='banners'");else await db.query("INSERT INTO settings(k,v) VALUES('banners',?) ON DUPLICATE KEY UPDATE v=VALUES(v)",[JSON.stringify(out)]);
  s.json({ok:1,banners:out.length})}));

 // ---------- product details: brand, specs, origin, return/COD rules, parcel size ----------
 const cleanSpecs=t=>String(t||"").split(/\r?\n/).map(l=>l.trim().replace(/\s+/g," ")).filter(l=>l.includes(":")&&!l.startsWith(":")).slice(0,30).map(l=>l.slice(0,200)).join("\n")||null;
 function cleanDetails(b){const f={};
  f.brand=clip(b.brand,80)||null;f.sku=clip(b.sku,40)||null;if(f.sku&&!/^[A-Za-z0-9._-]+$/.test(f.sku))return{error:"SKU can only have letters, numbers and . _ -"};
  f.origin=clip(b.origin,40)||"India";f.maker=clip(b.maker,255)||null;f.specs=cleanSpecs(b.specs);f.opt1=clip(b.opt1,20)||"Size";f.opt2=clip(b.opt2,20)||"Colour";
  const rd=b.ret_days;f.ret_days=(rd===""||rd==null||rd==="default")?null:parseInt(rd);if(f.ret_days!==null&&!(f.ret_days>=0&&f.ret_days<=60))return{error:"Return days must be 0 (no returns) to 60"};
  f.cod_ok=(b.cod_ok===false||b.cod_ok===0||b.cod_ok==="0")?0:1;
  for(const k of["pkg_l","pkg_b","pkg_h"]){const v=b[k];f[k]=(v===""||v==null)?null:parseInt(v);if(f[k]!==null&&!(f[k]>=1&&f[k]<=300))return{error:"Parcel size must be 1 to 300 cm"}}
  return{f}}
 app.patch("/api/products/:id/details",auth,h(async(q,s)=>{const d=cleanDetails(q.body);if(d.error)return s.status(400).json({error:d.error});
  const keys=Object.keys(d.f);
  try{const[r]=await db.query(`UPDATE products SET ${keys.map(k=>k+"=?").join(",")} WHERE id=?`,[...keys.map(k=>d.f[k]),q.params.id]);if(!r.affectedRows)return s.status(404).json({error:"Product not found"})}
  catch(e){if(e.code==="ER_DUP_ENTRY")return s.status(400).json({error:"Another product already uses this SKU"});throw e}
  s.json({ok:1})}));

 // ---------- CSV import (the browser parses the file and sends rows) ----------
 app.post("/api/products/import",auth,h(async(q,s)=>{
  const rows=Array.isArray(q.body.rows)?q.body.rows.slice(0,500):[];if(!rows.length)return s.status(400).json({error:"The file has no product rows"});
  const[sups]=await db.query("SELECT id,active FROM suppliers"),res={created:0,updated:0,errors:[]},int=x=>(x===""||x==null)?null:Number(x);
  for(let i=0;i<rows.length;i++){const r=rows[i]||{};try{
   const name=clip(r.name,120),cat=clip(r.category,60),price=int(r.price),mrp=int(r.mrp)??price,stock=int(r.stock)??0;
   if(!name)throw new Error("name is required");if(!cat||/[\/\\?#%]/.test(cat))throw new Error("category is required (no / \\ ? # %)");
   if(!validPricePair(price,mrp))throw new Error("price and MRP must be finite positive whole numbers; MRP must be at least the price");if(!(Number.isInteger(stock)&&stock>=0))throw new Error("stock must be 0 or more");
   const d=cleanDetails({brand:r.brand,sku:r.sku,origin:r.origin,maker:r.maker,specs:String(r.specs||"").replace(/;/g,"\n"),opt1:r.option1,opt2:r.option2,ret_days:r.return_days,cod_ok:/^(no|n|0|false)$/i.test(String(r.cod||"").trim())?0:1,pkg_l:r.length_cm,pkg_b:r.breadth_cm,pkg_h:r.height_cm});if(d.error)throw new Error(d.error);
   const cd=await ensureCat(cat);if(!cd)throw new Error("category tax configuration is missing; create and configure it before importing products");const gst=int(r.gst)??cd.gst_rate;if(!GST.includes(gst))throw new Error("gst must be 0, 5, 12, 18 or 28");
   const hsn=clip(r.hsn,8)||(cd&&cd.hsn)||"";if(hsn&&!/^\d{4,8}$/.test(hsn))throw new Error("hsn must be 4 to 8 digits");
   if(!taxMatchesCategory(cd,gst,hsn))throw new Error("gst and hsn must follow the configured category rules");
   const w=int(r.weight_g)??500;if(!(w>=1&&w<=100000))throw new Error("weight_g must be 1 to 100000");
   const supplierId=int(r.supplier_id),sup=supplierId==null?null:sups.find(x=>x.id===supplierId);
   if(supplierId!=null&&(!Number.isInteger(supplierId)||!sup||!sup.active))throw new Error("supplier_id must identify an active supplier");
   const desc=clip(r.description,2000)||null,f=d.f;
   const[[ex]]=f.sku?await db.query("SELECT id FROM products WHERE sku=?",[f.sku]):[[null]];
   const cols={name,category:cat,price,mrp,stock,gst_rate:gst,hsn,weight_g:w,description:desc,supplier_id:supplierId,...f};
   if(ex){const k=Object.keys(cols);await db.query(`UPDATE products SET ${k.map(x=>x+"=?").join(",")} WHERE id=?`,[...k.map(x=>cols[x]),ex.id]);res.updated++}
   else{cols.emoji=(cd&&cd.emoji)||"📦";const k=Object.keys(cols);await db.query(`INSERT INTO products(${k.join(",")}) VALUES(${k.map(()=>"?").join(",")})`,k.map(x=>cols[x]));res.created++}
  }catch(e){res.errors.push({row:i+2,error:e.code==="ER_DUP_ENTRY"?"duplicate SKU":e.message})}}
  s.json(res)}));

 return{catInfo,ensureCat,cleanDetails};
};
