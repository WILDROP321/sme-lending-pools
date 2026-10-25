-- Demo balances are intentionally not migrated into on-chain holdings.
CREATE TABLE wallet_challenges (
    nonce TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    message TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ledger_intents (
    id TEXT PRIMARY KEY,
    network TEXT NOT NULL,
    account TEXT NOT NULL,
    pool TEXT,
    action TEXT NOT NULL,
    transaction_json TEXT NOT NULL,
    tx_hash TEXT UNIQUE,
    signed_blob TEXT,
    status TEXT NOT NULL DEFAULT 'prepared',
    result_code TEXT,
    ledger_index INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE market_requests ADD COLUMN wallet_address TEXT;
