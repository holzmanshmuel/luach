'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { generateCardsAction, type CardBundle } from './actions';

export function CardsClient() {
  const [cards, setCards] = useState<CardBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const generate = (print: boolean) => {
    setError(null);
    startTransition(async () => {
      const res = await generateCardsAction();
      if (res.error) { setError(res.error); return; }
      setCards(res.cards ?? []);
      if (print) setTimeout(() => window.print(), 500);
    });
  };

  if (!cards) {
    return (
      <div className="max-w-xl mx-auto">
        <h1 className="font-display text-3xl font-semibold mb-4">Family cards</h1>
        <p className="text-sm text-stone-600 mb-6">
          Generating creates a <strong>fresh</strong> personal magic link for every
          family member and renders one printable card each. Each QR, when scanned,
          opens the calendar and logs the recipient in automatically.
        </p>
        <p className="text-xs text-stone-500 mb-6">
          Regenerating <strong>revokes</strong> everyone’s previous personal links (old
          printed cards stop working); personal links also expire after a year. Revoke
          individual tokens any time from{' '}
          <Link href="/admin/access" className="text-accent underline">/admin/access</Link>.
        </p>
        {error && <p className="text-sm text-red-700 bg-red-50 rounded-md px-3 py-2 mb-4">{error}</p>}
        <div className="flex gap-3 items-center">
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={pending}
            className="sig-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            🏷️ {pending ? 'Generating…' : 'Generate & Print'}
          </button>
          <button
            type="button"
            onClick={() => generate(false)}
            disabled={pending}
            className="inline-flex items-center gap-2 border border-warm-border rounded-xl px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
          >
            Preview without printing
          </button>
          <Link href="/" className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-ink ml-auto">
            ← Back
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="mb-8 text-center print-hide">
        <h1 className="font-display text-2xl font-semibold">Family Cards</h1>
        <p className="text-xs text-stone-500 mt-1">
          {cards.length} cards generated. Use your browser’s print dialog to print them.
        </p>
        <Link href="/" className="text-xs text-stone-500 hover:text-ink underline mt-3 inline-block">
          ← Back to calendar
        </Link>
      </header>

      <div className="card-sheet">
        {cards.map(({ id, name, nickname, family_branch, photo_url, qrPng }) => {
          const rawName = name.replace(/~[^~]+$/, '').replace(/\\/g, '');
          return (
            <div key={id} className="card-cell">
              <div className="text-[11px] tracking-widest uppercase text-stone-500">
                {family_branch || ''}
              </div>
              <div className="flex flex-col items-center gap-2">
                {photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo_url} alt={rawName} className="w-24 h-24 rounded-full object-cover border-4 border-white shadow" />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-stone-200 flex items-center justify-center text-2xl font-semibold text-stone-600">
                    {rawName.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                  </div>
                )}
                <div className="font-display text-lg font-semibold leading-tight">{rawName}</div>
                {nickname && <div className="text-xs text-stone-500 italic">&quot;{nickname}&quot;</div>}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrPng} alt={`${rawName} magic link`} width={140} height={140} />
              <div className="text-[9px] text-stone-400 tracking-wide text-center leading-snug">
                Scan to open the family calendar.<br />
                If it stops working, ask your family admin for a fresh link.
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
