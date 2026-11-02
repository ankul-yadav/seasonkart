-- Step 20: keep verified delivery evidence separate from carrier tracking state.
ALTER TABLE orders
 ADD COLUMN delivery_verified_at DATETIME NULL,
 ADD COLUMN delivery_verified_by INT NULL,
 ADD COLUMN delivery_reference VARCHAR(120) NULL;
