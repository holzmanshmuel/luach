// Static offline fallback shown by the service worker when a navigation
// request fails with no network. No session/cookies use here on purpose —
// this page must stay static (prerenderable) so it can be precached at
// install time and served instantly with zero server dependency.
export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-parchment flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="sig-star text-5xl mb-4">✡</div>

        <div dir="ltr" className="mb-6">
          <h1 className="font-display text-2xl text-ink">You&apos;re offline</h1>
          <p className="text-ink-muted mt-2 text-sm">
            Family Calendar needs a connection to load your data. Check your network and try again.
          </p>
        </div>

        <div dir="rtl" lang="he" className="font-heebo">
          <h1 className="font-display text-2xl text-ink">אין חיבור לאינטרנט</h1>
          <p className="text-ink-muted mt-2 text-sm">
            לוח השנה המשפחתי זקוק לחיבור לטעינת הנתונים. בדקו את החיבור ונסו שוב.
          </p>
        </div>
      </div>
    </div>
  );
}
