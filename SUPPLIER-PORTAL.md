# SeasonKart Supplier Portal

## What suppliers can do
- Sign in using credentials created by the store admin.
- Add products under their own supplier account, with name, category, selling price, MRP, stock, description, and up to 8 product photos.
- View and edit only their own active products (name, category, price, MRP, stock, description).
- Remove their own products from the storefront without deleting historical order records.
- View order items assigned to their supplier ID and update the item status.

## Setup safely
1. Keep a copy of the current project and run `npm run backup` before changing the database.
2. Check pending migrations with `npm run migrate -- --status`.
3. If migration `migrate12.sql` is pending, apply it with `npm run migrate`.
4. Start the app and sign in as admin; open **Suppliers** and create or set login credentials for each supplier. Passwords must be at least 10 characters.
5. Supplier opens `/#supplier`, signs in, and uses **Add your product**.

The supplier API derives the supplier ID from the signed JWT. It never accepts a supplier ID from the product form, and all supplier product edits/removals include `supplier_id` in the database condition. Public products are visible in the storefront after being added. Product removals are soft-deletes (`active=0`), preserving order history.

## Verification limits
JavaScript syntax checks can be run without database credentials. A real login/product/order test requires the local `.env` and a running MySQL database. Do not share `.env` or database passwords.


## New in this update (migration 13)
- Suppliers can download their own order list as CSV, including delivery addresses and item statuses. The endpoint requires the supplier login token and only exports that supplier's assigned order items. Handle customer addresses privately.
- Suppliers can mark their own order items Delivered. The overall order becomes Delivered only when every item in that order is marked Delivered. Admin status changes synchronize supplier item statuses too.
- Supplier payout ledger: run `npm run migrate` to create `supplier_payouts`. Admin opens `#admin-payouts`, records eligible delivered orders, transfers money through bank/UPI outside the app, then records the real transaction reference. Suppliers can see payout history in their portal. This ledger does not itself move money.
- The initial payout amount is item sale price × quantity, not a supplier-cost/commission calculation. Confirm the written supplier agreement, commissions, shipping, taxes, returns and refunds before paying; configure a real payment provider integration separately if automatic transfers are required.
