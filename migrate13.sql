-- Step 13: supplier payout ledger. Additive only; keeps existing order data.
CREATE TABLE IF NOT EXISTS supplier_payouts (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 supplier_id INT NOT NULL,
 order_id INT NOT NULL,
 amount DECIMAL(12,2) NOT NULL,
 status ENUM('pending','paid') NOT NULL DEFAULT 'pending',
 payment_reference VARCHAR(120) NULL,
 notes VARCHAR(500) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 paid_at DATETIME NULL,
 UNIQUE KEY supplier_order_payout_unique (supplier_id, order_id),
 KEY supplier_payout_status_idx (supplier_id,status),
 KEY supplier_payout_order_idx (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
