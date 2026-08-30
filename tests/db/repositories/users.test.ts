import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { UserRepository } from "../../../src/db/repositories/users"
import { hashPassword } from "../../../src/domain/identity/password"
import { freshDb } from "../../support/fixtures"

let db: Database
let users: UserRepository
let hash: string

beforeEach(async () => {
  db = freshDb()
  users = new UserRepository(db)
  hash = await hashPassword("correct horse battery staple 7")
})

describe("create", () => {
  test("returns a new id", () => {
    expect(users.create("a@test.co", hash)).toBeGreaterThan(0)
  })

  test("starts unverified, with no totp and tier zero", () => {
    const user = users.findById(users.create("a@test.co", hash))!
    expect(user.emailVerifiedAt).toBeNull()
    expect(user.totpEnabledAt).toBeNull()
    expect(user.kycTier).toBe(0)
    expect(user.status).toBe("active")
  })

  test("rejects a duplicate email", () => {
    users.create("a@test.co", hash)
    expect(() => users.create("a@test.co", hash)).toThrow()
  })

  test("rejects a duplicate email differing only in case", () => {
    users.create("a@test.co", hash)
    expect(() => users.create("A@TEST.CO", hash)).toThrow()
  })

  test("preserves the address as typed while matching case insensitively", () => {
    users.create("Someone@Test.CO", hash)
    expect(users.findByEmail("someone@test.co")!.email).toBe("Someone@Test.CO")
  })
})

describe("findByEmail", () => {
  test("returns null for an unknown address", () => {
    expect(users.findByEmail("nobody@test.co")).toBeNull()
  })

  test("exposes the password hash for verification", () => {
    users.create("a@test.co", hash)
    expect(users.findByEmail("a@test.co")!.passwordHash).toBe(hash)
  })
})

describe("findById", () => {
  test("does not expose the password hash", () => {
    const user = users.findById(users.create("a@test.co", hash))!
    expect(user).not.toHaveProperty("passwordHash")
  })
})

describe("mutations", () => {
  test("marks email verified", () => {
    const id = users.create("a@test.co", hash)
    users.markEmailVerified(id)
    expect(users.findById(id)!.emailVerifiedAt).not.toBeNull()
  })

  test("replaces the password hash", async () => {
    const id = users.create("a@test.co", hash)
    const next = await hashPassword("a completely different passphrase")
    users.setPasswordHash(id, next)
    expect(users.findByEmail("a@test.co")!.passwordHash).toBe(next)
  })

  test("stores and reads back an encrypted totp secret", () => {
    const id = users.create("a@test.co", hash)
    users.setTotpSecret(id, "encrypted-payload")
    expect(users.getTotpSecret(id)).toBe("encrypted-payload")
  })

  test("enabling totp records the time", () => {
    const id = users.create("a@test.co", hash)
    users.setTotpSecret(id, "encrypted-payload")
    users.enableTotp(id)
    expect(users.findById(id)!.totpEnabledAt).not.toBeNull()
  })

  test("disabling totp clears both the flag and the secret", () => {
    const id = users.create("a@test.co", hash)
    users.setTotpSecret(id, "encrypted-payload")
    users.enableTotp(id)
    users.disableTotp(id)
    expect(users.findById(id)!.totpEnabledAt).toBeNull()
    expect(users.getTotpSecret(id)).toBeNull()
  })
})
