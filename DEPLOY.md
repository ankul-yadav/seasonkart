# Putting SeasonKart live (VPS guide)

This guide takes you from an empty Ubuntu server to a live, HTTPS, backed-up, monitored shop. Budget about 2-3 hours the first time. Commands marked `#` are run as root/sudo, `$` as your normal user. Replace `yourshop.com` everywhere.

**What you need:** a domain name; a VPS with Ubuntu 24.04, 2 GB RAM, 25+ GB disk (DigitalOcean, Hetzner, AWS Lightsail, Hostinger...); a Razorpay account (live KYC done); an SMTP email account (Brevo / Zoho / Amazon SES / Gmail app-password); optional: Shiprocket, Twilio, WhatsApp Cloud API, an off-site storage account for backups (Google Drive / Backblaze B2 / any S3).

---
## Render deployment

The included `render.yaml` creates a paid Node web service with a persistent disk for uploaded product photos and `/health` monitoring. The app still needs an external MySQL database; Render's web service does not provide this project's MySQL database.

1. Create a MySQL database that accepts connections from Render. Create a non-root app user with `SELECT, INSERT, UPDATE, DELETE` privileges and a separate migration user with schema-change privileges. Use a DNS hostname whose TLS certificate matches `DB_HOST`; set `DB_SSL=1`, provide the database CA certificate in `DB_SSL_CA` if it is not publicly trusted, and restrict inbound MySQL traffic to the Render service's outbound IP addresses. Never expose port 3306 to `0.0.0.0/0`.
2. Push this project to a private GitHub repository, including `render.yaml`, `package.json`, and `package-lock.json`. Do not add `.env`, secrets, local databases, `node_modules`, or customer data.
3. In Render, create a Blueprint from that repository and enter the requested values securely in Render's environment-variable form. Use the external MySQL connection details and Razorpay **test** key ID, key secret, and webhook secret first. Keep `NODE_ENV=production` and `TRUST_PROXY=1`; do not share secrets in chat.
4. After the service is created, set `BASE_URL` to the HTTPS `onrender.com` service URL and set the Render-provided `PORT` only if the service asks for it. Configure Razorpay's webhook URL as `https://<your-service-host>/api/payment/webhook` for `payment.captured` and `order.paid`, using the same webhook secret.
5. Import `schema.sql` into the new database only for a fresh store, then run `npm run migrate:verify` and `npm run migrate -- --baseline` using the migration user's credentials. Do not point the deployment at the local development database.
6. Confirm `/health` returns `{"ok":true}`, run `npm run doctor` with the production configuration, upload real product photos, and complete a test-mode checkout and refund. Switch to Razorpay live keys only after the test transaction, webhook, and refund all succeed.
7. Render disks persist photos across deploys but are not backups. Configure database backups with the database provider and schedule encrypted off-site copies of `/var/data/uploads` and `/var/data/backups`; the VPS crontab examples below do not run on Render.

The Render blueprint uses a paid instance and persistent disk. A free/ephemeral service is not suitable for this shop's photo uploads. A custom domain can be added later; set `BASE_URL` to the final HTTPS domain when DNS and TLS are ready.

---
## 1. First-time server setup
```bash
ssh root@YOUR_SERVER_IP
adduser deploy && usermod -aG sudo deploy          # a normal user to run the shop
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy   # copy your SSH key to it
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable   # firewall: only SSH, HTTP, HTTPS
apt update && apt -y upgrade && apt -y install unattended-upgrades   # automatic security updates
```
Log in as `deploy` from now on (`ssh deploy@YOUR_SERVER_IP`). Optional but recommended: in `/etc/ssh/sshd_config` set `PermitRootLogin no` and `PasswordAuthentication no`, then `sudo systemctl restart ssh` (only after you confirmed key login works!).

## 2. Install the software
```bash
sudo apt -y install nginx mysql-server certbot python3-certbot-nginx unzip curl logrotate
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt -y install nodejs   # Node 22 LTS (20.9+ required)
sudo npm install -g pm2
node -v && mysql --version && nginx -v
```

## 3. Database
```bash
sudo mysql_secure_installation        # set a root password, remove test db, etc.
sudo mysql
```
```sql
CREATE DATABASE seasonkart CHARACTER SET utf8mb4;
-- the shop itself only needs normal read/write rights (NOT root):
CREATE USER 'seasonkart'@'localhost' IDENTIFIED BY 'PUT-A-LONG-RANDOM-PASSWORD-HERE';
GRANT SELECT,INSERT,UPDATE,DELETE ON seasonkart.* TO 'seasonkart'@'localhost';
-- a second user that is only used when you upgrade the shop (needs permission to change tables):
CREATE USER 'seasonkart_admin'@'localhost' IDENTIFIED BY 'ANOTHER-LONG-RANDOM-PASSWORD';
GRANT ALL ON seasonkart.* TO 'seasonkart_admin'@'localhost';
EXIT;
```
MySQL listens on localhost only by default - keep it that way (never open port 3306 in the firewall).

## 4. Install the shop
```bash
sudo mkdir -p /var/www && sudo chown deploy:deploy /var/www
cd /var/www && unzip ~/seasonkart-fullstack-vX.Y.zip      # upload the zip to your home folder first (scp / sftp); it creates /var/www/seasonkart
cd /var/www/seasonkart && mkdir -p logs backups public/uploads
npm install --omit=dev
sudo mysql --default-character-set=utf8mb4 seasonkart < schema.sql # creates all tables (fresh install only)
cp .env.example .env && chmod 600 .env && nano .env
DB_USER=seasonkart_admin DB_PASS='ANOTHER-LONG-RANDOM-PASSWORD' npm run migrate:verify
DB_USER=seasonkart_admin DB_PASS='ANOTHER-LONG-RANDOM-PASSWORD' npm run migrate -- --baseline   # verifies the complete schema before marking migrations
```
Fill `.env` (the important lines; everything is explained in `.env.example`):
`NODE_ENV=production`, `PORT=3000`, `DB_USER=seasonkart` + its `DB_PASS`, `JWT_SECRET` (generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`), `ADMIN_EMAIL` + a strong `ADMIN_PASSWORD` (10+ chars; used only to create the first admin at first start), `BASE_URL=https://yourshop.com`, `TRUST_PROXY=1`, `RAZORPAY_*`, `SMTP_*` + `MAIL_FROM` + `ADMIN_NOTIFY_EMAIL` (this address also receives server-error alerts), `STORE_NAME / STORE_EMAIL / STORE_PHONE / STORE_ADDRESS / STORE_STATE / STORE_GSTIN / GRIEVANCE_OFFICER`.
Without `TRUST_PROXY=1` every visitor looks like the same IP and the rate limiter will block real customers.

## 5. Run it with PM2
```bash
cd /var/www/seasonkart
pm2 start deploy/ecosystem.config.js
pm2 save
pm2 startup          # prints one command starting with "sudo env PATH=..." - copy/paste and run it so the shop starts after a reboot
curl -s http://127.0.0.1:3000/health        # should print {"ok":true}
pm2 logs seasonkart --lines 50              # look for "SeasonKart running on port 3000" and "Admin created"
```
(Prefer systemd? Use `deploy/seasonkart.service` instead - instructions are inside the file. Use one or the other, not both.)

## 6. nginx + HTTPS
1. In your domain's DNS add an **A record** for `yourshop.com` and `www` pointing to the server IP. Wait until `ping yourshop.com` shows that IP.
2. `sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/seasonkart`, edit the domain names, then:
```bash
sudo ln -s /etc/nginx/sites-available/seasonkart /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d yourshop.com -d www.yourshop.com     # free HTTPS certificate, auto-renews
```
3. Open `https://yourshop.com` - the shop should load. Log in at `https://yourshop.com/#admin` with your `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## 7. Connect the outside services (use the exact URLs)
| Service | Where | Value |
|---|---|---|
| Razorpay webhook | Dashboard > Settings > Webhooks | `https://yourshop.com/api/payment/webhook`, events `payment.captured`, `order.paid`; secret = `RAZORPAY_WEBHOOK_SECRET` |
| Shiprocket webhook | Disabled | The current static token is not a documented body signature. Use manual tracking until Shiprocket provides signed events with an event ID. |
| Google Search Console | search.google.com/search-console | add the site, submit `https://yourshop.com/sitemap.xml` |
| Uptime monitor | UptimeRobot / Better Stack / Freshping (free) | check `https://yourshop.com/health` every 5 min, alert to your email/phone |

## 8. Backups (do not skip - this is your insurance)
```bash
cd /var/www/seasonkart && bash scripts/backup.sh       # run once by hand first - it must end with "done"
crontab -e                                              # paste the line from deploy/backup.cron.example (nightly 02:15)
```
* The nightly job saves a compressed database dump (14 days kept) plus a weekly archive of your photos in `backups/`. The admin dashboard shows **Last backup**; the box turns red if it is older than 36 hours.
* **Copy backups off the server.** A backup that lives only on the same server is lost together with it. Easiest: install `rclone` (`curl https://rclone.org/install.sh | sudo bash`), run `rclone config` to connect Google Drive, Backblaze B2 or any S3 bucket, then set `BACKUP_RCLONE_REMOTE=gdrive:seasonkart-backups` in `.env`. Many cloud-server providers also offer one-click full-server snapshots - turn them on as a second layer.
* Backups contain customer names, phones and addresses. Set `BACKUP_PASSPHRASE` in `.env` to encrypt them (and store that passphrase in your password manager - without it nothing can be restored).
* Sign up at healthchecks.io (free), create a check with a 1-day schedule, and put its ping URL in `HC_PING_URL`: you get an email if a nightly backup does not report in.
* **Restore drill (do it once now, then every few months):**
```bash
bash scripts/restore.sh backups/db-YYYYMMDD-HHMMSS.sql.gz seasonkart_test     # restores into a scratch database, touches nothing live
sudo mysql seasonkart_test -e "SELECT COUNT(*) FROM orders; SELECT COUNT(*) FROM products;"   # numbers look right?
sudo mysql -e "DROP DATABASE seasonkart_test"
```
  Real disaster: `pm2 stop seasonkart` → `bash scripts/restore.sh <file>` (asks you to type YES) → `bash scripts/restore.sh backups/uploads-....tar.gz` for photos → `pm2 start seasonkart`.
* Log rotation so logs never fill the disk: create `/etc/logrotate.d/seasonkart` containing
```
/var/www/seasonkart/logs/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
```

## 9. Monitoring - how you find out something is wrong
* **Uptime monitor** on `/health` (it also checks the database; returns 503 if MySQL is down).
* **Error emails:** any unexpected server error emails `ADMIN_NOTIFY_EMAIL` (the same error at most once per 10 minutes, max 20 a day). If the server crashes it is restarted automatically by PM2.
* **Admin dashboard boxes:** *Last backup*, *Disk free*, *Refunds pending* (a refund that failed and needs "Retry refund"), *Stuck payments* (online orders unpaid for 2+ hours).
* Useful commands: `pm2 status`, `pm2 logs seasonkart`, `pm2 monit`, `df -h` (disk), `free -m` (memory), `sudo tail -f /var/log/nginx/error.log`.

## 10. Updating the shop later
```bash
cd /var/www/seasonkart
npm run backup                                    # always first
# upload the new zip next to the folder, then copy over the program files WITHOUT touching .env, uploads/ and backups/:
unzip -o ~/seasonkart-fullstack-vNEW.zip -d /tmp/sk && rsync -a --exclude .env --exclude public/uploads --exclude backups --exclude logs --exclude node_modules /tmp/sk/seasonkart/ ./
npm install --omit=dev
DB_USER=seasonkart_admin DB_PASS='...' npm run migrate      # applies only the new migrateN.sql files, in order
pm2 reload seasonkart                             # graceful, no dropped requests
curl -s https://yourshop.com/health               # {"ok":true}
```
If you were upgrading an existing shop by hand-running `migrate*.sql` files before, tell the tool where you were once: `npm run migrate -- --baseline N` (N = number of the last file you ran; `migrate.sql` is 1, `migrate2.sql` is 2 ...), then `npm run migrate`. `npm run migrate -- --status` shows what is applied.
**Rollback:** `pm2 stop seasonkart`, put the previous program files back, restore the pre-update database backup (section 8), `pm2 start seasonkart`.
**Forgot the admin password?** `node scripts/admin.js you@yourshop.com 'a-new-long-password'`.

## 11. Security checklist
- [ ] Only ports 22, 80, 443 open (`sudo ufw status`); SSH by key only; MySQL not exposed.
- [ ] `.env` is `chmod 600` and is never uploaded to GitHub / shared in chat.
- [ ] Shop runs as the `deploy` user (not root) and connects to MySQL as `seasonkart` (not root).
- [ ] `NODE_ENV=production`, `BASE_URL` starts with `https://`, `TRUST_PROXY=1`.
- [ ] Strong, unique `JWT_SECRET`, `ADMIN_PASSWORD`, DB passwords (password manager).
- [ ] Razorpay: live keys in `.env`, webhook secret set, test keys removed.
- [ ] Backups run nightly, are copied off-server, and you did one restore drill.
- [ ] Automatic OS security updates are on (`unattended-upgrades`); reboot occasionally (`sudo reboot` - PM2 starts the shop again).

## 12. Go-live checklist
1. **Test with real small money first:** a ₹1-10 product, pay online, confirm: order appears, confirmation email/SMS/WhatsApp arrives, webhook marks it paid (check Razorpay's webhook log shows 200), refund it by cancelling the order and see the refund in Razorpay.
2. Place a **COD** order (with OTP if you turned `COD_OTP=1` on), mark it Shipped (and create a Shiprocket shipment if used), mark Delivered, download the **invoice PDF** and show it to your CA, then try a **return**.
3. Check the **forgot password** and **email verification** emails arrive (not in spam; set SPF/DKIM for your sending domain at your email provider).
4. Check **policy pages** show your real details and have been read by a lawyer; GST rates/HSN codes confirmed by your CA.
5. `schema.sql` adds a few **demo products and demo suppliers** - delete them (Admin > Products / Suppliers) and add your real ones: photos, description, sizes with stock, price/MRP, GST %, weight. Edit the demo supplier or add yours so the supplier webhook/shipping details are correct. Verify every active product photo loads; the storefront shows a neutral placeholder when an uploaded photo is missing.
6. Paste a product link into WhatsApp to check the preview; view `https://yourshop.com/sitemap.xml`.
7. Remove test data (take a backup first!). In `sudo mysql seasonkart`:
```sql
DELETE FROM order_items; DELETE FROM orders; DELETE FROM reviews; DELETE FROM wishlist; DELETE FROM otps;
ALTER TABLE orders AUTO_INCREMENT=1; UPDATE coupons SET uses=0;
```
   then re-check stock numbers of products you used in test orders (Admin > Products).
8. Turn on your uptime monitor, check the dashboard shows a recent **Last backup**, and tell a friend to place a real order.

## 13. Troubleshooting
| Symptom | Likely cause / fix |
|---|---|
| nginx shows **502 Bad Gateway** | The app is not running: `pm2 status`, `pm2 logs seasonkart` (wrong `.env` / DB password is the usual reason) |
| App exits at start with "STOP: set JWT_SECRET..." / "choose a real ADMIN_PASSWORD" | Fix `.env` as the message says, `pm2 restart seasonkart` |
| Photo upload fails with **413** | nginx `client_max_body_size` too small (keep `8m`) |
| Customers get "Too many requests" | `TRUST_PROXY=1` missing in `.env` (all visitors share the nginx IP) |
| Online payment succeeds but order stays "unpaid" | Razorpay webhook not set/secret mismatch; check Razorpay > Webhooks > logs |
| No emails | `SMTP_*` wrong - `pm2 logs` shows "[email skipped]" or the SMTP error |
| WhatsApp/OTP not delivered | Template not approved yet / wrong name or variable count in `.env` (logs show the Meta error); SMS is the fallback |
| Dashboard "Last backup: NEVER" | The cron job has not run or failed: `tail logs/backup.log`, run `bash scripts/backup.sh` by hand |
| `mysqldump: command not found` | `sudo apt install mysql-client` |
| Disk filling up | `du -sh backups logs public/uploads`; lower `BACKUP_KEEP_DAYS`, make sure logrotate is set up |

*Not included in this package (add later if you need them): Docker files, multiple servers / load balancing, a separate staging site, automatic database replication.*
