try{require("dotenv").config()}catch{}
const mysql=require("mysql2/promise");
const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const {migrationFiles,splitTopLevel,verifySchema}=require("./schema-contract");

const ROOT=path.join(__dirname,"..");
const stripComments=sql=>sql.split(/\r?\n/).filter(line=>!line.trim().startsWith("--")).join("\n");

function statements(sql){
  const out=[];let start=0,quote="";
  for(let i=0;i<sql.length;i++){
    const ch=sql[i];
    if(quote){
      if(ch===quote&&sql[i-1]!=="\\"){
        if(sql[i+1]===quote){i++;continue}
        quote="";
      }
    }else if(ch==="'"||ch==='"'||ch==="`")quote=ch;
    else if(ch===";"){if(sql.slice(start,i).trim())out.push(sql.slice(start,i).trim());start=i+1}
  }
  if(sql.slice(start).trim())out.push(sql.slice(start).trim());
  return out;
}

async function tableColumns(connection,table){
  const[rows]=await connection.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table]
  );
  return new Set(rows.map(row=>row.COLUMN_NAME));
}

async function tableIndexes(connection,table){
  const[rows]=await connection.query(
    "SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
    [table]
  );
  return new Set(rows.map(row=>row.INDEX_NAME));
}

async function tableConstraints(connection,table){
  const[rows]=await connection.query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_TYPE='FOREIGN KEY'",
    [table]
  );
  return new Set(rows.map(row=>row.CONSTRAINT_NAME));
}

function checksum(migration){
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT,migration.file))).digest("hex");
}

async function ensureTracker(connection){
  await connection.query("CREATE TABLE IF NOT EXISTS schema_migrations(name VARCHAR(40) PRIMARY KEY,checksum CHAR(64) NULL,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  const columns=await tableColumns(connection,"schema_migrations");
  if(!columns.has("checksum"))await connection.query("ALTER TABLE schema_migrations ADD COLUMN checksum CHAR(64) NULL");
}

async function migrationHistoryErrors(connection,files){
  const columns=await tableColumns(connection,"schema_migrations");
  const[rows]=await connection.query(columns.has("checksum")?"SELECT name,checksum FROM schema_migrations":"SELECT name,NULL AS checksum FROM schema_migrations");
  const known=new Map(files.map(file=>[file.file,file]));
  const errors=[];
  for(const row of rows){
    const migration=known.get(row.name);
    if(!migration){errors.push(`Migration history contains unknown file ${row.name}`);continue}
    if(row.checksum&&row.checksum!==checksum(migration))errors.push(`Migration checksum mismatch for ${row.name}; restore the applied migration file or create a new corrective migration.`);
  }
  return{rows,errors};
}

async function executeAlter(connection,sql){
  const match=sql.match(/^ALTER TABLE\s+`?([a-zA-Z0-9_]+)`?\s+([\s\S]+)$/i);
  if(!match){await connection.query(sql);return}
  const table=match[1];
  for(const action of splitTopLevel(match[2])){
    const addColumn=action.match(/^ADD\s+COLUMN\s+`?([a-zA-Z0-9_]+)`?/i);
    if(addColumn&&(await tableColumns(connection,table)).has(addColumn[1]))continue;
    const addIndex=action.match(/^ADD\s+(?:UNIQUE\s+)?KEY\s+`?([a-zA-Z0-9_]+)`?/i);
    if(addIndex&&(await tableIndexes(connection,table)).has(addIndex[1]))continue;
    if(/^ADD\s+PRIMARY\s+KEY\b/i.test(action)&&(await tableIndexes(connection,table)).has("PRIMARY"))continue;
    const addConstraint=action.match(/^ADD\s+CONSTRAINT\s+`?([a-zA-Z0-9_]+)`?\s+FOREIGN KEY/i);
    if(addConstraint&&(await tableConstraints(connection,table)).has(addConstraint[1]))continue;
    if(addConstraint){
      const expected=action.match(/FOREIGN KEY\s*\(([^)]*)\)\s+REFERENCES\s+`?([a-zA-Z0-9_]+)`?\s*\(([^)]*)\)([\s\S]*)/i);
      const[rows]=await connection.query(
        "SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION",
        [table]
      );
      if(expected){
        const columns=expected[1].split(",").map(x=>x.trim().replace(/`/g,"")),references=expected[3].split(",").map(x=>x.trim().replace(/`/g,"")),referencedTable=expected[2],deleteRule=(expected[4].match(/ON DELETE\s+(CASCADE|SET NULL|RESTRICT|NO ACTION)/i)||[])[1]?.toUpperCase()||"NO ACTION";
        const constraints=new Map();
        for(const row of rows){if(!constraints.has(row.CONSTRAINT_NAME))constraints.set(row.CONSTRAINT_NAME,[]);constraints.get(row.CONSTRAINT_NAME).push(row)}
        if([...constraints.values()].some(items=>items.map(x=>x.COLUMN_NAME).join(",")===columns.join(",")&&items[0].REFERENCED_TABLE_NAME===referencedTable&&items.map(x=>x.REFERENCED_COLUMN_NAME).join(",")===references.join(",")&&items[0].DELETE_RULE===deleteRule))continue;
      }
    }
    await connection.query(`ALTER TABLE \`${table}\` ${action}`);
  }
}

async function applyFile(connection,migration){
  const sql=stripComments(fs.readFileSync(path.join(ROOT,migration.file),"utf8"));
  for(const statement of statements(sql)){
    if(/^ALTER TABLE\b/i.test(statement))await executeAlter(connection,statement);
    else await connection.query(statement);
  }
}

async function main(){
  const args=process.argv.slice(2),files=migrationFiles();
  const max=files.at(-1)?.number||0;
  const baselineAt=args.indexOf("--baseline");
  const verifyOnly=args.includes("--verify");
  const statusOnly=args.includes("--status");
  if(args.filter(a=>["--baseline","--verify","--status"].includes(a)).length>1)throw new Error("Choose only one of --baseline, --verify, or --status.");
  if(!max)throw new Error("No migration files were found.");
  let upto=max,all=true;
  if(baselineAt>=0&&args[baselineAt+1]!==undefined){
    upto=Number(args[baselineAt+1]);
    if(!Number.isInteger(upto)||upto<1||upto>max)throw new Error(`Baseline version must be an integer from 1 to ${max}.`);
    all=false;
  }
  if(!process.env.DB_NAME||!process.env.DB_USER)throw new Error("Set DB_NAME and DB_USER before running migrations.");
  const connection=await mysql.createConnection({
    host:process.env.DB_HOST||"localhost",
    port:Number(process.env.DB_PORT)||3306,
    user:process.env.DB_USER,
    password:process.env.DB_PASS,
    database:process.env.DB_NAME,
    connectTimeout:10000
  });
  try{
    if(verifyOnly){
      const result=await verifySchema(connection,{all:true});
      const [[tracker]]=await connection.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'");
      if(tracker.n){
        const history=await migrationHistoryErrors(connection,files);
        result.errors.push(...history.errors);
      }
      if(result.errors.length){console.error(`Schema verification failed for ${result.database}:`);result.errors.forEach(e=>console.error("- "+e));process.exitCode=1}
      else console.log(`Schema verification passed for ${result.database}.`);
      return;
    }
    const [[tracker]]=await connection.query(
      "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'"
    );
    if(statusOnly){
      const history=tracker.n?await migrationHistoryErrors(connection,files):{rows:[],errors:[]};
      const done=new Map(history.rows.map(row=>[row.name,row]));
      files.forEach(file=>{
        const row=done.get(file.file),state=!row?"PENDING  ":row.checksum&&row.checksum!==checksum(file)?"CHECKSUM MISMATCH  ":row.checksum?"applied  ":"applied (legacy; checksum pending)  ";
        console.log(state+file.file);
      });
      history.errors.forEach(error=>console.error(error));
      if(history.errors.length)process.exitCode=1;
      return;
    }
    if(baselineAt>=0){
      const result=await verifySchema(connection,{upto,all});
      if(result.errors.length){
        console.error(`Baseline refused for ${result.database}; required schema objects are missing or incompatible:`);
        result.errors.forEach(e=>console.error("- "+e));
        process.exitCode=1;
        return;
      }
      if(tracker.n){
        const history=await migrationHistoryErrors(connection,files);
        if(history.errors.length){history.errors.forEach(error=>console.error(error));process.exitCode=1;return}
      }
      await ensureTracker(connection);
      const history=await migrationHistoryErrors(connection,files);
      const done=new Set(history.rows.map(row=>row.name));
      let marked=0;
      for(const file of files)if(file.number<=upto&&!done.has(file.file)){
        await connection.query("INSERT INTO schema_migrations(name,checksum) VALUES(?,?)",[file.file,checksum(file)]);
        marked++;
      }
      for(const row of history.rows)if(!row.checksum&&files.find(file=>file.file===row.name)?.number<=upto){
        const file=files.find(item=>item.file===row.name);
        await connection.query("UPDATE schema_migrations SET checksum=? WHERE name=? AND checksum IS NULL",[checksum(file),row.name]);
      }
      console.log(`Baseline verified and marked ${marked} migration file(s) through migration ${upto}.`);
      return;
    }

    await ensureTracker(connection);
    const history=await migrationHistoryErrors(connection,files);
    if(history.errors.length){history.errors.forEach(error=>console.error(error));process.exitCode=1;return}
    const done=new Set(history.rows.map(row=>row.name));
    const todo=files.filter(file=>!done.has(file.file));
    if(!todo.length){
      const result=await verifySchema(connection,{all:true});
      if(result.errors.length){console.error("Migration tracker says current, but schema verification failed:");result.errors.forEach(e=>console.error("- "+e));process.exitCode=1}
      else{
        for(const row of history.rows)if(!row.checksum){
          const file=files.find(item=>item.file===row.name);
          await connection.query("UPDATE schema_migrations SET checksum=? WHERE name=? AND checksum IS NULL",[checksum(file),row.name]);
        }
        console.log("Database is up to date; schema verification passed.");
      }
      return;
    }
    for(const file of todo){
      process.stdout.write(`Applying ${file.file} ... `);
      try{
        await applyFile(connection,file);
        const result=await verifySchema(connection,{upto:file.number,all:file.number===max});
        if(result.errors.length)throw new Error(result.errors.join("; "));
        await connection.query("INSERT INTO schema_migrations(name,checksum) VALUES(?,?)",[file.file,checksum(file)]);
        console.log("ok");
      }catch(error){
        console.error(`FAILED\n${error.code||error.message}\nMigration tracking was not advanced. Re-run after resolving the reported schema issue.`);
        process.exitCode=1;
        return;
      }
    }
    const result=await verifySchema(connection,{all:true});
    if(result.errors.length){console.error("Migrations ran but final schema verification failed:");result.errors.forEach(e=>console.error("- "+e));process.exitCode=1}
    else{
      for(const row of history.rows)if(!row.checksum){
        const file=files.find(item=>item.file===row.name);
        await connection.query("UPDATE schema_migrations SET checksum=? WHERE name=? AND checksum IS NULL",[checksum(file),row.name]);
      }
      console.log("Done; schema verification passed.");
    }
  }finally{await connection.end()}
}

main().catch(error=>{
  console.error("Could not run migrations:",error.code||"",error.message);
  process.exitCode=1;
});
