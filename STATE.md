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
- Migrations (`scripts/seed.sql`, then `migrate-v2.sql` … `migrate-v15.sql`) are applied **in order**
  by `scripts/migrate.ts` as schema owner, and are idempotent — safe to re-run after a `git pull`.
- **`/join/<token>` must keep that exact URL, forever.** Those links sit in family WhatsApp threads
  and cannot be re-sent. Same for `buildInviteLink` and the `/join/` proxy allowlist entry.
- n8n is a dumb pipe. Luach is the source of truth; n8n only fans messages out.

## Where it stands

- `main`, clean, level with `origin/main`. Last commit `2121483` (2026-08-30) — HOLZMAN-152, the
  sign-in path for returning members on `/welcome`.
- Four local branches still exist but are **all already merged into main** — stale refs, no
  unmerged work: `chore/parse-hebrew-date-0.2.0`, `holzmanshmuel/holzman-152-welcome-signin-affordance`,
  `holzmanshmuel/holzman-63-ical-feed-i18n`, `tools/parser-drift-audit`.
- Tests: vitest, 33 test files / 333 tests, 9 of which hit a real Postgres. CI
  (`.github/workflows/ci.yml`) runs on push to main + PRs against a throwaway `postgres:16` service
  container and uses **no GitHub secrets** on purpose, so a fork's CI runs unmodified: migrate →
  create+grant restricted role → assert not superuser/bypassrls → lint → build → `tsc --noEmit` →
  `vitest run`.
- Scheduled work is external: an n8n cron (`0 8 * * *`, see `SETUP-WHATSAPP.md`) calls the
  `N8N_TOKEN`-gated routes `/api/events/today`, `/api/digest/week`, `/api/reminders/yahrzeit`.

## Log

### 2026-09-10 — the invite link became a front door; sign-in/onboarding rebuilt

- **`/join/<token>` is now a PAGE, not a GET route handler — same URL.** It names the family
  before it asks for anything, and redemption moved to a server action posted from it.
  Four states, resolved by `src/lib/invite-state.ts` (pure, so the branch order is
  testable): **sign-in** (live link, signed out), **confirm** (live, signed in, not a
  member — the only screen carrying the Join button), **already-in** (a member, very
  often the OWNER checking their own link), **expired/revoked** (dead but real, so it
  names the family and says what to do). An unknown token still redirects to the
  deliberately opaque `/join-invalid`.
- ⚠ **Redemption must never happen on a GET again.** The old handler joined on sight,
  which an in-app `<Link>` prefetch could fire silently — the same scar `/api/logout`
  carries. The page is strictly read-only (RSC cannot write cookies anyway, which is
  why it *was* a route handler); `joinFamilyAction` does the mutation. The rate limits
  split accordingly: IP-keyed on the peek, user-keyed on the redeem, and **both belong**.
- `scripts/migrate-v15.sql` adds **`peek_invite()`** — SECURITY DEFINER, read-only, the
  companion to `redeem_invite()`. Same justification: a visitor on an invite link has no
  tenant GUC and `app_user` is not BYPASSRLS, so encapsulate the one cross-tenant read
  rather than granting ambient RLS-bypass. 🪤 **It must not stamp `last_used_at`** —
  WhatsApp and Telegram fetch shared URLs to build a preview, and this page re-renders on
  every refresh, so stamping would report invite activity that never happened. Tested.
- **Naming the family on an expired or revoked link is a deliberate disclosure.** The
  token is 256-bit and unguessable, so whoever presents one was handed it; naming the
  family is what turns a dead end into "ask whoever sent you the X link for a new one".
  An *unknown* token names nothing — that page must stay non-oracular.
- **The duplicate-family trap is closed.** `/onboarding` used to offer exactly one action:
  CREATE. So a relative told "sign up at the site" (no link) made a second, empty family
  with the same surname, invisible to the real one and **unmergeable** with it. The page
  now leads with "were you invited?" plus a paste-your-link box (`extractInviteToken` —
  accepts a URL, a path or a bare token, never looks at the host), and only then the
  create form, still expanded so the founder pays no extra tap. Costs are asymmetric:
  creating the wrong family is permanent, failing to create is a ten-second recovery.
- **`/families/new` is the door to a second calendar that never existed.** `FamilySwitcher`
  now renders from **one** membership (was two), which also fixes a smaller gap — a
  one-family user could not see which family they were in — and the "start another
  calendar" item lives inside it, one level down, the way Slack/Notion/Linear/Figma do it.
  It reuses `createFamilyAction` unchanged; that action never checked the membership
  count, only `/onboarding`'s page guard did.
- 🪤 **`enterFamily()` (`src/lib/session-transitions.ts`) clears `viewFamilyIds`.** Every
  "you are now in THIS family" path — onboarding, /families/new, invite redemption — goes
  through it. Without the clear, a user sitting in the COMBINED view creates or joins a
  family, lands on a merged calendar that filters the new family out, and the button
  looks like it did nothing. That bug only becomes reachable once a second family is
  creatable, so it shipped in the same change that created the risk.
- **`?joined=1` finally does something.** Nothing read it before, so a relative who had
  just been added landed on a dense calendar with zero confirmation. `JoinedBanner` names
  the family and points at Subscribe. 🪤 It is rendered in **both** returns of
  `src/app/page.tsx` — that file has a Hebrew-month grid and a Gregorian one, and wiring
  only one leaves half the users with no confirmation.
- **A signed-in user with no family is no longer homeless.** The proxy's cookie gate needs
  BOTH `userId` and `familyId`, so anyone who abandoned onboarding bounced between
  `/login` (which signs them in again) and `/welcome` (marketing). They now go to
  `/onboarding`. `/login` redirects signed-in visitors away for the same reason, and
  `/join-invalid`'s single button is chosen from the session instead of always saying
  "sign in" to somebody who already is.
- 🪤 **That pairing can loop, so `/onboarding` no longer redirects on membership alone.**
  The proxy sends every family-less signed-in user to `/onboarding`, and `/onboarding`
  sends anyone holding a membership to `/` — a session with memberships but no
  `familyId` would bounce `/→/onboarding→/` forever. No known path produces that state
  (every join and creation sets `familyId`), but the page now self-heals instead:
  it renders a re-enter-your-family panel that POSTs to `/api/family/switch`, which
  re-verifies membership and writes the cookie an RSC render cannot. Both halves tested.
- **`/api/logout` is now proxy-allowlisted and honours a sanitized `?next=`.** That is what
  makes "use a different Google account" work on the invite confirmation: a relative who
  signed in as the wrong person on a shared phone has `userId` but no `familyId`, so the
  gate would otherwise swallow their only way out. `oauth.ts` already forces
  `prompt=select_account`; what was missing was showing WHICH account got picked.
- Copy: every new string is a **whole sentence with a named placeholder** (`{family}`,
  `{email}`) — never assembled from two keys, which presumes English word order.
  `splitTemplate` + `<Interpolated>` render the value inside `<bdi>` so a Latin surname or
  email is not reordered inside a Hebrew sentence. `landing.signin` is **deleted**: it
  pointed at the identical `/api/auth/google` URL as `landing.cta`, and two labels for one
  door read as a choice you can get wrong. ⚠ **The Hebrew is a working draft and wants a
  native read** — and it says יומן where some older strings say לוח.
- 🪤 Two translated labels shipped a hard-coded `←`/`→` (`invite.back`,
  `form.next_birthday`) that pointed backwards on the Hebrew page. Arrows are now JSX
  chosen from `dir`/`language`, and `translations.test.ts` fails any label that starts or
  ends with one. (A mid-string `→` as a step separator — "Settings → Calendar" — is a
  different thing and is left alone.)
- Tests: 33 files / 333 tests (was 28/281). New: `invite-state`, `invite-link`,
  `session-transitions`, `family-label`, `proxy` (seals a real iron-session cookie so it
  cannot drift from the app's format), plus `peekInvite` DB cases and a second-family case.
  Verified the three proxy assertions fail on the old redirect before keeping them.
- **Deliberately not done:** no leave-family / remove-member flow (a real gap — a relative
  who joins the wrong family cannot get out — but destructive, with its own
  ownership-transfer questions); no WhatsApp share button or stated expiry on
  `/admin/access`; no progressive enhancement on the Join button (it needs JS, exactly
  like the existing create-family form).

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
