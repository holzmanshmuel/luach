/**
 * Marketing route-group layout.
 *
 * This is intentionally a thin passthrough. Route groups still nest inside the
 * app's single ROOT layout (src/app/layout.tsx), which already supplies the
 * <html lang/dir>, the four brand fonts, the UserPrefsProvider, and the
 * BuiltByHolzman footer. The app "chrome" (the calendar Header, toolbars, etc.)
 * lives in individual page.tsx files — never in the root layout — so there is
 * nothing app-specific to strip here. We keep this file purely so the marketing
 * pages have their own segment boundary (and a place to grow shared marketing
 * chrome later) without introducing a second root layout, which would duplicate
 * <html> and force full page reloads between the app and marketing trees.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
