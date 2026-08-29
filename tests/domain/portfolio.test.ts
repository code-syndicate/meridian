import { test, expect, describe } from "bun:test"
import { valueHolding, buildPortfolio } from "../../src/domain/portfolio"
import { openDatabase, migrate } from "../../src/db"
import { AssetRepository } from "../../src/db/repositories/assets"
import type { Quote } from "../../src/domain/prices"

function assets() {
  const db = openDatabase(":memory:")
  migrate(db)
  return new AssetRepository(db).all()
}

function quote(symbol: string, priceUsd: bigint): Quote {
  return {
    symbol, displaySymbol: symbol, name: symbol, priceUsd,
    change24h: 0, sparkline: [], updatedAt: "2026-08-29T00:00:00.000Z",
  }
}

describe("valueHolding", () => {
  test("values one unit at the unit price", () => {
    expect(valueHolding(100000000n, 6741208000000n)).toBe(6741208000000n)
  })
  test("values a fractional holding", () => {
    expect(valueHolding(50000000n, 6741208000000n)).toBe(3370604000000n)
  })
  test("values a zero holding at zero", () => {
    expect(valueHolding(0n, 6741208000000n)).toBe(0n)
  })
  test("values any holding at a zero price as zero", () => {
    expect(valueHolding(100000000n, 0n)).toBe(0n)
  })
  test("truncates rather than rounding up, so value is never overstated", () => {
    // 0.00000001 units at 0.5 USD is 0.000000005, which truncates to 0.
    expect(valueHolding(1n, 50000000n)).toBe(0n)
  })
  test("stays exact far above 2^53", () => {
    const big = 9007199254740993n
    expect(valueHolding(big, 100000000n)).toBe(big)
  })
  test("returns bigint, never number", () => {
    expect(typeof valueHolding(100000000n, 6741208000000n)).toBe("bigint")
  })
})

describe("buildPortfolio", () => {
  const quotes = [quote("BTC", 6741208000000n), quote("ETH", 243611000000n)]

  test("returns a row for every asset, including zero balances", () => {
    const portfolio = buildPortfolio({ assets: assets(), balances: new Map(), quotes })
    expect(portfolio.rows).toHaveLength(10)
  })

  test("returns zero total for an empty portfolio", () => {
    const portfolio = buildPortfolio({ assets: assets(), balances: new Map(), quotes })
    expect(portfolio.totalUsd).toBe(0n)
    expect(portfolio.empty).toBe(true)
  })

  test("totals the value of every priced holding", () => {
    const balances = new Map([
      ["BTC", { available: 100000000n, held: 0n }],
      ["ETH", { available: 200000000n, held: 0n }],
    ])
    const portfolio = buildPortfolio({ assets: assets(), balances, quotes })
    expect(portfolio.totalUsd).toBe(6741208000000n + 243611000000n * 2n)
  })

  test("counts held balance in the total, because it is still owned", () => {
    const balances = new Map([["BTC", { available: 50000000n, held: 50000000n }]])
    const portfolio = buildPortfolio({ assets: assets(), balances, quotes })
    expect(portfolio.totalUsd).toBe(6741208000000n)
  })

  test("includes an unpriced asset with a null price and zero value", () => {
    const balances = new Map([["SOL", { available: 100000000n, held: 0n }]])
    const portfolio = buildPortfolio({ assets: assets(), balances, quotes })
    const sol = portfolio.rows.find((r) => r.symbol === "SOL")!
    expect(sol.priceUsd).toBeNull()
    expect(sol.valueUsd).toBe(0n)
    expect(sol.available).toBe(100000000n)
  })

  test("flags priced false when no quote covers any holding", () => {
    const balances = new Map([["SOL", { available: 100000000n, held: 0n }]])
    expect(buildPortfolio({ assets: assets(), balances, quotes }).priced).toBe(false)
  })

  test("flags pricesUnavailable when the feed returned nothing", () => {
    const portfolio = buildPortfolio({ assets: assets(), balances: new Map(), quotes: [] })
    expect(portfolio.pricesUnavailable).toBe(true)
  })

  test("orders rows by the asset registry sort order", () => {
    const portfolio = buildPortfolio({ assets: assets(), balances: new Map(), quotes })
    expect(portfolio.rows[0]!.symbol).toBe("BTC")
  })

  test("is not empty once anything is held", () => {
    const balances = new Map([["BTC", { available: 1n, held: 0n }]])
    expect(buildPortfolio({ assets: assets(), balances, quotes }).empty).toBe(false)
  })
})
