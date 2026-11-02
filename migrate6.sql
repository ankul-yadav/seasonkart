-- Step 5 upgrade (GST invoices, saved addresses, wishlist). Run once: mysql -u root -p seasonkart < migrate6.sql
ALTER TABLE products ADD COLUMN gst_rate TINYINT NOT NULL DEFAULT 5, ADD COLUMN hsn VARCHAR(8) NOT NULL DEFAULT '6110';
ALTER TABLE orders ADD COLUMN state VARCHAR(40) NULL;
ALTER TABLE order_items ADD COLUMN gst_rate TINYINT NULL, ADD COLUMN hsn VARCHAR(8) NULL;
CREATE TABLE IF NOT EXISTS addresses(id INT AUTO_INCREMENT PRIMARY KEY,customer_id INT NOT NULL,label VARCHAR(30) NULL,name VARCHAR(80) NOT NULL,phone VARCHAR(15) NOT NULL,line VARCHAR(200) NOT NULL,city VARCHAR(60) NOT NULL,state VARCHAR(40) NOT NULL,pincode CHAR(6) NOT NULL,is_default TINYINT NOT NULL DEFAULT 0,KEY(customer_id));
CREATE TABLE IF NOT EXISTS wishlist(customer_id INT NOT NULL,product_id INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(customer_id,product_id));
UPDATE products SET hsn=CASE category WHEN 'Mufflers' THEN '6117' WHEN 'Caps' THEN '6505' WHEN 'Socks' THEN '6115' WHEN 'Gloves' THEN '6116' ELSE '6110' END;
