ALTER TABLE mock_companies ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined'));
UPDATE mock_companies SET status = 'declined' WHERE risk_factor < 20;
CREATE TABLE mock_vaults (
 pool TEXT PRIMARY KEY CHECK(pool IN ('Safe','Medium','Risky')),
 opening_balance_cents INTEGER NOT NULL CHECK(opening_balance_cents >= 0),
 balance_cents INTEGER NOT NULL CHECK(balance_cents >= 0)
);
INSERT INTO mock_vaults(pool,opening_balance_cents,balance_cents)
 SELECT p.pool,coalesce(sum(c.decided_disbursement_cents),0)*2,coalesce(sum(c.decided_disbursement_cents),0)*2
 FROM (SELECT 'Safe' AS pool UNION ALL SELECT 'Medium' UNION ALL SELECT 'Risky') p
 LEFT JOIN mock_companies c ON c.pool=p.pool GROUP BY p.pool;
CREATE TABLE mock_vault_transactions (
 id TEXT PRIMARY KEY,
 pool TEXT NOT NULL REFERENCES mock_vaults(pool),
 kind TEXT NOT NULL CHECK(kind IN ('deposit','disbursement')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 balance_after_cents INTEGER NOT NULL CHECK(balance_after_cents >= 0),
 company_id INTEGER UNIQUE REFERENCES mock_companies(id),
 request_key TEXT UNIQUE,
 certificate TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((kind='deposit' AND company_id IS NULL AND certificate IS NULL AND request_key IS NOT NULL) OR
 (kind='disbursement' AND company_id IS NOT NULL AND certificate IS NOT NULL AND request_key IS NULL))
);
CREATE INDEX mock_vault_transactions_pool ON mock_vault_transactions(pool,created_at DESC);
CREATE TRIGGER mock_approval_immutable BEFORE UPDATE ON mock_companies WHEN OLD.status='approved'
 BEGIN SELECT RAISE(ABORT,'Approved applications are immutable'); END;
