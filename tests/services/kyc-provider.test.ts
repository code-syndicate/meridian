import { test, expect, describe, beforeEach } from "bun:test"
import { SandboxKycProvider } from "../../src/services/kyc-provider"

let provider: SandboxKycProvider

const validInput = {
  idType: "BVN" as const,
  idNumber: "12345678901",
  firstName: "Chidinma",
  lastName: "Okeke",
  dateOfBirth: "1994-05-12",
}

beforeEach(() => { provider = new SandboxKycProvider() })

describe("verifyGovernmentId", () => {
  test("names itself, so the application can record which provider decided", () => {
    expect(provider.name).toBe("sandbox")
  })
  test("verifies a normal identifier", async () => {
    const result = await provider.verifyGovernmentId(validInput)
    expect(result.verified).toBe(true)
    expect(result.reference.length).toBeGreaterThan(0)
  })
  test("returns a stable reference for the same identifier", async () => {
    const first = await provider.verifyGovernmentId(validInput)
    const second = await provider.verifyGovernmentId(validInput)
    expect(second.reference).toBe(first.reference)
  })
  test("fails an identifier ending 0000, so a rejection path is demonstrable", async () => {
    const result = await provider.verifyGovernmentId({ ...validInput, idNumber: "12345670000" })
    expect(result.verified).toBe(false)
    expect(result.reason).toBeDefined()
  })
  test("never echoes the identifier back in the reference", async () => {
    expect((await provider.verifyGovernmentId(validInput)).reference).not.toContain("12345678901")
  })
  test("never echoes the identifier in a failure reason", async () => {
    const result = await provider.verifyGovernmentId({ ...validInput, idNumber: "12345670000" })
    expect(result.reason ?? "").not.toContain("12345670000")
  })
})

describe("document session", () => {
  test("creates a session with an id and a url", async () => {
    const session = await provider.createDocumentSession({ applicationId: 1, redirectUrl: "u" })
    expect(session.sessionId.length).toBeGreaterThan(0)
    expect(session.url).toContain(encodeURIComponent(session.sessionId))
  })
  test("creates a different session each time", async () => {
    const a = await provider.createDocumentSession({ applicationId: 1, redirectUrl: "u" })
    const b = await provider.createDocumentSession({ applicationId: 1, redirectUrl: "u" })
    expect(a.sessionId).not.toBe(b.sessionId)
  })
  test("a fresh session is pending", async () => {
    const s = await provider.createDocumentSession({ applicationId: 1, redirectUrl: "u" })
    expect((await provider.getDocumentResult(s.sessionId)).status).toBe("pending")
  })
  test("a completed session passes", async () => {
    const s = await provider.createDocumentSession({ applicationId: 1, redirectUrl: "u" })
    provider.complete(s.sessionId, "passed")
    expect((await provider.getDocumentResult(s.sessionId)).status).toBe("passed")
  })
  test("a failed session reports a reason", async () => {
    const s = await provider.createDocumentSession({ applicationId: 1, redirectUrl: "u" })
    provider.complete(s.sessionId, "failed")
    const result = await provider.getDocumentResult(s.sessionId)
    expect(result.status).toBe("failed")
    expect(result.reason).toBeDefined()
  })
  test("an unknown session fails rather than passing by default", async () => {
    expect((await provider.getDocumentResult("nope")).status).toBe("failed")
  })
})
