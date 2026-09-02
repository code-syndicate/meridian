import { get, run } from "../../src/db"
import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../src/db"
import { freshDb, createUser } from "../support/fixtures"

let db: Client
let userId: number

beforeEach(async () => {
  db = await freshDb()
  userId = await createUser(db)
})

describe("audit_log", () => {
  test("rejects updating a row", async () => {
    await run(db, `INSERT INTO audit_log (user_id, actor_type, action, created_at)
       VALUES (?, 'user', 'login', '2026-01-01')`, [userId])
    await expect(run(db, "UPDATE audit_log SET action = 'x'")).rejects.toThrow(/append-only/)
  })

  test("rejects deleting a row", async () => {
    await run(db, `INSERT INTO audit_log (user_id, actor_type, action, created_at)
       VALUES (?, 'user', 'login', '2026-01-01')`, [userId])
    await expect(run(db, "DELETE FROM audit_log")).rejects.toThrow(/append-only/)
  })

  test("rejects an unknown actor type", async () => {
    await expect(run(db, `INSERT INTO audit_log (user_id, actor_type, action, created_at)
           VALUES (?, 'robot', 'login', '2026-01-01')`, [userId])).rejects.toThrow()
  })

  test("allows a system actor with no user", async () => {
    await run(db, `INSERT INTO audit_log (user_id, actor_type, action, created_at)
           VALUES (NULL, 'system', 'startup', '2026-01-01')`)
  })
})

describe("sessions", () => {
  test("stores a session keyed by its opaque id", async () => {
    await run(db, `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
       VALUES ('abc', ?, '2026-01-01', '2026-01-01', '2026-02-01')`, [userId])
    expect(await get(db, "SELECT id FROM sessions WHERE id = 'abc'")).toMatchObject({ id: "abc" })
  })

  test("rejects a session with no user", async () => {
    await expect(run(db, `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
           VALUES ('x', NULL, '2026-01-01', '2026-01-01', '2026-02-01')`)).rejects.toThrow()
  })

  test("rejects a duplicate session id", async () => {
    const insert = `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
                    VALUES ('dup', ?, '2026-01-01', '2026-01-01', '2026-02-01')`
    await run(db, insert, [userId])
    await expect(run(db, insert, [userId])).rejects.toThrow()
  })
})

describe("email_tokens", () => {
  test("rejects an unknown purpose", async () => {
    await expect(run(db, `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
           VALUES ('h', ?, 'nonsense', '2026-02-01', '2026-01-01')`, [userId])).rejects.toThrow()
  })

  test("accepts the two real purposes", async () => {
    for (const purpose of ["verify_email", "reset_password"]) {
      await run(db, `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
             VALUES (?, ?, ?, '2026-02-01', '2026-01-01')`, [`hash-${purpose}`, userId, purpose])
    }
  })
})
