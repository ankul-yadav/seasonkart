# Run SeasonKart on your own computer (VS Code)

You get the same shop you saw in the screenshots. It runs at **http://localhost:3000** and only you can see it. Allow about 30 minutes the first time.

> Important: open the shop with `npm start` (below). Do **not** double-click `index.html` and do **not** use the VS Code "Live Server" extension - the pages need the Node server and the database behind them, otherwise they stay empty.

## What you need (one time)
1. **Node.js 20.9 or newer** (LTS version) - https://nodejs.org . Check in a terminal: `node -v`.
2. **MySQL 8** (or MariaDB 10.5+). Easiest options:
   * **Windows:** install "MySQL Installer" from mysql.com > choose *MySQL Server* (+ *Workbench*), remember the **root password** you set. *Or* install **XAMPP** and press *Start* next to MySQL (its root password is empty).
   * **Mac:** `brew install mysql && brew services start mysql` (root password is empty at first).
3. **VS Code** (you have it) - open this folder with *File > Open Folder*.

## Steps
Open the terminal inside VS Code (*Terminal > New Terminal*) - it must be in the folder that contains `package.json`.

**1. Install the packages**
```
npm install
```

**2. Create the database and tables** (`schema.sql` creates a database called `seasonkart`)
* Terminal way (works if `mysql` is installed in your PATH): `mysql --default-character-set=utf8mb4 -u root -p < schema.sql` (press Enter if there is no password)
* Workbench way: open *MySQL Workbench* > connect > *File > Open SQL Script* > pick `schema.sql` > press the lightning button.
* XAMPP way: open http://localhost/phpmyadmin > *Import* > choose `schema.sql` > *Go*.

**3. Settings file**
* Windows: `copy .env.local.example .env`   Mac/Linux: `cp .env.local.example .env`
* Open `.env` in VS Code and set `DB_PASS` to your MySQL password (leave it empty for XAMPP / a fresh Mac install). You can change `ADMIN_EMAIL` and `ADMIN_PASSWORD` too.

**4. Verify the schema and check setup**
```
npm run migrate:verify
npm run doctor
```
Schema verification is read-only and reports missing/incompatible columns and indexes. The doctor checks app connectivity and required tables. Repeat until both pass.

**5. Start the shop**
```
npm start
```
(or `npm run dev` - restarts automatically when you edit a file.) Open **http://localhost:3000**.

**6. Log in as admin:** http://localhost:3000/#admin with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.

## First things to try
1. Admin > **Categories**: add your categories. Admin > **Products**: add a product with a photo (or use *Bulk upload (CSV)*), then open its **Details, photos & options** panel to add sizes/colours, brand and specifications.
2. Admin > **Settings**: change the home banners. Fresh `schema.sql` no longer inserts demo products or suppliers.
3. In the shop: search, add to cart, apply a coupon (create one in Admin > Coupons), place a **Cash on delivery** order.
4. Admin > **Orders** > View: mark it *Shipped* (enter a tracking number) and *Delivered*, download the invoice, then as the customer try *Request return* and *Write a review*.

## What works with nothing else installed
Browsing, search and filters, cart, coupons, **COD orders**, customer sign-up/login, wishlist, saved addresses, reviews, order tracking, cancel/return flow, invoice PDF, reports and CSV export, categories, banners, bulk upload, photo upload/compression, the whole admin panel.

## What needs an outside account (all optional while testing)
| Feature | What to add in `.env` | Notes |
|---|---|---|
| **Online payment** | `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` from razorpay.com > Settings > API keys, **Test mode** | Free. Pay with Razorpay's test card/UPI. Without keys only COD works. |
| **Emails** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (Gmail app password, Brevo, Mailtrap...) | Without it, each email is **printed in the terminal** so you can still copy the verification / password-reset link. |
| **SMS, WhatsApp, COD OTP** | `TWILIO_*` or `WA_*`, then `COD_OTP=1` | Needs real accounts (and WhatsApp template approval). Skip while testing. |
| **Razorpay webhook** | a public address, `RAZORPAY_WEBHOOK_SECRET`, and `BASE_URL` | Razorpay HMAC-SHA256 signatures are checked against the exact raw JSON request body. |
| **Supplier callbacks** | HTTPS supplier URL and `SUPPLIER_WEBHOOK_SECRET` | Uses HMAC-SHA256 and stable idempotency keys; suppliers need to implement signature verification and event deduplication. No callback is sent without a secret. |
| **Shiprocket webhook** | Not enabled | Current configuration documents a static header token, not a signed raw-body event. Updates must be entered manually until Shiprocket provides a documented signature and event-ID contract. |
| **Shiprocket courier** | `SHIPROCKET_*` | Or just type tracking numbers by hand. |
| **HTTPS** | - | Only on a real server (see `DEPLOY.md`). |

## If something goes wrong
| You see | Do this |
|---|---|
| `STOP: set JWT_SECRET ...` | `.env` is missing or `JWT_SECRET` is empty/short - redo step 3 |
| `ECONNREFUSED` / "Cannot connect" | MySQL is not running - start it (Services, XAMPP, `brew services start mysql`) |
| `ER_ACCESS_DENIED_ERROR` | wrong `DB_USER` / `DB_PASS` in `.env` |
| `ER_BAD_DB_ERROR` / `Unknown database` | step 2 was not done |
| `Table ... doesn't exist` / `Unknown column` | run `npm run migrate:verify`, review its output, then run `npm run migrate` |
| `EADDRINUSE` (port in use) | change `PORT=3001` in `.env` and open that port |
| Blank white page | `NODE_ENV` must be `development` in `.env` for localhost; open the browser console (F12) and send me the red error |
| `npm install` fails on `sharp` | run `npm install --include=optional`; photos still upload even without it |
| Any other error | copy the **red text from the terminal** (and the browser console, F12) and send it to me |

**Honest note:** this code has been tested piece by piece, but I have not been able to run the full shop against a real MySQL database myself. Small first-run bugs are possible - that is exactly what `npm run doctor` and the steps above are for. Send me any error text and I will fix it.
