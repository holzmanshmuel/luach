ALTER TABLE family_calendar.family_members
  ADD COLUMN IF NOT EXISTS name_he text,
  ADD COLUMN IF NOT EXISTS name_he_status text;  -- 'suggested' | 'confirmed' | NULL
