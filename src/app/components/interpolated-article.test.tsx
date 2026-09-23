import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Interpolated, InterpolatedMany } from './Interpolated';
import { T, fillTemplate, templateParts, withoutRepeatedArticle } from '@/lib/translations';

/**
 * # "You're invited to the The Levi Family calendar" (HOLZMAN-201)
 *
 * The English invite copy puts the family name inside "the … calendar", and the
 * onboarding form's own placeholder suggests naming the family "The Levy Family".
 * So a family that took the hint read a doubled article on every page a relative
 * sees when invited. The name is data (the family typed it) and the sentence is a
 * translation — neither is wrong on its own — so the rule lives where they meet:
 * when the text right before a value already ends in "the", the value's own
 * leading "The" is dropped.
 */

const strip = (html: string) => html.replace(/<[^>]+>/g, '');
const DOUBLED = /\bthe\s+the\b/i;

describe('withoutRepeatedArticle', () => {
  it('drops the value\'s "The" when the text before it already says "the"', () => {
    expect(withoutRepeatedArticle('invited to the ', 'The Levi Family')).toBe('Levi Family');
  });

  it('also at the start of a sentence ("The {family} calendar…")', () => {
    expect(withoutRepeatedArticle('The ', 'The Levi Family')).toBe('Levi Family');
  });

  it('keeps a name that has no article of its own', () => {
    expect(withoutRepeatedArticle('invited to the ', 'Levi')).toBe('Levi');
  });

  it('keeps "The" when nothing before it says "the"', () => {
    expect(withoutRepeatedArticle('Welcome, ', 'The Levi Family')).toBe('The Levi Family');
    expect(withoutRepeatedArticle('ליומן של ', 'The Levi Family')).toBe('The Levi Family');
  });

  it('only matches whole words', () => {
    // "breathe " ends in the letters t-h-e, and "Theodore" starts with them.
    expect(withoutRepeatedArticle('breathe ', 'The Levi Family')).toBe('The Levi Family');
    expect(withoutRepeatedArticle('invited to the ', 'Theodore')).toBe('Theodore');
  });
});

describe('no English sentence renders "the The …"', () => {
  // Every English template with a placeholder directly after "the " — today the six
  // invite/joined strings, and any sentence written the same way later.
  const THE_SLOT = /\bthe\s+\{([A-Za-z_][A-Za-z0-9_]*)\}/i;
  const keys = Object.keys(T.en).filter(k => THE_SLOT.test(T.en[k]));

  it('finds the sentences it is guarding', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'invite_land.title',
        'invite_confirm.title',
        'invite_member.title',
        'invite_expired.body',
        'invite_revoked.body',
        'joined.title',
      ])
    );
  });

  it.each(keys)('%s through <Interpolated>', key => {
    const placeholder = T.en[key].match(THE_SLOT)![1];
    const text = strip(
      renderToStaticMarkup(
        <Interpolated template={T.en[key]} placeholder={placeholder} value="The Levi Family" />
      )
    );
    expect(text).not.toMatch(DOUBLED);
    expect(text).toContain('Levi Family');
  });

  it.each(keys)('%s through <InterpolatedMany>', key => {
    const params = Object.fromEntries(
      templateParts(T.en[key]).flatMap(p => ('placeholder' in p ? [[p.placeholder, 'The Levi Family']] : []))
    );
    const text = strip(renderToStaticMarkup(<InterpolatedMany template={T.en[key]} params={params} />));
    expect(text).not.toMatch(DOUBLED);
  });

  it.each(keys)('%s through fillTemplate', key => {
    const params = Object.fromEntries(
      templateParts(T.en[key]).flatMap(p => ('placeholder' in p ? [[p.placeholder, 'The Levi Family']] : []))
    );
    expect(fillTemplate(T.en[key], params)).not.toMatch(DOUBLED);
  });

  it('reads naturally in the invite headline', () => {
    const text = strip(
      renderToStaticMarkup(
        <Interpolated template={T.en['invite_land.title']} placeholder="family" value="The Levi Family" />
      )
    );
    expect(text).toBe('You’re invited to the Levi Family calendar');
  });

  it('leaves the Hebrew sentence and a name without an article exactly as they were', () => {
    const he = strip(
      renderToStaticMarkup(
        <Interpolated template={T.he['invite_land.title']} placeholder="family" value="The Levi Family" />
      )
    );
    expect(he).toBe('הוזמנתם ליומן של The Levi Family');
    const plain = strip(
      renderToStaticMarkup(<Interpolated template={T.en['joined.title']} placeholder="family" value="Levi" />)
    );
    expect(plain).toBe('You are in the Levi calendar');
  });
});
