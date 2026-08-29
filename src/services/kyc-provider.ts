import { createHash, randomUUID } from "node:crypto"
import type { GovernmentIdType } from "../domain/kyc/types"

export interface GovernmentIdInput {
  idType: GovernmentIdType
  idNumber: string
  firstName: string
  lastName: string
  dateOfBirth: string
}

export interface GovernmentIdResult {
  verified: boolean
  reference: string
  reason?: string
}

export interface DocumentSession {
  sessionId: string
  url: string
}

export interface DocumentResult {
  status: "pending" | "passed" | "failed"
  reference: string
  reason?: string
}

/**
 * The vendor boundary. Smile ID, Dojah, and Youverify all fit this shape:
 * an identifier lookup, then a hosted capture session polled for a result.
 * Choosing between them is a configuration change, not a rewrite, and
 * nothing above this interface knows which one is in use.
 */
export interface KycProvider {
  readonly name: string
  verifyGovernmentId(input: GovernmentIdInput): Promise<GovernmentIdResult>
  createDocumentSession(input: {
    applicationId: number
    redirectUrl: string
  }): Promise<DocumentSession>
  getDocumentResult(sessionId: string): Promise<DocumentResult>
}

/**
 * Deterministic stand-in for development and tests. Identifiers ending 0000
 * fail, so the rejection path is demonstrable without a vendor account.
 * Never selected in production: the application refuses to start without a
 * real provider configured, the same way it refuses to start without SMTP.
 */
export class SandboxKycProvider implements KycProvider {
  readonly name = "sandbox"
  private readonly sessions = new Map<string, "pending" | "passed" | "failed">()

  async verifyGovernmentId(input: GovernmentIdInput): Promise<GovernmentIdResult> {
    // A hash, so the reference is stable per identifier without containing it.
    const reference = `sbx_${createHash("sha256")
      .update(`${input.idType}:${input.idNumber}`)
      .digest("hex")
      .slice(0, 24)}`

    if (input.idNumber.endsWith("0000")) {
      return {
        verified: false,
        reference,
        reason: "The details you gave do not match the records held for that identifier.",
      }
    }
    return { verified: true, reference }
  }

  async createDocumentSession(_input: {
    applicationId: number
    redirectUrl: string
  }): Promise<DocumentSession> {
    const sessionId = `sbxdoc_${randomUUID()}`
    this.sessions.set(sessionId, "pending")
    return {
      sessionId,
      url: `/onboarding/document/sandbox?session=${encodeURIComponent(sessionId)}`,
    }
  }

  /** Test and development hook. Not part of the KycProvider interface. */
  complete(sessionId: string, status: "passed" | "failed"): void {
    this.sessions.set(sessionId, status)
  }

  async getDocumentResult(sessionId: string): Promise<DocumentResult> {
    const status = this.sessions.get(sessionId)
    if (!status) {
      // An unknown session must not pass. Failing closed is the only safe default.
      return { status: "failed", reference: sessionId, reason: "Session not found" }
    }
    if (status === "failed") {
      return {
        status,
        reference: sessionId,
        reason: "The document or selfie could not be verified.",
      }
    }
    return { status, reference: sessionId }
  }
}
