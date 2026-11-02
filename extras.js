// Step 5: GST invoices (PDF), admin reports + CSV exports, saved addresses, wishlist.
const E=process.env;
const STATES=["Andaman and Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chandigarh","Chhattisgarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu and Kashmir","Jharkhand","Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Puducherry","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal"];
const HSN={Hoodies:"6110",Sweaters:"6110",Mufflers:"6117",Caps:"6505",Socks:"6115",Gloves:"6116"};
const r2=x=>Math.round(x*100)/100,m2=x=>Number(x).toFixed(2),norm=s=>String(s||"").trim().toLowerCase();
const sameState=o=>!!norm(E.STORE_STATE)&&norm(E.STORE_STATE)===norm(o.state);
const fy=d=>{d=new Date(d);const a=d.getMonth()>=3?d.getFullYear():d.getFullYear()-1;return a+"-"+String(a+1).slice(2)};
const invNo=o=>"INV/"+fy(o.created_at)+"/"+String(o.id).padStart(6,"0");

function chkAddr(b){
 const a={name:String(b.name||"").trim().slice(0,80),phone:String(b.phone||"").trim(),line:String(b.line||"").trim().slice(0,200),city:String(b.city||"").trim().slice(0,60),state:String(b.state||"").trim(),pincode:String(b.pincode||"").trim(),label:String(b.label||"").trim().slice(0,30)};
 if(!a.name||!/^\d{10}$/.test(a.phone))return{error:"Enter your name and a 10-digit phone number"};
 if(a.line.length<5||!a.city)return{error:"Enter your full address (house, street, area) and city"};
 if(!/^[1-9]\d{5}$/.test(a.pincode))return{error:"Enter a valid 6-digit pincode"};
 if(!STATES.includes(a.state))return{error:"Please choose your state"};
 return{a}}

// Prices are GST-inclusive. Coupon discount is spread across items; GST is backed out of the net amount.
function taxLines(o,items){
 const intra=sameState(o),disc=o.discount||0,sub=items.reduce((a,i)=>a+i.price*i.qty,0);let left=disc;
 const split=(tax)=>intra?{cgst:r2(tax/2),sgst:r2(tax-r2(tax/2)),igst:0}:{cgst:0,sgst:0,igst:tax};
 const L=items.map((i,k)=>{const gross=Number(i.price)*Number(i.qty),d=Math.min(left,gross,k===items.length-1?left:Math.round(disc*gross/(sub||1)));left-=d;
  const rate=Number(i.gst_rate),hsn=String(i.hsn||"");
  if(![0,5,12,18,28].includes(rate)||!/^\d{4,8}$/.test(hsn))throw Object.assign(new Error("Tax rate or HSN is missing from this order's saved tax details"),{code:"TAX_CONFIG"});
  const net=gross-d,taxable=r2(net/(1+rate/100)),tax=r2(net-taxable);
  return{name:i.name,size:i.size,hsn,qty:i.qty,rate,gross,disc:d,net,taxable,tax,...split(tax)}});
 const ship=Math.max(0,o.total-(sub-disc));
 if(ship>0){
  const rate=Number(E.SHIPPING_GST_RATE),hsn=String(E.SHIPPING_HSN||"");
  if(![0,5,12,18,28].includes(rate)||!/^\d{4,8}$/.test(hsn))throw Object.assign(new Error("Configure SHIPPING_GST_RATE and SHIPPING_HSN before finalizing invoices with shipping charges"),{code:"TAX_CONFIG"});
  const taxable=r2(ship/(1+rate/100)),tax=r2(ship-taxable);L.push({name:"Shipping charges",hsn,qty:1,rate,gross:ship,disc:0,net:ship,taxable,tax,ship:true,...split(tax)})
 }
 return L}

function pdfInvoice(res,o,items){
 const PDFDocument=require("pdfkit"),gst=!!E.STORE_GSTIN,intra=sameState(o),L=taxLines(o,items);
 const doc=new PDFDocument({size:"A4",margin:36});
 res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="Invoice-${o.code}.pdf"`);doc.pipe(res);
 const sub=items.reduce((a,i)=>a+i.price*i.qty,0),ship=L.filter(l=>l.ship).reduce((a,l)=>a+l.net,0);
 doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f7a3d").text(E.STORE_NAME||"SeasonKart",36,36);
 doc.font("Helvetica").fontSize(9).fillColor("#444").text([E.STORE_ADDRESS,E.STORE_PHONE&&"Phone: "+E.STORE_PHONE,E.STORE_EMAIL,gst?"GSTIN: "+E.STORE_GSTIN:"",gst&&E.STORE_STATE?"State: "+E.STORE_STATE:""].filter(Boolean).join("\n"),36,60,{width:290});
 doc.font("Helvetica-Bold").fontSize(15).fillColor("#000").text(gst?"TAX INVOICE":"INVOICE",330,36,{width:229,align:"right"});
 doc.font("Helvetica").fontSize(9).text(`Invoice no: ${invNo(o)}\nInvoice date: ${new Date(o.created_at).toLocaleDateString("en-IN")}\nOrder ID: ${o.code}\nPayment: ${o.payment_method==="cod"?"Cash on delivery":"Paid online"}`,330,58,{width:229,align:"right"});
 doc.font("Helvetica-Bold").fontSize(9).text("Bill to / Ship to",36,128).font("Helvetica").text(`${o.customer_name}\n${o.address}\nPhone: ${o.phone}${gst&&o.state?"\nPlace of supply: "+o.state:""}`,36,141,{width:330});
 let y=200;
 const cols=gst?(intra?[["Description",0,"left"],["HSN",44,"left"],["Qty",26,"right"],["Taxable",58,"right"],["GST%",32,"right"],["CGST",50,"right"],["SGST",50,"right"],["Amount",60,"right"]]:[["Description",0,"left"],["HSN",44,"left"],["Qty",26,"right"],["Taxable",62,"right"],["GST%",34,"right"],["IGST",58,"right"],["Amount",64,"right"]]):[["Description",0,"left"],["Qty",30,"right"],["Price",70,"right"],["Amount",80,"right"]];
 cols[0][1]=523-cols.slice(1).reduce((a,c)=>a+c[1],0);
 const val=(l,k)=>({Description:l.name+(l.size?` (${l.size})`:""),HSN:l.hsn,Qty:String(l.qty),Taxable:m2(l.taxable),"GST%":l.rate+"%",CGST:m2(l.cgst),SGST:m2(l.sgst),IGST:m2(l.igst),Price:m2(l.gross/l.qty),Amount:m2(l.net)})[k];
 const row=(vals,bold,fill)=>{doc.font(bold?"Helvetica-Bold":"Helvetica").fontSize(8.5);
  const h=Math.max(18,...vals.map((v,i)=>doc.heightOfString(v,{width:cols[i][1]-6})+8));
  if(y+h>770){doc.addPage();y=40}
  if(fill)doc.rect(36,y,523,h).fill("#eaf3ee");doc.fillColor("#000");
  let x=36;vals.forEach((v,i)=>{doc.text(v,x+3,y+4,{width:cols[i][1]-6,align:cols[i][2]});x+=cols[i][1]});
  y+=h;doc.moveTo(36,y).lineTo(559,y).lineWidth(.5).strokeColor("#ccc").stroke()};
 row(cols.map(c=>c[0]),true,true);L.forEach(l=>row(cols.map(c=>val(l,c[0]))));
 y+=12;
 const line=(a,b,bold)=>{if(y>770){doc.addPage();y=40}doc.font(bold?"Helvetica-Bold":"Helvetica").fontSize(bold?11:9).fillColor("#000").text(a,300,y,{width:160,align:"right"}).text(b,465,y,{width:94,align:"right"});y+=bold?18:14};
 line("Items total (incl. GST)","Rs. "+m2(sub));
 if(o.discount)line("Coupon "+(o.coupon_code||"")+" discount","- Rs. "+m2(o.discount));
 if(ship)line("Shipping (incl. GST)","Rs. "+m2(ship));
 line("Grand total","Rs. "+m2(o.total),true);
 if(gst){y+=6;const t=k=>L.reduce((a,l)=>a+l[k],0);doc.font("Helvetica-Bold").fontSize(9).text("GST summary",36,y);y+=14;
  line("Taxable value","Rs. "+m2(t("taxable")));
  if(intra){line("CGST","Rs. "+m2(t("cgst")));line("SGST","Rs. "+m2(t("sgst")))}else line("IGST","Rs. "+m2(t("igst")))}
 y+=14;doc.font("Helvetica").fontSize(8).fillColor("#666").text(`All prices are inclusive of GST where applicable.${gst?"":" Seller is not registered under GST."} This is a computer-generated invoice and does not need a signature. Returns: see our Returns & Refunds policy on the website.`,36,y,{width:523});
 doc.end()}

const csvCell=v=>{v=String(v??"");if(/^[=+\-@\t\r]/.test(v))v="'"+v;return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
const toCsv=rows=>"\ufeff"+rows.map(r=>r.map(csvCell).join(",")).join("\r\n");

module.exports=({app,db,h,rl,auth,cauth,jwt,tok})=>{
 // ---------- invoices ----------
 const sendInv=async(res,o)=>{
  if(!o)return res.status(404).json({error:"Order not found"});
  if(!["Shipped","Delivered"].includes(o.status))return res.status(400).json({error:"The invoice is available once your order has been shipped"});
  let snapshot=o.gst_snapshot;
  try{if(typeof snapshot==="string")snapshot=JSON.parse(snapshot)}catch{snapshot=null}
  let it;
  if(Array.isArray(snapshot)&&snapshot.length){
   if(snapshot.length>100||snapshot.some(i=>!i||typeof i.name!=="string"||!Number.isFinite(Number(i.price))||!Number.isInteger(Number(i.qty))||Number(i.qty)<1))return res.status(409).json({error:"Saved order tax snapshot is malformed; contact the store to issue a corrected invoice"});
   it=snapshot.map(i=>({...i,price:Number(i.price),qty:Number(i.qty),gst_rate:Number(i.gst_rate)}));
  }else{
   [it]=await db.query("SELECT name,price,qty,CONCAT_WS(' / ',NULLIF(size,''),NULLIF(color,'')) size,gst_rate,hsn FROM order_items WHERE order_id=?",[o.id]);
  }
  try{pdfInvoice(res,o,it)}catch(e){console.error("invoice generation failed:",e.code||"pdf_error");if(!res.headersSent)res.status(e.code==="TAX_CONFIG"?409:500).json({error:e.code==="TAX_CONFIG"?e.message:"Could not create the invoice (run npm install to add pdfkit)"})}};
 app.get("/api/customer/orders/:code/invoice",cauth,h(async(q,s)=>{const[[o]]=await db.query("SELECT * FROM orders WHERE code=? AND customer_id=?",[q.params.code,q.cid]);await sendInv(s,o)}));
 app.get("/api/invoice",rl(20,15,"Too many attempts. Please wait a few minutes."),h(async(q,s)=>{const[[o]]=await db.query("SELECT * FROM orders WHERE code=? AND phone=?",[String(q.query.code||"").toUpperCase(),String(q.query.phone||"")]);await sendInv(s,o)}));
 app.get("/api/orders/:code/invoice",auth,h(async(q,s)=>{const[[o]]=await db.query("SELECT * FROM orders WHERE code=?",[q.params.code]);await sendInv(s,o)}));

 // ---------- reports ----------
 const rng=q=>{const ok=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||"");return[ok(q.query.from)?q.query.from:new Date(Date.now()-29*864e5).toISOString().slice(0,10),ok(q.query.to)?q.query.to:new Date().toISOString().slice(0,10)]};
 const RANGE="o.created_at>=? AND o.created_at<DATE_ADD(?,INTERVAL 1 DAY)",VALID="o.status<>'Cancelled' AND NOT (o.payment_method='online' AND o.payment_status='pending') AND "+RANGE;
 const gstRows=async(from,to)=>{
  const[os]=await db.query(`SELECT * FROM orders o WHERE ${VALID} ORDER BY o.id LIMIT 5000`,[from,to]);if(!os.length)return[];
  const[its]=await db.query("SELECT order_id,name,price,qty,CONCAT_WS(' / ',NULLIF(size,''),NULLIF(color,'')) size,gst_rate,hsn FROM order_items WHERE order_id IN (?)",[os.map(o=>o.id)]);const out=[];
  os.forEach(o=>taxLines(o,its.filter(i=>i.order_id===o.id)).forEach(l=>out.push({o,l})));return out};
 app.get("/api/reports",auth,h(async(q,s)=>{const[from,to]=rng(q),a=[from,to],n=Number;
  const[[sm]]=await db.query(`SELECT COUNT(*) n,IFNULL(SUM(o.total),0) gross,IFNULL(SUM(o.discount),0) disc,IFNULL(SUM(o.payment_method='cod'),0) cod,IFNULL(SUM(o.payment_method='online'),0) onl FROM orders o WHERE ${VALID}`,a);
  const[[cn]]=await db.query(`SELECT COUNT(*) n,IFNULL(SUM(o.total),0) t FROM orders o WHERE o.status='Cancelled' AND ${RANGE}`,a);
  const[[rf]]=await db.query(`SELECT COUNT(*) n,IFNULL(SUM(o.total),0) t FROM orders o WHERE o.status<>'Cancelled' AND o.return_status='refunded' AND ${RANGE}`,a);
  const[days]=await db.query(`SELECT DATE_FORMAT(o.created_at,'%Y-%m-%d') d,COUNT(*) n,SUM(o.total) t FROM orders o WHERE ${VALID} GROUP BY d ORDER BY d`,a);
  const[top]=await db.query(`SELECT oi.name,SUM(oi.qty) q,SUM(oi.price*oi.qty) r FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${VALID} GROUP BY oi.product_id,oi.name ORDER BY q DESC LIMIT 10`,a);
  const[cats]=await db.query(`SELECT IFNULL(p.category,'Other') c,SUM(oi.qty) q,SUM(oi.price*oi.qty) r FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id WHERE ${VALID} GROUP BY c ORDER BY r DESC`,a);
  const g=(await gstRows(from,to)).reduce((t,{l})=>({taxable:t.taxable+l.taxable,tax:t.tax+l.tax}),{taxable:0,tax:0});
  s.json({from,to,n:n(sm.n),gross:n(sm.gross),disc:n(sm.disc),cod:n(sm.cod),onl:n(sm.onl),cn:n(cn.n),ct:n(cn.t),rn:n(rf.n),rt:n(rf.t),
   days:days.map(x=>({d:x.d,n:n(x.n),t:n(x.t)})),top:top.map(x=>({name:x.name,q:n(x.q),r:n(x.r)})),cats:cats.map(x=>({c:x.c,q:n(x.q),r:n(x.r)})),gst:{taxable:r2(g.taxable),tax:r2(g.tax)}})}));
 app.get("/api/export/:kind",auth,h(async(q,s)=>{const[from,to]=rng(q),k=q.params.kind;let rows;
  if(k==="orders"){const[r]=await db.query(`SELECT o.code,o.created_at,o.customer_name,o.phone,o.email,o.address,o.state,o.coupon_code,o.discount,o.total,o.payment_method,o.payment_status,o.status,o.return_status,GROUP_CONCAT(CONCAT(oi.name,' x',oi.qty) SEPARATOR '; ') items FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE ${RANGE} GROUP BY o.id ORDER BY o.id`,[from,to]);
   rows=[["Order ID","Date","Customer","Phone","Email","Address","State","Coupon","Discount","Total","Payment method","Payment status","Status","Return","Items"],...r.map(x=>[x.code,new Date(x.created_at).toISOString().slice(0,16).replace("T"," "),x.customer_name,x.phone,x.email,x.address,x.state,x.coupon_code,x.discount,x.total,x.payment_method,x.payment_status,x.status,x.return_status,x.items])]}
  else if(k==="gst"){rows=[["Invoice no","Order ID","Date","Customer","Place of supply","Description","HSN/SAC","Qty","GST %","Taxable value","CGST","SGST","IGST","Invoice value"],...(await gstRows(from,to)).map(({o,l})=>[invNo(o),o.code,new Date(o.created_at).toISOString().slice(0,10),o.customer_name,o.state||"",l.name,l.hsn,l.qty,l.rate,l.taxable,l.cgst,l.sgst,l.igst,l.net])]}
  else if(k==="inventory"){const[r]=await db.query("SELECT p.name,p.category,p.price,p.mrp,p.stock,p.gst_rate,p.hsn,IFNULL(s.name,'') sup,p.active FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id ORDER BY p.id");
   rows=[["Product","Category","Price","MRP","Stock","GST %","HSN","Supplier","Active"],...r.map(x=>[x.name,x.category,x.price,x.mrp,x.stock,x.gst_rate,x.hsn,x.sup,x.active?"Yes":"No"])]}
  else return s.status(404).json({error:"Unknown export"});
  s.setHeader("Content-Type","text/csv; charset=utf-8");s.setHeader("Content-Disposition",`attachment; filename="${k}-${from}-to-${to}.csv"`);s.send(toCsv(rows))}));

 // ---------- saved addresses ----------
 app.get("/api/customer/addresses",cauth,h(async(q,s)=>{const[r]=await db.query("SELECT id,label,name,phone,line,city,state,pincode,is_default FROM addresses WHERE customer_id=? ORDER BY is_default DESC,id DESC",[q.cid]);s.json(r)}));
 app.post("/api/customer/addresses",cauth,h(async(q,s)=>{const c=chkAddr(q.body);if(c.error)return s.status(400).json({error:c.error});const a=c.a;
  const[[d]]=await db.query("SELECT COUNT(*) n,SUM(line=? AND pincode=?) same FROM addresses WHERE customer_id=?",[a.line,a.pincode,q.cid]);
  if(+d.same)return s.json({ok:1});if(d.n>=5)return s.status(400).json({error:"You can save up to 5 addresses. Delete one first."});
  await db.query("INSERT INTO addresses(customer_id,label,name,phone,line,city,state,pincode,is_default) VALUES(?,?,?,?,?,?,?,?,?)",[q.cid,a.label||null,a.name,a.phone,a.line,a.city,a.state,a.pincode,d.n===0?1:0]);s.json({ok:1})}));
 app.patch("/api/customer/addresses/:id/default",cauth,h(async(q,s)=>{const[[a]]=await db.query("SELECT id FROM addresses WHERE id=? AND customer_id=?",[q.params.id,q.cid]);if(!a)return s.status(404).json({error:"Address not found"});
  await db.query("UPDATE addresses SET is_default=(id=?) WHERE customer_id=?",[a.id,q.cid]);s.json({ok:1})}));
 app.delete("/api/customer/addresses/:id",cauth,h(async(q,s)=>{await db.query("DELETE FROM addresses WHERE id=? AND customer_id=?",[q.params.id,q.cid]);
  await db.query("UPDATE addresses SET is_default=1 WHERE customer_id=? AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM addresses WHERE customer_id=? AND is_default=1) x) ORDER BY id DESC LIMIT 1",[q.cid,q.cid]);s.json({ok:1})}));

 // ---------- wishlist ----------
 app.get("/api/customer/wishlist",cauth,h(async(q,s)=>{const[r]=await db.query("SELECT product_id FROM wishlist WHERE customer_id=?",[q.cid]);s.json(r.map(x=>x.product_id))}));
 app.post("/api/customer/wishlist/:pid",cauth,h(async(q,s)=>{await db.query("INSERT IGNORE INTO wishlist(customer_id,product_id) SELECT ?,id FROM products WHERE id=? AND active=1",[q.cid,q.params.pid]);s.json({ok:1})}));
 app.delete("/api/customer/wishlist/:pid",cauth,h(async(q,s)=>{await db.query("DELETE FROM wishlist WHERE customer_id=? AND product_id=?",[q.cid,q.params.pid]);s.json({ok:1})}));

 return{STATES,HSN,chkAddr,taxLines,invNo};
};
module.exports.taxLines=taxLines;
