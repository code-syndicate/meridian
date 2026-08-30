import { test, expect, describe } from "bun:test"
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  needsRehash,
  MINIMUM_LENGTH,
} from "../../../src/domain/identity/password"
import { IdentityError } from "../../../src/domain/identity/errors"

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof IdentityError) return error.code
    throw error
  }
  throw new Error("expected a throw")
}

describe("validatePasswordPolicy", () => {
  test("accepts a long passphrase", () => {
    expect(() => validatePasswordPolicy("correct horse battery staple 7")).not.toThrow()
  })

  test("requires at least eight characters", () => {
    expect(MINIMUM_LENGTH).toBe(8)
    expect(codeOf(() => validatePasswordPolicy("shor1t"))).toBe("weak_password")
  })

  test("accepts exactly the minimum length", () => {
    expect(() => validatePasswordPolicy("abcdefg1")).not.toThrow()
  })

  test("requires a number", () => {
    expect(codeOf(() => validatePasswordPolicy("onlyletters"))).toBe("weak_password")
  })

  test("requires a letter", () => {
    expect(codeOf(() => validatePasswordPolicy("12345678"))).toBe("weak_password")
  })

  test("a long passphrase still needs a digit, which is the cost of the rule", () => {
    expect(codeOf(() => validatePasswordPolicy("thequickbrownfoxjumps"))).toBe("weak_password")
  })

  test("rejects an empty password", () => {
    expect(codeOf(() => validatePasswordPolicy(""))).toBe("weak_password")
  })

  test("caps length so a huge input cannot burn CPU in the hash", () => {
    expect(codeOf(() => validatePasswordPolicy("a".repeat(1025)))).toBe("weak_password")
  })
})

describe("hashPassword", () => {
  test("produces an argon2id hash", async () => {
    expect(await hashPassword("correct horse battery staple 7")).toStartWith("$argon2id$")
  })

  test("never returns the password itself", async () => {
    const password = "correct horse battery staple 7"
    expect(await hashPassword(password)).not.toContain(password)
  })

  test("salts, so the same password hashes differently each time", async () => {
    const a = await hashPassword("correct horse battery staple 7")
    const b = await hashPassword("correct horse battery staple 7")
    expect(a).not.toBe(b)
  })
})

describe("verifyPassword", () => {
  test("accepts the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple 7")
    expect(await verifyPassword("correct horse battery staple 7", hash)).toBe(true)
  })

  test("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple 7")
    expect(await verifyPassword("wrong horse battery staple", hash)).toBe(false)
  })

  test("returns false rather than throwing on a malformed hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false)
  })

  test("returns false on an empty hash", async () => {
    expect(await verifyPassword("anything", "")).toBe(false)
  })
})

describe("needsRehash", () => {
  test("accepts a current argon2id hash", async () => {
    expect(needsRehash(await hashPassword("correct horse battery staple 7"))).toBe(false)
  })

  test("flags a bcrypt hash for upgrade", () => {
    expect(needsRehash("$2b$12$abcdefghijklmnopqrstuv")).toBe(true)
  })

  test("flags a hash with a weaker memory cost", () => {
    expect(needsRehash("$argon2id$v=19$m=4096,t=2,p=1$abc$def")).toBe(true)
  })
})
