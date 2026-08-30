import type { KycStatus } from "./types"

export interface TierLimits {
  dailyWithdrawalUsd: number | null
  depositEnabled: boolean
  tradingEnabled: boolean
}

/**
 * Placeholder figures. They are configuration rather than product decisions,
 * and must be confirmed against the licensing framework in each market
 * and our AML programme before any of them take effect. Nothing is enabled in Slice 1
 * regardless of tier, because no asset has its movement flags set.
 */
const LIMITS: Record<number, TierLimits> = {
  0: { dailyWithdrawalUsd: 0, depositEnabled: false, tradingEnabled: false },
  1: { dailyWithdrawalUsd: 1_000, depositEnabled: true, tradingEnabled: true },
  2: { dailyWithdrawalUsd: 50_000, depositEnabled: true, tradingEnabled: true },
}

export function limitsFor(tier: number): TierLimits {
  return LIMITS[tier] ?? LIMITS[0]!
}

export function tierFor(status: KycStatus, targetTier: number): 0 | 1 | 2 {
  if (status !== "approved") return 0
  return targetTier === 2 ? 2 : 1
}
