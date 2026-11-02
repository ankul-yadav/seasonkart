# SeasonKart (Node.js + Express + MySQL)

## Run on your PC (VS Code)
1. Install Node 20.9+ and MySQL.
2. `mysql --default-character-set=utf8mb4 -u root -p < schema.sql`
3. `copy .env.example .env` (Mac/Linux: `cp`) and fill DB password, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD.
4. `npm install` then `npm start`
5. Store: http://localhost:3000  |  Admin: http://localhost:3000/#admin

## Razorpay
Put test keys (Razorpay Dashboard > API Keys) in `.env`. Choose "Pay online" at checkout.
Without keys, only Cash on delivery works.

## Supplier integration
Each supplier can have an `api_url` (webhook) in the `suppliers` table. Supplier callbacks require
HTTPS and `SUPPLIER_WEBHOOK_SECRET`; callbacks include `X-SeasonKart-Signature` (HMAC-SHA256 of
the exact JSON body) and a stable `Idempotency-Key`. The supplier must verify the signature and
deduplicate event IDs. Requests use bounded retries for timeouts, 408/425/429 and 5xx only.
Without the secret or a safe HTTPS URL, no customer/order data is sent. Shiprocket tracking
webhooks remain disabled until a documented signed-event specification is available.

## Database migrations and invoice tax

After restoring a backup to a disposable database, run `npm run migrate` and then
`npm run migrate:verify`. Do not use `--baseline` to bypass a schema mismatch. The
migration runner records checksums, verifies the schema before advancing its history,
and reports changed or unknown migration files. Always take and verify a protected
database backup before migrating an existing installation; do not put SQL dumps in
source archives.

Order tax rates and HSN are snapshotted at checkout. Configure each product category
with its accountant-confirmed GST rate and HSN. Set `SHIPPING_GST_RATE` and
`SHIPPING_HSN` to the confirmed shipping-service classification; invoices with a
shipping charge are withheld until those values are valid. Legacy orders without
complete saved tax details cannot be invoiced automatically and require review.

## Deploy (VPS: Hostinger / DigitalOcean / AWS Lightsail)
1. Install Node 20.9+, MySQL, nginx. Upload this folder, run steps 2-4 above.
2. `npm i -g pm2 && pm2 start server.js --name seasonkart && pm2 save && pm2 startup`
3. nginx: proxy_pass http://localhost:3000; then `certbot --nginx -d yourdomain.com` for HTTPS.
4. Use strong JWT_SECRET/ADMIN_PASSWORD and Razorpay live keys only after testing.

## New in v1.1

**Upgrading an existing DB?** Run `mysql -u root -p seasonkart < migrate.sql`, then `npm install` (adds multer + nodemailer). Fresh installs: schema.sql already has everything. Admin must log in again (tokens now carry a role).

**Product photos** – Admin > Products: choose a JPG/PNG/WEBP (max 3 MB) while adding a product, or click "Add/Change photo" on any existing row. Files are saved in `public/uploads/` (back this folder up / keep it on persistent disk when deploying). Products without a photo still show their emoji.

**Customer login + tracking** – `#account` (sign up / login), `#orders` (my orders with Processing → Shipped → Delivered timeline), `#track` (guests: Order ID + phone). Logged-in customers' orders are linked automatically; guest checkout still works.

**Email / SMS** – Fill SMTP_* (email) and TWILIO_* (SMS) in `.env`. Sent on: order confirmed (COD at checkout, online after payment verified) and when admin changes status to Shipped/Delivered. Blank settings = that channel is skipped and logged to console. `ADMIN_NOTIFY_EMAIL` also gets a new-order email. Note: for SMS to Indian numbers, Twilio may need a verified number/sender; MSG91 or Fast2SMS (DLT-registered) are common alternatives - only `sendSMS()` in notify.js needs changing.

## v1.2 (Step 1: stock, product edit, order details)
Existing DB? Run `mysql -u root -p seasonkart < migrate2.sql` (adds `stock`, default 50 per product - edit real numbers in Admin > Products).
- Stock is reduced atomically at checkout; if someone else buys the last unit first, the order is rejected with a clear message. Out-of-stock products show a disabled button; "Only N left" appears at 5 or fewer.
- Admin > Products: Edit button (name, category, price, MRP, stock, supplier), stock column, low-stock count on dashboard.
- Admin > Orders: View button shows customer phone, email, full address, payment and per-item supplier. Order list now shows all suppliers and payment status.
- Note: stock is NOT returned yet when an order is abandoned/cancelled - that comes with the cancel/refund step.

## v1.3 (Step 2: webhook, cancel, returns, refunds)
Existing DB? Run `mysql -u root -p seasonkart < migrate3.sql`.

**Razorpay webhook (do this or paid orders can get stuck):** Razorpay Dashboard > Settings > Webhooks > Add: URL `https://YOUR-DOMAIN/api/payment/webhook`, events `payment.captured` and `order.paid`, set a secret and put the same value in `.env` as `RAZORPAY_WEBHOOK_SECRET`. Also keep payment auto-capture ON in Razorpay settings. Webhook + browser verify can both arrive - the order is only confirmed/notified once.

**Cancel:** customers can cancel from My Orders and admin from the order detail, only while status is Processing. Stock is returned, supplier webhook gets `{order, cancelled:true}`, customer gets email/SMS. Paid online orders are refunded automatically via Razorpay (5-7 days to reach the customer); if the refund call fails the order shows "Refund due" and admin gets a "Retry refund" button.

**Abandoned online payments:** unpaid online orders are auto-cancelled and stock released after `UNPAID_MINUTES` (30). If money still arrives late, it is refunded automatically.

**Returns:** customer can request a return within `RETURN_DAYS` (7) of delivery. Admin approves/rejects in order detail. Online-paid orders are refunded on approval; for COD, pay the customer manually (UPI/bank) and click "Mark COD refund paid". Returned stock is NOT auto-added back (inspect first, then edit stock in Products).

## v1.4 (Step 3: security, policy pages, forgot password)
Existing DB? `mysql -u root -p seasonkart < migrate4.sql`, then `npm install` (adds helmet + express-rate-limit).

**The server now refuses to start unless `JWT_SECRET` is 32+ random characters** (the old example value is rejected). Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Everyone, including admin, must log in again after changing it.

**Security added:** helmet (security headers + CSP that allows Razorpay), 100 KB body limit, rate limits (admin/customer login: 10 per 15 min per IP and 6 per account; sign-up, checkout, tracking, password reset also limited; 600 API calls / 15 min overall), HTTPS redirect (`FORCE_HTTPS=1`), customer passwords now 8+ characters. **Behind nginx/Render/Railway/Cloudflare set `TRUST_PROXY=1`**, otherwise every visitor looks like one IP and rate limits will block real customers.

**Policy pages** (footer links): About & Contact, Shipping, Returns & Refunds, Privacy, Terms. Fill `STORE_*`, `GRIEVANCE_OFFICER`, `SHIP_DAYS` in `.env` - the pages pick them up automatically. Text lives in `public/pages.js`; it matches how the shop really works (cancel while Processing, 7-day returns, refund timelines) but **get a lawyer/CA to review it before launch**. Razorpay live KYC will ask for these pages.

**Forgot password:** "Forgot password?" on the login screen emails a one-hour reset link (needs working SMTP and `BASE_URL`). The link is single-use and only its hash is stored.

## v1.5 (Step 4: search/filters, reviews, coupons)
Existing DB? `mysql -u root -p seasonkart < migrate5.sql` (no new npm packages).

**Search, sort & filters** (shop page): live search by name/category, sort (price, top rated, biggest discount), price cap, in-stock only, "Show more" paging (12 at a time). Runs in the browser - fine for a few hundred products; move to server-side search if you grow past that. Size filter is not included because stock is tracked per product, not per size.

**Reviews & ratings:** only logged-in customers whose order containing that product is *Delivered* (and not fully refunded) can review - shown as "Verified buyer". One review per customer per product, editable. Product rating/count is recalculated from real reviews; products without reviews show "New" instead of a made-up rating. Admin sees a Delete button on reviews while logged in (for abuse).

**Coupons** (Admin > Coupons): percent or flat, minimum order, max discount cap (percent), total usage limit, expiry date, one-use-per-phone. Applied in the cart and re-checked on the server at checkout (the customer cannot fake a discount). Free-shipping threshold uses the subtotal *before* discount. Cancelling an order gives the coupon use back. A 100%-off order with free shipping becomes a zero-amount order and skips Razorpay.

## v1.6 (Step 5: GST invoice, reports/CSV, saved addresses, wishlist)
Existing DB? `mysql -u root -p seasonkart < migrate6.sql`, then `npm install` (adds pdfkit).

**GST invoice (PDF):** customers get "Download invoice" once an order is Shipped/Delivered (also guests via Track order, and admin via order detail). Prices are treated as GST-inclusive; the coupon discount is spread over items and GST is backed out per item; shipping is shown as its own line at 18%. Set `STORE_GSTIN` and `STORE_STATE` in `.env`: same-state buyers get CGST+SGST, others IGST. With no GSTIN the invoice is a plain "INVOICE" without tax columns. Per-product GST % and HSN code are editable in Admin > Products > Edit (defaults: 5% and HSN by category; the rate is saved on each order line so old invoices never change when you change rates later). Invoice numbers look like `INV/2026-27/000123` (from the order serial). **Please have your CA confirm the GST rates, HSN codes, shipping treatment and numbering before you rely on these.** This assumes you are the seller of record (you invoice the customer, suppliers ship for you).

**Checkout now asks for state + pincode** (needed for GST place of supply and for courier later).

**Reports** (Admin > Reports): pick a date range for orders, sales, discounts, cancellations, refunded returns, net sales, GST inside sales, COD/online split, sales by day, top products, by category. CSV downloads: all orders, **GST sales register** (line-wise taxable value/CGST/SGST/IGST for your CA), and inventory. Sales exclude cancelled and unpaid online orders. Returns/credit notes are shown as a total only - ask your CA how to record them.

**Saved addresses:** logged-in customers can pick a saved address at checkout, tick "Save this address", and manage (make default / delete, max 5) in Account.

**Wishlist:** heart on every product card and product page; saved to the account (login required); list at `#wishlist`.

## v1.7 (Step 6: delivery check, courier shipments, tracking numbers)
Existing DB? `mysql -u root -p seasonkart < migrate7.sql` (no new npm packages).

**Pincode check:** product page ("Delivery pincode" box) and checkout show estimated delivery time and whether COD is available. The server also enforces it at checkout (unserviceable pincode rejected; COD rejected where the couriers do not offer it). Without Shiprocket set up, it just shows your generic `SHIP_DAYS` estimate and accepts every valid pincode. If Shiprocket is temporarily down the check fails *open*, so sales never stop.

**Shiprocket (optional):** 1) In Shiprocket > Settings > API > Configure, create an **API user** (not your panel login) and put its email/password in `.env` (`SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD`). 2) Set `SHIPROCKET_PICKUP_LOCATION` to the exact pickup-address name from Shiprocket and `PICKUP_PINCODE` to its pincode. 3) Keep wallet balance in Shiprocket - AWB assignment fails without it (you get a clear message and can press the button again). Then in Admin > Orders > View, a Processing order has **Create shipment (Shiprocket)**: it creates the order, assigns the best courier/AWB automatically, requests pickup, and saves the AWB + tracking link. **Print label** fetches the shipping label. Product weights (grams, Admin > Products > Edit) are used for the parcel weight; default parcel size comes from `PKG_*`.
- COD: the amount sent to Shiprocket as `sub_total` is the order total (what the courier must collect). **Do one test COD order and confirm the COD amount in Shiprocket equals your order total.**
- Orders placed before this version have no saved city/pincode: for those, ship from the Shiprocket panel and type the AWB manually.

**Live status via webhook:** in Shiprocket > Settings > API > Webhooks add `https://YOUR-DOMAIN/api/courier/updates`, enable it, and set the token to the same value as `SHIPROCKET_WEBHOOK_TOKEN`. Shiprocket rejects webhook URLs containing "shiprocket", "sr", "kr" or "kartrocket" anywhere (including the domain) - use another domain/subdomain if yours has these letters. Picked up / in transit / out for delivery moves the order to **Shipped** (customer gets email/SMS with courier + AWB); Delivered moves it to **Delivered** (starts the return window). Statuses only move forward, so repeated or late events are harmless. If the courier starts returning a parcel (RTO) you get an email (`ADMIN_NOTIFY_EMAIL`) and the courier status shows on the order.

**Manual tracking (works without Shiprocket):** in the order detail enter courier name + AWB (+ optional link) and press "Save tracking & mark shipped" - ideal for orders your suppliers ship themselves. Customers see courier, AWB, status and a "Track shipment" link on My Orders and the Track page, and get it in the shipped email/SMS.

**Cancelling:** if an order with a Shiprocket shipment is cancelled while still Processing, the shipment is cancelled at Shiprocket too (best effort).

## v1.8 (Step 7: optimised photos, gallery, size/colour variants)
Existing DB? `mysql -u root -p seasonkart < migrate8.sql`, then `npm install` (adds **sharp**). Your already-uploaded photos are kept (copied into the new gallery table as they are; re-upload them to get the compressed WebP versions).

**Photos:** every upload is auto-rotated, resized to max 1000 px, converted to WebP (about 5-10x smaller than a phone photo) with a 420 px thumbnail for product cards, and GPS/EXIF data is stripped. Upload limit 6 MB per photo (JPG/PNG/WEBP), max 8 photos per product, files are cached by the browser for 30 days. If `sharp` cannot be installed on your server the photos are saved as-is (a warning is printed) so the shop never breaks.

**Gallery:** Admin > Products > **Photos & sizes** lets you add several photos, choose the main one and delete. The product page shows the main photo with a thumbnail strip.

**Sizes & colours with their own stock:** in the same panel, type sizes (e.g. `S,M,L,XL`), optional colours (`Black,Navy`) and a starting stock and press *Create all combinations*, then adjust each stock. The product page then shows size (and colour) buttons; sold-out combinations are crossed out; the stock shown, the quantity limit, the cart and the checkout all use that exact variant, and cancelling an order returns stock to that variant. Orders, invoices, supplier messages and emails show e.g. "L / Navy". Products with **no** sizes defined sell as a single item (no size buttons) and use the product's own stock.
- Before this version every product showed sizes S-XXL without per-size stock. After upgrading, products have no sizes until you add them (see the optional commented SQL at the bottom of `migrate8.sql` to create S/M/L/XL for whole categories in one go).
- Customers who still have an old cart: items whose product now has sizes are removed from the cart with a short message, so nobody buys the wrong size by accident.

## v1.9 (Step 8: SEO + share previews)
Existing DB? `mysql -u root -p seasonkart < migrate9.sql` (no new npm packages). **Set `BASE_URL` in `.env` to your real public address (https://www.yourshop.com)** - canonical links, the sitemap and preview images need it.

**Real URLs:** products now live at `/p/12-mens-fleece-hoodie` and categories at `/c/Hoodies` (the old `#item-12` links still work and are upgraded to the new form automatically; wrong or old spellings 301-redirect to the correct URL). Cart, orders, account, admin etc. stay on `/#...` pages. Back/forward buttons work between all of them.

**What crawlers and WhatsApp now see (without running JavaScript):** a proper `<title>`, description, canonical link, Open Graph/Twitter tags (so pasting a product link in WhatsApp/Facebook shows photo + name), and Product structured data (price in INR, in-stock/out-of-stock, star rating once real reviews exist, breadcrumbs). The home page also gets Organization + site-search data and a crawlable list of categories and products; category pages list their products. Unknown product URLs return a real 404 with `noindex`. Server-rendered pages are cached 5 minutes; the shop itself always shows live price/stock.

**Share image:** new photo uploads also get a 1200 px JPEG copy used only for previews (WhatsApp/Facebook read JPEG most reliably). Photos uploaded before this version are used as they are - re-upload the main photo of your best sellers if their preview looks wrong.

**Descriptions:** Admin > Products > Photos, sizes & description: write a real description per product (shown on the page and used as the Google snippet). Without one, a generic line is used - for SEO, write unique ones.

**Share button** on each product page (native share sheet on phones, copies the link on desktop). `/?q=hoodie` opens the shop with that search.

**After deploying:**
1. Open `https://yourshop.com/sitemap.xml` and `/robots.txt` to check they load.
2. In Google Search Console add your site and submit `/sitemap.xml`.
3. Paste a product link into WhatsApp (to yourself) to check the preview. WhatsApp/Facebook cache previews - if you fix something, test with Facebook's Sharing Debugger or add `?v=2` to the link.
4. Not in the sitemap: policy pages (still `#page-...`), cart/account/orders (should not be indexed anyway).

## v2.0 (Step 9: COD OTP, email verification, WhatsApp updates)
Existing DB? `mysql -u root -p seasonkart < migrate10.sql` (no new npm packages).

**COD OTP (stops fake cash-on-delivery orders):** set `COD_OTP=1` in `.env`. When a customer chooses Cash on delivery, they get a 6-digit OTP on WhatsApp (or SMS) and must enter it before the order is placed. The OTP is valid for 10 minutes, allows 5 wrong tries, is single-use and tied to that phone number; max 3 OTPs per number per hour, a 30-second gap between requests, and an overall daily cap (`OTP_DAILY_LIMIT`, default 300) so nobody can run up your messaging bill. Returning customers (logged in, with at least one delivered order) skip it. Online payments never need it. If both WhatsApp and SMS are unconfigured the check stays off and a warning is printed at start-up; if the message cannot be delivered the customer is told to try again or pay online.

**Email verification:** new accounts get a verification link by email (valid 48 hours); until verified, the account page shows a notice with *Resend link*. It does not block shopping. Existing customers appear as unverified until they click a link.

**WhatsApp order updates (Meta WhatsApp Business Cloud API):** WhatsApp is tried first, SMS is the automatic fallback, email is sent as before. Setup: 1) create a Meta app with the WhatsApp product and a business phone number; put the access token and *Phone number ID* in `WA_TOKEN` / `WA_PHONE_ID` (use a permanent system-user token). 2) In WhatsApp Manager create these templates (language English; variables must not be the first or last thing in the text - that is why each ends with a closing line), wait for approval, and put each template name in `.env`:
- `WA_TEMPLATE_ORDER_CONFIRMED` (Utility): `Hi {{1}}, your order {{2}} of {{3}} is confirmed. Track it anytime here: {{4}} - Team SeasonKart`
- `WA_TEMPLATE_SHIPPED` (Utility): `Hi {{1}}, your order {{2}} has been shipped via {{3}}. Tracking number: {{4}}. Thank you for shopping with SeasonKart.`
- `WA_TEMPLATE_DELIVERED` (Utility): `Hi {{1}}, your order {{2}} has been delivered. Thank you for shopping with SeasonKart!`
- `WA_TEMPLATE_CANCELLED` (Utility): `Hi {{1}}, your order {{2}} has been cancelled. {{3}} - Team SeasonKart`
- `WA_TEMPLATE_RETURN` (Utility): `Hi {{1}}, your return request for order {{2}} {{3}} - Team SeasonKart`
- `WA_TEMPLATE_OTP` (**Authentication** category, "Copy code" button): Meta fills the wording; the shop sends the code in the body and the button.
A template left blank simply uses SMS for that message. Customers are told at checkout that they will get updates on WhatsApp/SMS/email (WhatsApp requires this opt-in). Meta charges per conversation/message - check current India pricing. Test with your own number first.

## v2.1 (Step 10: backups, monitoring, deployment)
**Read `DEPLOY.md`** - a step-by-step guide from an empty Ubuntu server to a live HTTPS shop (PM2, nginx, MySQL with a limited user, firewall, webhooks, go-live checklist, troubleshooting). Config files are in `deploy/` (nginx, PM2, systemd, cron).

What was added:
- `GET /health` for uptime monitors (checks the database; returns 503 if it is down).
- Error alerts: unexpected server errors email `ADMIN_NOTIFY_EMAIL` (throttled), crashes restart automatically (PM2/systemd) after a graceful shutdown handler; the DB connection pool now keeps connections alive.
- Admin dashboard boxes: Last backup (red if older than 36 h), Disk free, Refunds pending, Stuck payments.
- `npm run backup` (`scripts/backup.sh`): MySQL dump + weekly photo archive, verified, optional AES-256 encryption, 14-day cleanup, optional off-site copy via rclone, optional healthchecks.io ping. `scripts/restore.sh` restores a database (also into a scratch DB for a restore drill) or the photos.
- `npm run migrate` (`scripts/migrate.js`): applies only the `migrateN.sql` files you have not applied yet, in order, and remembers them (`--status`, `--baseline`).
- `node scripts/admin.js email password` creates/resets an admin from the server console.
- In production the server now refuses to start with a default `ADMIN_PASSWORD`, and warns if `BASE_URL` is not https or the app connects to MySQL as root.

### v2.1.1
Phone layout: the header menu is now a single scrollable row under the logo (it used to stack and push products off the first screen). Category tiles say "1 item" instead of "1 items".

### v2.2 (new look)
Whole storefront redesigned: slim trust strip, header with search and SVG icons (no emoji), category menu, wool-knit hero, trust icons, photo category tiles (uses your product photos), 4:5 portrait product cards with discount badges and rating chips, product page with sticky "Add to cart" on phones, cart with a separate order-summary card, dark footer with links and contact details, restyled admin. Colours and fonts are CSS variables at the top of `public/index.html` (`--pri` is the main colour). The "Admin" link moved from the top menu to the footer ("Staff login"). Search now lives in the header.

### v2.3 (marketplace-style layout)
Coloured header with a wide search bar and Login button; round category icons (your product photos); rotating banners (edit the three `SLIDES` near `function shop` in `public/index.html`); sideways-scrolling deal rows (Top deals, Under Rs.500, Top rated, New arrivals) with "View all"; category/search pages with a left filter sidebar (price, rating, discount, stock) and sort tabs; product page with offers box, **Add to cart + Buy now**, similar products and a ratings summary, plus a sticky Add to cart / Buy now bar on phones; cart shows "You will save Rs.X". Colours are the CSS variables at the top (`--hd` header, `--pri` links/highlights, `--cta` Add to cart, `--buy` Buy now).

## v2.4 (sell any kind of product)
Fresh installs: import `schema.sql` using `utf8mb4`, then run `npm run migrate:verify`.
Existing databases: take and verify a protected backup, run `npm run migrate:verify`,
then `npm run migrate` and verify again. If migrations were already applied by hand,
use `npm run migrate -- --baseline N` only after confirming the database matches that
complete migration level; baseline refuses incomplete schemas and is not a repair tool.
See [MIGRATIONS.md](./MIGRATIONS.md) for recovery steps.

**Admin > Categories:** create your own categories (name, emoji, default GST % and HSN, order). New products start with their category's GST/HSN. Renaming a category moves its products. Customers only see categories that have products. The menu, home icons, footer and sitemap follow automatically.

**Admin > Settings:** edit the rotating home-page banners (headline, text, button, where it links, colours). "Reset to default" restores the generic ones. The shop name, address, phone etc. still come from `.env` (`STORE_*`).

**Per product** (Admin > Products > *Details, photos & options*): brand, SKU, country of origin, manufacturer/packer/importer, specification list (one `Name: value` per line - shown as a table), **names of the two options** (Size/Colour, Storage/Colour, Pack/Flavour, UK size...), **return window** (shop default / no returns / 3-30 days), **cash on delivery allowed**, and parcel size for the courier. Each size/colour option can have **its own price and MRP** (leave blank to use the product's). Customers see "From ₹X" on cards, the price changes when they pick an option, and the product page, cart, checkout, coupons, invoice and courier all use the chosen option's price.

**Rules enforced at checkout:** a product marked "no COD" (or any order above `COD_MAX` in `.env`) must be paid online; a product marked "no returns" blocks return requests for that order; return windows are the shortest among the items in the order. (Returns are for the whole order - partial item returns are not supported yet.)

**Brand filter** and brand/category words in search on the listing pages.

**Bulk upload:** Admin > Products > *Bulk upload (CSV)* - download the template, fill it in Excel/Sheets, upload. Up to 500 rows at a time; a row with an existing SKU updates that product (price, stock, details), otherwise a product is created; unknown categories are created automatically; rows with errors are listed with the reason and skipped. Photos and size/colour options are added afterwards per product.

**Before you sell certain things, check the rules:** Razorpay does not allow some categories (tobacco, alcohol, prescription medicine, weapons, adult items ...); food needs an FSSAI licence and shows net quantity/expiry; electronics may need BIS/warranty details; cosmetics and medicines have their own licences. Expiry dates/batches, bundles/combos, digital goods, services and made-to-order items are not supported.

### Running locally
See **LOCAL-SETUP.md** (VS Code, MySQL, `.env.local.example`, `npm run doctor`, `npm run dev`). When SMTP is not configured and `NODE_ENV` is not `production`, outgoing emails are printed in the terminal so you can test verification and password-reset links.


## MegaMart reference catalogue (v2.4.1 update)

This project can use the broader MegaMart-style catalogue shown in the reference screenshots. After importing the existing schema and setting `.env`, run `npm run seed:megamart`. The seed script is repeatable: it upserts the nine categories and ten sample products by SKU, reuses/creates supplier records, and hides only the six original sample winter products (it does not delete them). It never drops tables or deletes customer accounts, orders, reviews, or addresses. Product review counts are not fabricated.

Set `STORE_NAME=MegaMart` in your local `.env` to change the visible store name. Demo catalogue items use emoji illustrations until you upload real product images in the admin panel. Review prices, tax classifications, suppliers, descriptions and stock before any real sales; the included catalogue is sample/demo data.
