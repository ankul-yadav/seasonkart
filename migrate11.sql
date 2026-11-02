-- Step 11 upgrade (sell any kind of product). Run once: npm run migrate   (or: mysql -u root -p seasonkart < migrate11.sql)
CREATE TABLE IF NOT EXISTS categories(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(60) NOT NULL UNIQUE,emoji VARCHAR(8) NOT NULL DEFAULT '📦',gst_rate TINYINT NOT NULL DEFAULT 5,hsn VARCHAR(8) NOT NULL DEFAULT '',sort INT NOT NULL DEFAULT 99,active TINYINT NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings(k VARCHAR(40) PRIMARY KEY,v TEXT NOT NULL);
ALTER TABLE products
 ADD COLUMN sku VARCHAR(40) NULL, ADD COLUMN brand VARCHAR(80) NULL, ADD COLUMN specs TEXT NULL,
 ADD COLUMN origin VARCHAR(40) NOT NULL DEFAULT 'India', ADD COLUMN maker VARCHAR(255) NULL,
 ADD COLUMN opt1 VARCHAR(20) NOT NULL DEFAULT 'Size', ADD COLUMN opt2 VARCHAR(20) NOT NULL DEFAULT 'Colour',
 ADD COLUMN ret_days INT NULL, ADD COLUMN cod_ok TINYINT NOT NULL DEFAULT 1,
 ADD COLUMN pkg_l INT NULL, ADD COLUMN pkg_b INT NULL, ADD COLUMN pkg_h INT NULL, ADD UNIQUE KEY uq_sku(sku);
ALTER TABLE product_variants ADD COLUMN price INT NULL, ADD COLUMN mrp INT NULL;
ALTER TABLE order_items ADD COLUMN ret_days INT NULL;
INSERT IGNORE INTO categories(name,emoji,gst_rate,hsn,sort) VALUES('Hoodies','🧥',5,'6110',1),('Sweaters','🧶',5,'6110',2),('Mufflers','🧣',5,'6117',3),('Caps','🧢',5,'6505',4),('Socks','🧦',5,'6115',5),('Gloves','🧤',5,'6116',6);
INSERT IGNORE INTO categories(name,emoji,gst_rate,hsn,sort) SELECT DISTINCT category,'📦',5,'',99 FROM products WHERE category IS NOT NULL AND category<>'';
