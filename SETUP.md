# Luach — Deployment Guide

The [README](./README.md) covers running Luach locally. This is the longer
version for putting it on the internet. The examples use
[Railway](https://railway.app) because that is what the hosted instance runs on,
but nothing here is Railway-specific — it is a container and a Postgres
database.

---

## Step 1 — Create the database

Create a Postgres database (13 or newer), then apply the schema **as the schema
owner**:

```bash
DATABASE_URL="postgres://<owner>:<pw>@<host>:5432/<db>" npm run migrate
```

That runs `scripts/seed.sql` (the base schema) followed by every
`scripts/migrate-v*.sql` in numeric order. Every migration is idempotent, so
this same command is also how you upgrade an existing database after a
`git pull`.

If you would rather run them by hand, the order is:

```bash
psql "$DATABASE_URL" -f scripts/seed.sql
psql "$DATABASE_URL" -f scripts/migrate-v2.sql
psql "$DATABASE_URL" -f scripts/migrate-v3.sql
# …and so on through every scripts/migrate-v*.sql in numeric order.
```

## Step 2 — Create the app's database role

The migrations need `CREATE TABLE` / `ALTER TABLE` / `CREATE EXTENSION`, so they
run as the owner. **The app must not.** Create a restricted role for it:

```sql
CREATE ROLE app_user LOGIN PASSWORD '<a strong password>';
GRANT USAGE ON SCHEMA family_calendar TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA family_calendar TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA family_calendar TO app_user;
GRANT EXECUTE ON FUNCTION family_calendar.redeem_invite(TEXT, INTEGER) TO app_user;
```

> ### ⚠️ Never point the app at a superuser
>
> Families are isolated from each other by Postgres **row-level security**, and
> Postgres **silently skips row-level security for superusers and for roles with
> `BYPASSRLS`**. If `DATABASE_URL` names `postgres` or the database owner,
> nothing fails and nothing warns — every family simply gets read access to
> every other family's calendar. This is the single most important line in this
> document.

If you add tables later, re-run the `GRANT ... ON ALL TABLES` line (or set
`ALTER DEFAULT PRIVILEGES`), since grants do not apply retroactively to new
tables.

## Step 3 — Google OAuth credentials

1. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth 2.0 Client ID** of type **Web application**.
2. Add an authorised redirect URI:
   `https://<your-domain>/api/auth/google/callback`
   It must match `OAUTH_REDIRECT_URI` byte for byte — a trailing slash or `http`
   vs `https` mismatch is the usual cause of `redirect_uri_mismatch`.
3. Keep the client ID and secret for the next step.

Only the minimal identity scopes are requested. Luach never reads your Google
Calendar or contacts.

## Step 4 — Deploy the container

There is a `Dockerfile` producing a standalone Next.js build. On Railway:
**New → Deploy from GitHub repo**, pick your fork, and it will detect the
Dockerfile. Anywhere else, build and run the image as usual.

Set these variables on the service:

| Variable | Value |
|---|---|
| `DATABASE_URL` | The **`app_user`** connection string from step 2 |
| `SESSION_PASSWORD` | `openssl rand -hex 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From step 3 |
| `OAUTH_REDIRECT_URI` | `https://<your-domain>/api/auth/google/callback` |
| `NEXTAUTH_URL` | `https://<your-domain>` |
| `N8N_TOKEN` | Optional — bearer token for the automation feeds. See [SETUP-WHATSAPP.md](./SETUP-WHATSAPP.md). **A deployment secret: it reads across families.** |
| `DIGEST_RECIPIENTS` | Optional — extra comma-separated E.164 numbers for digests |

Photos are stored as base64 data URLs in Postgres, so there is no object store
or image CDN to configure.

## Step 5 — First sign-in

Visit the domain and sign in with Google. With no families yet you land in
onboarding, which creates your family and makes you its owner.

To load a demo family instead, see `npm run seed:example` in the README.

---

## Inviting the family

**Invite links.** As an owner, open `/admin/access` and mint an invite link
(editor or viewer). Send it however you like. A relative opens it, signs in with
Google, and joins — no shared password, and you can revoke any link later.
Invites expire after 30 days.

**Printable cards.** `/cards` generates a printable sheet with a QR code per
person, each carrying a personal magic link. Useful for relatives who will never
manage a login. Reprinting someone's card revokes their previous link.

## Subscribing to the calendar feed

1. Sign in and click **Subscribe** in the header. It shows your family's feed
   URL (`.../api/calendar.ics?token=…`). Copy it.
2. In Google Calendar, click `+` next to "Other calendars" → **From URL**.
3. Paste the link and add the calendar.

Every family has its **own** feed token (`families.feed_token`, added by
`scripts/migrate-v13.sql` and minted automatically for new families). The token
identifies the family, so the link only ever exposes that one family's calendar
— there is no shared master token and no `family=` parameter to change.

**Treat the link like a password:** anyone who has it can read that family's
calendar. Google Calendar refreshes subscribed URLs roughly hourly, so new
events show up within the hour rather than instantly.

## Upgrading

```bash
git pull
npm install
DATABASE_URL="postgres://<owner>@…" npm run migrate
```

Then redeploy. Migrations are idempotent and additive; none of them drop data.
