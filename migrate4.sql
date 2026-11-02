-- Step 3 upgrade (password reset). Run once: mysql -u root -p seasonkart < migrate4.sql
ALTER TABLE customers ADD COLUMN reset_hash CHAR(64) NULL, ADD COLUMN reset_expires DATETIME NULL;
