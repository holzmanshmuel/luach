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
- Migrations (`scripts/seed.sql`, then `migrate-v2.sql` … `migrate-v17.sql`) are applied **in order**
  by `scripts/migrate.ts` as schema owner, **before** the deploy that needs them, and are idempotent —
  safe to re-run after a `git pull`. `migrate.ts` globs `migrate-v*.sql`, so a new migration needs no
  registration.
- **`families` is written only from inside that family's tenant context** (enforced by the
  migrate-v17 trigger for every role but the owner). Use the tenant-scoped `query()` with
  `WHERE id = nullif(current_setting('app.current_family', true), '')::int`; in tests, delete a
  family with `deleteFamilies()` from `src/test-stubs/families.ts`, never a bare `systemQuery`.
- **Admin-page copy is translated too.** Server Actions and validators return a `TMessage`
  (`{ key, params }`), never an English sentence; render with `<Message>` / `<InterpolatedMany>` so
  each value is `<bdi>`-isolated.
- **`/join/<token>` must keep that exact URL, forever.** Those links sit in family WhatsApp threads
  and cannot be re-sent. Same for `buildInviteLink` and the `/join/` proxy allowlist entry.
- n8n is a dumb pipe. Luach is the source of truth; n8n only fans messages out.

## Where it stands

- 2026-09-14: HOLZMAN-181 (#2) and HOLZMAN-183 (#4) merged and deployed. **HOLZMAN-182 (#3) is
  merged only once `migrate-v17` has run on production** — see the 2026-09-14 log entry.
- Tests: vitest. All three branches trial-merged on a fresh migrated database as the app role:
  **55 files / 684 tests, 0 skipped**. CI (`.github/workflows/ci.yml`) runs on push to main + PRs
  against a throwaway `postgres:16` service container and uses **no GitHub secrets** on purpose, so a
  fork's CI runs unmodified: migrate → create+grant restricted role → assert not superuser/bypassrls
  → lint → build → `tsc --noEmit` → `vitest run`.
- Scheduled work is external. On the reference deployment ONE n8n job runs daily at 08:00
  Asia/Jerusalem and calls `/api/digest/daily` per family (recipients = members with a phone). The
  legacy `/api/digest/week` and `/api/reminders/yahrzeit` schedules are deactivated, and
  `DIGEST_RECIPIENTS` is being removed from the hosted service (HOLZMAN-180); self-hosters on the
  legacy routes can still set it.

## Log

### 2026-09-14 — a typed name forked people; `families` gets a database backstop; admin pages go bilingual

- **HOLZMAN-181 — adding an occasion by TYPING a name created a duplicate person.**
  `createEventAction`'s fallback lookup compared the form's full name ("Miriam Cohen") with the
  given-name column alone, so it never matched anyone who has a surname. It now matches each
  person's `fullName()` — the form the suggestion list shows — as stored AND as the viewer spells
  the family's surnames (`idsMatchingFullName()` in `names.ts`, shared with the client's auto-link).
  🪤 **Two people with one name: neither side guesses.** The action returns `err.person_ambiguous`
  and writes nothing; the form links on its own only when exactly one person matches. Attaching an
  occasion to "the first match" would be the same silent wrong answer in a new shape.
  `create-event-person-link.test.ts` runs the real action against Postgres; 3 of its 6 cases fail on
  the old code.
- **HOLZMAN-182 — `migrate-v17`: cross-family writes to `families` are refused by the database.**
  `families` has no RLS and cannot (it is the tenant list, read pre-auth), so isolation was
  discipline: a red-team lane overwrote another family's branch list with raw SQL as the app role.
  A `BEFORE UPDATE OR DELETE` row trigger now lets any role but the OWNER change or delete a row
  only from inside that family's own tenant context, and never change its id (42501, raised before
  constraints and before `ON DELETE CASCADE`). SELECT and INSERT are untouched, so the feed-token
  lookup, invite page and onboarding keep working; the owner stays exempt because migrations rewrite
  every family. Chosen over a SECURITY DEFINER write function because the one real write path
  (`setFamilyBranches`) already has this shape — no grants to keep in sync in four places, no app
  change — and because it covers DELETE, which cascades a whole family.
  `families-write-guard.test.ts` first asserts the suite is NOT the owner (as the owner every refusal
  would silently stop happening); with the trigger disabled 8 of its 10 cases fail.
  🪤 **Under a guard, `rejects.toThrow()` proves nothing.** The feed-token UNIQUE / NOT NULL tests
  would have kept passing on the guard's 42501 without ever reaching the constraint; they now write
  from inside the family and assert 23505 / 23502. Assert the SQLSTATE you mean.
  🪤 **Mutation-checking a guard runs its "refused" writes for real.** Disabling the trigger on the
  shared local staging database let the test's cross-family UPDATE rename every family row there.
  Do that kind of check on a throwaway database.
  ⚠ **Pending on production** until the owner runs
  `DATABASE_URL='<owner URL from Railway calendar-db>' npx tsx scripts/migrate.ts`; merge #3 after.
  No app code reads the trigger, so neither order can take the site down.
- **HOLZMAN-183 — `/admin/dates`, `/admin/branches`, `/admin/names` are bilingual.** The `dir="ltr"`
  pins are gone; back-links use `backArrow(dir)`. Validators, draft warnings and the admin Server
  Actions return translation keys with data (`TMessage`), rendered by `<Message>` /
  `<InterpolatedMany>`, which `<bdi>`-isolate every value — so Hebrew keeps its own word order and a
  Latin surname never drags punctuation out of place. Dates use the calendar's own localized
  formatters. Hebrew "branch" is **שבט** throughout (the header's `nav.branches` changed from ענפי
  משפחה to match `person.branch` and the tree filter). ⚠ The Hebrew is a working draft and wants a
  native read. Still English: `setHebrewNameAction`'s errors in `actions.ts`.

### 2026-09-10 — every relative outside Israel saw every date a day early

- **The same off-by-one bug class, third disguise: a `Date` crossing the server→client
  boundary.** `CalendarEvent.gregorianDate` was a real `Date`, built on the server (which
  runs `TZ=Asia/Jerusalem`) at local midnight and passed as a prop into CLIENT components,
  which called `.getDate()` / `.getMonth()` on it. React's wire format preserves the
  INSTANT, not the civil day: 4 Sep 2026 serialised as `2026-09-03T21:00:00.000Z` and the
  browser read it in the VIEWER's zone — Thu 3 Sept in London, New York and Los Angeles.
  **Every birthday, anniversary and yahrzeit was a day early for every relative outside
  Israel.** Same shape as the `toISOString()` bug that once wrote 38 birthdays a day early.
- 🪤 **The pure-function suite could not see it, and never could have.** The bug lived at a
  PROCESS BOUNDARY, not inside a function; every conversion test was already timezone-clean
  and passing. When a suite is green and the screen is wrong, ask what crosses a boundary.
- **The fix: the civil day is decided ONCE, on the server, in `TZ`, and travels as a
  `YYYY-MM-DD` string.** New `src/lib/civil-day.ts` (`CivilDay`, pure UTC/string arithmetic,
  client-safe) is the type; `zoned-day.ts` gained `todayYmd()` and `civilDayToDate()` as the
  two crossings. `CalendarEvent.gregorianDate: Date` → `gregorianDay: CivilDay`, and
  `HebrewMonthCell.gregorian: Date` → `ymd: CivilDay` (the whole month model is a client
  prop too — its "today" ring, its `Sep 4` note and its gathering lookup all read from it).
- **"Today" is the DEPLOYMENT's today.** `CalendarGrid`, `HebrewCalendarGrid` and `MonthNav`
  each called a bare `new Date()` IN THE BROWSER, so a relative in Auckland saw the
  highlight on tomorrow's cell. `page.tsx` now resolves it once and passes `todayDay` down.
- 🪤 **The shape guard found a second one nobody was looking for:** `created_at`/`updated_at`
  are `timestamptz`, so the pg driver hands them back as `Date` objects — behind a type that
  declared `string`, spread straight into a client prop. The calendar loaders now share an
  explicit `EVENT_COLUMNS` / `GATHERING_COLUMNS` list that returns them as ISO text (and
  drops `family_id`). **`e.*` is how a new column silently becomes a new client prop.**
- `formatGregorianLocalized(date, lang)` is **deleted**, not deprecated — a `Date`-taking day
  formatter is the loaded gun. `formatCivilDayLocalized` / `formatCivilDayShort` take the
  string and pin `Intl` to `timeZone: 'UTC'`, so the sentence is identical in every zone.
- `/api/digest/week` and `/api/reminders/yahrzeit` moved off their own local-midnight
  `startOfToday()` onto `civilDayInZone()`, and `digest.ts` rehydrates a gathering date as a
  noon carrier. **Output is byte-identical** — checked field by field over 25,550
  (instant, zone) pairs across 5 zones, and `broadcast-site-url.test.ts` still passes.
- **New tests are about SHAPE and about the READER's zone, not another conversion.**
  `calendar-boundary.test.ts` (DB-backed) walks everything the loaders return and fails on
  any `Date` instance anywhere in it; `calendar-display.test.tsx` renders the real client
  components under 7 viewer zones and diffs the markup. Reintroducing the old `CalendarGrid`
  behaviour fails 4 of them. `vitest.config.ts` now includes `*.test.tsx`.
- Suite: **46 files / 583 tests, 0 skipped**, green under `TZ=` Asia/Jerusalem, UTC,
  America/Los_Angeles, Pacific/Auckland and Asia/Kolkata. Verified in a real browser
  (production build) with the browser zone overridden: identical dates in all of them.

### 2026-09-10 — the month-nav chevrons are bidi-MIRRORED, and that is the actual hazard

- ⚠ **`‹` and `›` (U+2039/U+203A) have `Bidi_Mirrored = Yes`.** Measured from rendered
  pixels in Chrome: inside `dir="rtl"`, `‹` PAINTS as `›` and `›` PAINTS as `‹`. `←`/`→`
  (U+2190/U+2192) were measured the same way and are **not** mirrored.
- **So an audit that reads the DOM text gets the Hebrew nav exactly backwards.** One
  reported the chevrons inverted (right-hand "next month" button showing a left glyph); at
  the pixel level the original was CORRECT, and "fixing" the code points would have
  inverted what people actually see. **Read pixels, not code points, for a mirrored glyph.**
- The fix is to stop depending on the mirror at all: every chevron link carries
  `CHEVRON_BIDI` (`dir="ltr"`) from the new `src/lib/direction.ts`, which isolates the run so
  the source glyph IS the painted glyph in both languages. `flexRowChevron(dir, index)` then
  picks the glyph by DOM POSITION — a `dir="rtl"` flex row starts at the RIGHT, so the
  Hebrew nav's first child is its right-hand button.
- `direction.ts` also owns `backArrow(dir)`; `/tree`, `/timeline` and `/admin/access` now use
  it instead of a hard-coded `←`. A source guard in `direction.test.ts` fails if any
  direction-sensitive component contains a literal arrow or chevron, and a second one fails
  if a month-nav chevron link loses its `dir="ltr"`.
- Subscribe dialog: the calendar-URL `<input>` gained `dir="ltr"`, so the Hebrew page no
  longer right-aligns it and truncates the START of the link.

### 2026-09-10 — a new family must never inherit the operator's surnames

- **The v14 fallback chain leaked one tenant's PII into every other.** `NULL branches`
  meant "inherit `FAMILY_BRANCHES`", and a newly created family was left NULL — so a
  stranger signing up on the hosted deployment would have seen **the operator's real
  family surnames** as their own branch chips. Per-family branches existed to stop exactly
  that and stopped one step short.
- **NULL and empty are now different answers, and the difference is privacy:**
  `NULL` → predates per-family branches, inherit the env var (a finite, shrinking set of
  rows); `{}` → no sides set up yet, everyone neutral; `{…}` → the family's own list.
  `createFamilyWithOwner()` stamps `'{}'`, so **the env var can never reach a family
  created from now on.**
- `migrate-v16` relaxes v14's CHECK floor from `cardinality >= 1` to `>= 0`. **v14 was left
  exactly as it shipped** — it had already run in production, and editing an applied
  migration makes the database and the file disagree about history.
- `validateBranchList` now accepts an empty list (a real state: "sort nobody by side") and
  rejects a list of exactly ONE — a catch-all with nothing to catch, drawn neutral anyway,
  so it only looks like a branch that is broken.
- 🪤 **Two tests asserted the leak as correct behaviour** — `branches.test.ts` had
  "treats an empty stored list as *not set*" and `branches-server.test.ts` insisted on a
  ≥2 floor. Both were written deliberately and both encoded the bug. **A test passing does
  not mean the behaviour is right; it means the behaviour is what someone wrote down.**

### 2026-09-10 — CI's role grants drifted from the migrations

- **`peek_invite` shipped with its grant in the migration, README and SETUP.md — but not in
  `.github/workflows/ci.yml`.** The migration's grant is conditional on the role existing,
  and **CI creates the restricted role AFTER migrating**, so the grant silently no-opped
  and 9 tests failed on CI having passed locally (where the role predated the migration).
- Fixed the list, and added `src/lib/db-grants.test.ts`, which asks the DATABASE which
  SECURITY DEFINER functions exist and asserts the connecting role can EXECUTE every one.
  **Enumerating from the schema rather than from a hand-kept list is what makes the next
  one impossible to forget.**

### 2026-09-10 — ⚠️ TWO MIGRATIONS PENDING ON PRODUCTION

`migrate-v14` (families.branches) and `migrate-v15` (peek_invite) are BOTH written and
merged but **not yet applied to production**. Until they are:

- `/admin/branches` renders (the read falls back to `FAMILY_BRANCHES`) but **cannot save** —
  it returns a plain-language explanation rather than a 500.
- **`peek_invite` has no such guard.** `/join/<token>` calls it on every render, so deploying
  the invite-landing work before v15 runs would 500 **every invite link in the family's
  WhatsApp**. This is why that work is merged but deliberately NOT pushed.

Apply both, then push, in one shot so the order cannot be got wrong:

```
cd ~/luach && DATABASE_URL='<owner URL from Railway calendar-db → DATABASE_PUBLIC_URL>' \
  npx tsx scripts/migrate.ts && git push origin main
```

🪤 **Migrations run as the OWNER role, not `app_user`** — `migrate.ts` as `app_user` fails with
`permission denied`. The app keeps connecting as `app_user`; only the migration is elevated.

### 2026-09-10 — a deploy ahead of its migration took production down

- **What happened:** the per-family branch work was pushed and deployed before
  `migrate-v14` had been run against the production database. `storedFamilyBranches()`
  is called from the ROOT LAYOUT, so `SELECT branches` raised `undefined_column` and
  **every signed-in page returned 500.** Public pages (`/welcome`, `/login`) kept working,
  which is why an HTTP check on them looked healthy — the outage was only visible with a
  session. Reverted within minutes, then re-landed with the guard below.
- 🪤 **Additive migrations are not deploy-order-free just because they are additive.**
  The documented order is migrate, then deploy. Prod DB writes here are credential- and
  policy-gated, so "deploy now, migrate when someone runs it" is a state this app WILL
  sit in again.
- **The guard:** `storedFamilyBranches()` absorbs exactly SQLSTATE **42703**
  (`undefined_column`) and answers `null`. A missing column and a NULL column mean the
  same thing to every caller — "this family has not chosen a list" — so the read degrades
  into the `FAMILY_BRANCHES` fallback the resolution chain already has, and self-heals the
  moment the migration lands. Verified by dropping the column on a real database and
  confirming the resolved list came back from the env var.
- ⚠ **Nothing else is absorbed.** `42P01`, `42501`, connection failures and message-text
  matches all rethrow — swallowing those is how a genuinely broken deployment hides.
  `isUndefinedColumn()` is exported and matched on SQLSTATE, never on message text.
- 🪤 **Public-page health checks do not prove the app is up.** Assert against a signed-in
  page, or the check is blind to the layout, the tenant context and every guard.

### 2026-09-10 — one morning digest replaces two crons (`/api/digest/daily`)

- **`GET /api/digest/daily?family=<id>`** returns a ready-to-send WhatsApp body plus
  recipients, assembled from up to three blocks (empty ones omitted; all empty ⇒
  `has_content: false` and the workflow sends nothing):
  **Today** · **Tonight begins** · **Later in the week** (Sundays only, tomorrow→Saturday) ·
  **A yahrzeit is a week away** (exactly 7 days out), all sharing one de-dup set.
- ⚠ **"Tonight begins" is not optional.** A yahrzeit and its candle start at sundown, so a
  naive "today's events" digest would tell people the morning AFTER the candle should have
  been lit. That block carries the retired yahrzeit reminder's eve-before (`lead=1`)
  semantics; deleting it is a regression, not a simplification.
- ⚠ **The retired yahrzeit cron ran TWICE a day**, not once: `lead=1` for tonight's candle
  AND `lead=7` for a week's notice. The first consolidation folded in only the eve-before,
  which would have deleted the week-ahead notice the moment the old schedule was switched
  off — caught while checking the old workflow's nodes, not from the route's own docs.
  **When collapsing jobs, enumerate what the OLD schedule actually calls; a workflow can
  hit the same endpoint more than once with different parameters.**
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
