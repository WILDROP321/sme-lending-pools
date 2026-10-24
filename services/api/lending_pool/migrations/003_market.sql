CREATE TABLE market_requests (
 id INTEGER PRIMARY KEY, company TEXT NOT NULL, sector TEXT NOT NULL, purpose TEXT NOT NULL,
 invoice_ref TEXT NOT NULL, debtor TEXT NOT NULL, due_date TEXT NOT NULL,
 invoice_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL,
 risk REAL NOT NULL, pool TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_verification'
);
CREATE TABLE market_deposits (
 id INTEGER PRIMARY KEY, pool TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
