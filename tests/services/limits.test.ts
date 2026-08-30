import { test, expect, describe, beforeEach } from "bun:test"
import { openDatabase, migrate } from "../../src/db"
import { UsageRepository } from "../../src/db/repositories/usage"
import { LimitService } from "../../src/services/limits"
import { UserRepository } from "../../src/db/repositories/users"
import { parseAmount } from "../../src/domain/money"
import { fakePrices } from "../support/limits"
import type { Database } from "bun:sqlite"

let db: Database
let userId: number

function service(overrides: Parameters<typeof fakePrices>[0] = {}, caps = {}) {
  return new LimitService({
    usage: new UsageRepository(db),
    prices: fakePrices(overrides),
    config: {
      freeTierLimitUsd: 1_000,
      tier1DailyLimitUsd: 10_000,
      tier2DailyLimitUsd: 100_000,
      ...caps,
    },
  })
}

beforeEach(async () => {
  db = openDatabase(":memory:")
  migrate(db)
  const { hashPassword } = await import("../../src/domain/identity/password")
  userId = new UserRepository(db).create("a@test.co", await hashPassword("Sufficiently long pw 1"))
})

describe("unverified accounts", () => {
  test("may move value up to the configured limit", () => {
    const svc = service()
    const result = svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("900") })
    expect(result.ok).toBe(true)
  })

  test("are refused past it, and told to verify", () => {
    const svc = service()
    svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("900") })
    const result = svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("200") })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.denial.code).toBe("over_limit")
    expect(result.denial.message).toContain("Verify your identity")
  })

  test("are capped over their lifetime, not per day", () => {
    const svc = service()
    const yesterday = new Date("2026-08-28T12:00:00Z")
    const today = new Date("2026-08-29T12:00:00Z")
    expect(svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("1000"), now: yesterday }).ok).toBe(true)
    // A new day must not hand an unverified account a fresh allowance.
    expect(svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("1"), now: today }).ok).toBe(false)
  })

  test("the cap counts value, not units, so a pricier asset consumes more", () => {
    const svc = service({ BTC: 100_000 })
    // 0.02 BTC at $100,000 is $2,000, past a $1,000 limit.
    const result = svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("0.02") })
    expect(result.ok).toBe(false)
  })
})

describe("verified tiers", () => {
  test("get the configured daily cap", () => {
    const svc = service()
    expect(svc.reserveOutbound({ userId, tier: 1, symbol: "BTC", amount: parseAmount("9000") }).ok).toBe(true)
    expect(svc.reserveOutbound({ userId, tier: 1, symbol: "BTC", amount: parseAmount("2000") }).ok).toBe(false)
  })

  test("a daily cap resets the next day", () => {
    const svc = service()
    const day1 = new Date("2026-08-28T23:59:00Z")
    const day2 = new Date("2026-08-29T00:01:00Z")
    expect(svc.reserveOutbound({ userId, tier: 1, symbol: "BTC", amount: parseAmount("10000"), now: day1 }).ok).toBe(true)
    expect(svc.reserveOutbound({ userId, tier: 1, symbol: "BTC", amount: parseAmount("10000"), now: day2 }).ok).toBe(true)
  })

  test("tier 2 has more headroom than tier 1", () => {
    const svc = service()
    expect(svc.status(userId, 2).capUsd).toBeGreaterThan(svc.status(userId, 1).capUsd!)
  })
})

describe("failing closed", () => {
  test("an asset with no price is refused rather than waved through", () => {
    const svc = service()
    const result = svc.reserveOutbound({ userId, tier: 0, symbol: "UNLISTED", amount: parseAmount("1") })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.denial.code).toBe("no_price")
  })

  test("a zero price is treated as no price, not as a free withdrawal", () => {
    const svc = service({ BTC: 0 })
    const result = svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("999999") })
    expect(result.ok).toBe(false)
  })
})

describe("accounting", () => {
  test("headroom is reserved before the movement, so two racing requests cannot both pass", () => {
    const svc = service()
    const a = svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("600") })
    const b = svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("600") })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(false)
  })

  test("a failed movement gives the headroom back", () => {
    const svc = service()
    const first = svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("900") })
    if (!first.ok) throw new Error("unreachable")
    svc.releaseOutbound(userId, first.windowKey, first.amountUsd)
    expect(svc.status(userId, 0).usedUsd).toBe(0)
    expect(svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("900") }).ok).toBe(true)
  })

  test("deposits are recorded but never consume the outbound allowance", () => {
    const svc = service()
    svc.recordInbound(userId, "BTC", parseAmount("5000"))
    expect(svc.status(userId, 0).remainingUsd).toBe(1_000)
  })

  test("reports used, cap, and remaining", () => {
    const svc = service()
    svc.reserveOutbound({ userId, tier: 0, symbol: "BTC", amount: parseAmount("250") })
    const status = svc.status(userId, 0)
    expect(status.usedUsd).toBe(250)
    expect(status.capUsd).toBe(1_000)
    expect(status.remainingUsd).toBe(750)
    expect(status.window).toBe("lifetime")
  })
})
