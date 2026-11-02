# Safe database migration procedure

The application does not run schema migrations automatically at startup.

## Before changing an existing database

1. Stop application processes and confirm the selected database name and host from
   your deployment configuration without sharing `.env`.
2. Take a consistent backup to a private, access-restricted directory. Use the
   database client's password prompt; do not put a password in the command line:

   ```sh
   mkdir -p backups
   mysqldump --single-transaction --routines --triggers --hex-blob \
     --default-character-set=utf8mb4 -h DB_HOST -u DB_USER -p DB_NAME \
     | gzip > backups/pre-migration-$(date +%Y%m%d-%H%M%S).sql.gz
   gzip -t backups/pre-migration-*.sql.gz
   ```

3. Restore that backup to a **new disposable database** and verify the restored
   data and application compatibility before considering a production migration.
   Never restore over the existing database as a test.
4. On the intended database, run:

   ```sh
   npm run migrate:verify
   npm run migrate
   npm run migrate:verify
   npm run migrate -- --status
   ```

The runner stops at the first SQL/schema verification error and does not advance
the migration history for that migration. Correct the reported compatibility
issue, retain the database and rows, and rerun `npm run migrate`. Applied
migration files are SHA-256 checked. Do not edit a migration that has already
been applied; add a new numbered migration instead.

`npm run migrate -- --baseline` is only for a separately reviewed, already
compatible schema. It verifies the complete required schema before recording any
history, and it is not a repair mechanism. Do not use it to bypass verification.

## Recovery

If a migration stops after applying some DDL, leave the database intact. Review
the error and actual schema using `npm run migrate:verify` and
`npm run migrate -- --status`. The supported runner is designed to skip
already-present columns, indexes, and constraints and safely resume; do not
manually mark migration history. If a column or constraint has an incompatible
definition, preserve the original data and take a new backup before a reviewed,
targeted correction. Do not drop/reset tables to make verification pass.

Backups contain customer and order data. Keep them outside source archives,
restrict their permissions, encrypt off-host copies, and validate recovery
periodically.
