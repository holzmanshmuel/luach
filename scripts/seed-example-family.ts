/**
 * Seed a fictional demo family so a fresh clone has something to look at.
 *
 * Creates the **Levi family** — three generations, every event type the app
 * knows, and an invite link you can use to join it yourself:
 *
 *   • Hebrew-only birthdays      (recur by the Hebrew date; no English date stored)
 *   • an English-date birthday   (recurs on the fixed solar date too)
 *   • a wedding anniversary
 *   • a yahrzeit                 (with the Hebrew year of death, for the Nth count)
 *   • a one-off simcha           (bar mitzvah gathering)
 *   • parent/spouse relationships across three generations, for the family tree
 *   • an alternate surname spelling (Levi / Levy), for the per-viewer spelling UI
 *   • Hebrew names on every person, for Hebrew mode
 *
 * Every person, date and phone number below is invented. Delete them once you
 * have entered your own family — or point this at a throwaway family id and keep
 * it around as a demo.
 *
 * The demo family stores its OWN branch list (`families.branches` — see
 * DEMO_BRANCHES below and migrate-v14), so its people are colour-coded no matter
 * what `FAMILY_BRANCHES` is set to on this deployment. Nothing here depends on
 * the environment any more.
 *
 * Usage:
 *   DATABASE_URL="postgres://app_user:...@localhost:5432/family_calendar" \
 *     npx tsx scripts/seed-example-family.ts
 *
 * Safe to re-run: people are matched by name and events/relationships use
 * ON CONFLICT DO NOTHING, so a second run neither duplicates nor overwrites
 * anything. The one thing each run does add is a fresh invite link — handy when
 * the last one expired, harmless otherwise (revoke spares under /admin/access).
 */
import { Pool, type PoolClient } from 'pg';
import { createHash, randomBytes } from 'crypto';

const FAMILY_NAME = 'The Levi Family';
const FAMILY_NAME_HE = 'משפחת לוי';

// The demo family's own branch list, stored on its row. Matches the branch values
// the people below carry, with the catch-all LAST (its position is what makes it
// the catch-all — see src/lib/branches.ts).
const DEMO_BRANCHES = ['Levi', 'Cohen', 'Mizrahi', 'Adler', 'Other'];

const url = process.env.DATABASE_URL ?? '';
if (!url) {
  console.error('ERROR: DATABASE_URL is required.');
  process.exit(1);
}

// SSL for managed/remote Postgres; local dev Postgres has none.
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

// Every statement runs on ONE connection so the tenant GUC below stays set. The
// data tables have FORCEd row-level security keyed on `app.current_family`, so
// without it the INSERTs are rejected by the policy — being the table owner does
// not exempt you.
let client: PoolClient;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface PersonSpec {
  name: string;          // given name(s)
  last_name: string;
  name_he: string;
  branch: string;
  nickname?: string;
  maiden_name?: string;
  phone_e164?: string;
}

async function findOrCreatePerson(p: PersonSpec): Promise<number> {
  const existing = await client.query<{ id: number }>(
    `SELECT id FROM family_calendar.family_members
      WHERE LOWER(name) = LOWER($1) AND COALESCE(LOWER(last_name), '') = COALESCE(LOWER($2), '')`,
    [p.name, p.last_name]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const res = await client.query<{ id: number }>(
    `INSERT INTO family_calendar.family_members
       (name, last_name, name_he, name_he_status, family_branch, nickname, maiden_name,
        phone_e164, notifications_enabled)
     VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      p.name,
      p.last_name,
      p.name_he,
      p.branch,
      p.nickname ?? null,
      p.maiden_name ?? null,
      p.phone_e164 ?? null,
      p.phone_e164 ? true : false,
    ]
  );
  console.log(`  + ${p.name} ${p.last_name}`);
  return res.rows[0].id;
}

interface EventSpec {
  personId: number;
  type: 'birthday' | 'anniversary' | 'yahrtzeit' | 'other';
  hebrew_day: number;
  hebrew_month: string;
  /** Hebrew year the event originates in — drives the "Nth birthday/yahrzeit" count. */
  hebrew_year?: number | null;
  /** Set ONLY for events that should ALSO recur on their fixed English date. */
  original_english_date?: string | null;
  gregorian_year?: number | null;
  note?: string | null;
}

async function addEvent(e: EventSpec): Promise<void> {
  // One event of each type per person (UNIQUE(family_member_id, event_type)),
  // so a re-run is a no-op rather than a duplicate.
  await client.query(
    `INSERT INTO family_calendar.events
       (family_member_id, event_type, hebrew_day, hebrew_month, hebrew_year,
        original_english_date, gregorian_year, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (family_member_id, event_type) DO NOTHING`,
    [
      e.personId,
      e.type,
      e.hebrew_day,
      e.hebrew_month,
      e.hebrew_year ?? null,
      e.original_english_date ?? null,
      e.gregorian_year ?? null,
      e.note ?? null,
    ]
  );
}

async function addRelationship(
  personId: number,
  relatedTo: number,
  relation: 'parent' | 'spouse'
): Promise<void> {
  await client.query(
    `INSERT INTO family_calendar.relationships (person_id, related_to, relation)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [personId, relatedTo, relation]
  );
}

/** Spouse links are stored both ways round — the tree reads them symmetrically. */
async function addMarriage(a: number, b: number): Promise<void> {
  await addRelationship(a, b, 'spouse');
  await addRelationship(b, a, 'spouse');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  client = await pool.connect();

  // 1. The family itself. `families` is one of the non-RLS tenancy tables, so
  //    this runs before any tenant context exists. feed_token is minted by the
  //    column default from migrate-v13.
  const found = await client.query<{ id: number }>(
    'SELECT id FROM family_calendar.families WHERE name = $1',
    [FAMILY_NAME]
  );
  let familyId: number;
  if (found.rows.length > 0) {
    familyId = found.rows[0].id;
    console.log(`Family "${FAMILY_NAME}" already exists (id ${familyId}) — topping it up.\n`);
  } else {
    // `branches` is set explicitly (migrate-v14) so the demo family carries its
    // OWN list and its people are colour-coded whatever `FAMILY_BRANCHES` says on
    // this deployment. Every other family stays NULL and inherits the default.
    const created = await client.query<{ id: number }>(
      'INSERT INTO family_calendar.families (name, name_he, branches) VALUES ($1, $2, $3) RETURNING id',
      [FAMILY_NAME, FAMILY_NAME_HE, DEMO_BRANCHES]
    );
    familyId = created.rows[0].id;
    console.log(`Created family "${FAMILY_NAME}" (id ${familyId}).\n`);
  }

  // 2. Enter tenant context. Everything below lands in this family and RLS keeps
  //    it there.
  await client.query("SELECT set_config('app.current_family', $1, false)", [String(familyId)]);

  console.log('People:');

  // ── Generation 1 — the grandparents ──────────────────────────────────────
  const miriam = await findOrCreatePerson({
    name: 'Miriam', last_name: 'Levi', name_he: 'מרים לוי', branch: 'Levi',
  });
  const yosef = await findOrCreatePerson({
    name: 'Yosef', last_name: 'Levi', name_he: 'יוסף לוי', branch: 'Levi',
  });

  // ── Generation 2 — a couple, one of whom married in ──────────────────────
  const david = await findOrCreatePerson({
    name: 'David', last_name: 'Levi', name_he: 'דוד לוי', branch: 'Levi',
    // A fictional number in the +1-202-555-01xx range reserved for examples.
    phone_e164: '+12025550143',
  });
  const dina = await findOrCreatePerson({
    name: 'Dina', last_name: 'Levi', name_he: 'דינה לוי', branch: 'Cohen',
    maiden_name: 'Cohen',
  });

  // ── Generation 3 — the kids ──────────────────────────────────────────────
  const noa = await findOrCreatePerson({
    name: 'Noa', last_name: 'Levi', name_he: 'נועה לוי', branch: 'Levi',
  });
  const eitan = await findOrCreatePerson({
    name: 'Eitan', last_name: 'Levi', name_he: 'איתן לוי', branch: 'Levi',
    nickname: 'Eiti',
  });

  console.log('\nEvents:');

  // Miriam — a HEBREW-ONLY birthday. No English date, so it recurs purely by the
  // Hebrew calendar and drifts against the civil year, as a Hebrew birthday does.
  await addEvent({
    personId: miriam, type: 'birthday',
    hebrew_day: 12, hebrew_month: 'Kislev', hebrew_year: 5713,
  });
  console.log('  ✓ Miriam — Hebrew birthday (12 Kislev)');

  // Yosef — a YAHRZEIT. hebrew_year is the year of death, which is what turns the
  // occurrence into "Nth yahrzeit" in the digest and reminder emails.
  await addEvent({
    personId: yosef, type: 'yahrtzeit',
    hebrew_day: 3, hebrew_month: 'Cheshvan', hebrew_year: 5779,
    note: 'Remembered at the Shabbat table.',
  });
  console.log('  ✓ Yosef — yahrzeit (3 Cheshvan 5779)');

  // David — Hebrew birthday, with the birth YEAR known, so the app can also place
  // the solar birthday and count his age.
  await addEvent({
    personId: david, type: 'birthday',
    hebrew_day: 4, hebrew_month: 'Iyyar', hebrew_year: 5738, gregorian_year: 1978,
  });
  console.log('  ✓ David — Hebrew birthday (4 Iyyar)');

  // Dina — an ENGLISH-DATE birthday. original_english_date is stored, so this one
  // also recurs every year on its fixed civil date (14 June), alongside its
  // Hebrew occurrence.
  await addEvent({
    personId: dina, type: 'birthday',
    hebrew_day: 12, hebrew_month: 'Sivan', hebrew_year: 5741,
    original_english_date: '1981-06-14', gregorian_year: 1981,
  });
  console.log('  ✓ Dina — English-date birthday (14 June 1981 = 12 Sivan)');

  // The kids.
  await addEvent({
    personId: noa, type: 'birthday',
    hebrew_day: 9, hebrew_month: 'Elul', hebrew_year: 5771, gregorian_year: 2011,
  });
  console.log('  ✓ Noa — Hebrew birthday (9 Elul)');

  await addEvent({
    personId: eitan, type: 'birthday',
    hebrew_day: 19, hebrew_month: 'Shvat', hebrew_year: 5773, gregorian_year: 2013,
  });
  console.log('  ✓ Eitan — Hebrew birthday (19 Shvat)');

  // The wedding anniversary, stored once on David with both names in the note.
  await addEvent({
    personId: david, type: 'anniversary',
    hebrew_day: 5, hebrew_month: 'Elul', hebrew_year: 5767,
    original_english_date: '2007-08-19', gregorian_year: 2007,
    note: 'David & Dina',
  });
  console.log('  ✓ David & Dina — anniversary (5 Elul)');

  // ── Relationships — three generations, for the family tree ───────────────
  console.log('\nRelationships:');
  await addMarriage(miriam, yosef);
  for (const child of [david]) {
    await addRelationship(miriam, child, 'parent');
    await addRelationship(yosef, child, 'parent');
  }
  await addMarriage(david, dina);
  for (const child of [noa, eitan]) {
    await addRelationship(david, child, 'parent');
    await addRelationship(dina, child, 'parent');
  }
  console.log('  ✓ Miriam + Yosef → David → Noa, Eitan');

  // ── A one-off simcha ─────────────────────────────────────────────────────
  // Dated relative to today so the demo always has something coming up.
  const barMitzvah = new Date();
  barMitzvah.setMonth(barMitzvah.getMonth() + 2);
  const gatherDate = barMitzvah.toISOString().slice(0, 10);
  const existingGathering = await client.query(
    `SELECT id FROM family_calendar.gatherings WHERE title = $1`,
    ["Eitan's Bar Mitzvah"]
  );
  if (existingGathering.rows.length === 0) {
    await client.query(
      `INSERT INTO family_calendar.gatherings (title, kind, gather_date, gather_time, location, description)
       VALUES ($1, 'bar_mitzvah', $2, '09:30', 'The shul, then kiddush at home',
               'Eitan leins the whole parsha. Everyone welcome.')`,
      ["Eitan's Bar Mitzvah", gatherDate]
    );
  }
  console.log(`\nGathering:\n  ✓ Eitan's Bar Mitzvah (${gatherDate})`);

  // ── An alternate surname spelling ────────────────────────────────────────
  // Half the family writes it "Levy". Both spellings are equal; each viewer picks
  // theirs under "How we spell our names" and the whole site re-renders in it.
  await client.query(
    `INSERT INTO family_calendar.branch_spellings (branch, spelling)
     VALUES ('Levi', 'Levy') ON CONFLICT (branch, spelling) DO NOTHING`
  );
  console.log('\nSpellings:\n  ✓ Levi / Levy');

  // ── An invite link, so you can actually get in ───────────────────────────
  // Only members of a family can see it, and membership is created by redeeming
  // an invite. Mint one here (same sha256 hashing as src/lib/tokens.ts) and print
  // the URL — sign in with Google, open it, and you land in the Levi family.
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  await client.query(
    `INSERT INTO family_calendar.access_tokens (token_hash, kind, invite_role, label, expires_at)
     VALUES ($1, 'invite', 'editor', $2, NOW() + INTERVAL '30 days')`,
    [tokenHash, 'Demo seed invite']
  );

  client.release();
  await pool.end();

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  console.log(`
──────────────────────────────────────────────────────────────
  Demo family seeded.

  Join it:  ${baseUrl}/join/${rawToken}

  Sign in with Google first (or the link will send you there),
  then open it — you will join "${FAMILY_NAME}" as an editor.
  The invite is valid for 30 days; mint more in the app under
  /admin/access.
──────────────────────────────────────────────────────────────
`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
