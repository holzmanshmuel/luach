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
