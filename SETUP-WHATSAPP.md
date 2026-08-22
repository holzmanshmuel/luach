# WhatsApp Nudges — Setup

This gives the Family Calendar a morning WhatsApp nudge for any family event
happening today. The delivery chain is:

```
Daily cron in n8n  →  GET /api/events/today  →  Claude skill composes message
                                              →  Evolution API sends WhatsApp
                                              →  Google Sheet audit log
```

Everything here is optional. The calendar works fine without it — this just
adds the push half, so relatives hear about a birthday without opening the app.

> **⚠️ These routes are multi-tenant.** The calendar can host more than one
> family, each with its own isolated data. Every `N8N_TOKEN` feed route below
> (`/api/events/today`, `/api/digest/week`, `/api/reminders/yahrzeit`)
> **requires a `?family=<id>` query param** and returns only that one family's
> data. If you run more than one family, your workflow must loop over them —
> see "Multi-family loop" below.
>
> `/api/calendar.ics` is **not** in that list: the subscribable calendar feed
> is gated by a per-family `feed_token` (`scripts/migrate-v13.sql`), so the
> token itself names the family and a `family=` param is ignored. It is a
> human subscription surface, not an n8n one.

## What you need

1. An Evolution API service on Railway (new — instructions below).
2. An n8n workflow that fires daily (new).
3. Two new environment variables on the Family Calendar service:
   - `N8N_TOKEN` — long random string. n8n sends it as `Authorization: Bearer <token>`.
   - `NEXTAUTH_URL` — your public origin, so the links inside the messages point
     at the right place.

## 1. Phone numbers on each person

1. Open the Family Calendar, go to any person, click **Edit**.
2. Under "WhatsApp nudges" enter the phone in **E.164** format, e.g.
   `+14155551234` or `+441632960123`. The server rejects anything else.
3. Toggle **Send WhatsApp nudges to this person** off if the person does not
   want to receive messages. This flag is also honoured by `/api/events/today`
   — their events will not appear in the feed.

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

## 3. /api/events/today feed

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

## 4. Multi-family loop

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
   Over Items** node) and, for each family id, call each feed endpoint with
   `?family=<id>` appended — `/api/events/today?family=<id>`,
   `/api/digest/week?family=<id>`, `/api/reminders/yahrzeit?family=<id>`.
   Each family's results (events, recipients, message text) stay scoped to
   that family — don't merge recipient lists across families, since a
   family's WhatsApp nudge should never leak another family's people/dates
   into its message.
3. Everything downstream (composing the message, sending it, logging it) runs
   once per family, per event — nested inside the per-family loop.

## 5. n8n workflow

Architecture — per the "dumb pipe" pattern: **n8n handles mechanical fetch &
send; Claude skill handles the message wording**.

Nodes:

1. **Cron trigger** — `0 8 * * *` in your family's timezone (08:00 local).
2. **HTTP Request** — `GET /api/families` with header
   `Authorization: Bearer {{ $env.N8N_TOKEN }}` — returns every family to
   iterate (see section 4 above).
3. **Split In Batches** (outer loop) — iterate over `families[]`.
4. **HTTP Request** — `GET /api/events/today?family={{$json.id}}` with header
   `Authorization: Bearer {{ $env.N8N_TOKEN }}`.
5. **Split In Batches** (inner loop) — iterate over `events[]` for the
   current family.
6. **Compose the message.** Either a plain n8n template ("🎂 It's {{name}}'s
   birthday today — {{years_since}} years!"), or an LLM call if you want the
   wording to vary. The feed gives you every field you need; a small/cheap
   model is plenty for one sentence.
7. **If** — only proceed when `event.person_phone` is not null.
8. **HTTP Request** — `POST https://<evolution-domain>/message/sendText/family-nudges`
   with headers `apikey: <AUTHENTICATION_API_KEY>`, body:
   ```json
   {
     "number": "{{$json.person_phone}}",
     "text": "{{$json.message_text}}"
   }
   ```
9. **Append an audit row** to wherever you keep logs — a Google Sheet, an
   Airtable base, a database table. Suggested columns: `date, family_id,
   recipient, event_type, years_since, message_body, send_status`. Keep
   `family_id` in there so the trail stays traceable once more than one family
   is live.

Keep the message itself clean — no debug output. Anomalies (missing phone,
skipped opt-outs) belong in the audit log, not in the WhatsApp body.

## 6. Kill switch

Per person: edit them, uncheck **Send WhatsApp nudges to this person**.

Globally: delete / disable the cron trigger node in n8n. The feed itself stays
live; nothing polls it.

## 7. Verification checklist

- `/api/families` with a valid bearer returns 200 + JSON list including every
  active family.
- `/api/events/today?family=<id>` with a valid bearer returns 200 + JSON.
- Same endpoint without `family` returns 400; with an unknown `family` id
  returns 404; with a bad/missing token returns 401.
- Evolution API test curl above delivers to your own number.
- n8n workflow, manually triggered, delivers a test message — for every
  family, not just one (once the multi-family loop from section 4 is built).
- Schedule the cron and watch for 3 consecutive days: messages arrive, audit
  sheet has 3 new rows per family, no errors in n8n execution log.
