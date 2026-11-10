/**
 * Room codes (spec 01): 5 characters, permanent, no look-alike characters.
 * Excluded: 0/O and 1/I/L. 31 symbols ^ 5 ≈ 28.6 million codes.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function generateCode(random: (n: number) => Uint8Array = randomBytes): string {
  let out = "";
  // Rejection sampling keeps the distribution uniform (256 is not a multiple of 31).
  const limit = 256 - (256 % CODE_ALPHABET.length);
  while (out.length < CODE_LENGTH) {
    for (const b of random(CODE_LENGTH * 2)) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** Upper-cases, drops spaces/dashes/slashes. Returns null if the result is not a valid code. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return CODE_RE.test(s) ? s : null;
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(code);
}

function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}
