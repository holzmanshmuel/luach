-- V2 Migration: relationships, extended event types, year field
-- Run this once against Railway Postgres

-- 1. Relationships table
CREATE TABLE IF NOT EXISTS family_calendar.relationships (
  id          SERIAL PRIMARY KEY,
  person_id   INTEGER NOT NULL REFERENCES family_calendar.family_members(id) ON DELETE CASCADE,
  related_to  INTEGER NOT NULL REFERENCES family_calendar.family_members(id) ON DELETE CASCADE,
  relation    TEXT NOT NULL CHECK (relation IN ('parent', 'spouse')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(person_id, related_to, relation)
);

CREATE INDEX IF NOT EXISTS idx_relationships_person ON family_calendar.relationships(person_id);
CREATE INDEX IF NOT EXISTS idx_relationships_related ON family_calendar.relationships(related_to);

-- 2. Extend events: year field and label for 'other' type
ALTER TABLE family_calendar.events
  ADD COLUMN IF NOT EXISTS gregorian_year INTEGER,
  ADD COLUMN IF NOT EXISTS event_type_label TEXT;

-- 3. Expand the event_type check constraint
ALTER TABLE family_calendar.events
  DROP CONSTRAINT IF EXISTS events_event_type_check;

ALTER TABLE family_calendar.events
  ADD CONSTRAINT events_event_type_check
  CHECK (event_type IN ('birthday', 'anniversary', 'yahrtzeit', 'other'));
