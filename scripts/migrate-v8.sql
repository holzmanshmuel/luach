-- V8: editable alternate spellings for each family branch surname. The family
-- bickers (lovingly) over how to spell the family names — this lets anyone add
-- the spellings they use, so every variant is acknowledged. The canonical
-- spelling stays the family_branch enum value; these are the "also spelled" ones.
CREATE TABLE IF NOT EXISTS family_calendar.branch_spellings (
  id          SERIAL PRIMARY KEY,
  branch      TEXT NOT NULL,
  spelling    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch, spelling)
);

CREATE INDEX IF NOT EXISTS idx_branch_spellings_branch
  ON family_calendar.branch_spellings(branch);
