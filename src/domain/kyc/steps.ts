import type { KycStatus, KycStep } from "./types"

export const STEP_ORDER: readonly KycStep[] = [
  "identity",
  "government_id",
  "address",
  "document",
  "disclosures",
  "done",
] as const

export function stepIndex(step: KycStep): number {
  return STEP_ORDER.indexOf(step)
}

export function nextStep(current: KycStep): KycStep {
  return STEP_ORDER[Math.min(stepIndex(current) + 1, STEP_ORDER.length - 1)]!
}

/** A user may revisit a completed step but never skip ahead of their progress. */
export function canEnter(step: KycStep, current: KycStep): boolean {
  return stepIndex(step) <= stepIndex(current)
}

export function isEditable(status: KycStatus): boolean {
  return status === "draft"
}

const MAX_ATTEMPTS = 2

export function canResubmit(status: KycStatus, previousAttempts: number): boolean {
  return status === "rejected" && previousAttempts < MAX_ATTEMPTS
}
