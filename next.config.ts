import type { NextConfig } from 'next';

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

const nextConfig: NextConfig = {
  output: 'standalone',
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
