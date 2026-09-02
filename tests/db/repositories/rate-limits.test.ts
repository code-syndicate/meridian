import { run } from "../../../src/db"
import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../../src/db"
import { RateLimitRepository } from "../../../src/db/repositories/rate-limits"
import { freshDb } from "../../support/fixtures"

let db: Client
let limits: RateLimitRepository

beforeEach(async () => {
  db = await freshDb()
  limits = new RateLimitRepository(db)
})

describe("consume", () => {
  test("allows requests up to capacity", async () => {
    for (let i = 0; i < 5; i++) expect((await limits.consume("login:a", 5, 0, 900)).allowed).toBe(true)
  })

  test("blocks the request past capacity", async () => {
    for (let i = 0; i < 5; i++) await limits.consume("login:a", 5, 0, 900)
    expect((await limits.consume("login:a", 5, 0, 900)).allowed).toBe(false)
  })

  test("reports when the lock expires", async () => {
    for (let i = 0; i < 6; i++) await limits.consume("login:a", 5, 0, 900)
    expect((await limits.consume("login:a", 5, 0, 900)).lockedUntil).not.toBeNull()
  })

  test("keeps buckets independent", async () => {
    for (let i = 0; i < 5; i++) await limits.consume("login:a", 5, 0, 900)
    expect((await limits.consume("login:b", 5, 0, 900)).allowed).toBe(true)
  })

  test("refills over time", async () => {
    for (let i = 0; i < 5; i++) await limits.consume("login:c", 5, 1, 0)
    expect((await limits.consume("login:c", 5, 1, 0)).allowed).toBe(false)
    await run(db, "UPDATE rate_limits SET updated_at = ? WHERE bucket = 'login:c'", [new Date(Date.now() - 10_000).toISOString(),])
    expect((await limits.consume("login:c", 5, 1, 0)).allowed).toBe(true)
  })

  test("survives a restart, because the bucket is persisted", async () => {
    for (let i = 0; i < 5; i++) await limits.consume("login:d", 5, 0, 900)
    expect((await new RateLimitRepository(db).consume("login:d", 5, 0, 900)).allowed).toBe(false)
  })
})
