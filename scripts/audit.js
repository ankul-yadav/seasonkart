// Read-only SeasonKart audit. It never modifies the database or project data.
try { require('dotenv').config(); } catch {}
const fs = require('fs');
const path = require('path');
const {mysqlOptions}=require('../db-config');
const root = path.join(__dirname, '..');
const checks = [];
const pass = (name, detail='') => checks.push({status:'PASS', name, detail});
const warn = (name, detail='') => checks.push({status:'WARN', name, detail});
const fail = (name, detail='') => checks.push({status:'FAIL', name, detail});
const has = p => fs.existsSync(path.join(root,p));
(async () => {
  console.log('\nSeasonKart read-only audit\n');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 20 || (major === 20 && minor >= 9)) pass('Node.js version', process.version);
  else fail('Node.js version', `${process.version}; use Node 20.9 or newer`);
  for (const f of ['server.js','catalog.js','store.js','extras.js','ops.js','notify.js','otp.js','courier.js','seo.js','public/index.html','public/pages.js','schema.sql','scripts/doctor.js','scripts/backup.sh','scripts/restore.sh']) {
    has(f) ? pass(`File present: ${f}`) : fail(`File missing: ${f}`);
  }
  if (has('.env')) pass('.env exists (contents intentionally not displayed)');
  else warn('.env missing', 'Copy .env.local.example to .env and enter credentials locally; never share them in chat.');
  const required = ['express','mysql2','jsonwebtoken','bcryptjs','helmet','express-rate-limit','dotenv'];
  const missing = required.filter(n => { try { require.resolve(n, {paths:[root]}); return false; } catch { return true; } });
  missing.length ? warn('Dependencies', `Not installed or unavailable: ${missing.join(', ')}. Run npm install.`) : pass('Core dependencies resolvable');
  const env = process.env;
  if ((env.JWT_SECRET || '').length >= 32) pass('JWT_SECRET length', 'Value not displayed');
  else warn('JWT_SECRET', 'Missing or shorter than 32 characters');
  if (!env.DB_NAME || !env.DB_USER) warn('Database configuration', 'DB_NAME/DB_USER not configured in current environment');
  else {
    try {
      const mysql = require('mysql2/promise');
      const db = await mysql.createConnection(mysqlOptions(env,{connectTimeout:5000}));
      const [[v]] = await db.query('SELECT VERSION() AS version');
      const [tables] = await db.query('SHOW TABLES');
      pass('MySQL connection', `Connected to MySQL ${v.version}; database name: ${env.DB_NAME}`);
      const names = new Set(tables.map(r => Object.values(r)[0]));
      const requiredTables = ['admins','products','categories','customers','orders','order_items','coupons'];
      const missingTables = requiredTables.filter(t => !names.has(t));
      missingTables.length ? warn('Core schema', `Missing tables: ${missingTables.join(', ')}. Review migrations before applying any.`) : pass('Core schema', `${tables.length} tables found; no schema changes made`);
      if (names.has('products')) { const [[r]] = await db.query('SELECT COUNT(*) AS n FROM products'); pass('Product count', `${r.n} rows; read-only check`); }
      if (names.has('products')) {
        const [rows] = await db.query("SELECT id,name,price,mrp,ROUND((1-price/mrp)*100,1) AS discount_pct FROM products WHERE mrp>0 AND (is_demo=1 OR mrp>=price*2) ORDER BY is_demo DESC,discount_pct DESC LIMIT 50").catch(async e => {
          if (e.code !== 'ER_BAD_FIELD_ERROR') throw e;
          return db.query("SELECT id,name,price,mrp,ROUND((1-price/mrp)*100,1) AS discount_pct FROM products WHERE mrp>0 AND mrp>=price*2 ORDER BY discount_pct DESC LIMIT 50");
        });
        rows.length ? warn('Catalogue pricing review', `${rows.length} demo or 50%+ discount row(s) need human review; this is a review heuristic, not a fraud finding. IDs/names and public prices only: ${rows.map(x => `#${x.id} ${x.name} ₹${x.price}/₹${x.mrp} (${x.discount_pct}%)`).join('; ')}`) : pass('Catalogue pricing review', 'No demo or 50%+ discount rows found');
      }
      if (names.has('orders')) { const [[r]] = await db.query('SELECT COUNT(*) AS n FROM orders'); pass('Order count', `${r.n} rows; read-only check`); }
      await db.end();
    } catch (e) {
      const hints = {ECONNREFUSED:'Start MySQL and verify DB_HOST/DB_PORT.',ER_ACCESS_DENIED_ERROR:'Check DB_USER/DB_PASS in your local .env; do not paste them into chat.',ER_BAD_DB_ERROR:'Check DB_NAME. Do not create/drop databases until the intended database is confirmed.'};
      warn('MySQL check could not complete', `${e.code || 'ERROR'}: ${hints[e.code] || 'Review local database settings.'}`);
    }
  }
  console.log(checks.map(c => `${c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌'} ${c.status} — ${c.name}${c.detail ? `\n   ${c.detail}` : ''}`).join('\n'));
  console.log('\nThis audit is read-only: it does not seed products, run migrations, or alter customer/order data.');
  if (checks.some(c => c.status === 'FAIL')) process.exitCode = 1;
})().catch(e => { console.error('Audit failed safely:', e.message); process.exitCode = 1; });
