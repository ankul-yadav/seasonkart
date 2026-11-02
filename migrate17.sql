-- Step 17: durable, idempotent supplier callback delivery queue.
CREATE TABLE IF NOT EXISTS supplier_webhook_outbox (
 event_id VARCHAR(200) NOT NULL PRIMARY KEY,
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
 KEY supplier_webhook_outbox_ready_idx(status,next_attempt_at),
 KEY supplier_webhook_outbox_supplier_idx(supplier_id,status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
