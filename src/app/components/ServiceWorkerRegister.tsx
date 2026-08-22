'use client';

import { useEffect } from 'react';

// Registers the hand-written /sw.js service worker (see public/sw.js).
// Production-only and feature-detected so dev stays clean (no stale SW
// caching your live-reloaded build) and older browsers no-op safely.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }

    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service worker registration failed:', err);
    });
  }, []);

  return null;
}
