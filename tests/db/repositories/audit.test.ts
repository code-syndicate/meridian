import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../../src/db"
import { AuditRepository } from "../../../src/db/repositories/audit"
import { freshDb, createUser } from "../../support/fixtures"

let db: Client
let audit: AuditRepository
let userId: number

beforeEach(async () => {
  db = await freshDb()
  audit = new AuditRepository(db)
  userId = await createUser(db)
})

describe("record", () => {
  test("writes an entry and returns its id", async () => {
    expect(await audit.record({ userId, actorType: "user", action: "login" })).toBeGreaterThan(0)
  })

  test("stores metadata as structured data", async () => {
    await audit.record({ userId, actorType: "user", action: "login", metadata: { method: "password", twoFactor: true } })
    expect((await audit.forUser(userId, 10))[0]!.metadata).toEqual({ method: "password", twoFactor: true })
  })

  test("captures request context", async () => {
    await audit.record({ userId, actorType: "user", action: "login", ip: "203.0.113.4", userAgent: "Firefox" })
    const entry = (await audit.forUser(userId, 10))[0]!
    expect(entry.ip).toBe("203.0.113.4")
    expect(entry.userAgent).toBe("Firefox")
  })

  test("accepts a system entry with no user", async () => {
    await audit.record({ actorType: "system", action: "startup" })
  })
})

describe("forUser", () => {
  test("returns most recent first", async () => {
    await audit.record({ userId, actorType: "user", action: "first" })
    await audit.record({ userId, actorType: "user", action: "second" })
    expect((await audit.forUser(userId, 10))[0]!.action).toBe("second")
  })

  test("respects the limit", async () => {
    for (let i = 0; i < 10; i++) await audit.record({ userId, actorType: "user", action: `a-${i}` })
    expect(await audit.forUser(userId, 3)).toHaveLength(3)
  })

  test("excludes other users' entries", async () => {
    const other = await createUser(db, "other@test.co")
    await audit.record({ userId: other, actorType: "user", action: "theirs" })
    await audit.record({ userId, actorType: "user", action: "mine" })
    expect((await audit.forUser(userId, 10)).map((e) => e.action)).toEqual(["mine"])
  })

  test("never returns a secret-bearing field", async () => {
    await audit.record({ userId, actorType: "user", action: "login" })
    const keys = (await Object).keys((await audit.forUser(userId, 10))[0]!)
    expect(keys).not.toContain("password")
    expect(keys).not.toContain("token")
  })
})
