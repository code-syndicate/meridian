import { all, get, run } from "../../src/db"
import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../src/db"
import { freshDb, createUser } from "../support/fixtures"

let db: Client
let userId: number

async function insertApplication(status: string, step: string): Promise<void> {
  await run(db, `INSERT INTO kyc_applications (user_id, status, current_step, target_tier, created_at, updated_at)
     VALUES (?, ?, ?, 2, '2026-01-01', '2026-01-01')`, [userId, status, step])
}

async function newApplication(): Promise<number> {
  await insertApplication("draft", "identity")
  return Number((await get<{ id: number }>(db, "SELECT last_insert_rowid() AS id"))!.id)
}

beforeEach(async () => {
  db = await freshDb()
  userId = await createUser(db)
})

describe("kyc_applications", () => {
  test("accepts every real status", async () => {
    for (const status of ["draft", "submitted", "in_review", "approved", "rejected", "expired"]) {
      db = await freshDb()
      userId = await createUser(db)
      await insertApplication(status, "identity")
    }
  })

  test("rejects an unknown status", async () => {
    await expect(insertApplication("nonsense", "identity")).rejects.toThrow()
  })

  test("rejects an unknown step", async () => {
    await expect(insertApplication("draft", "nonsense")).rejects.toThrow()
  })

  test("rejects a tier outside 1 and 2", async () => {
    await expect(run(db, `INSERT INTO kyc_applications (user_id, status, current_step, target_tier, created_at, updated_at)
           VALUES (?, 'draft', 'identity', 5, '2026-01-01', '2026-01-01')`, [userId]),).rejects.toThrow()
  })

  test("permits only one open application per user", async () => {
    await insertApplication("draft", "identity")
    await expect(insertApplication("draft", "identity")).rejects.toThrow()
  })

  test("permits a new application once the previous one is rejected", async () => {
    await insertApplication("rejected", "identity")
    await insertApplication("draft", "identity")
  })
})

describe("kyc_profiles", () => {
  test("has no column capable of holding a full government identifier", async () => {
    const columns = (await all<{ name: string }>(db, "SELECT name FROM pragma_table_info('kyc_profiles')"))
      .map((c) => c.name)
    expect(columns).toContain("government_id_last4")
    expect(columns).toContain("government_id_type")
    expect(columns).toContain("provider_reference")
    expect(columns).toContain("country")
    expect(columns).not.toContain("government_id")
    expect(columns).not.toContain("passport_number")
  })

  test("rejects a last4 longer than four characters", async () => {
    const appId = await newApplication()
    await expect(run(db, `INSERT INTO kyc_profiles (application_id, government_id_type, government_id_last4, created_at, updated_at)
           VALUES (?, 'PASSPORT', '123456789', '2026-01-01', '2026-01-01')`, [appId]),).rejects.toThrow()
  })

  test("rejects an unknown identifier type", async () => {
    const appId = await newApplication()
    await expect(run(db, `INSERT INTO kyc_profiles (application_id, government_id_type, government_id_last4, created_at, updated_at)
           VALUES (?, 'BVN', '1234', '2026-01-01', '2026-01-01')`, [appId]),).rejects.toThrow()
  })
})

describe("kyc_consents", () => {
  test("is append-only, because a consent record is evidence", async () => {
    const appId = await newApplication()
    await run(db, `INSERT INTO kyc_consents (application_id, document, version, ip, created_at)
       VALUES (?, 'terms', '2026-08-29', '203.0.113.4', '2026-01-01')`, [appId])
    await expect(run(db, "UPDATE kyc_consents SET document = 'x'")).rejects.toThrow(/append-only/)
    await expect(run(db, "DELETE FROM kyc_consents")).rejects.toThrow(/append-only/)
  })

  test("rejects an unknown document", async () => {
    const appId = await newApplication()
    await expect(run(db, `INSERT INTO kyc_consents (application_id, document, version, ip, created_at)
           VALUES (?, 'nonsense', '2026-08-29', '203.0.113.4', '2026-01-01')`, [appId]),).rejects.toThrow()
  })
})
