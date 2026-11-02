-- Step 14: supplier bank/UPI payout details. Additive and safe for existing records.
ALTER TABLE suppliers ADD COLUMN payout_method ENUM('upi','bank') NULL;
ALTER TABLE suppliers ADD COLUMN payout_upi_id VARCHAR(120) NULL;
ALTER TABLE suppliers ADD COLUMN payout_account_name VARCHAR(120) NULL;
ALTER TABLE suppliers ADD COLUMN payout_account_number VARCHAR(40) NULL;
ALTER TABLE suppliers ADD COLUMN payout_ifsc VARCHAR(11) NULL;
ALTER TABLE suppliers ADD COLUMN payout_bank_name VARCHAR(120) NULL;
ALTER TABLE suppliers ADD COLUMN payout_updated_at DATETIME NULL;
