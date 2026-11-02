-- Step 23: distinguish debit clawbacks from credits in post-payment adjustments.
ALTER TABLE supplier_payout_adjustments
 ADD COLUMN direction ENUM('debit','credit') NOT NULL DEFAULT 'debit';
