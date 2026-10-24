-- Record the XRPL Devnet addresses used for reconciliation, and let a
-- contribution intent move from 'pending' to 'funded' once exactly one
-- independently verified, validated transaction has been recorded for it.

ALTER TABLE pools ADD COLUMN xrpl_address TEXT;
ALTER TABLE investors ADD COLUMN xrpl_address TEXT;

CREATE TABLE contribution_intents_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investor_id INTEGER NOT NULL REFERENCES investors(id),
    pool_id INTEGER NOT NULL REFERENCES pools(id),
    amount_drops INTEGER NOT NULL
        CHECK (typeof(amount_drops) = 'integer' AND amount_drops > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'funded')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO contribution_intents_v3
    (id, investor_id, pool_id, amount_drops, status, created_at)
SELECT id, investor_id, pool_id, amount_drops, status, created_at
FROM contribution_intents;
DROP TABLE contribution_intents;
ALTER TABLE contribution_intents_v3 RENAME TO contribution_intents;
CREATE INDEX contribution_intents_investor ON contribution_intents(investor_id);
CREATE INDEX contribution_intents_pool ON contribution_intents(pool_id);

-- tx_hash is UNIQUE so the same validated transaction cannot be recorded twice
-- (no double-crediting from a repeat observation). contribution_intent_id is
-- UNIQUE so one intent can be funded by exactly one receipt.
CREATE TABLE ledger_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contribution_intent_id INTEGER NOT NULL UNIQUE REFERENCES contribution_intents(id),
    tx_hash TEXT NOT NULL UNIQUE,
    amount_drops INTEGER NOT NULL CHECK (typeof(amount_drops) = 'integer' AND amount_drops > 0),
    sender_address TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
