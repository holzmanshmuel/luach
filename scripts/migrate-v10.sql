-- scripts/migrate-v10.sql — thread family_id through all data tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['family_members','events','relationships','access_tokens','gatherings','branch_spellings']
  LOOP
    EXECUTE format('ALTER TABLE family_calendar.%I ADD COLUMN IF NOT EXISTS family_id INTEGER', t);
    EXECUTE format('UPDATE family_calendar.%I SET family_id = 1 WHERE family_id IS NULL', t);
    EXECUTE format($f$ALTER TABLE family_calendar.%I
      ALTER COLUMN family_id SET DEFAULT nullif(current_setting('app.current_family', true), '')::int$f$, t);
    EXECUTE format('ALTER TABLE family_calendar.%I ALTER COLUMN family_id SET NOT NULL', t);
    BEGIN
      EXECUTE format($f$ALTER TABLE family_calendar.%I
        ADD CONSTRAINT %I FOREIGN KEY (family_id)
        REFERENCES family_calendar.families(id) ON DELETE CASCADE$f$, t, t || '_family_fk');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON family_calendar.%I(family_id)', 'idx_' || t || '_family', t);
  END LOOP;
END $$;

-- RLS: every data table is scoped to the current tenant GUC.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['family_members','events','relationships','access_tokens','gatherings','branch_spellings']
  LOOP
    EXECUTE format('ALTER TABLE family_calendar.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE family_calendar.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON family_calendar.%I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON family_calendar.%I
      USING (family_id = nullif(current_setting('app.current_family', true), '')::int)
      WITH CHECK (family_id = nullif(current_setting('app.current_family', true), '')::int)$p$, t);
  END LOOP;
END $$;
