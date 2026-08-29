import { test, expect, describe } from "bun:test"
import {
  INTERNAL_DECIMALS,
  parseAmount,
  formatBalance,
  formatPrice,
  fromNative,
  toNative,
  isRepresentableAtNative,
} from "../../src/domain/money"

describe("INTERNAL_DECIMALS", () => {
  test("is fixed at 8", () => {
    expect(INTERNAL_DECIMALS).toBe(8)
  })
})

describe("parseAmount", () => {
  test("parses a whole number", () => {
    expect(parseAmount("1")).toBe(100000000n)
  })

  test("parses a fractional amount", () => {
    expect(parseAmount("1.5")).toBe(150000000n)
  })

  test("parses full internal precision", () => {
    expect(parseAmount("0.00000001")).toBe(1n)
  })

  test("parses zero", () => {
    expect(parseAmount("0")).toBe(0n)
  })

  test("parses a large amount without precision loss", () => {
    expect(parseAmount("21000000.12345678")).toBe(2100000012345678n)
  })

  test("rejects more than 8 decimal places rather than truncating", () => {
    expect(() => parseAmount("0.000000001")).toThrow(/decimal places/)
  })

  test("rejects a negative amount", () => {
    expect(() => parseAmount("-1")).toThrow(/negative/)
  })

  test("rejects non-numeric input", () => {
    expect(() => parseAmount("abc")).toThrow()
    expect(() => parseAmount("")).toThrow()
    expect(() => parseAmount("1.2.3")).toThrow()
    expect(() => parseAmount("1e10")).toThrow()
  })
})

describe("formatBalance", () => {
  test("rounds down so a balance is never overstated", () => {
    expect(formatBalance(199999999n, 2)).toBe("1.99")
    expect(formatBalance(199999999n, 4)).toBe("1.9999")
  })

  test("pads to the requested precision", () => {
    expect(formatBalance(150000000n, 4)).toBe("1.5000")
  })

  test("formats zero", () => {
    expect(formatBalance(0n, 2)).toBe("0.00")
  })

  test("formats with zero decimals", () => {
    expect(formatBalance(199999999n, 0)).toBe("1")
  })
})

describe("formatPrice", () => {
  test("rounds half to even", () => {
    expect(formatPrice(150n, 6)).toBe("0.000002")
    expect(formatPrice(250n, 6)).toBe("0.000002")
    expect(formatPrice(350n, 6)).toBe("0.000004")
  })

  test("rounds up above the midpoint", () => {
    expect(formatPrice(151n, 6)).toBe("0.000002")
    expect(formatPrice(160n, 6)).toBe("0.000002")
  })
})

describe("fromNative", () => {
  test("converts 18-decimal ETH and captures the dust remainder", () => {
    const { base, dust } = fromNative(1234567890123456789n, 18)
    expect(base).toBe(123456789n)
    expect(dust).toBe(123456789n)
  })

  test("leaves no dust when the value divides exactly", () => {
    const { base, dust } = fromNative(1000000000000000000n, 18)
    expect(base).toBe(100000000n)
    expect(dust).toBe(0n)
  })

  test("scales up from 6-decimal USDT", () => {
    const { base, dust } = fromNative(1500000n, 6)
    expect(base).toBe(150000000n)
    expect(dust).toBe(0n)
  })

  test("is exact for 8-decimal BTC", () => {
    const { base, dust } = fromNative(123456789n, 8)
    expect(base).toBe(123456789n)
    expect(dust).toBe(0n)
  })

  test("never loses value: base scaled back plus dust equals the input", () => {
    const native = 987654321987654321n
    const { base, dust } = fromNative(native, 18)
    expect(base * 10n ** 10n + dust).toBe(native)
  })
})

describe("toNative", () => {
  test("scales up to 18-decimal ETH", () => {
    expect(toNative(100000000n, 18)).toBe(1000000000000000000n)
  })

  test("scales down to 6-decimal USDT when exactly representable", () => {
    expect(toNative(150000000n, 6)).toBe(1500000n)
  })

  test("throws rather than silently truncating an unrepresentable amount", () => {
    expect(() => toNative(150000001n, 6)).toThrow(/not representable/)
  })
})

describe("isRepresentableAtNative", () => {
  test("accepts an amount that fits the native precision", () => {
    expect(isRepresentableAtNative(150000000n, 6)).toBe(true)
  })

  test("rejects an amount with precision below the native precision", () => {
    expect(isRepresentableAtNative(150000001n, 6)).toBe(false)
  })

  test("accepts anything when native precision is at or above internal", () => {
    expect(isRepresentableAtNative(150000001n, 8)).toBe(true)
    expect(isRepresentableAtNative(150000001n, 18)).toBe(true)
  })
})

describe("round trip properties", () => {
  test("parse then format is identity at full precision", () => {
    for (const value of ["0.00000001", "1.00000000", "21000000.12345678", "0.00000000"]) {
      expect(formatBalance(parseAmount(value), 8)).toBe(value)
    }
  })

  test("random base amounts survive fromNative(toNative(x)) at 18 decimals", () => {
    for (let i = 0; i < 500; i++) {
      const base = BigInt(Math.floor(Math.random() * 1_000_000_000_000))
      expect(fromNative(toNative(base, 18), 18).base).toBe(base)
    }
  })
})
