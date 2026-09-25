import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy — Family Calendar',
  description:
    'What the Hebrew-English Family Calendar stores, why, and your rights.',
};

/**
 * Public privacy page. Listed in the proxy allowlist (src/proxy.ts) alongside
 * /welcome so it renders for signed-out visitors — a privacy policy has to be
 * readable before anyone signs in. English-only by design (it is a legal-ish
 * document with one canonical wording), rendered LTR regardless of the lang
 * cookie, and styled with the same parchment/ink Signal palette as /welcome.
 */
export default function PrivacyPage() {
  const sections: { lead: string; body: React.ReactNode }[] = [
    {
      lead: 'What we store.',
      body: (
        <>
          Your Google account name and email — used for sign-in only (we request
          the minimal scopes; we never see your Google calendar or contacts).
          Family member details entered by your family’s admin: names, dates
          (birthdays, anniversaries, yahrzeits), and optional phone numbers.
          Your language preference.
        </>
      ),
    },
    {
      lead: 'Why.',
      body: (
        <>
          To run your family’s shared calendar. That’s the only use — no ads, no
          analytics, no tracking cookies, and your data is never sold or shared.
        </>
      ),
    },
    {
      lead: 'WhatsApp messages.',
      body: (
        <>
          Families can turn on an optional weekly digest and reminders, sent
          only to numbers a family admin added with nudges enabled. Any member
          can ask their admin — or us — to turn theirs off, anytime.
        </>
      ),
    },
    {
      lead: 'Where it lives.',
      body: <>In a secured database, accessible only to the app and its operator.</>,
    },
    {
      lead: 'Your rights.',
      body: (
        <>
          View, correct, or delete your family’s information anytime from within
          the app, or email us and we’ll handle it.
        </>
      ),
    },
    {
      lead: 'Who we are.',
      body: (
        <>
          Family Calendar is built and run by Holzman AI &amp; Automations
          (Shmuel Holzman) ·{' '}
          <a
            href="mailto:shmuel@holzman.ai"
            className="ennote text-ink-muted hover:text-ink transition-colors"
          >
            shmuel@holzman.ai
          </a>
        </>
      ),
    },
  ];

  return (
    <main dir="ltr" className="min-h-screen bg-parchment text-ink-2">
      <div className="mx-auto w-full max-w-3xl px-5 py-16 sm:py-24">
        <div className="sig-star text-5xl mb-6 text-center" aria-hidden="true">
          ✡
        </div>

        <h1 className="font-display text-3xl sm:text-4xl font-medium text-ink text-center">
          Privacy
        </h1>

        <p className="mt-3 text-center text-sm font-semibold text-ink-muted">
          Last updated: July 17, 2026
        </p>

        <section className="mt-12 space-y-4">
          {sections.map((s) => (
            <div
              key={s.lead}
              className="bg-parchment-card border border-warm-border rounded-lg p-5"
            >
              <p className="text-sm sm:text-base text-ink-2 leading-relaxed">
                <strong className="font-semibold text-ink">{s.lead}</strong>{' '}
                {s.body}
              </p>
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
