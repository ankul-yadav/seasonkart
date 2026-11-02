-- Run ONLY if you already have an existing seasonkart database:  mysql -u root -p seasonkart < migrate.sql
ALTER TABLE products ADD COLUMN image VARCHAR(255) NULL;
ALTER TABLE orders ADD COLUMN email VARCHAR(120) NULL, ADD COLUMN customer_id INT NULL;
CREATE TABLE IF NOT EXISTS customers(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(80) NOT NULL,email VARCHAR(120) UNIQUE NOT NULL,phone VARCHAR(15) NOT NULL,password_hash VARCHAR(100) NOT NULL,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
