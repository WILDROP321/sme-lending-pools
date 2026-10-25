-- Explicitly authorized historical mock funding only; never run on app startup.
-- Uses the same atomic approval path as new requests. Approved records are skipped,
-- so rerunning cannot double-charge a company. Any failure rolls back the batch.
BEGIN;
DO $$
DECLARE c record;
BEGIN
 FOR c IN
  SELECT id FROM public.mock_companies
  WHERE pool IN ('Safe','Medium','Risky') AND status='pending'
  ORDER BY id
 LOOP
  PERFORM public.mock_approve(c.id);
 END LOOP;
END $$;
COMMIT;
