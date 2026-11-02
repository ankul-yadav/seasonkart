-- Step 6 upgrade (courier / tracking / pincode). Run once: mysql -u root -p seasonkart < migrate7.sql
ALTER TABLE products ADD COLUMN weight_g INT NOT NULL DEFAULT 500;
ALTER TABLE orders ADD COLUMN city VARCHAR(60) NULL, ADD COLUMN pincode CHAR(6) NULL, ADD COLUMN courier_name VARCHAR(60) NULL, ADD COLUMN awb VARCHAR(40) NULL, ADD COLUMN tracking_url VARCHAR(255) NULL, ADD COLUMN ship_status VARCHAR(60) NULL, ADD COLUMN sr_order_id VARCHAR(20) NULL, ADD COLUMN sr_shipment_id VARCHAR(20) NULL, ADD KEY idx_awb(awb);
