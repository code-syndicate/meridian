import { test, expect, describe } from "bun:test"
import { formatBalance } from "../../src/domain/money"
import {
  priceFromFeed,
  formatUsd,
  formatChange,
  directionOf,
  toTickerRow,
  usdParts,
  balanceParts,
  type Quote,
} from "../../src/domain/prices"

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "BTC",
    displaySymbol: "BTC",
    name: "Bitcoin",
    priceUsd: 6741208000000n,
    change24h: 2.41,
    sparkline: [],
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  }
}

describe("priceFromFeed", () => {
  test("converts a float price to base units", () => {
    expect(priceFromFeed(67412.08)).toBe(6741208000000n)
  })

  test("converts a sub-cent price without losing significant digits", () => {
    expect(priceFromFeed(0.00002341)).toBe(2341n)
  })

  test("converts an integer price", () => {
    expect(priceFromFeed(1)).toBe(100000000n)
  })

  test("converts zero", () => {
    expect(priceFromFeed(0)).toBe(0n)
  })

  test("returns bigint, never number", () => {
    expect(typeof priceFromFeed(67412.08)).toBe("bigint")
  })

  test("rejects a negative price", () => {
    expect(() => priceFromFeed(-1)).toThrow()
  })

  test("rejects a non-finite price", () => {
    expect(() => priceFromFeed(Number.NaN)).toThrow()
    expect(() => priceFromFeed(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe("formatUsd", () => {
  test("groups thousands and shows two decimals", () => {
    expect(formatUsd(6741208000000n)).toBe("67,412.08")
  })

  test("does not group below a thousand", () => {
    expect(formatUsd(150000000n)).toBe("1.50")
  })

  test("uses four decimals between a cent and a dollar", () => {
    expect(formatUsd(99999000n)).toBe("0.9999")
    expect(formatUsd(33830400n)).toBe("0.3383")
  })

  test("uses eight decimals below a cent", () => {
    expect(formatUsd(2341n)).toBe("0.00002341")
  })

  test("renders two near-identical stablecoins at the same width", () => {
    // One a hair under a dollar, one exactly on it. They must not look
    // like different kinds of number.
    const justUnder = formatUsd(99999000n)
    const exactlyOne = formatUsd(100000000n)
    expect(justUnder.split(".")[1]!.length).toBeLessThanOrEqual(4)
    expect(exactlyOne).toBe("1.00")
  })

  test("formats zero", () => {
    expect(formatUsd(0n)).toBe("0.00")
  })

  test("groups millions", () => {
    expect(formatUsd(123456789000000000n)).toBe("1,234,567,890.00")
  })
})

describe("formatChange", () => {
  test("prefixes a positive change with an up glyph and a sign", () => {
    expect(formatChange(2.41)).toBe("▲2.41%")
  })

  test("prefixes a negative change with a down glyph and a sign", () => {
    expect(formatChange(-1.2)).toBe("▼1.20%")
  })

  test("marks a flat change without a direction glyph", () => {
    expect(formatChange(0)).toBe("0.00%")
  })

  test("rounds to two decimals", () => {
    expect(formatChange(2.4567)).toBe("▲2.46%")
  })
})

describe("directionOf", () => {
  test("classifies positive, negative, and flat", () => {
    expect(directionOf(0.1)).toBe("up")
    expect(directionOf(-0.1)).toBe("down")
    expect(directionOf(0)).toBe("flat")
  })

  test("treats a change that rounds to zero as flat, not down", () => {
    // Stablecoins produce these constantly. A down arrow beside 0.00% is wrong.
    expect(directionOf(-0.0004)).toBe("flat")
    expect(directionOf(0.0004)).toBe("flat")
  })
})

describe("direction and magnitude agree", () => {
  test("a change displaying as 0.00% never carries a direction glyph", () => {
    for (const value of [-0.0004, 0.0004, -0.001, 0.004, 0]) {
      expect(formatChange(value)).toBe("0.00%")
      expect(directionOf(value)).toBe("flat")
    }
  })

  test("a change that survives rounding keeps its glyph", () => {
    expect(formatChange(-0.005)).toBe("▼0.01%")
    expect(directionOf(-0.005)).toBe("down")
  })
})

describe("toTickerRow", () => {
  test("builds a row carrying both glyph and colour class", () => {
    expect(toTickerRow(quote())).toEqual({
      symbol: "BTC",
      price: "67,412.08",
      change: "▲2.41%",
      direction: "up",
    })
  })

  test("uses the display symbol rather than the qualified symbol", () => {
    const row = toTickerRow(quote({ symbol: "USDT_TRC20", displaySymbol: "USDT" }))
    expect(row.symbol).toBe("USDT")
  })

  test("never conveys direction by colour alone", () => {
    const down = toTickerRow(quote({ change24h: -3 }))
    expect(down.change).toContain("▼")
    expect(down.direction).toBe("down")
  })
})

describe("usdParts", () => {
  test("splits a grouped price into whole and fraction", () => {
    expect(usdParts(6741208000000n)).toEqual({ whole: "67,412", fraction: "08" })
  })
  test("splits a sub-dollar price at four decimals", () => {
    expect(usdParts(33830400n)).toEqual({ whole: "0", fraction: "3383" })
  })
  test("splits a sub-cent price at eight decimals", () => {
    expect(usdParts(2341n)).toEqual({ whole: "0", fraction: "00002341" })
  })
  test("recombines to exactly what formatUsd returns", () => {
    for (const value of [6741208000000n, 33830400n, 2341n, 0n, 100000000n]) {
      const parts = usdParts(value)
      expect(`${parts.whole}.${parts.fraction}`).toBe(formatUsd(value))
    }
  })
})

describe("balanceParts", () => {
  test("splits a balance at the asset's display precision", () => {
    expect(balanceParts(150000000n, 4)).toEqual({ whole: "1", fraction: "5000" })
  })
  test("groups thousands in the whole part", () => {
    expect(balanceParts(123456700000000n, 2)).toEqual({ whole: "1,234,567", fraction: "00" })
  })
  test("recombines to formatBalance plus grouping", () => {
    const parts = balanceParts(150000000n, 8)
    expect(`${parts.whole}.${parts.fraction}`.replace(/,/g, "")).toBe(formatBalance(150000000n, 8))
  })
  test("handles zero decimals with an empty fraction", () => {
    expect(balanceParts(150000000n, 0)).toEqual({ whole: "1", fraction: "" })
  })
})
