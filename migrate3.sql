-- Step 2 upgrade (cancel / refund / returns / webhook). Run once: mysql -u root -p seasonkart < migrate3.sql
ALTER TABLE orders
 MODIFY payment_status VARCHAR(16),
 MODIFY status ENUM('Processing','Shipped','Delivered','Cancelled') DEFAULT 'Processing',
 ADD COLUMN rz_payment_id VARCHAR(40), ADD COLUMN refund_id VARCHAR(40), ADD COLUMN cancel_reason VARCHAR(200),
 ADD COLUMN cancelled_at TIMESTAMP NULL, ADD COLUMN delivered_at TIMESTAMP NULL,
 ADD COLUMN return_status VARCHAR(12) NULL, ADD COLUMN return_reason VARCHAR(300) NULL;
UPDATE orders SET delivered_at=created_at WHERE status='Delivered';
