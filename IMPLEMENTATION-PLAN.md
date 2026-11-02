# SeasonKart MegaMart implementation plan

## Safety rules
- Work on a separate extracted copy of the source ZIP; retain the original ZIP unchanged.
- Never delete/reinitialize the MySQL data directory or drop the existing `seasonkart` database.
- Take a database backup and verify that it is non-empty before migrations or catalogue changes.
- Use read-only checks first. Do not run seed scripts against a production database until the owner reviews the product/category changes.
- Never commit or share `.env`, passwords, JWT secrets, payment credentials, or customer data.
- Test payment providers in sandbox/test mode first. Email/SMS/AI providers remain disabled unless deliberately configured.

## Phases and acceptance checks

### 1. Baseline audit and backup
- Run `npm install`, `npm run doctor`, and `npm run audit` from the project directory.
- Run the existing backup script and confirm a backup file exists and is non-zero.
- Record table names and row counts before any migration/seed. Confirm restore steps on a separate test database where possible.
- Acceptance: no destructive DB operation; baseline and backup recorded.

### 2. Storefront and catalogue
- Premium MegaMart-style responsive homepage while retaining existing SeasonKart application structure.
- Categories, search, sorting and filters; product detail, image gallery, variants and stock display.
- Cart/wishlist state and clear empty/loading/error states.
- Acceptance: mobile and desktop checks; no horizontal overflow; API and UI agree on product/variant data.

### 3. Checkout and customer experience
- Validate cart/stock server-side, coupon eligibility, address selection, checkout and payment verification.
- Customer account, saved addresses, order history/tracking, cancellation and returns according to order status/policy.
- Acceptance: COD flow works; online payments are only enabled after test-mode verification; duplicate/invalid requests are rejected.

### 4. Admin and operations
- Protected admin dashboard for products, variants, inventory, low-stock alerts, orders, coupons, banners, store settings and supplier records.
- Reports/analytics and CSV export with server-side authorization.
- Acceptance: non-admin requests receive 401/403; stock/order changes are consistent; CSV contains no secrets.

### 5. Smart features and notifications
- Hindi/English UI; lightweight local product/FAQ assistant and recommendations first, without requiring a paid LLM.
- Email via optional SMTP; SMS/WhatsApp only when provider credentials and costs are explicitly approved.
- Acceptance: store still works with all optional providers unset; no API keys exposed to browser.

### 6. Security, resilience and final QA
- Validate inputs, protect sessions/tokens, rate-limit sensitive routes, review upload paths and access controls.
- Backup/restore rehearsal, API tests, checkout tests, admin authorization tests, and responsive smoke tests.
- Acceptance: release checklist passes and known limitations are documented.

## Current work started
- Added `npm run audit`, a read-only check for source files, runtime/dependencies, environment readiness, MySQL connection and key table/product/order counts.
- The audit does not migrate, seed, delete, or update database records.

## Important status note
The project already contains a number of catalogue, checkout, admin and operations modules. Presence in source is not proof of end-to-end functionality; each feature must pass runtime tests. Online payment, email/SMS, courier and AI integrations may require provider setup and can incur charges. Sample catalogue data must be replaced with verified product data before a public launch.

## Work completed in this implementation pass (2026-10-26)

- Added a responsive, free-first shopping helper to the existing storefront. It reads the public `/api/products` catalogue and suggests matching in-stock items by text/category/brand and optional budget; it does not call a paid AI provider or require an API key.
- Added an English/Hindi switch for the helper UI and its responses.
- Restored SeasonKart as the default visible store name while retaining the MegaMart-style visual direction. An explicit `STORE_NAME` in the user's own `.env` still takes precedence.
- Kept the helper isolated from the checkout/admin code and made no database writes or migrations.

### Validation status

- `node --check server.js`: passed.
- Both inline JavaScript blocks in `public/index.html`: passed syntax checks.
- `npm run audit` (read-only): source-file checks passed. Runtime validation is blocked in this packaging environment because `.env` and installed dependencies are absent; the audit correctly warns about these rather than changing the database.
- The assistant UI has not yet been browser-tested against a configured live database. Treat it as implemented code pending that runtime verification, not as fully production-certified.
