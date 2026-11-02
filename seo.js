// Step 8: SEO. Real product/category URLs (/p/12-name, /c/Hoodies), server-rendered <title>/description/Open Graph/JSON-LD
// (so Google and WhatsApp previews work without running JavaScript), sitemap.xml and robots.txt.
const fs=require("fs"),path=require("path");
module.exports=({app,db,h,rl,E,PROD,BASE})=>{
 const FILE=path.join(__dirname,"public","index.html"),store=E.STORE_NAME||"SeasonKart";let cache={m:0,html:""};
 const page=()=>{const m=fs.statSync(FILE).mtimeMs;if(m!==cache.m)cache={m,html:fs.readFileSync(FILE,"utf8")};return cache.html};
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const slug=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60);
 const purl=p=>"/p/"+p.id+(slug(p.name)?"-"+slug(p.name):""),curl=c=>"/c/"+encodeURIComponent(c);
 const baseOf=q=>BASE||(PROD?"":q.protocol+"://"+q.get("host")); // never trust the Host header in production
 const abs=(b,u)=>/^https?:\/\//.test(u)?u:b+u;
 const lim=rl(300,15,"Too many requests. Please slow down.");
 const rs=n=>"Rs."+Number(n).toLocaleString("en-IN");
 const DEFAULT_DESC=E.SEO_DESCRIPTION||`Shop online at ${store}: great prices, free shipping above Rs.999, easy returns and cash on delivery.`;

 // same stock/price rules as the shop API
 const PSQL=`SELECT p.id,p.name,p.category,p.price,p.mrp,p.rating,p.review_count rc,p.description d,p.brand b,
  IFNULL((SELECT COALESCE(share,url) FROM product_images WHERE product_id=p.id ORDER BY position,id LIMIT 1),p.image) img,
  IF(EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id AND v.active=1),(SELECT SUM(v.stock) FROM product_variants v WHERE v.product_id=p.id AND v.active=1),p.stock) st
  FROM products p WHERE p.active=1`;

 function send(q,s,o){
  const b=baseOf(q),url=b?b+o.path:"",ld=(o.ld||[]).map(x=>`<script type="application/ld+json">${JSON.stringify(x).replace(/</g,"\\u003c")}</script>`);
  const tags=[`<meta name="description" content="${esc(o.desc)}">`,o.robots?`<meta name="robots" content="${o.robots}">`:"",url?`<link rel="canonical" href="${esc(url)}">`:"",
   `<meta property="og:site_name" content="${esc(store)}">`,`<meta property="og:type" content="${o.type||"website"}">`,`<meta property="og:title" content="${esc(o.title)}">`,`<meta property="og:description" content="${esc(o.desc)}">`,
   url?`<meta property="og:url" content="${esc(url)}">`:"",o.image&&b?`<meta property="og:image" content="${esc(abs(b,o.image))}">`:"",
   `<meta name="twitter:card" content="${o.image&&b?"summary_large_image":"summary"}">`,...ld].filter(Boolean).join("\n");
  const html=page().replace(/<title>[\s\S]*?<\/title>/,`<title>${esc(o.title)}</title>`).replace("</head>",tags+"\n</head>").replace(/<body[^>]*>/,m=>m+`<noscript>${o.noscript||""}</noscript>`);
  s.status(o.status||200).set("Cache-Control","public, max-age=300").type("html").send(html)}
 const links=L=>`<ul>${L.map(p=>`<li><a href="${purl(p)}">${esc(p.name)}</a> - ${rs(p.price)}</li>`).join("")}</ul>`;
 const notFound=(q,s)=>send(q,s,{status:404,title:"Page not found | "+store,desc:"This page does not exist.",path:q.path,robots:"noindex",noscript:`<h1>Page not found</h1><p><a href="/">Go to the shop</a></p>`});

 app.get("/",lim,h(async(q,s)=>{
  const[L]=await db.query(PSQL+" ORDER BY p.id DESC LIMIT 24"),[cs]=await db.query("SELECT DISTINCT category c FROM products WHERE active=1 AND category IS NOT NULL ORDER BY c"),b=baseOf(q);
  send(q,s,{title:`${store} - Online Shopping`,desc:DEFAULT_DESC,path:"/",
   ld:[{"@context":"https://schema.org","@type":"Organization",name:store,...(b?{url:b}:{}),...(E.STORE_EMAIL?{email:E.STORE_EMAIL}:{}),...(E.STORE_PHONE?{telephone:E.STORE_PHONE}:{})},
    ...(b?[{"@context":"https://schema.org","@type":"WebSite",name:store,url:b,potentialAction:{"@type":"SearchAction",target:b+"/?q={search_term_string}","query-input":"required name=search_term_string"}}]:[])],
   noscript:`<h1>${esc(store)}</h1><p>${esc(DEFAULT_DESC)}</p><h2>Categories</h2><ul>${cs.map(c=>`<li><a href="${curl(c.c)}">${esc(c.c)}</a></li>`).join("")}</ul><h2>Products</h2>${links(L)}`})}));
 app.get("/index.html",(q,s)=>s.redirect(301,"/"));

 app.get("/c/:name",lim,h(async(q,s)=>{
  const[cs]=await db.query("SELECT DISTINCT category c FROM products WHERE active=1 AND category IS NOT NULL"),hit=cs.find(x=>x.c.toLowerCase()===String(q.params.name).toLowerCase());
  if(!hit)return notFound(q,s);if(hit.c!==q.params.name)return s.redirect(301,curl(hit.c));
  const[L]=await db.query(PSQL+" AND p.category=? ORDER BY p.id DESC LIMIT 60",[hit.c]),b=baseOf(q);
  send(q,s,{title:`${hit.c} - Buy Online | ${store}`,desc:`Buy ${hit.c.toLowerCase()} online at ${store}. ${L.length} styles, free shipping above Rs.999, easy returns and cash on delivery.`,path:curl(hit.c),
   ld:b?[{"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:[{"@type":"ListItem",position:1,name:"Home",item:b+"/"},{"@type":"ListItem",position:2,name:hit.c,item:b+curl(hit.c)}]}]:[],
   noscript:`<h1>${esc(hit.c)}</h1>${links(L)}<p><a href="/">Home</a></p>`})}));

 app.get("/p/:slug",lim,h(async(q,s)=>{
  const id=parseInt(q.params.slug);if(!(id>0))return notFound(q,s);
  const[[p]]=await db.query(PSQL+" AND p.id=?",[id]);if(!p)return notFound(q,s);
  const want=purl(p);if("/p/"+q.params.slug!==want)return s.redirect(301,want);
  const b=baseOf(q),url=b+want,desc=(p.d||`${p.name} - ${p.category}. Available at ${store} with free shipping above Rs.999, easy returns and cash on delivery.`).replace(/\s+/g," ").trim().slice(0,160),inStock=+p.st>0;
  const ld=[{"@context":"https://schema.org","@type":"Product",name:p.name,description:desc,sku:"SK-"+p.id,category:p.category,brand:{"@type":"Brand",name:p.b||store},
   ...(p.img&&b?{image:[abs(b,p.img)]}:{}),
   offers:{"@type":"Offer",priceCurrency:"INR",price:String(p.price),availability:"https://schema.org/"+(inStock?"InStock":"OutOfStock"),itemCondition:"https://schema.org/NewCondition",...(b?{url}:{})},
   ...(p.rc>0?{aggregateRating:{"@type":"AggregateRating",ratingValue:String(+p.rating),reviewCount:p.rc}}:{})}];
  if(b)ld.push({"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:[{"@type":"ListItem",position:1,name:"Home",item:b+"/"},{"@type":"ListItem",position:2,name:p.category,item:b+curl(p.category)},{"@type":"ListItem",position:3,name:p.name,item:url}]});
  send(q,s,{title:`${p.name} | ${store}`,desc,path:want,image:p.img,type:"product",ld,
   noscript:`<h1>${esc(p.name)}</h1><p>${rs(p.price)}${p.mrp>p.price?` <s>${rs(p.mrp)}</s>`:""} - ${inStock?"In stock":"Out of stock"}</p><p>${esc(desc)}</p><p><a href="${curl(p.category)}">More ${esc(p.category)}</a> | <a href="/">Home</a></p>`})}));

 app.get("/sitemap.xml",lim,h(async(q,s)=>{
  const b=baseOf(q);if(!b)return s.status(503).type("text/plain").send("Set BASE_URL in .env (your public https address) to enable the sitemap.");
  const[ps]=await db.query("SELECT id,name FROM products WHERE active=1 ORDER BY id"),[cs]=await db.query("SELECT DISTINCT category c FROM products WHERE active=1 AND category IS NOT NULL");
  const urls=[b+"/",...cs.map(x=>b+curl(x.c)),...ps.map(p=>b+purl(p))];
  s.set("Cache-Control","public, max-age=3600").type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${esc(u)}</loc></url>`).join("\n")}</urlset>`)}));
 app.get("/robots.txt",(q,s)=>{const b=baseOf(q);s.type("text/plain").send(`User-agent: *\nDisallow: /api/\nAllow: /\n${b?"Sitemap: "+b+"/sitemap.xml\n":""}`)});
 return{slug,purl};
};
