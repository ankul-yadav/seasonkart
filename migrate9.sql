-- Step 8 upgrade (SEO: descriptions + social preview images). Run once: mysql -u root -p seasonkart < migrate9.sql
ALTER TABLE products ADD COLUMN description TEXT NULL;
ALTER TABLE product_images ADD COLUMN share VARCHAR(255) NULL;
