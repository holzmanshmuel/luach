# Security Policy

## Reporting a vulnerability

Email **holzmanshmuel@gmail.com** with "Luach security" in the subject.

Please include what you found, how to reproduce it, and what an attacker could
reach with it. If you have a proof of concept, a minimal one is ideal.

Please do **not** open a public GitHub issue for a vulnerability. Report it
privately first and give it a reasonable window to be fixed before disclosing.

**What to expect:** this is a side project maintained by one person. There is
**no bug bounty** and no paid reward. Response is best-effort — realistically a
few days, sometimes longer. You will get an acknowledgement, and credit in the
release notes if you want it.

**Supported versions:** the `main` branch only. There are no backported
security releases for older tags.

## Security posture

Luach is multi-tenant: one deployment hosts many unrelated families, and the
whole design question is keeping them apart. The main mechanisms:

- **Tenant isolation is enforced in Postgres, not in application code.** Every
  data table (`family_members`, `events`, `relationships`, `gatherings`,
  `access_tokens`, `branch_spellings`) carries a `family_id` and has row-level
  security `ENABLE`d **and `FORCE`d**, with a policy comparing `family_id`
  against the `app.current_family` setting. The app opens a transaction, sets
  that setting from the session, and runs the query — so a query that forgets a
  `WHERE family_id = …` returns nothing rather than another family's data.

- **The app connects as a restricted role.** `app_user` has data privileges
  only: no DDL, not a superuser, and no `BYPASSRLS`. This matters — Postgres
  silently skips row-level security for superusers and for `BYPASSRLS` roles,
  so running the app as the database owner or as `postgres` would disable the
  isolation without any error. See the self-hosting notes in the README.

- **Exactly one cross-tenant operation exists**, and it is encapsulated: joining
  a family by redeeming an invite. A joiner has no family yet, so there is no
  tenant context to scope by. Rather than granting the app ambient RLS bypass,
  that lookup lives in a `SECURITY DEFINER` function
  (`family_calendar.redeem_invite`, `scripts/migrate-v11.sql`) which validates
  the token and creates the membership. Every other access-token read is
  tenant-scoped.

- **Calendar feeds are authorized per family.** `/api/calendar.ics` is gated by
  a per-family `feed_token` (192 bits of randomness, unique, minted by a column
  default so no insert path can forget it). The token *identifies* the family,
  so there is no `?family=` selector to tamper with and no shared master token
  to leak. Treat a feed URL like a password: anyone holding it can read that
  family's calendar.

- **Sign-in is Google OAuth**; there is no password to steal. Sessions are
  sealed cookies (`iron-session`) keyed by `SESSION_PASSWORD`. Invite links and
  personal magic links are random 256-bit tokens stored only as SHA-256 hashes,
  are revocable, and expire.

- **Machine endpoints** (`/api/events/today`, `/api/digest/week`,
  `/api/reminders/yahrzeit`, `/api/families`) require a bearer `N8N_TOKEN` and
  are per-family. Treat `N8N_TOKEN` as a deployment secret: it reads across
  families.

### Known limitations

- Rate limiting is in-process and per-instance. Running multiple instances
  behind a load balancer weakens it proportionally.
- Photos are stored as base64 data URLs in Postgres. There is no virus scanning
  or content moderation on upload.
- Anyone with a family's feed token or invite link has that family's data. There
  is no per-person redaction inside a family — membership is the boundary.
