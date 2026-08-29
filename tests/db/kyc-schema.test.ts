import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { freshDb, createUser } from "../support/fixtures"

let db: Database
let userId: number

function insertApplication(status: string, step: string): void {
  db.query(
    `INSERT INTO kyc_applications (user_id, status, current_step, target_tier, created_at, updated_at)
     VALUES (?, ?, ?, 2, '2026-01-01', '2026-01-01')`,
  ).run(userId, status, step)
}

function newApplication(): number {
  insertApplication("draft", "identity")
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}

beforeEach(() => {
  db = freshDb()
  userId = createUser(db)
})

describe("kyc_applications", () => {
  test("accepts every real status", () => {
    for (const status of ["draft", "submitted", "in_review", "approved", "rejected", "expired"]) {
      db = freshDb()
      userId = createUser(db)
      expect(() => insertApplication(status, "identity")).not.toThrow()
    }
  })

  test("rejects an unknown status", () => {
    expect(() => insertApplication("nonsense", "identity")).toThrow()
  })

  test("rejects an unknown step", () => {
    expect(() => insertApplication("draft", "nonsense")).toThrow()
  })

  test("rejects a tier outside 1 and 2", () => {
    expect(() =>
      db.query(`INSERT INTO kyc_applications (user_id, status, current_step, target_tier, created_at, updated_at)
           VALUES (?, 'draft', 'identity', 5, '2026-01-01', '2026-01-01')`).run(userId),
    ).toThrow()
  })

  test("permits only one open application per user", () => {
    insertApplication("draft", "identity")
    expect(() => insertApplication("draft", "identity")).toThrow()
  })

  test("permits a new application once the previous one is rejected", () => {
    insertApplication("rejected", "identity")
    expect(() => insertApplication("draft", "identity")).not.toThrow()
  })
})

describe("kyc_profiles", () => {
  test("has no column capable of holding a full government identifier", () => {
    const columns = db
      .query<{ name: string }, []>("SELECT name FROM pragma_table_info('kyc_profiles')")
      .all()
      .map((c) => c.name)
    expect(columns).toContain("government_id_last4")
    expect(columns).toContain("government_id_type")
    expect(columns).toContain("provider_reference")
    expect(columns).not.toContain("bvn")
    expect(columns).not.toContain("nin")
    expect(columns).not.toContain("government_id")
  })

  test("rejects a last4 longer than four characters", () => {
    const appId = newApplication()
    expect(() =>
      db.query(`INSERT INTO kyc_profiles (application_id, government_id_type, government_id_last4, created_at, updated_at)
           VALUES (?, 'BVN', '123456789', '2026-01-01', '2026-01-01')`).run(appId),
    ).toThrow()
  })

  test("rejects an unknown identifier type", () => {
    const appId = newApplication()
    expect(() =>
      db.query(`INSERT INTO kyc_profiles (application_id, government_id_type, government_id_last4, created_at, updated_at)
           VALUES (?, 'PASSPORT', '1234', '2026-01-01', '2026-01-01')`).run(appId),
    ).toThrow()
  })
})

describe("kyc_consents", () => {
  test("is append-only, because a consent record is evidence", () => {
    const appId = newApplication()
    db.query(`INSERT INTO kyc_consents (application_id, document, version, ip, created_at)
       VALUES (?, 'terms', '2026-08-29', '203.0.113.4', '2026-01-01')`).run(appId)
    expect(() => db.query("UPDATE kyc_consents SET document = 'x'").run()).toThrow(/append-only/)
    expect(() => db.query("DELETE FROM kyc_consents").run()).toThrow(/append-only/)
  })

  test("rejects an unknown document", () => {
    const appId = newApplication()
    expect(() =>
      db.query(`INSERT INTO kyc_consents (application_id, document, version, ip, created_at)
           VALUES (?, 'nonsense', '2026-08-29', '203.0.113.4', '2026-01-01')`).run(appId),
    ).toThrow()
  })
})
