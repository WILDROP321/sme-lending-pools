-- Version 2 demo terms. Preserve every previously approved certificate and balance.
BEGIN;
DROP TRIGGER IF EXISTS auto_fund_mock_request ON public.mock_companies;
UPDATE public.mock_companies SET decided_disbursement_cents=CASE WHEN risk_factor<20 THEN 0 ELSE money_requested_cents-round(money_requested_cents*0.05)::bigint END WHERE status<>'approved';
CREATE OR REPLACE FUNCTION public.mock_approve(p_company_id bigint) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.mock_companies; v public.mock_vaults; t public.mock_vault_transactions;
 principal bigint; fee bigint; interest bigint; invested bigint; capital bigint;
BEGIN
 SELECT * INTO c FROM public.mock_companies WHERE id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;
 SELECT * INTO t FROM public.mock_vault_transactions WHERE company_id=c.id;
 IF FOUND THEN RETURN to_jsonb(t); END IF;
 IF c.status<>'pending' OR c.pool='Decline' THEN RAISE EXCEPTION 'Company is not eligible for approval'; END IF;
 IF c.invoice_due <= (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'Invoice is past due'; END IF;
 principal := c.money_requested_cents; fee := round(principal*0.05); interest := round(principal*0.08);
 SELECT * INTO v FROM public.mock_vaults WHERE pool=c.pool FOR UPDATE;
 IF NOT FOUND OR v.balance_cents<principal THEN RAISE EXCEPTION 'Insufficient mock vault assets'; END IF;
 SELECT coalesce(sum(amount_cents),0) INTO invested FROM public.mock_vault_transactions WHERE pool=c.pool AND kind='deposit';
 capital := v.opening_balance_cents+invested;
 UPDATE public.mock_vaults SET balance_cents=balance_cents-principal WHERE pool=c.pool RETURNING * INTO v;
 INSERT INTO public.mock_vault_transactions(pool,kind,amount_cents,balance_after_cents,company_id,certificate)
 VALUES(c.pool,'disbursement',principal,v.balance_cents,c.id,
 jsonb_build_object('terms_version',2,'company_name',c.company_name,'debtor',c.debtor,'from_date',c.from_date,
 'invoice_due',c.invoice_due,'maturity_date',c.invoice_due+1,'requested_cents',principal,'principal_cents',principal,
 'repayment_cents',principal+interest,'disbursed_cents',principal-fee,'fee_cents',fee,'fee_rate_bps',500,
 'interest_cents',interest,'interest_rate_bps',800,'risk_factor',c.risk_factor,'pool',c.pool,
 'verification','Business and background check passed (demo assumption)',
 'investor_principal_cents',CASE WHEN capital>0 THEN floor(principal::numeric*invested/capital)::bigint ELSE 0 END,
 'investor_interest_cents',CASE WHEN capital>0 THEN floor(interest::numeric*invested/capital)::bigint ELSE 0 END,
 'currency','MOCKRLUSD','mode','mock')) RETURNING * INTO t;
 UPDATE public.mock_companies SET status='approved',decided_disbursement_cents=principal-fee WHERE id=c.id;
 RETURN to_jsonb(t);
END; $$;
-- Seed the user-requested scenario once, using existing accounting operations.
SELECT public.mock_deposit('Medium',10000000,'a0000000-0000-4000-8000-000000000001'::uuid);
INSERT INTO public.mock_companies(company_name,risk_factor,status,decided_disbursement_cents,money_requested_cents,debtor,from_date,invoice_due,source)
 SELECT 'Amy''s Cookies',62,'pending',6650000,7000000,'Walmart','2026-10-25','2026-11-19','application'
 WHERE NOT EXISTS (SELECT 1 FROM public.mock_companies WHERE company_name='Amy''s Cookies');
COMMIT;
