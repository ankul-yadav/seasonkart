-- Step 16: verify referential constraints on supplier products and order items.
ALTER TABLE products ADD CONSTRAINT products_supplier_id_fk FOREIGN KEY(supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD CONSTRAINT order_items_order_id_fk FOREIGN KEY(order_id) REFERENCES orders(id);
