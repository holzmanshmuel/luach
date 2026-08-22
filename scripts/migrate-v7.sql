-- V7: give gatherings a "kind" so the calendar can show a tailored glyph per
-- simcha (wedding, bar/bat mitzvah, brit, engagement, sheva brachot, other).
-- Existing rows default to 'other' so nothing breaks.
ALTER TABLE family_calendar.gatherings
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'other';
