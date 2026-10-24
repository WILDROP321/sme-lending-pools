# Database migrations

Each developer uses their own ignored SQLite database at `services/api/instance/lending.sqlite`. Never commit the database or a backup.

## Fresh checkout

```sh
python -m flask init-db
python -m flask seed-demo
```

Both `init-db` and `migrate-db` apply all pending migrations. Seeding creates a demo pool and demo investor only when their tables are empty; it never creates an on-ledger account or payment.

## Upgrade an existing checkout

Activate your environment and stop the development server. Make a SQLite backup before applying schema changes:

```sh
python -c "import sqlite3; src=sqlite3.connect('services/api/instance/lending.sqlite'); dst=sqlite3.connect('services/api/instance/lending-backup.sqlite'); src.backup(dst); dst.close(); src.close()"
python -m flask migrate-db
python -m flask run --debug
```

The backup command overwrites an existing `lending-backup.sqlite`; choose a new backup filename if you want to keep multiple snapshots.

Migration `001_initial.sql` adopts the original unversioned tables. `002_investors_and_reviews.sql` adds investors, pending intents, review history, and funding-request status constraints. Existing pool/request IDs, amounts, statuses, and timestamps are preserved. There are no destructive reset commands.

The runner records versions in `schema_migrations`, takes a write lock while checking/applying migrations, and applies pending changes in one transaction. A failure rolls back all changes from that invocation. Unexpected old status/amount values cause a failure rather than silently rewriting records; inspect those records before retrying.

## Adding a migration

Add the next numbered SQL file under `services/api/lending_pool/migrations/`, for example `003_ledger_receipts.sql`. Never edit, rename, or reorder an applied migration. Keep transaction control in the Python runner, not in migration SQL. Add tests that upgrade an existing database and verify record preservation, constraints, and repeat runs.

This starter supports forward migrations. Returning to older code may require restoring a compatible backup; do not assume older application code understands a newer database.
