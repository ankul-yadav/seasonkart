-- Step 19: retain line-level tax facts captured when an order is placed.
ALTER TABLE orders ADD COLUMN gst_snapshot JSON NULL;
