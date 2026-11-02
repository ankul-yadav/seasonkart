CREATE DATABASE IF NOT EXISTS seasonkart CHARACTER SET utf8mb4;
USE seasonkart;
SET NAMES utf8mb4;
CREATE TABLE admins(id INT AUTO_INCREMENT PRIMARY KEY,email VARCHAR(120) UNIQUE NOT NULL,password_hash VARCHAR(100) NOT NULL);
CREATE TABLE suppliers(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(80) NOT NULL,category VARCHAR(60),location VARCHAR(60),api_url VARCHAR(255) NULL,active TINYINT DEFAULT 1);
CREATE TABLE products(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120) NOT NULL,category VARCHAR(40),price INT NOT NULL,mrp INT NOT NULL,rating DECIMAL(2,1) DEFAULT 4.0,emoji VARCHAR(8) DEFAULT '🧥',image VARCHAR(255) NULL,review_count INT NOT NULL DEFAULT 0,description TEXT NULL,sku VARCHAR(40) NULL,brand VARCHAR(80) NULL,specs TEXT NULL,origin VARCHAR(40) NOT NULL DEFAULT 'India',maker VARCHAR(255) NULL,opt1 VARCHAR(20) NOT NULL DEFAULT 'Size',opt2 VARCHAR(20) NOT NULL DEFAULT 'Colour',ret_days INT NULL,cod_ok TINYINT NOT NULL DEFAULT 1,pkg_l INT NULL,pkg_b INT NULL,pkg_h INT NULL,weight_g INT NOT NULL DEFAULT 500,gst_rate TINYINT NOT NULL DEFAULT 5,hsn VARCHAR(8) NOT NULL DEFAULT '6110',stock INT NOT NULL DEFAULT 50,supplier_id INT NULL,active TINYINT DEFAULT 1,
 CONSTRAINT products_supplier_id_fk FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL);
CREATE TABLE customers(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(80) NOT NULL,email VARCHAR(120) UNIQUE NOT NULL,phone VARCHAR(15) NOT NULL,password_hash VARCHAR(100) NOT NULL,reset_hash CHAR(64) NULL,reset_expires DATETIME NULL,email_verified TINYINT NOT NULL DEFAULT 0,verify_hash CHAR(64) NULL,verify_expires DATETIME NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE coupons(id INT AUTO_INCREMENT PRIMARY KEY,code VARCHAR(20) UNIQUE NOT NULL,type ENUM('percent','flat') NOT NULL,value INT NOT NULL,min_order INT NOT NULL DEFAULT 0,max_discount INT NULL,usage_limit INT NULL,uses INT NOT NULL DEFAULT 0,one_per_phone TINYINT NOT NULL DEFAULT 1,expires_at DATETIME NULL,active TINYINT NOT NULL DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE reviews(id INT AUTO_INCREMENT PRIMARY KEY,product_id INT NOT NULL,customer_id INT NOT NULL,stars TINYINT NOT NULL,body VARCHAR(1000) NOT NULL DEFAULT '',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY one_review(product_id,customer_id));
CREATE TABLE orders(id INT AUTO_INCREMENT PRIMARY KEY,code VARCHAR(20) UNIQUE,customer_name VARCHAR(80),phone VARCHAR(15),email VARCHAR(120) NULL,customer_id INT NULL,coupon_code VARCHAR(20) NULL,discount INT NOT NULL DEFAULT 0,state VARCHAR(40) NULL,city VARCHAR(60) NULL,pincode CHAR(6) NULL,courier_name VARCHAR(60) NULL,awb VARCHAR(40) NULL,tracking_url VARCHAR(255) NULL,ship_status VARCHAR(60) NULL,sr_order_id VARCHAR(20) NULL,sr_shipment_id VARCHAR(20) NULL,address TEXT,total INT,
 payment_method ENUM('cod','online'),payment_status VARCHAR(16),status ENUM('Processing','Shipped','Delivered','Cancelled') DEFAULT 'Processing',rz_order_id VARCHAR(40),rz_payment_id VARCHAR(40),refund_id VARCHAR(40),cancel_reason VARCHAR(200),cancelled_at TIMESTAMP NULL,delivered_at TIMESTAMP NULL,return_status VARCHAR(12) NULL,return_reason VARCHAR(300) NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,KEY idx_awb(awb));
CREATE TABLE order_items(id INT AUTO_INCREMENT PRIMARY KEY,order_id INT,product_id INT,name VARCHAR(120),price INT,qty INT,size VARCHAR(12),color VARCHAR(30) NULL,variant_id INT NULL,supplier_id INT NULL,gst_rate TINYINT NULL,hsn VARCHAR(8) NULL,ret_days INT NULL,
 CONSTRAINT order_items_order_id_fk FOREIGN KEY(order_id) REFERENCES orders(id));
CREATE TABLE addresses(id INT AUTO_INCREMENT PRIMARY KEY,customer_id INT NOT NULL,label VARCHAR(30) NULL,name VARCHAR(80) NOT NULL,phone VARCHAR(15) NOT NULL,line VARCHAR(200) NOT NULL,city VARCHAR(60) NOT NULL,state VARCHAR(40) NOT NULL,pincode CHAR(6) NOT NULL,is_default TINYINT NOT NULL DEFAULT 0,KEY(customer_id));
CREATE TABLE wishlist(customer_id INT NOT NULL,product_id INT NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(customer_id,product_id));

CREATE TABLE product_images(id INT AUTO_INCREMENT PRIMARY KEY,product_id INT NOT NULL,url VARCHAR(255) NOT NULL,thumb VARCHAR(255) NOT NULL,share VARCHAR(255) NULL,position INT NOT NULL DEFAULT 0,KEY(product_id));
CREATE TABLE product_variants(id INT AUTO_INCREMENT PRIMARY KEY,product_id INT NOT NULL,size VARCHAR(12) NOT NULL,color VARCHAR(30) NOT NULL DEFAULT '',stock INT NOT NULL DEFAULT 0,price INT NULL,mrp INT NULL,active TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uv(product_id,size,color));

CREATE TABLE otps(id INT AUTO_INCREMENT PRIMARY KEY,phone VARCHAR(15) NOT NULL,code_hash CHAR(64) NOT NULL,expires_at DATETIME NOT NULL,attempts TINYINT NOT NULL DEFAULT 0,verified TINYINT NOT NULL DEFAULT 0,used TINYINT NOT NULL DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,KEY(phone,created_at));

ALTER TABLE products ADD UNIQUE KEY uq_sku(sku);
CREATE TABLE categories(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(60) NOT NULL UNIQUE,emoji VARCHAR(8) NOT NULL DEFAULT '📦',gst_rate TINYINT NOT NULL DEFAULT 5,hsn VARCHAR(8) NOT NULL DEFAULT '',sort INT NOT NULL DEFAULT 99,active TINYINT NOT NULL DEFAULT 1);
CREATE TABLE settings(k VARCHAR(40) PRIMARY KEY,v TEXT NOT NULL);
INSERT INTO categories(name,emoji,gst_rate,hsn,sort) VALUES('Hoodies','🧥',5,'6110',1),('Sweaters','🧶',5,'6110',2),('Mufflers','🧣',5,'6117',3),('Caps','🧢',5,'6505',4),('Socks','🧦',5,'6115',5),('Gloves','🧤',5,'6116',6);

ALTER TABLE suppliers
 ADD COLUMN is_demo TINYINT NOT NULL DEFAULT 0,
 ADD COLUMN email VARCHAR(120) NULL,
 ADD COLUMN password_hash VARCHAR(100) NULL,
 ADD UNIQUE KEY supplier_email_unique (email),
 ADD COLUMN payout_method ENUM('upi','bank') NULL,
 ADD COLUMN payout_upi_id VARCHAR(120) NULL,
 ADD COLUMN payout_account_name VARCHAR(120) NULL,
 ADD COLUMN payout_account_number VARCHAR(40) NULL,
 ADD COLUMN payout_ifsc VARCHAR(11) NULL,
 ADD COLUMN payout_bank_name VARCHAR(120) NULL,
 ADD COLUMN payout_updated_at DATETIME NULL;
ALTER TABLE order_items ADD COLUMN supplier_status VARCHAR(20) NOT NULL DEFAULT 'New';
ALTER TABLE products ADD COLUMN is_demo TINYINT NOT NULL DEFAULT 0;
ALTER TABLE orders
 ADD COLUMN cod_remitted_at DATETIME NULL,
 ADD COLUMN cod_remittance_reference VARCHAR(120) NULL,
 ADD COLUMN gst_snapshot JSON NULL,
 ADD COLUMN delivery_verified_at DATETIME NULL,
 ADD COLUMN delivery_verified_by INT NULL,
 ADD COLUMN delivery_reference VARCHAR(120) NULL,
 ADD COLUMN cod_remitted_by INT NULL,
 ADD KEY idx_payout_eligibility(status,payment_method,payment_status,delivered_at);
CREATE TABLE supplier_payouts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 supplier_id INT NOT NULL,
 order_id INT NOT NULL,
 amount DECIMAL(12,2) NOT NULL,
 status ENUM('pending','paid') NOT NULL DEFAULT 'pending',
 payment_reference VARCHAR(120) NULL,
 notes VARCHAR(500) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 paid_at DATETIME NULL,
 UNIQUE KEY supplier_order_payout_unique (supplier_id, order_id),
 KEY supplier_payout_status_idx (supplier_id,status),
 KEY supplier_payout_order_idx (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE supplier_webhook_outbox (
 event_id VARCHAR(200) NOT NULL PRIMARY KEY,
 supplier_id INT NOT NULL,
 order_code VARCHAR(20) NOT NULL,
 event_type VARCHAR(40) NOT NULL,
 endpoint_url VARCHAR(1000) NOT NULL,
 payload_json MEDIUMTEXT NOT NULL,
 status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 last_error VARCHAR(40) NULL,
 locked_until DATETIME NULL,
 next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 sent_at DATETIME NULL,
 KEY supplier_webhook_outbox_ready_idx(status,next_attempt_at),
 KEY supplier_webhook_outbox_supplier_idx(supplier_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE order_status_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 order_code VARCHAR(20) NOT NULL,
 from_status VARCHAR(20) NULL,
 to_status VARCHAR(20) NOT NULL,
 actor_role VARCHAR(20) NOT NULL,
 actor_id INT NULL,
 source VARCHAR(40) NOT NULL,
 evidence_reference VARCHAR(120) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY order_status_audit_order_idx(order_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE supplier_payout_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 payout_id BIGINT UNSIGNED NOT NULL,
 supplier_id INT NOT NULL,
 order_id INT NOT NULL,
 action VARCHAR(20) NOT NULL,
 actor_id INT NULL,
 payment_reference VARCHAR(120) NULL,
 notes VARCHAR(500) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY supplier_payout_audit_payout_idx(payout_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE supplier_shipments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 supplier_id INT NOT NULL,
 courier_name VARCHAR(60) NOT NULL,
 awb VARCHAR(40) NOT NULL,
 tracking_url VARCHAR(1000) NULL,
 status VARCHAR(60) NOT NULL DEFAULT 'Handed to courier',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY supplier_shipment_supplier_awb_unique(supplier_id,awb),
 UNIQUE KEY supplier_order_shipment_unique(order_id,supplier_id),
 KEY supplier_shipments_order_idx(order_id,supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE cod_remittance_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 order_code VARCHAR(20) NOT NULL,
 actor_id INT NOT NULL,
 reference VARCHAR(120) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY cod_remittance_audit_order_idx(order_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE supplier_payout_adjustments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 payout_id BIGINT UNSIGNED NOT NULL,
 supplier_id INT NOT NULL,
 order_id INT NOT NULL,
 direction ENUM('debit','credit') NOT NULL DEFAULT 'debit',
 amount DECIMAL(12,2) NOT NULL,
 reason VARCHAR(500) NOT NULL,
 reference VARCHAR(120) NULL,
 actor_id INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY supplier_payout_adjustments_payout_idx(payout_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
