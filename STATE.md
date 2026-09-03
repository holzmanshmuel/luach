# Luach — STATE

**Read `README.md` first** (setup, env vars, migration chain). This file = operational truth,
newest on top. Current-state only — git history is the history.

## What this is

A Hebrew–English family calendar. It tracks birthdays, anniversaries and yahrzeits on **both** the
Hebrew and Gregorian date, and adds a family tree, a timeline, a subscribable iCal feed, and
optional WhatsApp digests/reminders driven by n8n. Multi-family: each family's rows are isolated by
Postgres row-level security in schema `family_calendar`, with a combined view for people who belong
to two families.

Next.js 16 + React 19, PostgreSQL 13+, `@hebcal/core` for the Hebrew-calendar math, d3 for the
tree, Google OAuth + invite links for sign-in (no passwords). Hosted free at
**family-calendar.holzman-ai.com** (Railway); self-hostable.

> Not to be confused with `~/family-calendar`, the older repo this one succeeded. That repo's
> GitHub remote is archived and every branch's substance now lives here — see the 2026-09-03 entry.

## Standing rules

- **Never point `DATABASE_URL` at the owner/superuser role.** RLS is then silently skipped and
  family isolation stops being enforced. CI asserts `rolsuper` and `rolbypassrls` are both false.
- **`FAMILY_BRANCHES` is ordered and load-bearing** — branch colours are assigned by list position.
  Append, never insert or reorder.
- Migrations (`scripts/seed.sql`, then `migrate-v2.sql` … `migrate-v13.sql`) are applied **in order**
  by `scripts/migrate.ts` as schema owner, and are idempotent — safe to re-run after a `git pull`.
- n8n is a dumb pipe. Luach is the source of truth; n8n only fans messages out.

## Where it stands

- `main`, clean, level with `origin/main`. Last commit `2121483` (2026-08-30) — HOLZMAN-152, the
  sign-in path for returning members on `/welcome`.
- Four local branches still exist but are **all already merged into main** — stale refs, no
  unmerged work: `chore/parse-hebrew-date-0.2.0`, `holzmanshmuel/holzman-152-welcome-signin-affordance`,
  `holzmanshmuel/holzman-63-ical-feed-i18n`, `tools/parser-drift-audit`.
- Tests: vitest, 27 test files / 219 tests, 9 of which hit a real Postgres. CI
  (`.github/workflows/ci.yml`) runs on push to main + PRs against a throwaway `postgres:16` service
  container and uses **no GitHub secrets** on purpose, so a fork's CI runs unmodified: migrate →
  create+grant restricted role → assert not superuser/bypassrls → lint → build → `tsc --noEmit` →
  `vitest run`.
- Scheduled work is external: an n8n cron (`0 8 * * *`, see `SETUP-WHATSAPP.md`) calls the
  `N8N_TOKEN`-gated routes `/api/events/today`, `/api/digest/week`, `/api/reminders/yahrzeit`.

## Log

### 2026-09-03 — test-file serialization; family-calendar triaged and retired

- **`vitest.config.ts` now sets `fileParallelism: false`.** The 9 DB-backed test files clean up by
  hand (`DELETE`) rather than inside a rolled-back transaction — `db.ts`'s `query()` opens its own
  `BEGIN`/`COMMIT` per call, so there is no per-file wrapping transaction. Run in parallel against
  one database they race on shared fixture rows. This is the exact failure shape HOLZMAN-89
  recorded in the sibling `family-calendar` repo (8/172 then 7/172 failures, different tests each
  run) and nothing here prevented it — not the config, not CI. Sibling `torim` has had
  `fileParallelism: false` for the same reason; this brings luach in line.
- **`~/family-calendar` triaged against this repo.** All 13 of its local refs were checked: every
  one is either already ported here, or deliberately superseded (its Claude-mention CI workflows
  were replaced by this repo's secretless `ci.yml`). **Zero still-unique work.** Its branches are
  preserved at `~/Archive/2026-09-sprint/family-calendar-branches.bundle` (`git bundle verify` →
  complete history) because its GitHub remote is archived and cannot be pushed to.
- STATE.md added (this file) — the repo had none.
