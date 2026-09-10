import type { NextConfig } from 'next';
import { resolveServerActionOrigins } from './src/lib/server-action-origins';

/**
 * Baseline security headers applied to every route.
 *
 * NOTE on CSP: intentionally ONLY `frame-ancestors 'none'` (clickjacking
 * defense — pairs with X-Frame-Options: DENY). We deliberately do NOT set
 * default-src/script-src/style-src: Next.js emits inline bootstrap scripts and
 * styles (and the PWA needs them), which a restrictive CSP would break.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
];

/**
 * Origins allowed to invoke Server Actions.
 *
 * Behind a reverse proxy the browser's `origin` and the forwarded
 * `x-forwarded-host` never match, and Next aborts every Server Action as a CSRF
 * risk — which kills every edit in the app while leaving pages and sign-in
 * working, so the site looks healthy. See src/lib/server-action-origins.ts.
 *
 * ⚠️ **This alone does not fix the hosted deployment, and did not.** The list is
 * resolved during `next build` and baked into the standalone output — but this image
 * is built from a Dockerfile that declares no build arg for `NEXTAUTH_URL`, so at
 * build time it resolves EMPTY and the setting silently does nothing. The real repair
 * happens at runtime in `src/proxy.ts`, which rewrites `x-forwarded-host` to the
 * configured public host. This stays for deployments that DO have the variable at
 * build time (`next start` from a plain checkout, Vercel, a Dockerfile with the arg),
 * where it is the documented and more direct fix.
 */
const allowedOrigins = resolveServerActionOrigins(process.env);

const nextConfig: NextConfig = {
  output: 'standalone',
  ...(allowedOrigins.length > 0
    ? { experimental: { serverActions: { allowedOrigins } } }
    : {}),
  // Drop the informational `x-powered-by: Next.js` header (LOW: fingerprinting).
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
