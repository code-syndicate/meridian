import { INTERNAL_SCALE } from "../domain/money"
import { limitsFor, windowKey, usdWhole, type LimitConfig, type TierLimits } from "../domain/limits"
import type { UsageRepository } from "../db/repositories/usage"
import type { Quote } from "../domain/prices"

export type LimitDenial =
  | { code: "no_price"; message: string }
  | { code: "over_limit"; message: string; remainingUsd: number; capUsd: number }

export interface PriceLookup {
  snapshot(): Quote[]
}

export class LimitService {
  constructor(
    private readonly deps: {
      usage: UsageRepository
      prices: PriceLookup
      config: LimitConfig
    },
  ) {}

  limits(tier: number): TierLimits {
    return limitsFor(tier, this.deps.config)
  }

  /**
   * USD value of an asset amount, both at internal scale. Null when the feed
   * carries no quote for the asset: a limit that cannot be measured must not
   * be assumed to be satisfied.
   */
  valueUsd(symbol: string, amount: bigint): bigint | null {
    const quote = this.deps.prices.snapshot().find((q) => q.symbol === symbol)
    if (!quote || quote.priceUsd <= 0n) return null
    return (amount * quote.priceUsd) / INTERNAL_SCALE
  }

  status(userId: number, tier: number, now: Date = new Date()) {
    const limits = this.limits(tier)
    const used = this.deps.usage.used(userId, "outbound", windowKey(limits, now))
    const remaining = limits.capUsd === null ? null : limits.capUsd - used
    return {
      limits,
      usedUsd: usdWhole(used),
      capUsd: limits.capUsd === null ? null : usdWhole(limits.capUsd),
      remainingUsd: remaining === null ? null : Math.max(0, usdWhole(remaining)),
      window: limits.window,
    }
  }

  /**
   * Reserves headroom for an outbound movement. Reserve-then-move rather than
   * check-then-move, so two concurrent withdrawals cannot both pass a check
   * against the same headroom.
   */
  reserveOutbound(input: {
    userId: number
    tier: number
    symbol: string
    amount: bigint
    now?: Date
  }): { ok: true; amountUsd: bigint; windowKey: string } | { ok: false; denial: LimitDenial } {
    const now = input.now ?? new Date()
    const limits = this.limits(input.tier)
    const key = windowKey(limits, now)
    const amountUsd = this.valueUsd(input.symbol, input.amount)

    if (amountUsd === null) {
      return {
        ok: false,
        denial: {
          code: "no_price",
          message:
            "We cannot price that asset right now, so we cannot check it against your limit. Try again shortly.",
        },
      }
    }

    const consumed = this.deps.usage.consume({
      userId: input.userId,
      kind: "outbound",
      windowKey: key,
      amountUsd,
      capUsd: limits.capUsd,
    })

    if (!consumed) {
      const status = this.status(input.userId, input.tier, now)
      return {
        ok: false,
        denial: {
          code: "over_limit",
          message:
            limits.window === "lifetime"
              ? `That would take you past the $${status.capUsd?.toLocaleString("en-US")} limit for unverified accounts. Verify your identity to raise it.`
              : `That would take you past your $${status.capUsd?.toLocaleString("en-US")} daily limit. It resets at 00:00 UTC.`,
          remainingUsd: status.remainingUsd ?? 0,
          capUsd: status.capUsd ?? 0,
        },
      }
    }

    return { ok: true, amountUsd, windowKey: key }
  }

  releaseOutbound(userId: number, key: string, amountUsd: bigint): void {
    this.deps.usage.release({ userId, kind: "outbound", windowKey: key, amountUsd })
  }

  /** Deposits are recorded but never refused: the funds have already arrived. */
  recordInbound(userId: number, symbol: string, amount: bigint, now: Date = new Date()): void {
    const value = this.valueUsd(symbol, amount)
    if (value === null) return
    this.deps.usage.consume({
      userId,
      kind: "inbound",
      windowKey: windowKey({ ...this.limits(0), window: "lifetime" }, now),
      amountUsd: value,
      capUsd: null,
    })
  }
}
