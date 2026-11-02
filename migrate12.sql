-- Step 12: supplier portal login and supplier-specific order status.
-- Back up first: npm run backup. Safe additive migration; does not delete existing rows.
ALTER TABLE suppliers ADD COLUMN email VARCHAR(120) NULL;
ALTER TABLE suppliers ADD COLUMN password_hash VARCHAR(100) NULL;
ALTER TABLE suppliers ADD UNIQUE KEY supplier_email_unique (email);
ALTER TABLE order_items ADD COLUMN supplier_status VARCHAR(20) NOT NULL DEFAULT 'New';
