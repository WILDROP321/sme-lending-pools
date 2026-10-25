-- One-time opening-capital change. Preserve deposits, disbursements and receipts.
UPDATE public.mock_vaults SET balance_cents=balance_cents+100000000-opening_balance_cents,
 opening_balance_cents=100000000;
ALTER TABLE public.mock_vaults ADD COLUMN annual_rate_bps integer NOT NULL DEFAULT 500 CHECK(annual_rate_bps BETWEEN 0 AND 10000);
UPDATE public.mock_vaults SET annual_rate_bps=CASE pool WHEN 'Risky' THEN 2000 WHEN 'Medium' THEN 1000 ELSE 500 END;
