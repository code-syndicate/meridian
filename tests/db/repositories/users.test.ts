import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../../src/db"
import { UserRepository } from "../../../src/db/repositories/users"
import { hashPassword } from "../../../src/domain/identity/password"
import { freshDb } from "../../support/fixtures"

let db: Client
let users: UserRepository
let hash: string

beforeEach(async () => {
  db = await freshDb()
  users = new UserRepository(db)
  hash = await hashPassword("correct horse battery staple 7")
})

describe("create", () => {
  test("returns a new id", async () => {
    expect(await users.create("a@test.co", hash)).toBeGreaterThan(0)
  })

  test("starts unverified, with no totp and tier zero", async () => {
    const user = (await users.findById(await users.create("a@test.co", hash)))!
    expect(user.emailVerifiedAt).toBeNull()
    expect(user.totpEnabledAt).toBeNull()
    expect(user.kycTier).toBe(0)
    expect(user.status).toBe("active")
  })

  test("rejects a duplicate email", async () => {
    await users.create("a@test.co", hash)
    await expect(users.create("a@test.co", hash)).rejects.toThrow()
  })

  test("rejects a duplicate email differing only in case", async () => {
    await users.create("a@test.co", hash)
    await expect(users.create("A@TEST.CO", hash)).rejects.toThrow()
  })

  test("preserves the address as typed while matching case insensitively", async () => {
    await users.create("Someone@Test.CO", hash)
    expect((await users.findByEmail("someone@test.co"))!.email).toBe("Someone@Test.CO")
  })
})

describe("findByEmail", () => {
  test("returns null for an unknown address", async () => {
    expect(await users.findByEmail("nobody@test.co")).toBeNull()
  })

  test("exposes the password hash for verification", async () => {
    await users.create("a@test.co", hash)
    expect((await users.findByEmail("a@test.co"))!.passwordHash).toBe(hash)
  })
})

describe("findById", () => {
  test("does not expose the password hash", async () => {
    const user = (await users.findById(await users.create("a@test.co", hash)))!
    expect(user).not.toHaveProperty("passwordHash")
  })
})

describe("mutations", () => {
  test("marks email verified", async () => {
    const id = await users.create("a@test.co", hash)
    await users.markEmailVerified(id)
    expect((await users.findById(id))!.emailVerifiedAt).not.toBeNull()
  })

  test("replaces the password hash", async () => {
    const id = await users.create("a@test.co", hash)
    const next = await hashPassword("a completely different passphrase")
    await users.setPasswordHash(id, next)
    expect((await users.findByEmail("a@test.co"))!.passwordHash).toBe(next)
  })

  test("stores and reads back an encrypted totp secret", async () => {
    const id = await users.create("a@test.co", hash)
    await users.setTotpSecret(id, "encrypted-payload")
    expect(await users.getTotpSecret(id)).toBe("encrypted-payload")
  })

  test("enabling totp records the time", async () => {
    const id = await users.create("a@test.co", hash)
    await users.setTotpSecret(id, "encrypted-payload")
    await users.enableTotp(id)
    expect((await users.findById(id))!.totpEnabledAt).not.toBeNull()
  })

  test("disabling totp clears both the flag and the secret", async () => {
    const id = await users.create("a@test.co", hash)
    await users.setTotpSecret(id, "encrypted-payload")
    await users.enableTotp(id)
    await users.disableTotp(id)
    expect((await users.findById(id))!.totpEnabledAt).toBeNull()
    expect(await users.getTotpSecret(id)).toBeNull()
  })
})
