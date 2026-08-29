import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { freshDb, createUser } from "../support/fixtures"

let db: Database
let userId: number

beforeEach(() => {
  db = freshDb()
  userId = createUser(db)
})

describe("audit_log", () => {
  test("rejects updating a row", () => {
    db.query(`INSERT INTO audit_log (user_id, actor_type, action, created_at)
       VALUES (?, 'user', 'login', '2026-01-01')`).run(userId)
    expect(() => db.query("UPDATE audit_log SET action = 'x'").run()).toThrow(/append-only/)
  })

  test("rejects deleting a row", () => {
    db.query(`INSERT INTO audit_log (user_id, actor_type, action, created_at)
       VALUES (?, 'user', 'login', '2026-01-01')`).run(userId)
    expect(() => db.query("DELETE FROM audit_log").run()).toThrow(/append-only/)
  })

  test("rejects an unknown actor type", () => {
    expect(() => db.query(`INSERT INTO audit_log (user_id, actor_type, action, created_at)
           VALUES (?, 'robot', 'login', '2026-01-01')`).run(userId)).toThrow()
  })

  test("allows a system actor with no user", () => {
    expect(() => db.query(`INSERT INTO audit_log (user_id, actor_type, action, created_at)
           VALUES (NULL, 'system', 'startup', '2026-01-01')`).run()).not.toThrow()
  })
})

describe("sessions", () => {
  test("stores a session keyed by its opaque id", () => {
    db.query(`INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
       VALUES ('abc', ?, '2026-01-01', '2026-01-01', '2026-02-01')`).run(userId)
    expect(db.query("SELECT id FROM sessions WHERE id = 'abc'").get()).toMatchObject({ id: "abc" })
  })

  test("rejects a session with no user", () => {
    expect(() => db.query(`INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
           VALUES ('x', NULL, '2026-01-01', '2026-01-01', '2026-02-01')`).run()).toThrow()
  })

  test("rejects a duplicate session id", () => {
    const insert = `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
                    VALUES ('dup', ?, '2026-01-01', '2026-01-01', '2026-02-01')`
    db.query(insert).run(userId)
    expect(() => db.query(insert).run(userId)).toThrow()
  })
})

describe("email_tokens", () => {
  test("rejects an unknown purpose", () => {
    expect(() => db.query(`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
           VALUES ('h', ?, 'nonsense', '2026-02-01', '2026-01-01')`).run(userId)).toThrow()
  })

  test("accepts the two real purposes", () => {
    for (const purpose of ["verify_email", "reset_password"]) {
      expect(() => db.query(`INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
             VALUES (?, ?, ?, '2026-02-01', '2026-01-01')`).run(`hash-${purpose}`, userId, purpose)).not.toThrow()
    }
  })
})
