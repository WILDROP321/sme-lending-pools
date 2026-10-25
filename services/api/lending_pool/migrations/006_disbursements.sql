-- Let an approved funding request receive its disbursement address, and
-- record exactly one independently verified, validated Devnet transaction
-- (pool -> business) per funding request before it can move to 'funded'.

ALTER TABLE funding_requests ADD COLUMN xrpl_address TEXT;

-- tx_hash is UNIQUE so the same validated transaction cannot be recorded
-- twice; funding_request_id is UNIQUE so one request can be disbursed by
-- exactly one receipt. Mirrors ledger_receipts for contribution intents.
CREATE TABLE disbursements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funding_request_id INTEGER NOT NULL UNIQUE REFERENCES funding_requests(id),
    tx_hash TEXT NOT NULL UNIQUE,
    amount_drops INTEGER NOT NULL CHECK (typeof(amount_drops) = 'integer' AND amount_drops > 0),
    sender_address TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
