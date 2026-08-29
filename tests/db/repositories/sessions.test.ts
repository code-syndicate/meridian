import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { SessionRepository } from "../../../src/db/repositories/sessions"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let sessions: SessionRepository
let userId: number

beforeEach(() => {
  db = freshDb()
  sessions = new SessionRepository(db)
  userId = createUser(db)
})

const ctx = { ip: "203.0.113.4", userAgent: "Firefox" }

describe("create", () => {
  test("returns a 256-bit base64url id", () => {
    const id = sessions.create(userId, ctx)
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(id, "base64url")).toHaveLength(32)
  })

  test("is opaque: the id encodes nothing about the user", () => {
    // Two users' ids must be indistinguishable. Generating many and finding
    // no shared prefix or suffix is a real check; searching for a digit in a
    // random string is not.
    const other = createUser(db, "other@test.co")
    const mine = Array.from({ length: 20 }, () => sessions.create(userId, ctx))
    const theirs = Array.from({ length: 20 }, () => sessions.create(other, ctx))

    const prefixes = new Set([...mine, ...theirs].map((id) => id.slice(0, 4)))
    expect(prefixes.size).toBe(40)

    for (const id of [...mine, ...theirs]) {
      expect(id).not.toContain(`:${userId}`)
      expect(id).not.toContain(`:${other}`)
    }
  })

  test("returns a different id every time", () => {
    expect(sessions.create(userId, ctx)).not.toBe(sessions.create(userId, ctx))
  })

  test("records request context", () => {
    const session = sessions.find(sessions.create(userId, ctx))!
    expect(session.ip).toBe("203.0.113.4")
    expect(session.userAgent).toBe("Firefox")
  })
})

describe("find", () => {
  test("returns null for an unknown id", () => {
    expect(sessions.find("nope")).toBeNull()
  })

  test("returns null for a revoked session", () => {
    const id = sessions.create(userId, ctx)
    sessions.revoke(id)
    expect(sessions.find(id)).toBeNull()
  })

  test("returns null for an expired session", () => {
    const id = sessions.create(userId, ctx)
    db.query("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id)
    expect(sessions.find(id)).toBeNull()
  })
})

describe("revocation", () => {
  test("revokeAllFor revokes every active session and reports the count", () => {
    sessions.create(userId, ctx)
    sessions.create(userId, ctx)
    expect(sessions.revokeAllFor(userId)).toBe(2)
    expect(sessions.listActive(userId)).toHaveLength(0)
  })

  test("revokeAllFor leaves other users alone", () => {
    const other = createUser(db, "other@test.co")
    const theirs = sessions.create(other, ctx)
    sessions.create(userId, ctx)
    sessions.revokeAllFor(userId)
    expect(sessions.find(theirs)).not.toBeNull()
  })

  test("revoking twice is harmless", () => {
    const id = sessions.create(userId, ctx)
    sessions.revoke(id)
    expect(() => sessions.revoke(id)).not.toThrow()
  })
})

describe("listActive", () => {
  test("lists only active sessions, newest first", () => {
    const first = sessions.create(userId, ctx)
    const second = sessions.create(userId, ctx)
    sessions.revoke(first)
    expect(sessions.listActive(userId).map((s) => s.id)).toEqual([second])
  })
})

describe("touch", () => {
  test("advances last seen", () => {
    const id = sessions.create(userId, ctx)
    db.query("UPDATE sessions SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id)
    sessions.touch(id)
    expect(sessions.find(id)!.lastSeenAt).not.toBe("2020-01-01T00:00:00.000Z")
  })
})
