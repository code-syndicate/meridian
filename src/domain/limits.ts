import { INTERNAL_SCALE } from "./money"

export interface TierLimits {
  /** Cap in USD at internal scale. null means uncapped. */
  capUsd: bigint | null
  /** "lifetime" caps total movement ever; "daily" resets each UTC day. */
  window: "lifetime" | "daily"
  depositEnabled: boolean
  withdrawalEnabled: boolean
  tradingEnabled: boolean
}

export interface LimitConfig {
  freeTierLimitUsd: number
  tier1DailyLimitUsd: number
  tier2DailyLimitUsd: number
}

function usd(whole: number): bigint {
  return BigInt(Math.round(whole)) * INTERNAL_SCALE
}

/**
 * An unverified account is capped over its lifetime rather than per day. A
 * daily cap on an unverified account is only a slower uncapped one, which is
 * the pattern structuring is built to exploit.
 */
export function limitsFor(tier: number, config: LimitConfig): TierLimits {
  if (tier >= 2) {
    return {
      capUsd: usd(config.tier2DailyLimitUsd),
      window: "daily",
      depositEnabled: true,
      withdrawalEnabled: true,
      tradingEnabled: true,
    }
  }
  if (tier === 1) {
    return {
      capUsd: usd(config.tier1DailyLimitUsd),
      window: "daily",
      depositEnabled: true,
      withdrawalEnabled: true,
      tradingEnabled: true,
    }
  }
  return {
    capUsd: usd(config.freeTierLimitUsd),
    window: "lifetime",
    depositEnabled: true,
    withdrawalEnabled: true,
    tradingEnabled: true,
  }
}

export function windowKey(limits: TierLimits, now: Date): string {
  return limits.window === "lifetime" ? "lifetime" : now.toISOString().slice(0, 10)
}

/** Whole-dollar USD for display. Rounds down, so we never overstate headroom. */
export function usdWhole(value: bigint): number {
  return Number(value / INTERNAL_SCALE)
}
