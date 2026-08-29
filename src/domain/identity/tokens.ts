import { randomBytes, createHash } from "node:crypto"

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

/**
 * Email tokens are stored hashed. A leaked database therefore does not hand
 * an attacker a working password-reset link. SHA-256 is right here rather
 * than Argon2id: the token is already 256 bits of entropy, so there is
 * nothing to brute force and no reason to pay the cost.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
