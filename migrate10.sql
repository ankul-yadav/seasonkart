-- Step 9 upgrade (COD OTP, email verification). Run once: mysql -u root -p seasonkart < migrate10.sql
ALTER TABLE customers ADD COLUMN email_verified TINYINT NOT NULL DEFAULT 0, ADD COLUMN verify_hash CHAR(64) NULL, ADD COLUMN verify_expires DATETIME NULL;
CREATE TABLE IF NOT EXISTS otps(id INT AUTO_INCREMENT PRIMARY KEY,phone VARCHAR(15) NOT NULL,code_hash CHAR(64) NOT NULL,expires_at DATETIME NOT NULL,attempts TINYINT NOT NULL DEFAULT 0,verified TINYINT NOT NULL DEFAULT 0,used TINYINT NOT NULL DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,KEY(phone,created_at));
