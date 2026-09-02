import { all, get } from "../../../src/db"
import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../../src/db"
import { KycRepository } from "../../../src/db/repositories/kyc"
import { freshDb, createUser } from "../../support/fixtures"

let db: Client
let kyc: KycRepository
let userId: number

beforeEach(async () => {
  db = await freshDb()
  kyc = new KycRepository(db)
  userId = await createUser(db)
})

describe("start", () => {
  test("creates a draft at the first step", async () => {
    const id = await kyc.start(userId, 2)
    const app = (await kyc.openFor(userId))!
    expect(app.id).toBe(id)
    expect(app.status).toBe("draft")
    expect(app.currentStep).toBe("identity")
    expect(app.targetTier).toBe(2)
  })
  test("refuses a second open application", async () => {
    await kyc.start(userId, 2)
    await expect(kyc.start(userId, 2)).rejects.toThrow()
  })
  test("permits a new application after a rejection", async () => {
    const first = await kyc.start(userId, 2)
    await kyc.decide(first, "rejected", "Details did not match")
    await kyc.start(userId, 2)
  })
  test("creates the profile row alongside the application", async () => {
    expect(await kyc.profileFor(await kyc.start(userId, 2))).not.toBeNull()
  })
})

describe("openFor and latestFor", () => {
  test("openFor returns null when there is none", async () => { expect(await kyc.openFor(userId)).toBeNull() })
  test("openFor ignores a rejected application", async () => {
    await kyc.decide(await kyc.start(userId, 2), "rejected", "no")
    expect(await kyc.openFor(userId)).toBeNull()
  })
  test("latestFor still returns the rejected application", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.decide(id, "rejected", "no")
    expect((await kyc.latestFor(userId))!.id).toBe(id)
    expect((await kyc.latestFor(userId))!.rejectionReason).toBe("no")
  })
  test("does not leak another user's application", async () => {
    await kyc.start(await createUser(db, "other@test.co"), 2)
    expect(await kyc.openFor(userId)).toBeNull()
  })
})

describe("attemptsFor", () => {
  test("counts applications, so resubmission can be capped", async () => {
    expect(await kyc.attemptsFor(userId)).toBe(0)
    const first = await kyc.start(userId, 2)
    expect(await kyc.attemptsFor(userId)).toBe(1)
    await kyc.decide(first, "rejected", "no")
    await kyc.start(userId, 2)
    expect(await kyc.attemptsFor(userId)).toBe(2)
  })
})

describe("profile", () => {
  test("returns an empty profile before anything is saved", async () => {
    expect((await kyc.profileFor(await kyc.start(userId, 2)))!.firstName).toBeNull()
  })
  test("saves and reads back identity fields", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.updateProfile(id, {
      firstName: "Chidinma", lastName: "Okeke",
      dateOfBirth: "1994-05-12", phone: "+2348031234567",
    })
    const profile = (await kyc.profileFor(id))!
    expect(profile.firstName).toBe("Chidinma")
    expect(profile.phone).toBe("+2348031234567")
  })
  test("a partial update leaves other fields alone", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.updateProfile(id, { firstName: "Chidinma" })
    await kyc.updateProfile(id, { lastName: "Okeke" })
    const profile = (await kyc.profileFor(id))!
    expect(profile.firstName).toBe("Chidinma")
    expect(profile.lastName).toBe("Okeke")
  })
  test("ignores a key that is not an allowlisted column", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.updateProfile(id, { notAColumn: "x" } as never)
  })
  test("stores only the last four of a government identifier", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.updateProfile(id, {
      governmentIdType: "PASSPORT", governmentIdLast4: "4567", providerReference: "sbx_abc",
    })
    expect((await kyc.profileFor(id))!.governmentIdLast4).toBe("4567")
    const dump = JSON.stringify(await all(db, "SELECT * FROM kyc_profiles"))
    expect(dump).not.toContain("A01234567")
  })
})

describe("advance and provider", () => {
  test("moves the current step", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.advance(id, "government_id")
    expect((await kyc.openFor(userId))!.currentStep).toBe("government_id")
  })
  test("records which provider decided", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.setProvider(id, "sandbox", "sbx_abc")
    expect((await kyc.openFor(userId))!.provider).toBe("sandbox")
    expect((await kyc.openFor(userId))!.providerRef).toBe("sbx_abc")
  })
  test("records a document session", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.setDocumentSession(id, "sbxdoc_1")
    expect((await kyc.openFor(userId))!.documentSession).toBe("sbxdoc_1")
  })
})

describe("consents", () => {
  test("records each document separately", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.recordConsent(id, "terms", "2026-08-29", "203.0.113.4")
    await kyc.recordConsent(id, "privacy", "2026-08-29", "203.0.113.4")
    expect((await kyc.consentsFor(id)).sort()).toEqual(["privacy", "terms"])
  })
  test("returns an empty list when nothing is consented", async () => {
    expect(await kyc.consentsFor(await kyc.start(userId, 2))).toEqual([])
  })
  test("stores the version and ip as evidence", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.recordConsent(id, "risk", "2026-08-29", "203.0.113.4")
    const row = await get(db, "SELECT version, ip FROM kyc_consents") as {
      version: string; ip: string
    }
    expect(row.version).toBe("2026-08-29")
    expect(row.ip).toBe("203.0.113.4")
  })
})

describe("submit and decide", () => {
  test("submitting moves to in_review and stamps the time", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.submit(id)
    const app = (await kyc.openFor(userId))!
    expect(app.status).toBe("in_review")
    expect(app.currentStep).toBe("done")
    expect(app.submittedAt).not.toBeNull()
  })
  test("approving stamps a decision time", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.decide(id, "approved")
    const app = (await kyc.latestFor(userId))!
    expect(app.status).toBe("approved")
    expect(app.decidedAt).not.toBeNull()
  })
  test("rejecting records the reason", async () => {
    const id = await kyc.start(userId, 2)
    await kyc.decide(id, "rejected", "Details did not match records")
    expect((await kyc.latestFor(userId))!.rejectionReason).toBe("Details did not match records")
  })
})
