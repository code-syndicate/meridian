import { test, expect, describe } from "bun:test"
import { STEP_ORDER, nextStep, canEnter, isEditable, canResubmit } from "../../../src/domain/kyc/steps"
import { tierFor, limitsFor } from "../../../src/domain/kyc/tiers"

describe("STEP_ORDER", () => {
  test("matches the five wizard steps then done", () => {
    expect([...STEP_ORDER]).toEqual(["identity","government_id","address","document","disclosures","done"])
  })
})

describe("nextStep", () => {
  test("advances through the wizard", () => {
    expect(nextStep("identity")).toBe("government_id")
    expect(nextStep("government_id")).toBe("address")
    expect(nextStep("address")).toBe("document")
    expect(nextStep("document")).toBe("disclosures")
    expect(nextStep("disclosures")).toBe("done")
  })
  test("stops at done", () => { expect(nextStep("done")).toBe("done") })
})

describe("canEnter", () => {
  test("permits the current step", () => { expect(canEnter("address", "address")).toBe(true) })
  test("permits going back to a completed step", () => { expect(canEnter("identity", "address")).toBe(true) })
  test("refuses skipping ahead", () => {
    expect(canEnter("disclosures", "identity")).toBe(false)
    expect(canEnter("document", "address")).toBe(false)
  })
  test("permits revisiting once done", () => {
    expect(canEnter("identity", "done")).toBe(true)
    expect(canEnter("done", "done")).toBe(true)
  })
})

describe("isEditable", () => {
  test("a draft can be edited", () => { expect(isEditable("draft")).toBe(true) })
  test("a submitted or reviewing application cannot", () => {
    expect(isEditable("submitted")).toBe(false)
    expect(isEditable("in_review")).toBe(false)
  })
  test("an approved application cannot", () => { expect(isEditable("approved")).toBe(false) })
  test("a rejected application cannot be edited in place", () => {
    // Resubmission starts a new application rather than mutating the old one,
    // because the rejected record is evidence.
    expect(isEditable("rejected")).toBe(false)
  })
})

describe("canResubmit", () => {
  test("permits one resubmission after a rejection", () => { expect(canResubmit("rejected", 1)).toBe(true) })
  test("refuses a third attempt", () => { expect(canResubmit("rejected", 2)).toBe(false) })
  test("refuses resubmission while under review", () => { expect(canResubmit("in_review", 1)).toBe(false) })
  test("refuses resubmission once approved", () => { expect(canResubmit("approved", 1)).toBe(false) })
})

describe("tierFor", () => {
  test("an approved tier 2 application grants tier 2", () => { expect(tierFor("approved", 2)).toBe(2) })
  test("an approved tier 1 application grants tier 1", () => { expect(tierFor("approved", 1)).toBe(1) })
  test("anything not approved grants tier 0", () => {
    for (const status of ["draft","submitted","in_review","rejected","expired"] as const) {
      expect(tierFor(status, 2)).toBe(0)
    }
  })
})

describe("limitsFor", () => {
  test("tier 0 permits nothing", () => {
    expect(limitsFor(0)).toEqual({ dailyWithdrawalUsd: 0, depositEnabled: false, tradingEnabled: false })
  })
  test("tier 1 permits deposits with a cap", () => {
    const limits = limitsFor(1)
    expect(limits.depositEnabled).toBe(true)
    expect(limits.dailyWithdrawalUsd).toBeGreaterThan(0)
  })
  test("tier 2 raises the cap above tier 1", () => {
    expect(limitsFor(2).dailyWithdrawalUsd!).toBeGreaterThan(limitsFor(1).dailyWithdrawalUsd!)
  })
  test("an unknown tier falls back to the most restrictive", () => {
    expect(limitsFor(99)).toEqual(limitsFor(0))
  })
})
