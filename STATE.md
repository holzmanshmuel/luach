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
- Tests: vitest, 34 test files / 405 tests, 10 of which hit a real Postgres. CI
  (`.github/workflows/ci.yml`) runs on push to main + PRs against a throwaway `postgres:16` service
  container and uses **no GitHub secrets** on purpose, so a fork's CI runs unmodified: migrate →
  create+grant restricted role → assert not superuser/bypassrls → lint → build → `tsc --noEmit` →
  `vitest run`.
- Scheduled work is external: an n8n cron (`0 8 * * *`, see `SETUP-WHATSAPP.md`) calls the
  `N8N_TOKEN`-gated routes `/api/events/today`, `/api/digest/week`, `/api/reminders/yahrzeit`.

## Log

### 2026-09-10 — one morning digest replaces two crons (`/api/digest/daily`)

- **`GET /api/digest/daily?family=<id>`** returns a ready-to-send WhatsApp body plus
  recipients, assembled from up to three blocks (empty ones omitted; all empty ⇒
  `has_content: false` and the workflow sends nothing):
  **Today** · **Tonight begins** · **Later in the week** (Sundays only, tomorrow→Saturday,
  de-duplicated against the first two).
- ⚠ **"Tonight begins" is not optional.** A yahrzeit and its candle start at sundown, so a
  naive "today's events" digest would tell people the morning AFTER the candle should have
  been lit. That block carries the retired yahrzeit reminder's eve-before (`lead=1`)
  semantics; deleting it is a regression, not a simplification.
- **Multi-tenancy leak closed.** The three legacy feeds add the deployment-wide
  `DIGEST_RECIPIENTS` env list to EVERY family's recipients — correct with one family,
  wrong the moment a second exists, since the operator then receives another family's
  private dates. The new route reads only per-family members with a phone +
  `notifications_enabled`, and never reads that env var. `DIGEST_RECIPIENTS` is now
  documented as legacy.
- ⚠ **Nobody in the reference deployment has a phone number stored** (all members have
  `notifications_enabled` defaulted true, zero have `phone_e164`), so today the only
  recipient is the env var. **Verify `recipients` is non-empty before retiring the old
  schedules**, or the new job sends to nobody.
- New libs, all pure and unit-tested: `zoned-day.ts` (civil-day reckoning in the
  deployment `TZ`), `digest.ts` (icons, phrasing, occurrence windowing, dedup,
  recipients), `digest-daily.ts` (the assembler). `digest/week` and `reminders/yahrzeit`
  were refactored onto the shared helpers with byte-identical output;
  `api/events/today` was left alone.
- 🪤 **No `toISOString()` anywhere in this path.** Civil dates ride on local-**noon**
  carriers and compare as `YYYY-MM-DD` strings, so neither DST nor a midnight boundary can
  shift a day. The new files were run under four host zones (UTC, Los Angeles, Auckland,
  Kolkata) with identical results, so CI's zone cannot matter.
- Suite after merge: **32 files / 349 tests, 0 skipped.** The one to watch on any future
  change here is `src/app/api/broadcast-site-url.test.ts` — it asserts message CONTENT for
  both refactored legacy routes, and it is DB-backed.

### 2026-09-10 — owner lock-out on re-redeeming your own invite (live bug)

- **An owner who clicked their own invite link lost their admin pages.**
  `redeem_invite()` (migrate-v11) returns the role baked into the TOKEN, and its
  `INSERT … ON CONFLICT DO NOTHING` means an existing member keeps their stored role —
  so the database stayed correct while the function handed back `viewer`. `join/[token]`
  writes that straight into the session cookie, `proxy.ts` gates `/admin/*` on
  `session.role !== 'owner'`, and `Header` hides 🔑 Access on the same value. Below two
  memberships the family switcher does not render, so a single-family owner's only way
  out was signing out and back in. Owners *do* click their own invite links to check them.
- Fixed in `redeemInvite()` (TS, no migration): re-read the membership and return the role
  the user ACTUALLY holds. **The token decides what a NEW member gets; it must never decide
  what an existing one keeps.**
- 🪤 **The test for this already existed and passed.** `tokens.test.ts` → "does NOT
  downgrade/overwrite an existing membership role on re-redeem" asserted the *database
  row* was still `owner` and never asserted the *returned* role — the value that actually
  reaches the session and decides what the user can do. Its comment even claimed "role
  stays owner". Verified the strengthened assertion fails on the old code before fixing.
  **When a function's output drives authorization, assert the output, not just the row.**

### 2026-09-10 — date-consistency audit (`/admin/dates`)

- **Found a whole class of silent wrong dates, and shipped the check for it.** An event
  carries two independently-stored dates — the recurring Hebrew `hebrew_day`/`hebrew_month`
  and `original_english_date` — and the calendar renders BOTH. Nothing ever checked that
  they describe the same day. Rows entered through the app agree by construction (the form
  derives the Hebrew date from the English one), but an IMPORTED row has two hand-typed
  spreadsheet columns and a typo in either survives forever: the Hebrew birthday shows on
  the right day, the English one on the wrong day, and nobody notices for years.
- **The shape that surfaced it:** a spreadsheet cell holding a two-digit day lost its
  leading digit, so "the 17th" was typed as "the 7th". Both halves of the row parsed
  cleanly, the Hebrew date stayed correct, and the English birthday sat ten days early
  until somebody was wished a happy birthday on the wrong day. Note that the HOLZMAN-115
  audit (8/23) *re-blessed* that row: it verified prod against the sheet and the sheet
  against nothing, so a self-consistent typo passed. **An audit that trusts one source
  cannot find an error inside that source** — cross-convert instead.
- `src/lib/date-consistency.ts` — pure, no clock/DB/locale. Projects the stored Hebrew date
  with the app's OWN recurrence rule (`hebrewToGregorianAll`, what the grid uses) into the
  civil year of the stored English date and measures the gap in days, so the audit agrees
  with what a viewer sees by definition and never has to compare Adar month NAMES.
  Probes the target's civil year ±1 so a late-December Hebrew date does not report a false
  ~350-day gap. 16 tests, including the real regression case.
- ⚠ **A one-day gap is not an error** — the Hebrew day begins at nightfall, so an evening
  birth legitimately carries the next day's Hebrew date. `NIGHTFALL_TOLERANCE_DAYS = 1`;
  only ≥2 days is a finding. Getting this wrong would flag a large share of any family.
- `/admin/dates` (owner-only, header 🩺) reports the contradictions and offers the two
  readings — "the Hebrew date is right" / "the English date is right" — one click each.
  **The client posts only an event id**; `actions.ts` re-runs the audit server-side and
  applies its own computed value, so a stale page or doctored form cannot write a date.
- 🪤 **`original_english_date` is selected as `::text`.** The pg driver hands a DATE back as
  a JS Date at local midnight; formatting that back to a day is precisely how this database
  once acquired 38 birthdays one day early. Same trap bit the investigation itself — a
  first pass at the Hebrew arithmetic used `toISOString()` and was off by one, which is why
  `date-consistency.ts` builds every `YYYY-MM-DD` from local getters.
- ⚠ **Adar is a decision, not a defect.** A leap year has two Adars and which one an
  occasion recurs in is custom, not arithmetic — this app recurs a generic `Adar` in Adar
  II. So a row born 1 Adar I and stored as plain `Adar` reads ~30 days out every leap year
  with nothing mistyped. Those are detected by their signature (same day of month, both
  months Adar) as verdict `adar_convention`, reported in a SEPARATE `adarChoices` list, and
  the one-click corrections refuse to touch them — offering the blunt fix there would have
  silently moved when a family observes a yahrzeit or birthday.
- **First run on the reference deployment** (74 events): most agreed exactly, a handful sat
  one day apart (nightfall — fine), **seven were genuine contradictions** and one was an
  Adar question. Two of the seven were the same person's birthday AND anniversary carrying
  an identical Hebrew date — a copy-paste, not a mistype, which is a shape worth looking for.
  Findings themselves are family data and are deliberately NOT recorded in this repo.
- 🪤 **`scripts/import-sheet.ts` cannot do this check.** It runs under `tsx`, and
  `@hebcal/core` is ESM-only with an exports map that tsx's CJS resolution rejects
  (`ERR_PACKAGE_PATH_NOT_EXPORTED`) — renaming to `.mts` clears hebcal but then the repo's
  own CJS-emitted modules lose their named exports. The importer therefore ends by pointing
  at `/admin/dates`; the check lives in the app, where it covers hand-entered rows too and
  is re-runnable by every family forever.

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
