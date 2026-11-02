// Add the MegaMart-style demo catalogue without dropping tables or deleting customer/order data.
// Existing winter demo products are hidden (active=0), not deleted. Run: npm run seed:megamart
require('dotenv').config();
const mysql = require('mysql2/promise');
const {mysqlOptions}=require('../db-config');
const {assertSafeDemoSeed}=require('./seed-safety');
const categories = [
  ['Demo: Mobiles','📱',18,'8517',1],['Demo: Electronics','🎧',18,'8518',2],['Demo: Home & Kitchen','🍳',18,'7323',3],
  ['Demo: Books','📚',0,'4901',4],['Demo: Footwear','👟',12,'6404',5],['Demo: Grocery','🥜',5,'0802',6],
  ['Demo: Clothing','🧥',5,'6110',7],['Demo: Sports','🧘',12,'9506',8],['Demo: Beauty','🧴',18,'3304',9]
];
const suppliers = [
  ['Demo: MegaMart Direct','General Merchandise','Pune'],['Demo: Acme Electronics','Electronics','Pune'],
  ['Demo: Orange Press','Books','Delhi'],['Demo: NutriFarm','Grocery','Pune'],['Demo: Urban Basics','Clothing','Mumbai']
];
const products = [
  {sku:'MM-MOB-001',name:'Smartphone X 128GB',category:'Mobiles',brand:'Acme',price:14999,mrp:17999,emoji:'📱',gst:18,hsn:'8517',weight:300,desc:'Smartphone with 6.5 inch AMOLED display, 50MP camera and 5000mAh battery.',specs:'RAM: 6 GB\nStorage: 128 GB\nDisplay: 6.5 inch AMOLED\nBattery: 5000 mAh\nConnectivity: 5G',maker:'Acme Pvt Ltd, Pune, Maharashtra',supplier:'Demo: Acme Electronics'},
  {sku:'MM-ELE-001',name:'Wireless Earbuds Pro',category:'Electronics',brand:'SoundMax',price:1999,mrp:3999,emoji:'🎧',gst:18,hsn:'8518',weight:180,desc:'Wireless earbuds with a compact charging case and clear everyday audio.',specs:'Connectivity: Bluetooth\nCharging: USB-C\nUse: Music and calls',maker:'SoundMax India',supplier:'Demo: Acme Electronics'},
  {sku:'MM-HOM-001',name:'Non-stick Cookware Set (3 pcs)',category:'Home & Kitchen',brand:'HomeChef',price:1499,mrp:2999,emoji:'🍳',gst:18,hsn:'7323',weight:1800,desc:'Everyday non-stick cookware set for home kitchens.',specs:'Pieces: 3\nCoating: Non-stick\nUse: Home cooking',maker:'HomeChef India',supplier:'Demo: MegaMart Direct'},
  {sku:'MM-FTW-001',name:'Running Shoes',category:'Footwear',brand:'RunVibe',price:1299,mrp:2599,emoji:'👟',gst:12,hsn:'6404',weight:650,desc:'Lightweight everyday running shoes with a cushioned sole.',specs:'Type: Running shoes\nSole: Cushioned\nOrigin: India',maker:'RunVibe India',supplier:'Demo: Urban Basics'},
  {sku:'MM-BOK-001',name:'Python for Beginners',category:'Books',brand:'Orange Press',price:399,mrp:499,emoji:'📚',gst:0,hsn:'4901',weight:350,desc:'A beginner-friendly introduction to Python programming.',specs:'Language: English\nLevel: Beginner\nFormat: Paperback',maker:'Orange Press, Delhi',supplier:'Demo: Orange Press'},
  {sku:'MM-GRO-001',name:'Organic Almonds 500g',category:'Grocery',brand:'NutriFarm',price:449,mrp:599,emoji:'🥜',gst:5,hsn:'0802',weight:550,desc:'Packed almonds for everyday snacking and cooking.',specs:'Net quantity: 500 g\nShelf life: 9 months\nStorage: Keep in a cool, dry place',maker:'NutriFarm Pvt Ltd, Pune, Maharashtra',supplier:'Demo: NutriFarm'},
  {sku:'MM-CLO-001',name:'Men’s Hoodie',category:'Clothing',brand:'Urban Basics',price:599,mrp:1299,emoji:'🧥',gst:5,hsn:'6110',weight:500,desc:'Soft everyday hoodie for casual wear.',specs:'Type: Hoodie\nFit: Regular\nCare: Gentle wash',maker:'Urban Basics, Mumbai',supplier:'Demo: Urban Basics'},
  {sku:'MM-HOM-002',name:'LED Table Lamp',category:'Home & Kitchen',brand:'Luma',price:799,mrp:999,emoji:'💡',gst:18,hsn:'9405',weight:700,desc:'Compact LED table lamp for a desk or bedside table.',specs:'Type: LED desk lamp\nUse: Reading and desk lighting',maker:'Luma India',supplier:'Demo: MegaMart Direct'},
  {sku:'MM-SPT-001',name:'Yoga Mat 6mm',category:'Sports',brand:'FitLife',price:499,mrp:699,emoji:'🧘',gst:12,hsn:'9506',weight:900,desc:'Comfortable 6mm exercise mat for yoga and stretching.',specs:'Thickness: 6 mm\nUse: Yoga and floor exercise',maker:'FitLife India',supplier:'Demo: MegaMart Direct'},
  {sku:'MM-BEA-001',name:'Face Wash 100ml',category:'Beauty',brand:'GlowUp',price:199,mrp:249,emoji:'🧴',gst:18,hsn:'3304',weight:130,desc:'Everyday facial cleanser in a 100ml pack.',specs:'Net quantity: 100 ml\nUse: Face cleanser',maker:'GlowUp India',supplier:'Demo: MegaMart Direct'}
];
(async()=>{
  assertSafeDemoSeed();
  const db=await mysql.createConnection(mysqlOptions(process.env,{charset:'utf8mb4'}));
  try {
    const required=['admins','suppliers','products','categories'];
    const [rows]=await db.query('SHOW TABLES'); const have=new Set(rows.map(r=>Object.values(r)[0]));
    const missing=required.filter(t=>!have.has(t)); if(missing.length) throw new Error('Missing required tables: '+missing.join(', ')+'. Import schema.sql / run migrations first.');
    await db.beginTransaction();
    for(const [name,emoji,gst,hsn,sort] of categories) await db.query(
      'INSERT INTO categories(name,emoji,gst_rate,hsn,sort,active) VALUES(?,?,?,?,?,1) ON DUPLICATE KEY UPDATE emoji=VALUES(emoji),gst_rate=VALUES(gst_rate),hsn=VALUES(hsn),sort=VALUES(sort),active=1',
      [name,emoji,gst,hsn,sort]);
    const supplierIds={};
    for(const [name,category,location] of suppliers){
      const [[found]]=await db.query('SELECT id FROM suppliers WHERE name=? ORDER BY id LIMIT 1',[name]);
      if(found){supplierIds[name]=found.id;await db.query('UPDATE suppliers SET category=?,location=?,active=1,is_demo=1 WHERE id=?',[category,location,found.id]);}
      else {const [r]=await db.query('INSERT INTO suppliers(name,category,location,active,is_demo) VALUES(?,?,?,1,1)',[name,category,location]);supplierIds[name]=r.insertId;}
    }
    // Only hide the six known sample winter products; preserve their rows and all other user data.
    await db.query("UPDATE products SET active=0,is_demo=1 WHERE name IN ('Men’s Hoodie','Woolen Scarf','Winter Cap','Woolen Socks (Pack of 3)','Wool Sweater','Fleece Gloves') AND (sku IS NULL OR sku NOT LIKE 'MM-%')");
    for(const p of products){
      const category='Demo: '+p.category;
      await db.query(`INSERT INTO products(name,category,price,mrp,rating,emoji,review_count,description,sku,brand,specs,origin,maker,opt1,opt2,ret_days,cod_ok,weight_g,gst_rate,hsn,stock,supplier_id,active,is_demo)
        VALUES(?,?,?,?,0,?,0,?,?,?,?, 'India',?,'Option','Colour',7,1,?,?,?,50,?,0,1)
        ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),price=VALUES(price),mrp=VALUES(mrp),emoji=VALUES(emoji),description=VALUES(description),brand=VALUES(brand),specs=VALUES(specs),maker=VALUES(maker),weight_g=VALUES(weight_g),gst_rate=VALUES(gst_rate),hsn=VALUES(hsn),supplier_id=VALUES(supplier_id),active=0,is_demo=1`,
        [p.name,category,p.price,p.mrp,p.emoji,p.desc,p.sku,p.brand,p.specs,p.maker,p.weight,p.gst,p.hsn,supplierIds[p.supplier]]);
    }
    await db.commit();
    const [[counts]]=await db.query("SELECT (SELECT COUNT(*) FROM categories WHERE active=1) categories,(SELECT COUNT(*) FROM products WHERE active=1) products,(SELECT COUNT(*) FROM admins) admins,(SELECT COUNT(*) FROM orders) orders");
    console.log('MegaMart demo catalogue applied successfully.');
    console.log(`Active categories: ${counts.categories}; active products: ${counts.products}; existing admin accounts: ${counts.admins}; existing orders preserved: ${counts.orders}.`);
    console.log('No tables or customer/order records were dropped. Product reviews are not fabricated.');
  } catch(e){await db.rollback();throw e;} finally {await db.end();}
})().catch(e=>{console.error('Seed failed:',e.message);process.exit(1)});
