import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { RateLimitRepository } from "../../../src/db/repositories/rate-limits"
import { freshDb } from "../../support/fixtures"

let db: Database
let limits: RateLimitRepository

beforeEach(() => {
  db = freshDb()
  limits = new RateLimitRepository(db)
})

describe("consume", () => {
  test("allows requests up to capacity", () => {
    for (let i = 0; i < 5; i++) expect(limits.consume("login:a", 5, 0, 900).allowed).toBe(true)
  })

  test("blocks the request past capacity", () => {
    for (let i = 0; i < 5; i++) limits.consume("login:a", 5, 0, 900)
    expect(limits.consume("login:a", 5, 0, 900).allowed).toBe(false)
  })

  test("reports when the lock expires", () => {
    for (let i = 0; i < 6; i++) limits.consume("login:a", 5, 0, 900)
    expect(limits.consume("login:a", 5, 0, 900).lockedUntil).not.toBeNull()
  })

  test("keeps buckets independent", () => {
    for (let i = 0; i < 5; i++) limits.consume("login:a", 5, 0, 900)
    expect(limits.consume("login:b", 5, 0, 900).allowed).toBe(true)
  })

  test("refills over time", () => {
    for (let i = 0; i < 5; i++) limits.consume("login:c", 5, 1, 0)
    expect(limits.consume("login:c", 5, 1, 0).allowed).toBe(false)
    db.query("UPDATE rate_limits SET updated_at = ? WHERE bucket = 'login:c'").run(
      new Date(Date.now() - 10_000).toISOString(),
    )
    expect(limits.consume("login:c", 5, 1, 0).allowed).toBe(true)
  })

  test("survives a restart, because the bucket is persisted", () => {
    for (let i = 0; i < 5; i++) limits.consume("login:d", 5, 0, 900)
    expect(new RateLimitRepository(db).consume("login:d", 5, 0, 900).allowed).toBe(false)
  })
})
