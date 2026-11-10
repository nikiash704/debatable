import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/** Order key strictly between a and b (null = open end). Robust to equal/inverted neighbours. */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) return generateKeyBetween(a, null);
  return generateKeyBetween(a, b);
}

export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (a !== null && b !== null && a >= b) return generateNKeysBetween(a, null, n);
  return generateNKeysBetween(a, b, n);
}

export function byOrder<T extends { order: string; id: string }>(x: T, y: T): number {
  if (x.order < y.order) return -1;
  if (x.order > y.order) return 1;
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
}
