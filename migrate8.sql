-- Step 7 upgrade (photo gallery, size/colour variants). Run once: mysql -u root -p seasonkart < migrate8.sql
ALTER TABLE order_items MODIFY size VARCHAR(12), ADD COLUMN color VARCHAR(30) NULL, ADD COLUMN variant_id INT NULL;
CREATE TABLE IF NOT EXISTS product_images(id INT AUTO_INCREMENT PRIMARY KEY,product_id INT NOT NULL,url VARCHAR(255) NOT NULL,thumb VARCHAR(255) NOT NULL,position INT NOT NULL DEFAULT 0,KEY(product_id));
CREATE TABLE IF NOT EXISTS product_variants(id INT AUTO_INCREMENT PRIMARY KEY,product_id INT NOT NULL,size VARCHAR(12) NOT NULL,color VARCHAR(30) NOT NULL DEFAULT '',stock INT NOT NULL DEFAULT 0,active TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uv(product_id,size,color));
-- keep the photos you already uploaded
INSERT INTO product_images(product_id,url,thumb,position) SELECT id,image,image,0 FROM products WHERE image IS NOT NULL AND id NOT IN (SELECT product_id FROM product_images);

-- OPTIONAL: before this version every product showed sizes S-XXL without per-size stock.
-- To give your existing clothing the same sizes (stock split evenly), un-comment and edit the categories:
-- INSERT INTO product_variants(product_id,size,stock)
--   SELECT p.id,z.size,FLOOR(p.stock/4) FROM products p JOIN (SELECT 'S' size UNION SELECT 'M' UNION SELECT 'L' UNION SELECT 'XL') z
--   WHERE p.active=1 AND p.category IN ('Hoodies','Sweaters');
