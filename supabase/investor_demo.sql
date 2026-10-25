-- Extend existing protected vault rows; no new grants, functions or policies.
ALTER TABLE public.mock_vaults ADD COLUMN IF NOT EXISTS demo_state jsonb;
ALTER TABLE public.mock_vaults ADD COLUMN IF NOT EXISTS demo_revision integer NOT NULL DEFAULT 0;
