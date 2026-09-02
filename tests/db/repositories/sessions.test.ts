import { run } from "../../../src/db"
import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../../src/db"
import { SessionRepository } from "../../../src/db/repositories/sessions"
import { freshDb, createUser } from "../../support/fixtures"

let db: Client
let sessions: SessionRepository
let userId: number

beforeEach(async () => {
  db = await freshDb()
  sessions = new SessionRepository(db)
  userId = await createUser(db)
})

const ctx = { ip: "203.0.113.4", userAgent: "Firefox" }

describe("create", () => {
  test("returns a 256-bit base64url id", async () => {
    const id = await sessions.create(userId, ctx)
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(id, "base64url")).toHaveLength(32)
  })

  test("is opaque: the id encodes nothing about the user", async () => {
    // Two users' ids must be indistinguishable. Generating many and finding
    // no shared prefix or suffix is a real check; searching for a digit in a
    // random string is not.
    const other = await createUser(db, "other@test.co")
    const mine = await Promise.all(Array.from({ length: 20 }, () => sessions.create(userId, ctx)))
    const theirs = await Promise.all(Array.from({ length: 20 }, () => sessions.create(other, ctx)))

    const prefixes = new Set([...mine, ...theirs].map((id) => id.slice(0, 4)))
    expect(prefixes.size).toBe(40)

    for (const id of [...mine, ...theirs]) {
      expect(id).not.toContain(`:${userId}`)
      expect(id).not.toContain(`:${other}`)
    }
  })

  test("returns a different id every time", async () => {
    expect(await sessions.create(userId, ctx)).not.toBe(await sessions.create(userId, ctx))
  })

  test("records request context", async () => {
    const session = (await sessions.find(await sessions.create(userId, ctx)))!
    expect(session.ip).toBe("203.0.113.4")
    expect(session.userAgent).toBe("Firefox")
  })
})

describe("find", () => {
  test("returns null for an unknown id", async () => {
    expect(await sessions.find("nope")).toBeNull()
  })

  test("returns null for a revoked session", async () => {
    const id = await sessions.create(userId, ctx)
    await sessions.revoke(id)
    expect(await sessions.find(id)).toBeNull()
  })

  test("returns null for an expired session", async () => {
    const id = await sessions.create(userId, ctx)
    await run(db, "UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [id])
    expect(await sessions.find(id)).toBeNull()
  })
})

describe("revocation", () => {
  test("revokeAllFor revokes every active session and reports the count", async () => {
    await sessions.create(userId, ctx)
    await sessions.create(userId, ctx)
    expect(await sessions.revokeAllFor(userId)).toBe(2)
    expect(await sessions.listActive(userId)).toHaveLength(0)
  })

  test("revokeAllFor leaves other users alone", async () => {
    const other = await createUser(db, "other@test.co")
    const theirs = await sessions.create(other, ctx)
    await sessions.create(userId, ctx)
    await sessions.revokeAllFor(userId)
    expect(await sessions.find(theirs)).not.toBeNull()
  })

  test("revoking twice is harmless", async () => {
    const id = await sessions.create(userId, ctx)
    await sessions.revoke(id)
    await sessions.revoke(id)
  })
})

describe("listActive", () => {
  test("lists only active sessions, newest first", async () => {
    const first = await sessions.create(userId, ctx)
    const second = await sessions.create(userId, ctx)
    await sessions.revoke(first)
    expect((await sessions.listActive(userId)).map((s) => s.id)).toEqual([second])
  })
})

describe("touch", () => {
  test("advances last seen", async () => {
    const id = await sessions.create(userId, ctx)
    await run(db, "UPDATE sessions SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [id])
    await sessions.touch(id)
    expect((await sessions.find(id))!.lastSeenAt).not.toBe("2020-01-01T00:00:00.000Z")
  })
})
