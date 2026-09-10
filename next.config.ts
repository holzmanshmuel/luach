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
 * ⚠️ Read at BUILD time: `next build` bakes the resolved list into the standalone
 * output, so changing the variable needs a redeploy, not a restart.
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
