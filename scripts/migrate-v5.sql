-- Maiden name (birth surname), optional, per language. Helps relatives see which
-- side of the family someone married in from. Stored as a short surname only.
ALTER TABLE family_calendar.family_members
  ADD COLUMN IF NOT EXISTS maiden_name text,
  ADD COLUMN IF NOT EXISTS maiden_name_he text;
