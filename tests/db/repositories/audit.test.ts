import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { AuditRepository } from "../../../src/db/repositories/audit"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let audit: AuditRepository
let userId: number

beforeEach(() => {
  db = freshDb()
  audit = new AuditRepository(db)
  userId = createUser(db)
})

describe("record", () => {
  test("writes an entry and returns its id", () => {
    expect(audit.record({ userId, actorType: "user", action: "login" })).toBeGreaterThan(0)
  })

  test("stores metadata as structured data", () => {
    audit.record({ userId, actorType: "user", action: "login", metadata: { method: "password", twoFactor: true } })
    expect(audit.forUser(userId, 10)[0]!.metadata).toEqual({ method: "password", twoFactor: true })
  })

  test("captures request context", () => {
    audit.record({ userId, actorType: "user", action: "login", ip: "203.0.113.4", userAgent: "Firefox" })
    const entry = audit.forUser(userId, 10)[0]!
    expect(entry.ip).toBe("203.0.113.4")
    expect(entry.userAgent).toBe("Firefox")
  })

  test("accepts a system entry with no user", () => {
    expect(() => audit.record({ actorType: "system", action: "startup" })).not.toThrow()
  })
})

describe("forUser", () => {
  test("returns most recent first", () => {
    audit.record({ userId, actorType: "user", action: "first" })
    audit.record({ userId, actorType: "user", action: "second" })
    expect(audit.forUser(userId, 10)[0]!.action).toBe("second")
  })

  test("respects the limit", () => {
    for (let i = 0; i < 10; i++) audit.record({ userId, actorType: "user", action: `a-${i}` })
    expect(audit.forUser(userId, 3)).toHaveLength(3)
  })

  test("excludes other users' entries", () => {
    const other = createUser(db, "other@test.co")
    audit.record({ userId: other, actorType: "user", action: "theirs" })
    audit.record({ userId, actorType: "user", action: "mine" })
    expect(audit.forUser(userId, 10).map((e) => e.action)).toEqual(["mine"])
  })

  test("never returns a secret-bearing field", () => {
    audit.record({ userId, actorType: "user", action: "login" })
    const keys = Object.keys(audit.forUser(userId, 10)[0]!)
    expect(keys).not.toContain("password")
    expect(keys).not.toContain("token")
  })
})
