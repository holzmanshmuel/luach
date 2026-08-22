-- V3 Migration: nickname, photos, access tokens, phone/nudge fields
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- This migration also re-applies the v2 event_type constraint expansion
-- as a safety net for any environment that skipped v2.

-- 1. Nickname (already used by app code; schema was missing the column)
ALTER TABLE family_calendar.family_members
  ADD COLUMN IF NOT EXISTS nickname TEXT;

-- 2. Photo fields (Phase D — avatars)
ALTER TABLE family_calendar.family_members
  ADD COLUMN IF NOT EXISTS photo_url         TEXT,
  ADD COLUMN IF NOT EXISTS photo_uploaded_at TIMESTAMPTZ;

-- 3. Phone + opt-out for WhatsApp nudges (Phase I)
ALTER TABLE family_calendar.family_members
  ADD COLUMN IF NOT EXISTS phone_e164             TEXT,
  ADD COLUMN IF NOT EXISTS notifications_enabled  BOOLEAN NOT NULL DEFAULT TRUE;

-- 4. Access tokens (Phase H — magic links, replaces shared password for viewers)
CREATE TABLE IF NOT EXISTS family_calendar.access_tokens (
  id            SERIAL PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('shared', 'personal')),
  person_id     INTEGER REFERENCES family_calendar.family_members(id) ON DELETE CASCADE,
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  CHECK (
    (kind = 'shared'   AND person_id IS NULL) OR
    (kind = 'personal' AND person_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_access_tokens_hash    ON family_calendar.access_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_access_tokens_kind    ON family_calendar.access_tokens(kind);
CREATE INDEX IF NOT EXISTS idx_access_tokens_person  ON family_calendar.access_tokens(person_id);

-- 5. Safety re-run of the v2 event_type constraint expansion
-- (original seed.sql restricts to birthday|anniversary; v2 expanded to yahrtzeit|other).
ALTER TABLE family_calendar.events
  DROP CONSTRAINT IF EXISTS events_event_type_check;

ALTER TABLE family_calendar.events
  ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('birthday', 'anniversary', 'yahrtzeit', 'other'));

-- 6. Safety re-run of v2 events extensions (year + label for 'other')
ALTER TABLE family_calendar.events
  ADD COLUMN IF NOT EXISTS gregorian_year    INTEGER,
  ADD COLUMN IF NOT EXISTS event_type_label  TEXT;
