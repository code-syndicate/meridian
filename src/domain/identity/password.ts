import { IdentityError } from "./errors"

export const MINIMUM_LENGTH = 12
const MAXIMUM_LENGTH = 1024

// OWASP's current Argon2id guidance. Raising these later is fine: needsRehash
// detects the older parameters and login upgrades the stored hash in place.
const MEMORY_COST = 19456
const TIME_COST = 2

export function validatePasswordPolicy(password: string): void {
  if (password.length < MINIMUM_LENGTH) {
    throw new IdentityError(
      "weak_password",
      `Password must be at least ${MINIMUM_LENGTH} characters`,
    )
  }
  if (password.length > MAXIMUM_LENGTH) {
    throw new IdentityError(
      "weak_password",
      `Password must be at most ${MAXIMUM_LENGTH} characters`,
    )
  }
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: MEMORY_COST,
    timeCost: TIME_COST,
  })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false
  try {
    return await Bun.password.verify(password, hash)
  } catch {
    // A malformed stored hash is a data problem, not a reason to 500 a login.
    return false
  }
}

export function needsRehash(hash: string): boolean {
  if (!hash.startsWith("$argon2id$")) return true
  const memory = hash.match(/m=(\d+)/)?.[1]
  const time = hash.match(/t=(\d+)/)?.[1]
  if (!memory || !time) return true
  return Number(memory) < MEMORY_COST || Number(time) < TIME_COST
}
