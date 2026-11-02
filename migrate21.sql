-- Step 21: retain independent shipment tracking for each supplier on an order.
CREATE TABLE IF NOT EXISTS supplier_shipments (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 order_id INT NOT NULL,
 supplier_id INT NOT NULL,
 courier_name VARCHAR(60) NOT NULL,
 awb VARCHAR(40) NOT NULL,
 tracking_url VARCHAR(1000) NULL,
 status VARCHAR(60) NOT NULL DEFAULT 'Handed to courier',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY supplier_shipment_supplier_awb_unique(supplier_id,awb),
 UNIQUE KEY supplier_order_shipment_unique(order_id,supplier_id),
 KEY supplier_shipments_order_idx(order_id,supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
