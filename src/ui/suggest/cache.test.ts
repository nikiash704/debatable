import { describe, expect, it } from "vitest";
import { Lru } from "./cache";

describe("Lru", () => {
  it("evicts the least recently used entry", () => {
    const c = new Lru<number>(2);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1); // a is now the most recent
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
    expect(c.size).toBe(2);
  });
  it("stores empty strings (a known 'no suggestion')", () => {
    const c = new Lru<string>(2);
    c.set("k", "");
    expect(c.get("k")).toBe("");
    expect(c.get("missing")).toBeUndefined();
  });
  it("overwrites without growing", () => {
    const c = new Lru<number>(2);
    c.set("a", 1);
    c.set("a", 2);
    expect(c.size).toBe(1);
    expect(c.get("a")).toBe(2);
  });
});
