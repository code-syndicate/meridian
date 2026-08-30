import { test, expect, describe } from "bun:test"
import {
  validateName, validateDateOfBirth, normalizePhone,
  validateGovernmentId, validateCountry, validateRegion,
} from "../../../src/domain/kyc/validate"
import { COUNTRIES, findCountry } from "../../../src/domain/kyc/countries"
import { KycError } from "../../../src/domain/kyc/types"

function fieldOf(fn: () => unknown): string {
  try { fn() } catch (error) {
    if (error instanceof KycError) return error.field
    throw error
  }
  throw new Error("expected a throw")
}

describe("validateName", () => {
  test("accepts a normal name", () => { expect(validateName("Chidinma", "firstName")).toBe("Chidinma") })
  test("trims surrounding whitespace", () => { expect(validateName("  Adebayo  ", "firstName")).toBe("Adebayo") })
  test("accepts hyphens, apostrophes, and spaces", () => {
    expect(validateName("Ade-Bayo", "firstName")).toBe("Ade-Bayo")
    expect(validateName("O'Brien", "lastName")).toBe("O'Brien")
    expect(validateName("Van der Berg", "lastName")).toBe("Van der Berg")
  })
  test("accepts non-ascii letters, because names have them", () => {
    expect(validateName("Ògúnkúnlé", "lastName")).toBe("Ògúnkúnlé")
  })
  test("rejects an empty name", () => { expect(fieldOf(() => validateName("", "firstName"))).toBe("firstName") })
  test("rejects digits", () => { expect(fieldOf(() => validateName("Ade2", "firstName"))).toBe("firstName") })
  test("rejects an absurdly long name", () => {
    expect(fieldOf(() => validateName("a".repeat(101), "firstName"))).toBe("firstName")
  })
})

describe("validateDateOfBirth", () => {
  function yearsAgo(years: number): string {
    const d = new Date()
    d.setUTCFullYear(d.getUTCFullYear() - years)
    return d.toISOString().slice(0, 10)
  }
  test("accepts an adult", () => { expect(validateDateOfBirth(yearsAgo(30))).toBe(yearsAgo(30)) })
  test("accepts someone who turned eighteen today", () => {
    expect(() => validateDateOfBirth(yearsAgo(18))).not.toThrow()
  })
  test("rejects someone under eighteen", () => {
    expect(fieldOf(() => validateDateOfBirth(yearsAgo(17)))).toBe("dateOfBirth")
  })
  test("rejects a future date", () => {
    expect(fieldOf(() => validateDateOfBirth("2099-01-01"))).toBe("dateOfBirth")
  })
  test("rejects an implausible age", () => {
    expect(fieldOf(() => validateDateOfBirth("1850-01-01"))).toBe("dateOfBirth")
  })
  test("rejects a malformed date", () => {
    expect(fieldOf(() => validateDateOfBirth("not-a-date"))).toBe("dateOfBirth")
    expect(fieldOf(() => validateDateOfBirth("2000-13-45"))).toBe("dateOfBirth")
  })
})

describe("normalizePhone", () => {
  test("accepts E.164 from any country", () => {
    expect(normalizePhone("+2348031234567")).toBe("+2348031234567")
    expect(normalizePhone("+447700900123")).toBe("+447700900123")
    expect(normalizePhone("+14155552671")).toBe("+14155552671")
    expect(normalizePhone("+6591234567")).toBe("+6591234567")
  })
  test("strips separators a person types", () => {
    expect(normalizePhone("+44 7700 900-123")).toBe("+447700900123")
    expect(normalizePhone("+1 (415) 555.2671")).toBe("+14155552671")
  })
  test("requires the leading plus, so the country is never guessed", () => {
    expect(fieldOf(() => normalizePhone("07700900123"))).toBe("phone")
    expect(fieldOf(() => normalizePhone("447700900123"))).toBe("phone")
  })
  test("rejects an implausible length", () => {
    expect(fieldOf(() => normalizePhone("+1234567"))).toBe("phone")
    expect(fieldOf(() => normalizePhone("+1234567890123456"))).toBe("phone")
  })
  test("rejects non-digits", () => {
    expect(fieldOf(() => normalizePhone("+44abc900123"))).toBe("phone")
  })
})

describe("validateGovernmentId", () => {
  test("accepts a passport number", () => {
    expect(validateGovernmentId("PASSPORT", "A01234567")).toBe("A01234567")
  })
  test("accepts a national ID number", () => {
    expect(validateGovernmentId("NATIONAL_ID", "12345678901")).toBe("12345678901")
  })
  test("accepts a driver licence", () => {
    expect(validateGovernmentId("DRIVERS_LICENSE", "SMITH901234AB")).toBe("SMITH901234AB")
  })
  test("normalises case and strips separators", () => {
    expect(validateGovernmentId("PASSPORT", "a0 12-34567")).toBe("A01234567")
  })
  test("rejects something too short or too long", () => {
    expect(fieldOf(() => validateGovernmentId("PASSPORT", "A123"))).toBe("governmentId")
    expect(fieldOf(() => validateGovernmentId("PASSPORT", "A".repeat(21)))).toBe("governmentId")
  })
  test("rejects punctuation that is not a separator", () => {
    expect(fieldOf(() => validateGovernmentId("NATIONAL_ID", "1234$5678901"))).toBe("governmentId")
  })
  test("rejects an all-zero identifier", () => {
    expect(fieldOf(() => validateGovernmentId("NATIONAL_ID", "00000000000"))).toBe("governmentId")
  })
})

describe("validateCountry", () => {
  test("accepts a supported country code", () => {
    expect(validateCountry("GB")).toBe("GB")
    expect(validateCountry("NG")).toBe("NG")
    expect(validateCountry("SG")).toBe("SG")
  })
  test("rejects an unsupported or invented code", () => {
    expect(fieldOf(() => validateCountry("ZZ"))).toBe("country")
    expect(fieldOf(() => validateCountry(""))).toBe("country")
  })
})

describe("validateRegion", () => {
  test("accepts and trims a region", () => {
    expect(validateRegion("  Greater London ")).toBe("Greater London")
  })
  test("rejects an empty region", () => {
    expect(fieldOf(() => validateRegion("   "))).toBe("region")
  })
  test("rejects an absurdly long region", () => {
    expect(fieldOf(() => validateRegion("a".repeat(101)))).toBe("region")
  })
})

describe("COUNTRIES", () => {
  test("spans several regions rather than one market", () => {
    const codes = COUNTRIES.map((c) => c.code)
    for (const code of ["GB", "CA", "NG", "SG", "BR", "DE", "JP"]) {
      expect(codes).toContain(code)
    }
  })
  test("uses unique ISO codes", () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length)
  })
  test("is sorted by code, so a dropdown is navigable", () => {
    const codes = COUNTRIES.map((c) => c.code)
    expect([...codes]).toEqual([...codes].sort())
  })
  test("every country carries a dial code", () => {
    for (const c of COUNTRIES) expect(c.dial.startsWith("+")).toBe(true)
  })
  test("findCountry returns null for an unknown code", () => {
    expect(findCountry("ZZ")).toBeNull()
  })
})
