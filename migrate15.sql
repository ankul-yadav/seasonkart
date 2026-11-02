-- Step 15: isolate demo catalog data and require confirmed COD remittance before payouts.
ALTER TABLE products ADD COLUMN is_demo TINYINT NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN is_demo TINYINT NOT NULL DEFAULT 0;
ALTER TABLE orders
 ADD COLUMN cod_remitted_at DATETIME NULL,
 ADD COLUMN cod_remittance_reference VARCHAR(120) NULL,
 ADD KEY idx_payout_eligibility(status,payment_method,payment_status,delivered_at);
