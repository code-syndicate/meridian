import { KycError, type GovernmentIdType } from "./types"
import { COUNTRIES, findCountry } from "./countries"

// Letters from any script, plus space, hyphen, and apostrophe. Names are not
// ASCII and a validator that assumes they are will reject real people.
const NAME_PATTERN = /^[\p{L}][\p{L} '-]*$/u


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

/**
 * E.164. Country-specific formats are the verification provider's job, not
 * ours: hard-coding one country's prefixes is what made this Nigeria-only.
 */
export function normalizePhone(value: string): string {
  const cleaned = value.replace(/[\s()./-]/g, "")
  if (!/^\+\d{8,15}$/.test(cleaned)) {
    throw new KycError("phone", "Enter your number in international format, starting with +")
  }
  return cleaned
}

const ID_LABELS: Record<GovernmentIdType, string> = {
  PASSPORT: "passport number",
  NATIONAL_ID: "national ID number",
  DRIVERS_LICENSE: "driver's licence number",
}

export function idLabel(type: GovernmentIdType): string {
  return ID_LABELS[type]
}

/**
 * Format varies by country and document, so this checks shape only. The
 * verification provider validates the document itself.
 */
export function validateGovernmentId(type: GovernmentIdType, value: string): string {
  const cleaned = value.replace(/[\s-]/g, "").toUpperCase()
  if (!/^[A-Z0-9]{6,20}$/.test(cleaned)) {
    throw new KycError("governmentId", `Enter a valid ${ID_LABELS[type]}`)
  }
  if (/^0+$/.test(cleaned)) {
    throw new KycError("governmentId", `Enter a valid ${ID_LABELS[type]}`)
  }
  return cleaned
}

export function validateCountry(code: string): string {
  if (!findCountry(code)) throw new KycError("country", "Choose a country from the list")
  return code
}

export function validateRegion(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new KycError("region", "Enter your state, province, or region")
  if (trimmed.length > 100) throw new KycError("region", "That is too long")
  return trimmed
}

export { COUNTRIES }
