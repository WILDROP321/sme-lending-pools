CREATE TABLE market_investors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    preference TEXT NOT NULL CHECK(preference IN ('core', 'balanced', 'opportunity')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE market_deposits ADD COLUMN investor_id INTEGER REFERENCES market_investors(id);
ALTER TABLE market_deposits ADD COLUMN operation_key TEXT;
CREATE UNIQUE INDEX market_deposit_operation ON market_deposits(operation_key);
ALTER TABLE market_requests ADD COLUMN years_trading REAL;
ALTER TABLE market_requests ADD COLUMN late_payment_pct REAL;
ALTER TABLE market_requests ADD COLUMN assessment TEXT;
ALTER TABLE market_requests ADD COLUMN invoice_key TEXT;
ALTER TABLE market_requests ADD COLUMN document_name TEXT;
ALTER TABLE market_requests ADD COLUMN document_type TEXT;
ALTER TABLE market_requests ADD COLUMN document_data BLOB;
ALTER TABLE market_requests ADD COLUMN created_at TEXT;
ALTER TABLE market_requests ADD COLUMN approved_at TEXT;
CREATE UNIQUE INDEX market_invoice_identity ON market_requests(invoice_key);
CREATE TABLE market_reviews (
    id INTEGER PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES market_requests(id),
    decision TEXT NOT NULL CHECK(decision IN ('approved', 'rejected')),
    reviewer TEXT NOT NULL,
    note TEXT NOT NULL,
    checks TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
