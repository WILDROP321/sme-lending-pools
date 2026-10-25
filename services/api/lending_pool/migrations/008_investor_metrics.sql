-- Rebase the mock opening capital, preserving every deposit and funding record.
UPDATE mock_vaults SET balance_cents=balance_cents+100000000-opening_balance_cents, opening_balance_cents=100000000;
ALTER TABLE mock_vaults ADD COLUMN annual_rate_bps INTEGER NOT NULL DEFAULT 500 CHECK(annual_rate_bps BETWEEN 0 AND 10000);
UPDATE mock_vaults SET annual_rate_bps=CASE pool WHEN 'Risky' THEN 2000 WHEN 'Medium' THEN 1000 ELSE 500 END;
