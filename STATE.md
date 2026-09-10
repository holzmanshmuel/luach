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
- **The branch list is PER-FAMILY, and it is ordered and load-bearing** — branch colours are
  assigned by list position. Each family owns `families.branches`, edited at `/admin/branches`;
  `FAMILY_BRANCHES` is only the fallback for families that have never set one. Append, never
  insert or reorder. Resolution: family's own list → `FAMILY_BRANCHES` → `DEFAULT_FAMILY_BRANCHES`.
- Migrations (`scripts/seed.sql`, then `migrate-v2.sql` … `migrate-v14.sql`) are applied **in order**
  by `scripts/migrate.ts` as schema owner, and are idempotent — safe to re-run after a `git pull`.
  `migrate.ts` globs `migrate-v*.sql`, so a new migration needs no registration.
- n8n is a dumb pipe. Luach is the source of truth; n8n only fans messages out.

## Where it stands

- `main`, clean, level with `origin/main`. Last commit `2121483` (2026-08-30) — HOLZMAN-152, the
  sign-in path for returning members on `/welcome`.
- Four local branches still exist but are **all already merged into main** — stale refs, no
  unmerged work: `chore/parse-hebrew-date-0.2.0`, `holzmanshmuel/holzman-152-welcome-signin-affordance`,
  `holzmanshmuel/holzman-63-ical-feed-i18n`, `tools/parser-drift-audit`.
- Tests: vitest, 29 test files / 318 tests, 10 of which hit a real Postgres. CI
  (`.github/workflows/ci.yml`) runs on push to main + PRs against a throwaway `postgres:16` service
  container and uses **no GitHub secrets** on purpose, so a fork's CI runs unmodified: migrate →
  create+grant restricted role → assert not superuser/bypassrls → lint → build → `tsc --noEmit` →
  `vitest run`.
- Scheduled work is external: an n8n cron (`0 8 * * *`, see `SETUP-WHATSAPP.md`) calls the
  `N8N_TOKEN`-gated routes `/api/events/today`, `/api/digest/week`, `/api/reminders/yahrzeit`.

## Log

### 2026-09-10 — branch lists are per-family (multi-tenancy fix)

- **`FAMILY_BRANCHES` was a deployment-wide env var in a multi-tenant app** — a genuine tenancy
  defect, not a rough edge: the second unrelated family to create a calendar was shown the FIRST
  family's surnames as their branch chips, with no way to change them. It blocked the app being
  usable by anyone but the operator's own family.
- **`migrate-v14.sql` adds `families.branches TEXT[]`** — ordered by construction (order is colour),
  rewritten whole, with a shape CHECK for the invariants an app-side validator cannot guarantee
  against psql. **Deliberately left NULL on every existing row: no backfill.** NULL means "has not
  chosen", so the production family and every self-hoster keep working on their env var with zero
  data migration, and only a family that actively saves its own list diverges. A backfill would have
  frozen today's env value into every row.
- `families` has **no RLS** (it is the tenant list, and must be readable before any tenant context
  exists), so this column's isolation is the WRITE PATH: `setFamilyBranches()` goes through the
  tenant-scoped `query()` and selects its row with
  `WHERE id = nullif(current_setting('app.current_family', true), '')::int` — the row is chosen by
  the request's tenant GUC, never by a caller-supplied id, and `query()` throws with no tenant.
  `requireAdmin()` re-verifies live owner membership on top. Proven both directions in
  `src/lib/branches-server.test.ts`.
- `familyBranches()` is now **async and tenant-aware** (defaults to the active family, accepts an
  explicit id for machine callers). Every call site updated: root layout, `/timeline`, `spellings.ts`,
  `addBranchSpellingAction`, and `scripts/import-sheet.ts` — which resolves the list of the family
  its `--family=<id>` names. `src/lib/branches.ts` stays PURE (client-importable); the resolution
  chain lives there as `resolveBranches()`.
- **`BRANCH_STYLES` grew from 4 to 8 tints.** A 5th named branch used to wrap back to slot 0 and wear
  the first branch's colour. The original four are frozen byte-for-byte (a test pins them) — colour
  is positional and existing families already recognise those tints. The new hues are measured for
  WCAG AA against their own chip and against both paper surfaces.
- **`/admin/branches`** (owner-only, English, no `translations.ts` keys): add, rename in place,
  remove, choose the catch-all — with the cost shown BEFORE saving, and silence on the safe edit
  (appending). The "what would this cost" reasoning is pure, in `src/lib/branch-draft.ts`.
- `scripts/seed-example-family.ts` now stores the demo family's own branch list, so the demo is
  colour-coded regardless of what `FAMILY_BRANCHES` is set to.

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
