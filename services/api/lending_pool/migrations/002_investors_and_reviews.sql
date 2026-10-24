CREATE TABLE investors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE contribution_intents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investor_id INTEGER NOT NULL REFERENCES investors(id),
    pool_id INTEGER NOT NULL REFERENCES pools(id),
    amount_drops INTEGER NOT NULL
        CHECK (typeof(amount_drops) = 'integer' AND amount_drops > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending'),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX contribution_intents_investor ON contribution_intents(investor_id);
CREATE INDEX contribution_intents_pool ON contribution_intents(pool_id);

-- Preserve the starter's records and IDs while constraining lifecycle states.
CREATE TABLE funding_requests_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id INTEGER NOT NULL REFERENCES pools(id),
    business_name TEXT NOT NULL,
    amount_drops INTEGER NOT NULL
        CHECK (typeof(amount_drops) = 'integer' AND amount_drops > 0),
    expected_payment_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected',
                         'cancelled', 'funded', 'repaid', 'defaulted')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO funding_requests_v2
    (id, pool_id, business_name, amount_drops, expected_payment_date, status, created_at)
SELECT id, pool_id, business_name, amount_drops, expected_payment_date, status, created_at
FROM funding_requests;
DROP TABLE funding_requests;
ALTER TABLE funding_requests_v2 RENAME TO funding_requests;

CREATE TABLE funding_request_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    funding_request_id INTEGER NOT NULL REFERENCES funding_requests(id),
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX funding_request_reviews_request ON funding_request_reviews(funding_request_id);
