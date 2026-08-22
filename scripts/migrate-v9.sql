-- scripts/migrate-v9.sql — tenancy tables (families, users, memberships)
CREATE TABLE IF NOT EXISTS family_calendar.families (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  name_he    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create a default family as id = 1. This exists so that migrate-v10, which
-- backfills `family_id = 1` on every pre-tenancy row and then adds the NOT NULL
-- + foreign key, has a family to point those rows at. On a brand-new install the
-- data tables are empty, so this row is simply the first family — rename it in
-- the app, or ignore it and create your own family through onboarding.
INSERT INTO family_calendar.families (id, name, name_he)
VALUES (1, 'My Family', NULL)
ON CONFLICT (id) DO NOTHING;
-- keep the SERIAL sequence ahead of the manual id=1 insert
SELECT setval(pg_get_serial_sequence('family_calendar.families','id'),
              GREATEST((SELECT MAX(id) FROM family_calendar.families), 1));

CREATE TABLE IF NOT EXISTS family_calendar.users (
  id           SERIAL PRIMARY KEY,
  google_sub   TEXT UNIQUE NOT NULL,   -- Google's stable subject id
  email        TEXT NOT NULL,
  display_name TEXT,
  photo_url    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_calendar.memberships (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL REFERENCES family_calendar.users(id) ON DELETE CASCADE,
  family_id        INTEGER NOT NULL REFERENCES family_calendar.families(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','editor','viewer')),
  member_person_id INTEGER,  -- optional link to this family's family_members row
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, family_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON family_calendar.memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_family ON family_calendar.memberships(family_id);
