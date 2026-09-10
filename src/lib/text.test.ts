import { describe, it, expect } from "vitest";
import { oneLine } from "@/lib/text";

describe("oneLine", () => {
  it("leaves ordinary single-line text unchanged", () => {
    expect(oneLine("Sarah Cohen")).toBe("Sarah Cohen");
  });

  it("collapses embedded newlines to a single space (line-injection defense)", () => {
    // An editor smuggling a newline + a fake line must NOT produce a new line.
    const malicious = "Sarah\n\u2022 injected fake event";
    const result = oneLine(malicious);
    expect(result).not.toContain("\n");
    expect(result).toBe("Sarah \u2022 injected fake event");
  });

  it("strips carriage returns, tabs, and CRLF", () => {
    expect(oneLine("a\r\nb\tc")).toBe("a b c");
  });

  it("collapses runs of whitespace/control chars into one space", () => {
    expect(oneLine("a\n\n\n   b")).toBe("a b");
  });

  it("trims leading and trailing whitespace/controls", () => {
    expect(oneLine("\n  hello  \r\n")).toBe("hello");
  });

  it("removes C0/C1 control characters (constructed, not literal)", () => {
    const nul = String.fromCharCode(0x00);
    const c1 = String.fromCharCode(0x85); // C1 NEL
    expect(oneLine(`a${nul}${c1}b`)).toBe("a b");
  });

  it("keeps emoji and non-ASCII (Hebrew) intact", () => {
    expect(oneLine("\u05e9\u05e8\u05d4 \ud83d\udd6f\ufe0f")).toBe("\u05e9\u05e8\u05d4 \ud83d\udd6f\ufe0f");
  });
});

/**
 * Bidirectional overrides let stored text lie about its own order: one invisible
 * U+202E reverses everything after it, so a gathering location or a person's name
 * can render as something quite different from what is stored. In a Hebrew/English
 * calendar, where mixed-direction text is entirely normal, nobody would look twice —
 * and because the characters are invisible, a reviewer reading the broadcast cannot
 * see why it renders wrongly.
 */
describe('bidirectional and zero-width controls', () => {
  it('strips the right-to-left override', () => {
    expect(oneLine('Kiddush ‮gnorw sdaer')).toBe('Kiddush gnorw sdaer');
  });

  it('strips every explicit bidi formatting character', () => {
    for (const c of ['‪', '‫', '‬', '‭', '‮',
                     '⁦', '⁧', '⁨', '⁩', '‎', '‏']) {
      expect(oneLine(`before${c}after`)).toBe('beforeafter');
    }
  });

  it('strips zero-width characters used to hide or split text', () => {
    for (const c of ['​', '‌', '‍', '﻿']) {
      expect(oneLine(`Sha${c}bbos`)).toBe('Shabbos');
    }
  });

  it('removes them without leaving a gap, unlike control characters', () => {
    // A newline becomes a space (it separated words); an invisible override did
    // not, so padding there would corrupt the visible text.
    expect(oneLine('one\ntwo')).toBe('one two');
    expect(oneLine('one‮two')).toBe('onetwo');
  });

  it('leaves real Hebrew and Arabic alone — this strips control, not language', () => {
    expect(oneLine('משפחת לוי')).toBe('משפחת לוי');
    expect(oneLine('סעודה שלישית')).toBe('סעודה שלישית');
    expect(oneLine('🎂 יום הולדת')).toBe('🎂 יום הולדת');
  });

  it('still collapses a smuggled newline into one line', () => {
    expect(oneLine('Kiddush\n‮🕯️ Yahrzeit')).toBe('Kiddush 🕯️ Yahrzeit');
  });
});
