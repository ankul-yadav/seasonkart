# MegaMart reference design update

This update keeps the existing SeasonKart application and its checkout/admin code. It adds a safe, repeatable catalogue seed for the wider MegaMart-style store in the reference screenshots.

## Before you start

1. Keep a backup of your current project and database. Do not delete or reinitialize the MySQL data folder.
2. Extract this ZIP into a new folder first, then copy your local `.env` into that folder. Do not share `.env` in screenshots or chat.
3. Check `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`, and `JWT_SECRET` in `.env`. Keep your own secure values; do not copy example credentials into a live store.
4. Make sure MySQL is running and use a disposable development database. The seed requires an explicit development opt-in and refuses database names containing `prod` or `live`.

## Apply the MegaMart catalogue

From the project directory (the folder containing `package.json`), run:

```bash
npm install
npm run migrate:verify
npm run doctor
NODE_ENV=development SEASONKART_ALLOW_DEMO_SEED=1 npm run seed:megamart
```

The seed command:
- Adds demo-prefixed categories and suppliers plus ten sample products marked with `is_demo`.
- New demo products remain inactive until an admin reviews and approves them.
- Hides known starter winter demo products without deleting their rows.
- Does not drop or recreate tables and does not delete customers, orders, order items, reviews, addresses, admin accounts or other products.
- Can be run again safely.

## Branding and launch

Set this in your private `.env` file:

```env
STORE_NAME=MegaMart
```

Then start the app:

```bash
npm start
```

Open `http://localhost:3000`. Keep the terminal running while using the site. The sample products initially use emoji illustrations; upload licensed product photos in the admin panel for a closer visual match. No fake customer reviews are added. This is a visual/catalogue alignment, not a claim that real suppliers, product images, tax advice, payment credentials or shipping integrations are live.

## Before going live

Replace demo catalogue values with verified product data, actual supplier and manufacturer details, real product photos, accurate tax/HSN information, actual inventory, and your store's policies. Configure a limited-privilege MySQL account, strong JWT/admin credentials, HTTPS, email, courier and payment test credentials. Never commit `.env` to a public repository.
