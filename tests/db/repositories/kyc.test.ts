import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { KycRepository } from "../../../src/db/repositories/kyc"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let kyc: KycRepository
let userId: number

beforeEach(() => {
  db = freshDb()
  kyc = new KycRepository(db)
  userId = createUser(db)
})

describe("start", () => {
  test("creates a draft at the first step", () => {
    const id = kyc.start(userId, 2)
    const app = kyc.openFor(userId)!
    expect(app.id).toBe(id)
    expect(app.status).toBe("draft")
    expect(app.currentStep).toBe("identity")
    expect(app.targetTier).toBe(2)
  })
  test("refuses a second open application", () => {
    kyc.start(userId, 2)
    expect(() => kyc.start(userId, 2)).toThrow()
  })
  test("permits a new application after a rejection", () => {
    const first = kyc.start(userId, 2)
    kyc.decide(first, "rejected", "Details did not match")
    expect(() => kyc.start(userId, 2)).not.toThrow()
  })
  test("creates the profile row alongside the application", () => {
    expect(kyc.profileFor(kyc.start(userId, 2))).not.toBeNull()
  })
})

describe("openFor and latestFor", () => {
  test("openFor returns null when there is none", () => { expect(kyc.openFor(userId)).toBeNull() })
  test("openFor ignores a rejected application", () => {
    kyc.decide(kyc.start(userId, 2), "rejected", "no")
    expect(kyc.openFor(userId)).toBeNull()
  })
  test("latestFor still returns the rejected application", () => {
    const id = kyc.start(userId, 2)
    kyc.decide(id, "rejected", "no")
    expect(kyc.latestFor(userId)!.id).toBe(id)
    expect(kyc.latestFor(userId)!.rejectionReason).toBe("no")
  })
  test("does not leak another user's application", () => {
    kyc.start(createUser(db, "other@test.co"), 2)
    expect(kyc.openFor(userId)).toBeNull()
  })
})

describe("attemptsFor", () => {
  test("counts applications, so resubmission can be capped", () => {
    expect(kyc.attemptsFor(userId)).toBe(0)
    const first = kyc.start(userId, 2)
    expect(kyc.attemptsFor(userId)).toBe(1)
    kyc.decide(first, "rejected", "no")
    kyc.start(userId, 2)
    expect(kyc.attemptsFor(userId)).toBe(2)
  })
})

describe("profile", () => {
  test("returns an empty profile before anything is saved", () => {
    expect(kyc.profileFor(kyc.start(userId, 2))!.firstName).toBeNull()
  })
  test("saves and reads back identity fields", () => {
    const id = kyc.start(userId, 2)
    kyc.updateProfile(id, {
      firstName: "Chidinma", lastName: "Okeke",
      dateOfBirth: "1994-05-12", phone: "+2348031234567",
    })
    const profile = kyc.profileFor(id)!
    expect(profile.firstName).toBe("Chidinma")
    expect(profile.phone).toBe("+2348031234567")
  })
  test("a partial update leaves other fields alone", () => {
    const id = kyc.start(userId, 2)
    kyc.updateProfile(id, { firstName: "Chidinma" })
    kyc.updateProfile(id, { lastName: "Okeke" })
    const profile = kyc.profileFor(id)!
    expect(profile.firstName).toBe("Chidinma")
    expect(profile.lastName).toBe("Okeke")
  })
  test("ignores a key that is not an allowlisted column", () => {
    const id = kyc.start(userId, 2)
    expect(() =>
      kyc.updateProfile(id, { notAColumn: "x" } as never),
    ).not.toThrow()
  })
  test("stores only the last four of a government identifier", () => {
    const id = kyc.start(userId, 2)
    kyc.updateProfile(id, {
      governmentIdType: "PASSPORT", governmentIdLast4: "4567", providerReference: "sbx_abc",
    })
    expect(kyc.profileFor(id)!.governmentIdLast4).toBe("4567")
    const dump = JSON.stringify(db.query("SELECT * FROM kyc_profiles").all())
    expect(dump).not.toContain("A01234567")
  })
})

describe("advance and provider", () => {
  test("moves the current step", () => {
    const id = kyc.start(userId, 2)
    kyc.advance(id, "government_id")
    expect(kyc.openFor(userId)!.currentStep).toBe("government_id")
  })
  test("records which provider decided", () => {
    const id = kyc.start(userId, 2)
    kyc.setProvider(id, "sandbox", "sbx_abc")
    expect(kyc.openFor(userId)!.provider).toBe("sandbox")
    expect(kyc.openFor(userId)!.providerRef).toBe("sbx_abc")
  })
  test("records a document session", () => {
    const id = kyc.start(userId, 2)
    kyc.setDocumentSession(id, "sbxdoc_1")
    expect(kyc.openFor(userId)!.documentSession).toBe("sbxdoc_1")
  })
})

describe("consents", () => {
  test("records each document separately", () => {
    const id = kyc.start(userId, 2)
    kyc.recordConsent(id, "terms", "2026-08-29", "203.0.113.4")
    kyc.recordConsent(id, "privacy", "2026-08-29", "203.0.113.4")
    expect(kyc.consentsFor(id).sort()).toEqual(["privacy", "terms"])
  })
  test("returns an empty list when nothing is consented", () => {
    expect(kyc.consentsFor(kyc.start(userId, 2))).toEqual([])
  })
  test("stores the version and ip as evidence", () => {
    const id = kyc.start(userId, 2)
    kyc.recordConsent(id, "risk", "2026-08-29", "203.0.113.4")
    const row = db.query("SELECT version, ip FROM kyc_consents").get() as {
      version: string; ip: string
    }
    expect(row.version).toBe("2026-08-29")
    expect(row.ip).toBe("203.0.113.4")
  })
})

describe("submit and decide", () => {
  test("submitting moves to in_review and stamps the time", () => {
    const id = kyc.start(userId, 2)
    kyc.submit(id)
    const app = kyc.openFor(userId)!
    expect(app.status).toBe("in_review")
    expect(app.currentStep).toBe("done")
    expect(app.submittedAt).not.toBeNull()
  })
  test("approving stamps a decision time", () => {
    const id = kyc.start(userId, 2)
    kyc.decide(id, "approved")
    const app = kyc.latestFor(userId)!
    expect(app.status).toBe("approved")
    expect(app.decidedAt).not.toBeNull()
  })
  test("rejecting records the reason", () => {
    const id = kyc.start(userId, 2)
    kyc.decide(id, "rejected", "Details did not match records")
    expect(kyc.latestFor(userId)!.rejectionReason).toBe("Details did not match records")
  })
})
