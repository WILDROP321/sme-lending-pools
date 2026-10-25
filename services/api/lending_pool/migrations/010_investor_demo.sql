ALTER TABLE mock_vaults ADD COLUMN demo_state TEXT;
ALTER TABLE mock_vaults ADD COLUMN demo_revision INTEGER NOT NULL DEFAULT 0;
