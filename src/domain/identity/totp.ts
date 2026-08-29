import * as OTPAuth from "otpauth"
import { randomBytes } from "node:crypto"

export { encryptSecret, decryptSecret } from "./crypto"

const ISSUER = "Meridian"
const PERIOD = 30
const DIGITS = 6
// One step either side, per RFC 6238, to absorb clock drift without opening
// a meaningfully wider window.
const WINDOW = 1

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

export function generateTotpSecret(): string {
  const bytes = randomBytes(32)
  let out = ""
  for (const byte of bytes) out += BASE32[byte % 32]
  return out
}

function totpFor(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
}

export function totpUri(secret: string, email: string): string {
  return totpFor(secret, email).toString()
}

export function verifyTotp(secret: string, token: string): boolean {
  const cleaned = token.replace(/\s+/g, "")
  if (!/^\d{6}$/.test(cleaned)) return false
  try {
    return totpFor(secret, "verify").validate({ token: cleaned, window: WINDOW }) !== null
  } catch {
    return false
  }
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>()
  while (codes.size < count) {
    const bytes = randomBytes(10)
    let code = ""
    for (let i = 0; i < 10; i++) {
      code += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length]
      if (i === 4) code += "-"
    }
    codes.add(code)
  }
  return [...codes]
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return Bun.password.hash(code, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 })
}

export async function verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
  if (!hash) return false
  try {
    return await Bun.password.verify(code, hash)
  } catch {
    return false
  }
}
