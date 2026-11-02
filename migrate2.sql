-- Step 1 upgrade (stock). Run once on an existing DB: mysql -u root -p seasonkart < migrate2.sql
ALTER TABLE products ADD COLUMN stock INT NOT NULL DEFAULT 50;
