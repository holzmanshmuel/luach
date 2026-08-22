-- V6: one-off family gatherings (Shabbat, yom-tov, simchas) — distinct from the
-- recurring birthday/anniversary/yahrzeit events, which are keyed to a Hebrew date.
-- A gathering is a single calendar item with a specific Gregorian date and an
-- optional time, place and description.
CREATE TABLE IF NOT EXISTS family_calendar.gatherings (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  gather_date  DATE NOT NULL,
  gather_time  TIME,          -- optional, NULL = all-day
  location     TEXT,          -- optional
  description  TEXT,          -- optional
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gatherings_date ON family_calendar.gatherings(gather_date);
