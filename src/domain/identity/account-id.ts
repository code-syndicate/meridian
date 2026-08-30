/**
 * Crockford base32 without I, L, O, or U: no character pairs that are
 * mistaken for one another when read aloud or copied off a screen, and no
 * accidental words.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const LENGTH = 10

export function generateAccountId(random: (n: number) => Uint8Array): string {
  const bytes = random(LENGTH)
  let out = ""
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length]
  }
  return out
}

/** Accepts what a user is likely to paste: spaces, dashes, and lower case. */
export function normalizeAccountId(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/I/g, "1")
    .replace(/L/g, "1")
    .replace(/O/g, "0")
}

export function looksLikeAccountId(input: string): boolean {
  const normalized = normalizeAccountId(input)
  return normalized.length === LENGTH && [...normalized].every((c) => ALPHABET.includes(c))
}

/** Grouped for reading and dictating: XXXXX-XXXXX. */
export function formatAccountId(id: string): string {
  return `${id.slice(0, 5)}-${id.slice(5)}`
}
