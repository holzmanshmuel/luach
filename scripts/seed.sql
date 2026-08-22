-- Family Calendar Database Schema
-- Run this against your Railway Postgres instance to set up the schema.
-- Uses a separate schema to isolate from any other apps (e.g., n8n) on the same DB.

CREATE SCHEMA IF NOT EXISTS family_calendar;

CREATE TABLE IF NOT EXISTS family_calendar.family_members (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  family_branch TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_calendar.events (
  id                    SERIAL PRIMARY KEY,
  family_member_id      INTEGER NOT NULL REFERENCES family_calendar.family_members(id) ON DELETE CASCADE,
  event_type            TEXT NOT NULL CHECK (event_type IN ('birthday', 'anniversary')),
  hebrew_day            INTEGER NOT NULL CHECK (hebrew_day BETWEEN 1 AND 30),
  hebrew_month          TEXT NOT NULL,
  hebrew_year           INTEGER,
  original_english_date DATE,
  note                  TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(family_member_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_events_hebrew_month ON family_calendar.events(hebrew_month);
CREATE INDEX IF NOT EXISTS idx_events_type ON family_calendar.events(event_type);
CREATE INDEX IF NOT EXISTS idx_family_members_branch ON family_calendar.family_members(family_branch);
