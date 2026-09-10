import type { Metadata, Viewport } from 'next';
import { Space_Grotesk, Inter, IBM_Plex_Mono, Heebo } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { UserPrefsProvider } from '@/app/components/UserPrefsContext';
import { ServiceWorkerRegister } from '@/app/components/ServiceWorkerRegister';
import { InstallPrompt } from '@/app/components/InstallPrompt';
import { BuiltByHolzman } from '@/app/components/BuiltByHolzman';
import { establishTenant } from '@/lib/auth';
import { familyBranches } from '@/lib/branches-server';
import { getViewerSpelling } from '@/lib/spellings';
import type { Lang } from '@/lib/translations';

// Display / headings — geometric sans (Holzman "Signal" brand)
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display-latin',
  display: 'swap',
});

// Body — clean, even sans
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans-latin',
  display: 'swap',
});

// Mono — uppercase tracked-out labels / eyebrows / data
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-signal',
  display: 'swap',
});

// Hebrew body + display sans — the Hebrew counterpart to Inter / Space Grotesk
const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  variable: '--font-heebo',
  display: 'swap',
});

// Product name: "Hebrew-English Family Calendar" (full) / "Luach" (short / home-screen).
// Keep in sync with public/manifest.webmanifest (name / short_name).
export const metadata: Metadata = {
  title: 'Hebrew-English Family Calendar',
  description: 'Every birthday, anniversary and yahrzeit — in both Hebrew and Gregorian dates, shared with the whole family.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    title: 'Luach',
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  themeColor: '#1D4ED8',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const langCookie = cookieStore.get('lang')?.value;
  const lang: Lang = langCookie === 'he' ? 'he' : 'en';
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  // Soft-establish tenant context for this render. Returns null for a signed-out
  // viewer (login/offline/etc.) OR a signed-in user without a live membership —
  // both render as a guest. On success it has called enterTenant(), so the
  // tenant-scoped getViewerSpelling() query below is safe (previously this was
  // gated on session cookie fields alone, which would 500 once sign-in went live
  // because no tenant context had actually been entered).
  const tenant = await establishTenant();
  // owner ⇒ admin surfaces; owner/editor ⇒ edit affordances; viewer ⇒ neither.
  const isAdmin = tenant?.role === 'owner';
  const canEdit = tenant?.role === 'owner' || tenant?.role === 'editor';
  // getViewerSpelling() reads tenant-scoped data — only fetch it once a family is
  // genuinely established (tenant != null). Public routes have no tenant, so
  // spelling preferences simply don't apply there.
  const vs = tenant
    ? await getViewerSpelling()
    : { variants: {}, chosen: {} };

  return (
    <html
      lang={lang}
      dir={dir}
      className={`h-full ${spaceGrotesk.variable} ${inter.variable} ${plexMono.variable} ${heebo.variable}`}
    >
      <body className="min-h-full antialiased">
        <ServiceWorkerRegister />
        <UserPrefsProvider
          language={lang}
          isAdmin={isAdmin}
          canEdit={canEdit}
          // Read here, on the server, and handed down as a prop: FAMILY_BRANCHES
          // is a runtime variable and does not exist in the browser bundle. This
          // is the single point where the configured list enters the UI.
          branches={familyBranches()}
          spellings={vs.chosen}
          branchVariants={vs.variants}
        >
          {children}
          <BuiltByHolzman lang={lang} />
          <InstallPrompt />
        </UserPrefsProvider>
      </body>
    </html>
  );
}
