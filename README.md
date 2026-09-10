# Luach

[![Source on GitHub](https://img.shields.io/badge/source-holzmanshmuel%2Fluach-1D4ED8?logo=github)](https://github.com/holzmanshmuel/luach)
[![License: MIT](https://img.shields.io/badge/license-MIT-1D4ED8)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-1D4ED8?logo=nextdotjs)](https://nextjs.org)

**The Hebrew–English family calendar.** Every birthday, anniversary and
yahrzeit — on both the Hebrew and the Gregorian date, in both Hebrew and
English, shared with the whole family.

Jewish families run on two calendars at once. A birthday is on the 12th of
Kislev *and* on some date in November that moves every year; a yahrzeit is
fixed to the Hebrew date and quietly drifts through the civil one. Keeping that
straight in a spreadsheet is how yahrzeits get missed. Luach keeps both dates
for every occasion, shows whichever one you think in, and pushes the reminders
out to the people who need them.

**Hosted free at [family-calendar.holzman-ai.com](https://family-calendar.holzman-ai.com)**
— or self-host it; the whole thing is in this repo.

![Luach's month grid in English](./docs/screenshots/month-english.png)

*The month grid: birthdays and anniversaries beside Rosh Chodesh and the
candle-lighting times, with the next occasions down the side. Every person and
date in these screenshots is from the fictional demo family that ships with the
repo — see [the demo family](#4-optional--the-demo-family).*

## What it does

- **Dual dates everywhere.** Every event carries its Hebrew date and its
  Gregorian one. A birthday recurs on its Hebrew date *and* on its fixed civil
  date, so both show up — and Adar in a leap year, and 30 Cheshvan in a short
  year, land where they should.
- **Yahrzeits**, counted in Hebrew years (which is not the same as subtracting
  Gregorian years for a Tevet–Adar date that crosses January 1).
- **Hebrew birthdays**, including for people whose English birth date nobody
  remembers.
- **Bilingual UI**, Hebrew and English, with proper RTL. Every person can have a
  Hebrew name alongside their English one; each viewer picks their language and
  the whole site follows, calendar grid included.
- **Yomim tovim and Shabbat** built into the grid, so nothing sneaks up on you.
- **Family tree** — a zoomable, collapsible org chart of parents, spouses,
  remarriages and cousin marriages, tinted by family branch.
- **Timeline** and **on this day** views.
- **Simchas** — one-off gatherings (wedding, bar mitzvah, brit, upsherin, sheva
  brachot) with their own glyphs, separate from the recurring events.
- **Subscribable calendar feed.** Each family gets its own iCal URL, so every
  relative adds it once to Google or Apple Calendar and gets the birthdays and
  yahrzeits in their own calendar forever.
- **WhatsApp digests and reminders** — an optional weekly digest and a
  yahrzeit-eve reminder, sent via [n8n](https://n8n.io) and a WhatsApp gateway
  you run. See [SETUP-WHATSAPP.md](./SETUP-WHATSAPP.md).
- **Multi-family.** One deployment hosts many unrelated families, isolated from
  each other by Postgres row-level security. If you belong to more than one —
  your side and your in-laws' — there is a **combined view** that merges both
  calendars with a colour per family. Start a second one from the 🏠 family
  switcher in the header.
- **Google sign-in and invite links.** No shared password. An owner mints an
  invite link; a relative opens it, sees whose calendar it is, signs in with
  Google, confirms, and is in. Nobody has to know whether their family already
  has a calendar — the link decides.
- **Printable QR cards** with per-person magic links, for relatives who will
  never manage a login.
- **Installable PWA** with an offline shell.
- **A Hebrew date converter**, because someone always asks.

## Screenshots

**The family tree** — three generations, spouses and parents, tinted by branch,
zoomable and collapsible.

![The demo family's tree, three generations deep](./docs/screenshots/family-tree.png)

**The same screen in Hebrew.** Each viewer picks their own language; the whole
site follows, right-to-left layout and Hebrew names included.

![The same tree rendered right to left, with Hebrew names](./docs/screenshots/family-tree-hebrew.png)

**The landing page**, for the relatives you still have to talk into it.

![The Luach welcome page](./docs/screenshots/welcome.png)

## Self-hosting

You need Node 20+ and a Postgres 13+ database.

### 1. Database

Create the database and run every migration, **as the schema owner**:

```bash
createdb luach
DATABASE_URL="postgres://<owner>@localhost:5432/luach" npm run migrate
```

That applies `scripts/seed.sql` (the base schema) and every
`scripts/migrate-v*.sql` in order. All of them are idempotent, so re-running
after a `git pull` is how you upgrade.

Then create the restricted role the app actually connects as:

```sql
CREATE ROLE app_user LOGIN PASSWORD '<a strong password>';
GRANT USAGE ON SCHEMA family_calendar TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA family_calendar TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA family_calendar TO app_user;
GRANT EXECUTE ON FUNCTION family_calendar.redeem_invite(TEXT, INTEGER) TO app_user;
GRANT EXECUTE ON FUNCTION family_calendar.peek_invite(TEXT) TO app_user;
```

> ### ⚠️ Do not run the app as a superuser
>
> Families are kept apart by Postgres **row-level security**, and Postgres
> **silently skips row-level security for superusers and for roles with
> `BYPASSRLS`**. Point `DATABASE_URL` at `postgres` (or at the database owner)
> and nothing errors — every family just quietly gets read access to every
> other family's calendar. Run migrations as the owner; run the app as
> `app_user`.

### 2. Environment

```bash
cp .env.example .env.local
```

Fill it in — `.env.example` documents each variable:

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres URL for the **`app_user`** role (see the warning above) |
| `SESSION_PASSWORD` | yes | 32+ chars sealing the session cookie — `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | Google OAuth 2.0 "Web application" client |
| `OAUTH_REDIRECT_URI` | yes | `https://<your-domain>/api/auth/google/callback`, registered identically in the Google console |
| `NEXTAUTH_URL` | in prod | Your public origin, used to build invite and feed URLs. The WhatsApp broadcast feeds **500 rather than guess** if it is unset — there is no default |
| `FAMILY_BRANCHES` | optional | Your family's branch surnames, comma-separated — see [Family branches](#family-branches). Unset = the demo family's |
| `N8N_TOKEN` | optional | Bearer token for the automation feeds — **a deployment secret; it reads across families** |
| `DIGEST_RECIPIENTS` | optional | Extra comma-separated E.164 numbers for digests |

### Family branches

A "branch" is a side of the family — usually a surname. Luach tints avatars,
tree cards and timeline entries by branch, and each viewer can pick their
preferred spelling of each branch surname. Set yours in the environment; no code
changes:

```bash
FAMILY_BRANCHES="Levi,Cohen,Mizrahi,Adler,Other"
```

Leave it unset and you get that fictional demo list.

Two rules:

- **Keep a catch-all LAST.** The final entry is the "no particular branch"
  bucket. It is drawn in a neutral tint, it is where the CSV importer files
  anyone whose surname it can't place, and it is left out of the
  spelling picker (it has no surname to spell). Call it `Other`, `Misc`, `אחר`
  — whatever you like; only its position matters.
- **Order is the colour.** Branch colours are assigned by POSITION: the first
  name gets the first palette colour, the second the second, and so on.
  Reordering the list therefore reshuffles the colours everyone in your family
  already recognises — **append, never insert or reorder**. Renaming a branch in
  place keeps its colour, but does not rewrite the value stored on existing
  people; edit those in the app (or with SQL) if you want them to move.

You can list more or fewer than five. Beyond the built-in palette (four named
branches plus the neutral catch-all) colours repeat from the start; add entries
to `BRANCH_STYLES` in `src/lib/branches.ts` if you'd rather they didn't.

Branch values already in the database that are **not** in your current list
don't break anything — those people render in the neutral tint, keep their
stored value, and filter under the catch-all chip in the tree.

### 3. Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Sign in with Google. If you have no family yet you land on onboarding, which
asks first whether you were **invited** — paste that link and you join the
family that sent it — and otherwise creates your family. If you already have
one, the same button just signs you in.

### 4. Optional — the demo family

To see every feature working before you enter real people:

```bash
DATABASE_URL="postgres://app_user:...@localhost:5432/luach" npm run seed:example
```

This creates the fictional **Levi family** — three generations, a yahrzeit,
Hebrew and English-dated birthdays, an anniversary, a bar mitzvah — and prints
an invite link. Open the link, sign in, press **Join this calendar**, and you
are in.

### 5. Optional — import your existing spreadsheet

Most families already have one. Export it as CSV with the columns
`Name, Hebrew Birthday, English Birthday, Anniversary[, Branch]` and:

```bash
DATABASE_URL="..." npx tsx scripts/import-sheet.ts data.csv --family=<id>
```

It parses the messy hand-written Hebrew dates people actually type
(`ח' שבט`, `כ״ט ניסן`, `15 Adar II`) and reports anything it could not read so
you can add those few by hand. The parsing is
[`parse-hebrew-date`](https://github.com/holzmanshmuel/parse-hebrew-date), the
parser extracted from this project into its own package.

### 6. Deploy

There is a `Dockerfile` producing a standalone Next.js build; it runs anywhere
that takes a container. Set the same environment variables as secrets, point
`DATABASE_URL` at your managed Postgres (as `app_user`), and run
`npm run migrate` against it once as the owner.

### Making it yours

A few places carry the reference deployment's identity rather than yours:

- Branch surnames are the `FAMILY_BRANCHES` environment variable — see
  [Family branches](#family-branches). No code change needed.
- `src/app/(marketing)/privacy/page.tsx` and
  `src/app/components/BuiltByHolzman.tsx` — the privacy policy and footer name
  the hosted instance's operator and contact address. If you run your own
  public instance, put your own details there.

## Tech

Next.js 16, React 19, Tailwind 4, Postgres (row-level security for tenancy),
[`@hebcal/core`](https://github.com/hebcal/hebcal-es6) for the Hebrew calendar
maths, `iron-session` for the session cookie, `ics` for the calendar feed.
Tests are Vitest:

```bash
npm test
npx tsc --noEmit
npm run lint
```

## Contributing

Issues and pull requests are welcome. This is a side project maintained by one
person, so please note:

- **No support SLA.** Issues get answered when there is time. A clear
  reproduction gets answered faster.
- **Open an issue before a large PR**, so you don't build something that turns
  out to be a direction the project isn't going.
- Keep `npm test`, `npx tsc --noEmit` and `npm run lint` green.
- Hebrew-calendar behaviour needs a test. The edge cases (Adar I/II, 30 Cheshvan
  and 30 Kislev in short years, Hebrew-year counts across January 1) are exactly
  where this software earns or loses its trust.
- **Never commit real family data.** `.gitignore` already excludes `.env*` and
  `*.csv`; keep fixtures fictional.

Security issues go to [SECURITY.md](./SECURITY.md), not the public tracker.

## License

[MIT](./LICENSE) © 2026 Shmuel Holzman.

---

Source: **[github.com/holzmanshmuel/luach](https://github.com/holzmanshmuel/luach)** ·
Hosted free at **[family-calendar.holzman-ai.com](https://family-calendar.holzman-ai.com)** ·
Built by **[Holzman AI & Automations](https://holzman-ai.com)**
