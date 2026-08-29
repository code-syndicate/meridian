import { KycError, type GovernmentIdType } from "./types"
import { NIGERIAN_STATES } from "./nigeria"

// Letters from any script, plus space, hyphen, and apostrophe. Names are not
// ASCII and a validator that assumes they are will reject real people.
const NAME_PATTERN = /^[\p{L}][\p{L} '-]*$/u
const MOBILE_PREFIXES = ["70", "80", "81", "90", "91"]

export function validateName(value: string, field: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ")
  if (trimmed.length === 0) throw new KycError(field, "This field is required")
  if (trimmed.length > 100) throw new KycError(field, "This name is too long")
  if (!NAME_PATTERN.test(trimmed)) {
    throw new KycError(field, "Use letters, spaces, hyphens, and apostrophes only")
  }
  return trimmed
}

export function validateDateOfBirth(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new KycError("dateOfBirth", "Enter a date as YYYY-MM-DD")
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new KycError("dateOfBirth", "That is not a real date")
  }

  const now = new Date()
  if (date > now) throw new KycError("dateOfBirth", "That date is in the future")

  const eighteenth = new Date(date)
  eighteenth.setUTCFullYear(eighteenth.getUTCFullYear() + 18)
  if (eighteenth > now) {
    throw new KycError("dateOfBirth", "You must be 18 or older to open an account")
  }

  const oldest = new Date(now)
  oldest.setUTCFullYear(oldest.getUTCFullYear() - 120)
  if (date < oldest) throw new KycError("dateOfBirth", "Check that date of birth")

  return value
}

export function normalizeNigerianPhone(value: string): string {
  const digits = value.replace(/[\s()-]/g, "")

  let national: string
  if (/^\+234\d{10}$/.test(digits)) national = digits.slice(4)
  else if (/^234\d{10}$/.test(digits)) national = digits.slice(3)
  else if (/^0\d{10}$/.test(digits)) national = digits.slice(1)
  else throw new KycError("phone", "Enter a Nigerian mobile number")

  if (!MOBILE_PREFIXES.includes(national.slice(0, 2))) {
    throw new KycError("phone", "Enter a Nigerian mobile number")
  }
  return `+234${national}`
}

export function validateGovernmentId(type: GovernmentIdType, value: string): string {
  const digits = value.replace(/[\s-]/g, "")
  if (!/^\d{11}$/.test(digits)) throw new KycError("governmentId", `Your ${type} is 11 digits`)
  if (/^0+$/.test(digits)) throw new KycError("governmentId", `That is not a valid ${type}`)
  return digits
}

export function validateState(value: string): string {
  if (!(NIGERIAN_STATES as readonly string[]).includes(value)) {
    throw new KycError("state", "Choose a state from the list")
  }
  return value
}
