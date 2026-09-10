import { describe, it, expect } from 'vitest';
import { resolveServerActionOrigins } from './server-action-origins';

/**
 * Regression cover for a production outage: every Server Action in the app was
 * rejected with "Invalid Server Actions request", because the Cloudflare Worker in
 * front of the origin forwards `x-forwarded-host` as the internal hostname while
 * the browser sends the public one. Pages and sign-in kept working — only edits
 * died — so the site looked fine from the outside.
 */
describe('resolveServerActionOrigins', () => {
  it('derives the public host from NEXTAUTH_URL, so a correct deployment needs no new setting', () => {
    expect(resolveServerActionOrigins({ NEXTAUTH_URL: 'https://calendar.example.test' }))
      .toEqual(['calendar.example.test']);
  });

  it('accepts several hostnames, for a deployment answering on more than one', () => {
    expect(
      resolveServerActionOrigins({
        SERVER_ACTIONS_ALLOWED_ORIGINS: 'old.example.test, new.example.test',
        NEXTAUTH_URL: 'https://new.example.test',
      })
    ).toEqual(['old.example.test', 'new.example.test']);
  });

  it('takes a bare host as readily as a full origin', () => {
    expect(resolveServerActionOrigins({ SERVER_ACTIONS_ALLOWED_ORIGINS: 'example.test' }))
      .toEqual(['example.test']);
  });

  it('keeps the port — example.test and example.test:3000 are different hosts to Next', () => {
    expect(resolveServerActionOrigins({ NEXTAUTH_URL: 'http://localhost:3000' }))
      .toEqual(['localhost:3000']);
  });

  it('drops path, query and trailing slash, keeping only the host', () => {
    expect(resolveServerActionOrigins({ NEXTAUTH_URL: 'https://calendar.example.test/app?x=1' }))
      .toEqual(['calendar.example.test']);
  });

  it('returns nothing when nothing is configured — Next falls back to same-origin only', () => {
    expect(resolveServerActionOrigins({})).toEqual([]);
    expect(resolveServerActionOrigins({ NEXTAUTH_URL: '' })).toEqual([]);
  });

  it('ignores one malformed entry instead of poisoning the whole list', () => {
    expect(
      resolveServerActionOrigins({
        SERVER_ACTIONS_ALLOWED_ORIGINS: 'good.example.test, :::, ',
      })
    ).toEqual(['good.example.test']);
  });

  it('de-duplicates when the two variables name the same host', () => {
    expect(
      resolveServerActionOrigins({
        SERVER_ACTIONS_ALLOWED_ORIGINS: 'calendar.example.test',
        NEXTAUTH_URL: 'https://calendar.example.test',
      })
    ).toEqual(['calendar.example.test']);
  });
});
