-- Automatically fund eligible pending requests within the insert/update transaction.
CREATE FUNCTION public.auto_fund_mock_request() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='pending' AND NEW.pool<>'Decline' AND NEW.decided_disbursement_cents>0 THEN
  BEGIN
   PERFORM public.mock_approve(NEW.id);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT IN ('Insufficient mock vault assets','Invoice is past due') THEN RAISE; END IF;
  END;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.auto_fund_mock_request() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER auto_fund_mock_request AFTER INSERT OR UPDATE ON public.mock_companies
 FOR EACH ROW WHEN (NEW.status='pending') EXECUTE FUNCTION public.auto_fund_mock_request();
