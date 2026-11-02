const fs=require("fs");
const path=require("path");

const ROOT=path.join(__dirname,"..");
const CHANGES={
  1:{tables:["admins","suppliers","products","orders","order_items","customers"],columns:{products:["image"],orders:["email","customer_id"]},indexes:{},constraints:{}},
  2:{columns:{products:["stock"]},indexes:{},constraints:{}},
  3:{columns:{orders:["rz_payment_id","refund_id","cancel_reason","cancelled_at","delivered_at","return_status","return_reason"]},indexes:{},constraints:{}},
  4:{columns:{customers:["reset_hash","reset_expires"]},indexes:{},constraints:{}},
  5:{tables:["coupons","reviews"],columns:{products:["review_count"],orders:["coupon_code","discount"]},indexes:{},constraints:{}},
  6:{tables:["addresses","wishlist"],columns:{products:["gst_rate","hsn"],orders:["state"],order_items:["gst_rate","hsn"]},indexes:{},constraints:{}},
  7:{columns:{products:["weight_g"],orders:["city","pincode","courier_name","awb","tracking_url","ship_status","sr_order_id","sr_shipment_id"]},indexes:{orders:["idx_awb"]},constraints:{}},
  8:{tables:["product_images","product_variants"],columns:{order_items:["color","variant_id"]},indexes:{},constraints:{}},
  9:{columns:{products:["description"],product_images:["share"]},indexes:{},constraints:{}},
  10:{tables:["otps"],columns:{customers:["email_verified","verify_hash","verify_expires"]},indexes:{},constraints:{}},
  11:{tables:["categories","settings"],columns:{products:["sku","brand","specs","origin","maker","opt1","opt2","ret_days","cod_ok","pkg_l","pkg_b","pkg_h"],product_variants:["price","mrp"],order_items:["ret_days"]},indexes:{products:["uq_sku"]},constraints:{}},
  12:{columns:{suppliers:["email","password_hash"],order_items:["supplier_status"]},indexes:{suppliers:["supplier_email_unique"]},constraints:{}},
  13:{tables:["supplier_payouts"],columns:{},indexes:{},constraints:{}},
  14:{columns:{suppliers:["payout_method","payout_upi_id","payout_account_name","payout_account_number","payout_ifsc","payout_bank_name","payout_updated_at"]},indexes:{},constraints:{}},
  15:{columns:{products:["is_demo"],suppliers:["is_demo"],orders:["cod_remitted_at","cod_remittance_reference"]},indexes:{orders:["idx_payout_eligibility"]},constraints:{}},
  16:{columns:{},indexes:{},constraints:{products:["products_supplier_id_fk"],order_items:["order_items_order_id_fk"]}},
  17:{tables:["supplier_webhook_outbox"],columns:{supplier_webhook_outbox:["event_id","supplier_id","order_code","event_type","endpoint_url","payload_json","status","attempts","last_error","locked_until","next_attempt_at","created_at","updated_at","sent_at"]},indexes:{supplier_webhook_outbox:["PRIMARY","supplier_webhook_outbox_ready_idx","supplier_webhook_outbox_supplier_idx"]},constraints:{}},
  18:{tables:["order_status_audit","supplier_payout_audit"],columns:{order_status_audit:["id","order_id","order_code","from_status","to_status","actor_role","actor_id","source","evidence_reference","created_at"],supplier_payout_audit:["id","payout_id","supplier_id","order_id","action","actor_id","payment_reference","notes","created_at"]},indexes:{order_status_audit:["PRIMARY","order_status_audit_order_idx"],supplier_payout_audit:["PRIMARY","supplier_payout_audit_payout_idx"]},constraints:{}},
  19:{columns:{orders:["gst_snapshot"]}},
  20:{columns:{orders:["delivery_verified_at","delivery_verified_by","delivery_reference"]},indexes:{},constraints:{}},
  21:{tables:["supplier_shipments"],columns:{supplier_shipments:["id","order_id","supplier_id","courier_name","awb","tracking_url","status","created_at","updated_at"]},indexes:{supplier_shipments:["PRIMARY","supplier_shipment_supplier_awb_unique","supplier_order_shipment_unique","supplier_shipments_order_idx"]},constraints:{}},
  22:{tables:["cod_remittance_audit","supplier_payout_adjustments"],columns:{orders:["cod_remitted_by"],cod_remittance_audit:["id","order_id","order_code","actor_id","reference","created_at"],supplier_payout_adjustments:["id","payout_id","supplier_id","order_id","amount","reason","reference","actor_id","created_at"]},indexes:{cod_remittance_audit:["PRIMARY","cod_remittance_audit_order_idx"],supplier_payout_adjustments:["PRIMARY","supplier_payout_adjustments_payout_idx"]},constraints:{}},
  23:{columns:{supplier_payout_adjustments:["direction"]},indexes:{},constraints:{}}
};

function splitTopLevel(text){
  const out=[];let start=0,depth=0,quote="";
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quote){
      if(ch===quote&&text[i-1]!=="\\"){
        if(text[i+1]===quote){i++;continue}
        quote="";
      }
    }else if(ch==="'"||ch==='"'||ch==="`")quote=ch;
    else if(ch==="(")depth++;
    else if(ch===")")depth--;
    else if(ch===","&&depth===0){out.push(text.slice(start,i).trim());start=i+1}
  }
  if(text.slice(start).trim())out.push(text.slice(start).trim());
  return out;
}

function unquote(value){
  if(value==="NULL")return null;
  if(value&&value[0]==="'"&&value[value.length-1]==="'")return value.slice(1,-1).replace(/''/g,"'");
  return value;
}

function parseSchema(){
  const sql=fs.readFileSync(path.join(ROOT,"schema.sql"),"utf8"),tables=new Map();
  for(const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+`?([a-zA-Z0-9_]+)`?\s*\(([\s\S]*?)\)\s*(?:ENGINE=[^;]*)?;/gi)){
    const table=match[1],definition={columns:new Map(),indexes:new Map(),constraints:new Map()};
    for(const entry of splitTopLevel(match[2])){
      if(/^(?:CONSTRAINT|FOREIGN KEY|PRIMARY KEY|UNIQUE KEY|KEY)\b/i.test(entry)){
        const idx=entry.match(/^(PRIMARY KEY|UNIQUE KEY|KEY)(?:\s+`?([a-zA-Z0-9_]+)`?)?\s*\(([^)]*)\)/i);
        if(idx){
          const cols=idx[3].split(",").map(x=>x.trim().replace(/`/g,"").split(/\s+/)[0]);
          const name=idx[1].toUpperCase()==="PRIMARY KEY"?"PRIMARY":(idx[2]||cols[0]);
          definition.indexes.set(name,{unique:idx[1].toUpperCase()!=="KEY",columns:cols});
        }
        const fk=entry.match(/^CONSTRAINT\s+`?([a-zA-Z0-9_]+)`?\s+FOREIGN KEY\s*\(([^)]*)\)\s+REFERENCES\s+`?([a-zA-Z0-9_]+)`?\s*\(([^)]*)\)([\s\S]*)$/i);
        if(fk)definition.constraints.set(fk[1],{columns:fk[2].split(",").map(x=>x.trim().replace(/`/g,"")),table:fk[3],references:fk[4].split(",").map(x=>x.trim().replace(/`/g,"")),deleteRule:(fk[5].match(/ON DELETE\s+(CASCADE|SET NULL|RESTRICT|NO ACTION)/i)||[])[1]?.toUpperCase()||"NO ACTION"});
        continue;
      }
      const col=entry.match(/^`?([a-zA-Z0-9_]+)`?\s+((?:enum|set)\s*\([^)]*\)|[a-zA-Z]+(?:\s*\([^)]*\))?(?:\s+unsigned)?)([\s\S]*)$/i);
      if(col){
        const tail=col[3],def=tail.match(/\bDEFAULT\s+(NULL|'(?:''|[^'])*'|"(?:""|[^"])*"|CURRENT_TIMESTAMP(?:\(\))?|-?\d+(?:\.\d+)?)/i);
        definition.columns.set(col[1],{
          type:col[2].replace(/\s+/g," ").trim().toLowerCase(),
          nullable:!/\bNOT NULL\b|\bPRIMARY KEY\b/i.test(tail),
          hasDefault:!!def,
          defaultValue:def?unquote(def[1]):undefined,
          autoIncrement:/\bAUTO_INCREMENT\b/i.test(tail),
          onUpdate:(tail.match(/\bON UPDATE\s+(CURRENT_TIMESTAMP(?:\(\))?)/i)||[])[1]?.toUpperCase()||null
        });
        if(/\bPRIMARY KEY\b/i.test(tail))definition.indexes.set("PRIMARY",{unique:true,columns:[col[1]]});
        else if(/\bUNIQUE\b/i.test(tail))definition.indexes.set(col[1],{unique:true,columns:[col[1]]});
        continue;
      }
    }
    tables.set(table,definition);
  }
  for(const match of sql.matchAll(/ALTER TABLE\s+`?([a-zA-Z0-9_]+)`?\s+([\s\S]*?);/gi)){
    const definition=tables.get(match[1]);if(!definition)continue;
    for(const action of splitTopLevel(match[2])){
      const col=action.match(/^ADD\s+COLUMN\s+`?([a-zA-Z0-9_]+)`?\s+((?:enum|set)\s*\([^)]*\)|[a-zA-Z]+(?:\s*\([^)]*\))?(?:\s+unsigned)?)([\s\S]*)$/i);
      if(col){
        const def=col[3].match(/\bDEFAULT\s+(NULL|'(?:''|[^'])*'|"(?:""|[^"])*"|CURRENT_TIMESTAMP(?:\(\))?|-?\d+(?:\.\d+)?)/i);
        definition.columns.set(col[1],{type:col[2].replace(/\s+/g," ").trim().toLowerCase(),nullable:!/\bNOT NULL\b|\bPRIMARY KEY\b/i.test(col[3]),hasDefault:!!def,defaultValue:def?unquote(def[1]):undefined,autoIncrement:/\bAUTO_INCREMENT\b/i.test(col[3]),onUpdate:(col[3].match(/\bON UPDATE\s+(CURRENT_TIMESTAMP(?:\(\))?)/i)||[])[1]?.toUpperCase()||null});
        continue;
      }
      const idx=action.match(/^ADD\s+(UNIQUE\s+)?KEY\s+`?([a-zA-Z0-9_]+)`?\s*\(([^)]*)\)/i);
      if(idx)definition.indexes.set(idx[2],{unique:!!idx[1],columns:idx[3].split(",").map(x=>x.trim().replace(/`/g,"").split(/\s+/)[0])});
    }
  }
  return tables;
}

function migrationFiles(){
  return fs.readdirSync(ROOT).map(file=>({file,match:file.match(/^migrate(\d*)\.sql$/)}))
    .filter(x=>x.match).map(x=>({file:x.file,number:Number(x.match[1]||1)}))
    .sort((a,b)=>a.number-b.number);
}

function requirements(upto,all=false){
  const schema=parseSchema(),tables=new Set(),columns=new Map(),indexes=new Map(),constraints=new Map(),contractErrors=[];
  if(all){
    for(const [table,def] of schema){tables.add(table);columns.set(table,new Set(def.columns.keys()));indexes.set(table,new Set(def.indexes.keys()));constraints.set(table,new Set(def.constraints.keys()))}
    for(const [number,change] of Object.entries(CHANGES)){
      (change.tables||[]).forEach(table=>{if(!schema.has(table))contractErrors.push(`Fresh schema is missing migration ${number} table ${table}`)});
      for(const [table,names] of Object.entries(change.columns||{}))for(const name of names)if(!schema.get(table)?.columns.has(name))contractErrors.push(`Fresh schema is missing migration ${number} column ${table}.${name}`);
      for(const [table,names] of Object.entries(change.indexes||{}))for(const name of names)if(!schema.get(table)?.indexes.has(name))contractErrors.push(`Fresh schema is missing migration ${number} index ${table}.${name}`);
      for(const [table,names] of Object.entries(change.constraints||{}))for(const name of names)if(!schema.get(table)?.constraints.has(name))contractErrors.push(`Fresh schema is missing migration ${number} foreign key ${table}.${name}`);
    }
    return{schema,tables,columns,indexes,constraints,contractErrors};
  }
  for(const [number,change] of Object.entries(CHANGES)){
    if(+number>upto)continue;
    (change.tables||[]).forEach(t=>tables.add(t));
    for(const [table,names] of Object.entries(change.columns||{})){
      tables.add(table);if(!columns.has(table))columns.set(table,new Set());names.forEach(n=>columns.get(table).add(n));
    }
    for(const [table,names] of Object.entries(change.indexes||{})){
      tables.add(table);if(!indexes.has(table))indexes.set(table,new Set());names.forEach(n=>indexes.get(table).add(n));
    }
    for(const [table,names] of Object.entries(change.constraints||{})){
      tables.add(table);if(!constraints.has(table))constraints.set(table,new Set());names.forEach(n=>constraints.get(table).add(n));
    }
  }
  return{schema,tables,columns,indexes,constraints,contractErrors};
}

async function verifySchema(connection,{upto=Infinity,all=true}={}){
  const contract=requirements(upto,all),errors=[...contract.contractErrors];
  const [[db]]=await connection.query("SELECT DATABASE() AS name");
  if(!db||!db.name)throw new Error("Select a database before running schema verification.");
  const [[{n:tableCount}]]=await connection.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  const tableRows=tableCount? (await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"))[0]:[];
  const presentTables=new Set(tableRows.map(x=>x.TABLE_NAME));
  for(const table of contract.tables)if(!presentTables.has(table))errors.push(`Missing table ${table}`);
  const neededColumns=new Set();
  for(const [table,names] of contract.columns||[])for(const name of names)neededColumns.add(`${table}.${name}`);
  if(all)for(const [table,def] of contract.schema)for(const name of def.columns.keys())neededColumns.add(`${table}.${name}`);
  const columnRows=neededColumns.size?(await connection.query(
    "SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()"
  ))[0]:[];
  const presentColumns=new Map(columnRows.map(row=>[`${row.TABLE_NAME}.${row.COLUMN_NAME}`,row])),createStatements=new Map();
  for(const key of neededColumns){
    const split=key.indexOf("."),table=key.slice(0,split),name=key.slice(split+1),expected=contract.schema.get(table)?.columns.get(name),actual=presentColumns.get(key);
    if(!actual){errors.push(`Missing column ${key}`);continue}
    if(!expected){errors.push(`No schema.sql definition found for ${key}`);continue}
    const normalizeType=value=>value.replace(/\s+/g," ").toLowerCase().replace(/\b(tinyint|smallint|mediumint|int|integer|bigint)\(\d+\)/,"$1");
    if(normalizeType(actual.COLUMN_TYPE)!==normalizeType(expected.type))errors.push(`Incompatible type for ${key}: expected ${expected.type}, found ${actual.COLUMN_TYPE}`);
    if((actual.IS_NULLABLE==="YES")!==expected.nullable)errors.push(`Incompatible nullability for ${key}: expected ${expected.nullable?"NULL":"NOT NULL"}`);
    if(expected.autoIncrement!==/\bauto_increment\b/i.test(actual.EXTRA||""))errors.push(`Incompatible auto-increment setting for ${key}`);
    const actualOnUpdate=(String(actual.EXTRA||"").match(/\bon update\s+(current_timestamp(?:\(\))?)/i)||[])[1]?.toUpperCase()||null;
    if(expected.onUpdate!==actualOnUpdate)errors.push(`Incompatible ON UPDATE setting for ${key}`);
    const actualDefault=actual.COLUMN_DEFAULT===null?null:String(actual.COLUMN_DEFAULT);
    const expectedDefault=expected.hasDefault?(expected.defaultValue===null?null:String(expected.defaultValue)):null;
    if(actualDefault!==expectedDefault&&actualDefault?.toUpperCase()!==expectedDefault?.toUpperCase()){
      if(expectedDefault&&/[^\x00-\x7F]/.test(expectedDefault)){
        if(!createStatements.has(table)){
          const[[row]]=await connection.query(`SHOW CREATE TABLE \`${table}\``);
          createStatements.set(table,String(row["Create Table"]||""));
        }
        const definition=createStatements.get(table).match(new RegExp("`"+name+"`[^\\n]*?DEFAULT\\s+(0x[0-9a-f]+|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\")","i"));
        const actualLiteral=definition&&definition[1];
        const actualText=actualLiteral&&/^0x/i.test(actualLiteral)?Buffer.from(actualLiteral.slice(2),"hex").toString("utf8"):actualLiteral?unquote(actualLiteral):null;
        if(actualText!==expectedDefault)errors.push(`Incompatible default for ${key}: expected ${expectedDefault}, found ${actualDefault}`);
      }else errors.push(`Incompatible default for ${key}: expected ${expectedDefault}, found ${actualDefault}`);
    }
  }
  const neededIndexes=new Set();
  for(const [table,names] of contract.indexes||[])for(const name of names)neededIndexes.add(`${table}.${name}`);
  if(all)for(const [table,def] of contract.schema)for(const name of def.indexes.keys())neededIndexes.add(`${table}.${name}`);
  const indexRows=neededIndexes.size?(await connection.query(
    "SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX"
  ))[0]:[];
  const actualIndexes=new Map();
  for(const row of indexRows){const key=`${row.TABLE_NAME}.${row.INDEX_NAME}`;if(!actualIndexes.has(key))actualIndexes.set(key,{unique:Number(row.NON_UNIQUE)===0,columns:[]});actualIndexes.get(key).columns.push(row.COLUMN_NAME)}
  for(const key of neededIndexes){
    const split=key.indexOf("."),table=key.slice(0,split),name=key.slice(split+1),expected=contract.schema.get(table)?.indexes.get(name),actual=actualIndexes.get(key);
    if(!actual){errors.push(`Missing index ${key}`);continue}
    if(!expected){errors.push(`No schema.sql definition found for index ${key}`);continue}
    if(actual.unique!==expected.unique||actual.columns.join(",")!==expected.columns.join(","))errors.push(`Incompatible index ${key}: expected ${expected.columns.join(",")} ${expected.unique?"UNIQUE":"NON-UNIQUE"}, found ${actual.columns.join(",")} ${actual.unique?"UNIQUE":"NON-UNIQUE"}`);
  }
  const neededConstraints=new Set();
  for(const [table,names] of contract.constraints||[])for(const name of names)neededConstraints.add(`${table}.${name}`);
  if(all)for(const [table,def] of contract.schema)for(const name of def.constraints.keys())neededConstraints.add(`${table}.${name}`);
  const constraintRows=neededConstraints.size?(await connection.query(
    "SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,k.ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION"
  ))[0]:[];
  const actualConstraints=new Map();
  for(const row of constraintRows){const key=`${row.TABLE_NAME}.${row.CONSTRAINT_NAME}`;if(!actualConstraints.has(key))actualConstraints.set(key,{columns:[],table:row.REFERENCED_TABLE_NAME,references:[],deleteRule:row.DELETE_RULE});const item=actualConstraints.get(key);item.columns.push(row.COLUMN_NAME);item.references.push(row.REFERENCED_COLUMN_NAME)}
  for(const key of neededConstraints){
    const split=key.indexOf("."),table=key.slice(0,split),name=key.slice(split+1),expected=contract.schema.get(table)?.constraints.get(name),actual=actualConstraints.get(key);
    if(!actual&&expected){
      const equivalent=[...actualConstraints.values()].some(value=>value.columns.join(",")===expected.columns.join(",")&&value.table===expected.table&&value.references.join(",")===expected.references.join(",")&&value.deleteRule===expected.deleteRule);
      if(equivalent)continue;
    }
    if(!actual){errors.push(`Missing foreign key ${key}`);continue}
    if(!expected){errors.push(`No schema.sql definition found for foreign key ${key}`);continue}
    if(actual.columns.join(",")!==expected.columns.join(",")||actual.table!==expected.table||actual.references.join(",")!==expected.references.join(",")||actual.deleteRule!==expected.deleteRule)errors.push(`Incompatible foreign key ${key}`);
  }
  return{database:db.name,errors};
}

module.exports={CHANGES,splitTopLevel,parseSchema,migrationFiles,requirements,verifySchema};
