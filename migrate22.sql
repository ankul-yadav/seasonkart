-- Step 22: preserve COD reconciliation evidence and record post-payment adjustments.
ALTER TABLE orders ADD COLUMN cod_remitted_by INT NULL;
CREATE TABLE IF NOT EXISTS cod_remittance_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 order_code VARCHAR(20) NOT NULL,
 actor_id INT NOT NULL,
 reference VARCHAR(120) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY cod_remittance_audit_order_idx(order_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS supplier_payout_adjustments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 payout_id BIGINT UNSIGNED NOT NULL,
 supplier_id INT NOT NULL,
 order_id INT NOT NULL,
 amount DECIMAL(12,2) NOT NULL,
 reason VARCHAR(500) NOT NULL,
 reference VARCHAR(120) NULL,
 actor_id INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY supplier_payout_adjustments_payout_idx(payout_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
