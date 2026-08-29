import { test, expect, describe } from "bun:test"
import {
  validateName, validateDateOfBirth, normalizeNigerianPhone,
  validateGovernmentId, validateState,
} from "../../../src/domain/kyc/validate"
import { NIGERIAN_STATES } from "../../../src/domain/kyc/nigeria"
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

describe("normalizeNigerianPhone", () => {
  test("normalizes a local format", () => { expect(normalizeNigerianPhone("08031234567")).toBe("+2348031234567") })
  test("normalizes an international format", () => { expect(normalizeNigerianPhone("+2348031234567")).toBe("+2348031234567") })
  test("normalizes a country code with no plus", () => { expect(normalizeNigerianPhone("2348031234567")).toBe("+2348031234567") })
  test("ignores spaces and dashes a person types", () => {
    expect(normalizeNigerianPhone("0803 123 4567")).toBe("+2348031234567")
    expect(normalizeNigerianPhone("0803-123-4567")).toBe("+2348031234567")
  })
  test("accepts every valid mobile prefix", () => {
    for (const prefix of ["070", "080", "081", "090", "091"]) {
      expect(() => normalizeNigerianPhone(`${prefix}31234567`)).not.toThrow()
    }
  })
  test("rejects a landline or invalid prefix", () => {
    expect(fieldOf(() => normalizeNigerianPhone("01234567890"))).toBe("phone")
  })
  test("rejects a number of the wrong length", () => {
    expect(fieldOf(() => normalizeNigerianPhone("0803123456"))).toBe("phone")
    expect(fieldOf(() => normalizeNigerianPhone("080312345678"))).toBe("phone")
  })
  test("rejects a non-Nigerian number", () => {
    expect(fieldOf(() => normalizeNigerianPhone("+447700900123"))).toBe("phone")
  })
})

describe("validateGovernmentId", () => {
  test("accepts an eleven digit BVN", () => { expect(validateGovernmentId("BVN", "12345678901")).toBe("12345678901") })
  test("accepts an eleven digit NIN", () => { expect(validateGovernmentId("NIN", "12345678901")).toBe("12345678901") })
  test("strips spaces a person types", () => { expect(validateGovernmentId("BVN", "123 456 789 01")).toBe("12345678901") })
  test("rejects the wrong length", () => {
    expect(fieldOf(() => validateGovernmentId("BVN", "1234567890"))).toBe("governmentId")
    expect(fieldOf(() => validateGovernmentId("BVN", "123456789012"))).toBe("governmentId")
  })
  test("rejects non-digits", () => {
    expect(fieldOf(() => validateGovernmentId("NIN", "1234567890a"))).toBe("governmentId")
  })
  test("rejects an all-zero identifier", () => {
    expect(fieldOf(() => validateGovernmentId("BVN", "00000000000"))).toBe("governmentId")
  })
})

describe("validateState", () => {
  test("accepts a real state", () => { expect(validateState("Lagos")).toBe("Lagos") })
  test("accepts the Federal Capital Territory", () => {
    expect(validateState("Federal Capital Territory")).toBe("Federal Capital Territory")
  })
  test("rejects anything not in the reference list", () => {
    expect(fieldOf(() => validateState("Atlantis"))).toBe("state")
  })
})

describe("NIGERIAN_STATES", () => {
  test("lists 36 states plus the Federal Capital Territory", () => {
    expect(NIGERIAN_STATES).toHaveLength(37)
  })
  test("contains no duplicates", () => {
    expect(new Set(NIGERIAN_STATES).size).toBe(NIGERIAN_STATES.length)
  })
  test("is sorted, so a dropdown is navigable", () => {
    expect([...NIGERIAN_STATES]).toEqual([...NIGERIAN_STATES].sort())
  })
})
