# WhatsApp Nudges — Setup

This gives the Family Calendar **one morning WhatsApp message per family** —
today's events, the yahrzeits that begin at nightfall tonight, and, on Sundays,
the rest of the week. The delivery chain is:

```
One daily cron in n8n  →  GET /api/families                      (every family)
                       →  GET /api/digest/daily?family=<id>      (per family)
                       →  gate on has_content
                       →  Evolution API sends `message` to each recipient
                       →  audit-log row
```

Everything here is optional. The calendar works fine without it — this just
adds the push half, so relatives hear about a birthday without opening the app.

> **⚠️ These routes are multi-tenant.** The calendar can host more than one
> family, each with its own isolated data. Every `N8N_TOKEN` feed route below
> (`/api/digest/daily`, `/api/events/today`, `/api/digest/week`,
> `/api/reminders/yahrzeit`) **requires a `?family=<id>` query param** and
> returns only that one family's data. If you run more than one family, your
> workflow must loop over them — see "Multi-family loop" below.
>
> `/api/calendar.ics` is **not** in that list: the subscribable calendar feed
> is gated by a per-family `feed_token` (`scripts/migrate-v13.sql`), so the
> token itself names the family and a `family=` param is ignored. It is a
> human subscription surface, not an n8n one.

## What you need

1. An Evolution API service on Railway (new — instructions below).
2. An n8n workflow that fires daily (new).
3. Environment variables on the Family Calendar service:
   - `N8N_TOKEN` — long random string. n8n sends it as `Authorization: Bearer <token>`.
   - `NEXTAUTH_URL` — your public origin, so the links inside the messages point
     at the right place. **Every broadcast endpoint returns HTTP 500 naming this
     variable when it is missing**, rather than falling back to some other
     deployment and messaging your family a link to a calendar that isn't yours.
   - `TZ` — the timezone the calendar reckons a day in, e.g. `Asia/Jerusalem`.
     `/api/digest/daily` decides what "today" is, and whether today is Sunday,
     in this zone. Leave it unset and you get the container's zone (usually
     UTC), which turns the day over at the wrong moment: a Saturday-evening run
     would report Sunday's events, or a Sunday one would skip the week-ahead
     block. Set it to the family's zone.
   - `DIGEST_RECIPIENTS` — optional, and **only** used by the two legacy feeds;
     `/api/digest/daily` ignores it on purpose (see section 3).

## 1. Phone numbers on each person

1. Open the Family Calendar, go to any person, click **Edit**.
2. Under "WhatsApp nudges" enter the phone in **E.164** format, e.g.
   `+14155551234` or `+441632960123`. The server rejects anything else.
3. Toggle **Send WhatsApp nudges to this person** off if the person does not
   want to receive messages. This flag is also honoured by `/api/events/today`
   — their events will not appear in the feed.

**This is how somebody subscribes to the daily digest.** The `recipients` list
`/api/digest/daily` returns is exactly the members of that family who have a
phone number on record and nudges enabled — including people who are on the
tree only to receive the message. Anyone who should get the digest goes in as a
family member with a phone number.

## 2. Evolution API on Railway (self-hosted WhatsApp)

Evolution API is an open-source gateway that pairs with your personal WhatsApp
on your phone via QR code and exposes an HTTP API to send messages.

**Important:** connecting WhatsApp via an unofficial gateway is technically
against WhatsApp's terms of service. At family-scale volume (a few messages
per day) the ban risk is low but not zero. You accept this risk.

### Setup

1. In Railway, click **New → Deploy from Docker image**.
2. Image: `atendai/evolution-api:latest`.
3. Port: `8080` (expose publicly with a Railway-assigned domain).
4. Environment variables:
   - `AUTHENTICATION_API_KEY` — a long random string. Save it.
   - `DATABASE_URL` — reuse your existing Postgres URL.
   - `STORAGE_TYPE=postgres`
   - `DATABASE_CONNECTION_URI=${DATABASE_URL}`
   - `DATABASE_CONNECTION_DB_PREFIX_NAME=evolution`
   - `WEBHOOK_GLOBAL_URL` — blank for now (fill in later with the n8n URL if you want inbound webhook support).
5. Deploy. Once up, visit `https://<your-evolution-domain>/manager`.
6. Create an **instance** (any name, e.g. `family-nudges`). This gives you an
   instance slug used in URLs.
7. Open the instance and scan the QR code with your WhatsApp mobile app
   (Settings → Linked Devices → Link a device). Session persists until you
   unlink or the phone loses connection for a long time.

### Test it

```
curl -X POST 'https://<your-evolution-domain>/message/sendText/family-nudges' \
  -H 'apikey: <AUTHENTICATION_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{ "number": "+14155551234", "text": "Hello from Family Calendar" }'
```

You should receive a WhatsApp on that number within seconds.

## 3. /api/digest/daily — the one morning digest

The route the daily workflow calls. One request per family returns a
ready-to-send WhatsApp body plus the numbers to send it to:

```
curl -H 'Authorization: Bearer $N8N_TOKEN' \
  'https://<calendar-domain>/api/digest/daily?family=1'
```

The `message` is assembled from up to three blocks, and **any empty block is
left out entirely**:

1. **Today** — every event falling today: birthdays, anniversaries, other
   recurring events, simchas, and yahrzeits whose date *is* today. Same glyphs
   and one-line phrasing as the weekly digest.
2. **Tonight begins** — yahrzeits whose Hebrew date begins at nightfall
   **tonight** (i.e. tomorrow's date on the calendar). A yahrzeit and its
   memorial candle start at sundown, so a strictly "today" digest would tell
   people the morning *after* the candle should have been lit. This block is the
   eve-before reminder, folded in.
3. **Later in the week:** — **Sundays only**, tomorrow through Saturday,
   de-duplicated against the earlier blocks so nothing is said twice.
4. **A yahrzeit is a week away** — yahrzeits falling **exactly seven days** from
   today. This is the retired reminder's second daily call (`?lead=7`), folded in
   too. The old cron ran that endpoint *twice* a day — once at the default
   `lead=1` for tonight's candle and once at `lead=7` — so carrying over only the
   eve-before would have silently deleted the week's notice the moment you switch
   the old schedule off. A week is the notice people actually arrange a minyan
   around; keep it.

`has_content` is true only when at least one block has something in it. **Gate
the workflow on it** — on a quiet day the digest deliberately has no message and
nothing should be sent.

Response:

```json
{
  "date": "2026-09-13",
  "timezone": "Asia/Jerusalem",
  "is_sunday": true,
  "has_content": true,
  "counts": { "today": 2, "tonight": 1, "later_this_week": 1 },
  "today": [
    {
      "date": "2026-09-13",
      "icon": "🎂",
      "text": "Dina Levi's 42nd birthday",
      "kind": "event",
      "event_type": "birthday",
      "event_id": 12,
      "gathering_id": null,
      "person_id": 7,
      "person_name": "Dina Levi",
      "years_since": 42
    }
  ],
  "tonight": [ "… same shape …" ],
  "later_this_week": [ "… same shape …" ],
  "message": "🗓️ *Today in the family* — Sunday, September 13\n\n🎂 Dina Levi's 42nd birthday\n…",
  "recipients": ["+14155551234", "+441632960123"]
}
```

`message` is the only field you have to send; the three arrays are the same
content in structured form, for auditing or for composing your own wording.

### Which day is "today"

Decided in the deployment's timezone — `TZ` (see "What you need"), reported back
as `timezone`. Never in UTC: with `TZ=Asia/Jerusalem`, UTC is still on the
previous day between midnight and 03:00 local, and a Saturday-evening UTC
reading of a Sunday morning would silently drop the week-ahead block.

### Recipients: opt in as a family member

`/api/digest/daily` builds `recipients` from **one** source: members of *that
family* who have a phone number and notifications enabled. It does **not** read
`DIGEST_RECIPIENTS`.

That is deliberate, and it is a fix rather than an omission. `DIGEST_RECIPIENTS`
is a single deployment-wide list, so it is applied to every family: the moment a
second, unrelated family exists on the instance, the operator's own phone starts
receiving that family's private birthdays and yahrzeits. **A deployment-wide
recipient list cannot be correct on a multi-family deployment.** So whoever wants
the digest — the maintainer included — joins the family as a member with a phone
number and nudges enabled (section 1). The two legacy feeds below still honour
`DIGEST_RECIPIENTS`, because self-hosters' running workflows depend on it.

## 4. The legacy feeds (still live)

Three earlier `N8N_TOKEN` feeds remain, unchanged, for deployments whose
workflows already call them:

| Route | What it returns |
|---|---|
| `/api/events/today` | today's events as structured JSON, no message text |
| `/api/digest/week` | a "This week in the family" message for the next 8 days |
| `/api/reminders/yahrzeit` | a yahrzeit reminder; `?lead=1` (default) = the candle is lit this evening, `?lead=7` = a week-ahead heads-up |

`/api/digest/daily` replaces the pair of crons that called `/api/digest/week`
weekly and `/api/reminders/yahrzeit` nightly. If you switch to it, delete those
two schedules — otherwise the family gets the same yahrzeit twice.

### /api/events/today feed

Already deployed as part of the app. Every family is isolated — you must pass
`?family=<id>` (see "Multi-family n8n loop" below for how to discover the
list of family ids). Example:

```
curl -H 'Authorization: Bearer $N8N_TOKEN' \
  'https://<calendar-domain>/api/events/today?family=1'
```

Returns:

```json
{
  "date": "2026-04-17",
  "events": [
    {
      "person_id": 7,
      "person_name": "Dina Levi",
      "nickname": null,
      "person_phone": "+14155551234",
      "family_branch": "Levi",
      "event_type": "birthday",
      "event_type_label": null,
      "years_since": 42,
      "hebrew_date": "1 Iyyar 5745",
      "gregorian_date": "2026-04-17",
      "note": null,
      "date_type": "hebrew"
    }
  ]
}
```

Only people with `notifications_enabled = true` appear.

## 5. Multi-family loop

If your instance hosts more than one family, the workflow has to fetch each
family separately — a single call cannot return them all, by design. A
workflow that calls a feed route with no `family` id gets a 400
(`family parameter required`).

There is a companion route for exactly this:

```
GET /api/families
Authorization: Bearer <N8N_TOKEN>
```

Returns every family in the system:

```json
{ "families": [ { "id": 1, "name": "The Levi Family" }, { "id": 2, "name": "..." } ] }
```

Structure the workflow as a two-stage fetch:

1. **First**, call `GET /api/families` once at the top of the run.
2. **Then**, loop over `families[]` (n8n **Split In Batches** or a **Loop
   Over Items** node) and, for each family id, call the feed endpoint with
   `?family=<id>` appended — `/api/digest/daily?family=<id>` (or, on a legacy
   workflow, `/api/events/today?family=<id>`, `/api/digest/week?family=<id>`,
   `/api/reminders/yahrzeit?family=<id>`).
   Each family's results (events, recipients, message text) stay scoped to
   that family — don't merge recipient lists across families, since a
   family's WhatsApp nudge should never leak another family's people/dates
   into its message.
3. Everything downstream (sending the message, logging it) runs once per
   family — nested inside the per-family loop.

## 6. The daily n8n workflow

Architecture — per the "dumb pipe" pattern: **Luach composes the message; n8n
only schedules the fetch and fans it out.** One workflow, one schedule, and no
message wording inside n8n at all.

Nodes:

1. **Schedule Trigger** — `0 8 * * *`, timezone `Asia/Jerusalem` (or your
   family's). Set the *workflow's* timezone too, so the cron and the calendar
   agree about when a day starts.
2. **HTTP Request** — `GET https://<calendar-domain>/api/families` with header
   `Authorization: Bearer {{ $env.N8N_TOKEN }}` — returns every family to
   iterate (see section 5 above).
3. **Split Out / Loop Over Items** — one item per entry in `families[]`.
4. **HTTP Request** — `GET /api/digest/daily?family={{ $json.id }}` with header
   `Authorization: Bearer {{ $env.N8N_TOKEN }}`.
5. **If** — continue only when `{{ $json.has_content }}` is true. A quiet day
   ends here; the digest has no message and nothing should be sent.
6. **Split Out** on `recipients` — one item per phone number, carrying the
   family's `message` with it.
7. **HTTP Request** — `POST https://<evolution-domain>/message/sendText/family-nudges`
   with headers `apikey: <AUTHENTICATION_API_KEY>`, body:
   ```json
   {
     "number": "{{ $json.recipients }}",
     "text": "{{ $json.message }}"
   }
   ```
8. **Append an audit row** to wherever you keep logs — a Google Sheet, an
   Airtable base, a database table. Suggested columns: `date, family_id,
   recipient, counts_today, counts_tonight, counts_later, message_body,
   send_status`. Keep `family_id` in there so the trail stays traceable once
   more than one family is live.

**This one job replaces two.** It supersedes the Sunday-evening
`/api/digest/week` workflow and the nightly `/api/reminders/yahrzeit` workflow:
the Sunday look-ahead is the digest's third block and the eve-before yahrzeit
reminder is its second. Deactivate those two schedules when you switch, or the
same yahrzeit goes out twice.

Keep the message itself clean — no debug output. Anomalies (a family with no
recipients, a failed send) belong in the audit log, not in the WhatsApp body.

## 7. Kill switch

Per person: edit them, uncheck **Send WhatsApp nudges to this person**.

Globally: delete / disable the cron trigger node in n8n. The feed itself stays
live; nothing polls it.

## 8. Verification checklist

- `/api/families` with a valid bearer returns 200 + JSON list including every
  active family.
- `/api/digest/daily?family=<id>` with a valid bearer returns 200 + JSON, and
  `timezone` in the response is the zone you meant (not `UTC` by accident).
- Same endpoint without `family` returns 400; with an unknown `family` id
  returns 404; with a bad/missing token returns 401.
- On a day you know is quiet, `has_content` is false and `message` is empty.
- `recipients` holds exactly the members you expect — and nobody who is not a
  member of that family.
- Run it on a Sunday: `is_sunday` is true and `later_this_week` is populated. Run
  it on any other day: `later_this_week` is empty.
- Evolution API test curl above delivers to your own number.
- n8n workflow, manually triggered, delivers a test message — for every
  family, not just one (once the multi-family loop from section 5 is built).
- The old weekly-digest and nightly-yahrzeit workflows are deactivated.
- Schedule the cron and watch for 3 consecutive days: messages arrive, audit
  sheet has a row per family per send, no errors in n8n execution log.
