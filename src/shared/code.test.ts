import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, generateCode, isValidCode, normalizeCode } from "./code";

describe("room codes", () => {
  it("are 5 characters with no look-alikes", () => {
    for (const bad of ["0", "O", "1", "I", "L"]) expect(CODE_ALPHABET).not.toContain(bad);
    for (let i = 0; i < 500; i++) {
      const c = generateCode();
      expect(c).toHaveLength(5);
      expect(isValidCode(c)).toBe(true);
    }
  });
  it("normalize user input", () => {
    expect(normalizeCode(" k7f-2q ")).toBe("K7F2Q");
    expect(normalizeCode("abcde")).toBe("ABCDE");
    expect(normalizeCode("ab0de")).toBeNull();
    expect(normalizeCode("abcd")).toBeNull();
  });
});
