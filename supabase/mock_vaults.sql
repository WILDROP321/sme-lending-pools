-- Apply once after schema.sql. Balances and receipts are fictional, never XRPL state.
ALTER TABLE public.mock_companies ADD COLUMN status text NOT NULL DEFAULT 'pending'
 CHECK (status IN ('pending', 'approved', 'declined'));
UPDATE public.mock_companies SET status = 'declined' WHERE risk_factor < 20;
CREATE TABLE public.mock_vaults (
 pool text PRIMARY KEY CHECK (pool IN ('Safe','Medium','Risky')),
 opening_balance_cents bigint NOT NULL CHECK (opening_balance_cents >= 0),
 balance_cents bigint NOT NULL CHECK (balance_cents >= 0)
);
INSERT INTO public.mock_vaults(pool, opening_balance_cents, balance_cents)
 SELECT p.pool, coalesce(sum(c.decided_disbursement_cents),0)*2, coalesce(sum(c.decided_disbursement_cents),0)*2
 FROM (VALUES ('Safe'),('Medium'),('Risky')) AS p(pool)
 LEFT JOIN public.mock_companies c ON c.pool=p.pool GROUP BY p.pool;
CREATE TABLE public.mock_vault_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pool text NOT NULL REFERENCES public.mock_vaults(pool),
 kind text NOT NULL CHECK (kind IN ('deposit','disbursement')),
 amount_cents bigint NOT NULL CHECK (amount_cents > 0),
 balance_after_cents bigint NOT NULL CHECK (balance_after_cents >= 0),
 company_id bigint UNIQUE REFERENCES public.mock_companies(id),
 request_key uuid UNIQUE,
 certificate jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind='deposit' AND company_id IS NULL AND certificate IS NULL AND request_key IS NOT NULL)
 OR (kind='disbursement' AND company_id IS NOT NULL AND certificate IS NOT NULL AND request_key IS NULL))
);
CREATE INDEX mock_vault_transactions_pool ON public.mock_vault_transactions(pool, created_at DESC);
ALTER TABLE public.mock_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_vault_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_vaults, public.mock_vault_transactions FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.mock_vaults TO anon;
GRANT SELECT, INSERT ON public.mock_vault_transactions TO anon;
GRANT ALL ON public.mock_vaults, public.mock_vault_transactions TO service_role;
CREATE POLICY flow_vaults_read ON public.mock_vaults FOR SELECT TO anon USING (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-flow-api-key',''),'UTF8')),'hex')='FLOW_API_KEY_SHA256');
CREATE POLICY flow_vaults_update ON public.mock_vaults FOR UPDATE TO anon USING (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-flow-api-key',''),'UTF8')),'hex')='FLOW_API_KEY_SHA256') WITH CHECK (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-flow-api-key',''),'UTF8')),'hex')='FLOW_API_KEY_SHA256');
CREATE POLICY flow_vault_transactions_read ON public.mock_vault_transactions FOR SELECT TO anon USING (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-flow-api-key',''),'UTF8')),'hex')='FLOW_API_KEY_SHA256');
CREATE POLICY flow_vault_transactions_insert ON public.mock_vault_transactions FOR INSERT TO anon WITH CHECK (encode(sha256(convert_to(coalesce(current_setting('request.headers',true)::jsonb->>'x-flow-api-key',''),'UTF8')),'hex')='FLOW_API_KEY_SHA256');
CREATE FUNCTION public.mock_deposit(p_pool text,p_amount bigint,p_request_key uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v public.mock_vaults; t public.mock_vault_transactions;
BEGIN
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>10000000000 OR p_request_key IS NULL THEN RAISE EXCEPTION 'Invalid deposit'; END IF;
 SELECT * INTO v FROM public.mock_vaults WHERE pool=p_pool FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pool not found'; END IF;
 SELECT * INTO t FROM public.mock_vault_transactions WHERE request_key=p_request_key;
 IF FOUND THEN
  IF t.pool<>p_pool OR t.amount_cents<>p_amount THEN RAISE EXCEPTION 'Deposit reference already used'; END IF;
  RETURN to_jsonb(t);
 END IF;
 UPDATE public.mock_vaults SET balance_cents=balance_cents+p_amount WHERE pool=p_pool RETURNING * INTO v;
 INSERT INTO public.mock_vault_transactions(pool,kind,amount_cents,balance_after_cents,request_key)
 VALUES(p_pool,'deposit',p_amount,v.balance_cents,p_request_key) RETURNING * INTO t;
 RETURN to_jsonb(t);
END; $$;
CREATE FUNCTION public.mock_approve(p_company_id bigint) RETURNS jsonb
 LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.mock_companies; v public.mock_vaults; t public.mock_vault_transactions;
BEGIN
 SELECT * INTO c FROM public.mock_companies WHERE id=p_company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company not found'; END IF;
 SELECT * INTO t FROM public.mock_vault_transactions WHERE company_id=c.id;
 IF FOUND THEN RETURN to_jsonb(t); END IF;
 IF c.status<>'pending' OR c.pool='Decline' OR c.decided_disbursement_cents<=0 THEN RAISE EXCEPTION 'Company is not eligible for approval'; END IF;
 IF c.invoice_due <= (now() AT TIME ZONE 'America/New_York')::date THEN RAISE EXCEPTION 'Invoice is past due'; END IF;
 SELECT * INTO v FROM public.mock_vaults WHERE pool=c.pool FOR UPDATE;
 IF NOT FOUND OR v.balance_cents<c.decided_disbursement_cents THEN RAISE EXCEPTION 'Insufficient mock vault assets'; END IF;
 UPDATE public.mock_vaults SET balance_cents=balance_cents-c.decided_disbursement_cents WHERE pool=c.pool RETURNING * INTO v;
 INSERT INTO public.mock_vault_transactions(pool,kind,amount_cents,balance_after_cents,company_id,certificate)
 VALUES(c.pool,'disbursement',c.decided_disbursement_cents,v.balance_cents,c.id,
 jsonb_build_object('company_name',c.company_name,'debtor',c.debtor,'from_date',c.from_date,
 'invoice_due',c.invoice_due,'requested_cents',c.money_requested_cents,'repayment_cents',c.money_requested_cents,
 'disbursed_cents',c.decided_disbursement_cents,'risk_factor',c.risk_factor,'pool',c.pool,'currency','MOCKRLUSD','mode','mock')) RETURNING * INTO t;
 UPDATE public.mock_companies SET status='approved' WHERE id=c.id;
 RETURN to_jsonb(t);
END; $$;
CREATE FUNCTION public.protect_mock_approval() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved applications are immutable'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER mock_approval_immutable BEFORE UPDATE ON public.mock_companies FOR EACH ROW EXECUTE FUNCTION public.protect_mock_approval();
REVOKE ALL ON FUNCTION public.mock_deposit(text,bigint,uuid), public.mock_approve(bigint), public.protect_mock_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_deposit(text,bigint,uuid), public.mock_approve(bigint) TO anon;
