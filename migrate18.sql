-- Step 18: repair schema drift in COD, demo isolation, and supplier callback objects.
ALTER TABLE products ADD COLUMN is_demo TINYINT NOT NULL DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN is_demo TINYINT NOT NULL DEFAULT 0;
ALTER TABLE orders
 ADD COLUMN cod_remitted_at DATETIME NULL,
 ADD COLUMN cod_remittance_reference VARCHAR(120) NULL,
 ADD KEY idx_awb(awb),
 ADD KEY idx_payout_eligibility(status,payment_method,payment_status,delivered_at);

CREATE TABLE IF NOT EXISTS supplier_webhook_outbox (
 event_id VARCHAR(200) NOT NULL,
 supplier_id INT NOT NULL,
 order_code VARCHAR(20) NOT NULL,
 event_type VARCHAR(40) NOT NULL,
 endpoint_url VARCHAR(1000) NOT NULL,
 payload_json MEDIUMTEXT NOT NULL,
 status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 last_error VARCHAR(40) NULL,
 locked_until DATETIME NULL,
 next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 sent_at DATETIME NULL,
 PRIMARY KEY(event_id),
 KEY supplier_webhook_outbox_ready_idx(status,next_attempt_at),
 KEY supplier_webhook_outbox_supplier_idx(supplier_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE supplier_webhook_outbox
 ADD COLUMN event_id VARCHAR(200) NOT NULL,
 ADD COLUMN supplier_id INT NOT NULL,
 ADD COLUMN order_code VARCHAR(20) NOT NULL,
 ADD COLUMN event_type VARCHAR(40) NOT NULL,
 ADD COLUMN endpoint_url VARCHAR(1000) NOT NULL,
 ADD COLUMN payload_json MEDIUMTEXT NOT NULL,
 ADD COLUMN status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
 ADD COLUMN attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 ADD COLUMN last_error VARCHAR(40) NULL,
 ADD COLUMN locked_until DATETIME NULL,
 ADD COLUMN next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 ADD COLUMN sent_at DATETIME NULL,
 ADD PRIMARY KEY(event_id),
 ADD KEY supplier_webhook_outbox_ready_idx(status,next_attempt_at),
 ADD KEY supplier_webhook_outbox_supplier_idx(supplier_id,status);

CREATE TABLE IF NOT EXISTS order_status_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 order_code VARCHAR(20) NOT NULL,
 from_status VARCHAR(20) NULL,
 to_status VARCHAR(20) NOT NULL,
 actor_role VARCHAR(20) NOT NULL,
 actor_id INT NULL,
 source VARCHAR(40) NOT NULL,
 evidence_reference VARCHAR(120) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY order_status_audit_order_idx(order_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE order_status_audit ADD COLUMN evidence_reference VARCHAR(120) NULL;
CREATE TABLE IF NOT EXISTS supplier_payout_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 payout_id BIGINT UNSIGNED NOT NULL,
 supplier_id INT NOT NULL,
 order_id INT NOT NULL,
 action VARCHAR(20) NOT NULL,
 actor_id INT NULL,
 payment_reference VARCHAR(120) NULL,
 notes VARCHAR(500) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY supplier_payout_audit_payout_idx(payout_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
