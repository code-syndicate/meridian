import { parseAmount, formatBalance } from "./money"

export interface Quote {
  symbol: string
  displaySymbol: string
  name: string
  priceUsd: bigint
  change24h: number
  updatedAt: string
  sparkline: number[]
  marketCap: number
  volume24h: number
}

export interface TickerRow {
  symbol: string
  price: string
  change: string
  direction: "up" | "down" | "flat"
}

/**
 * The external feed hands us JSON numbers. This is the only place a float
 * touches a price, and it converts through the decimal string so no binary
 * rounding survives into the rest of the system. Indicative display data only.
 */
export function priceFromFeed(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error(`Price is not finite: ${value}`)
  }
  if (value < 0) {
    throw new Error(`Price may not be negative: ${value}`)
  }
  return parseAmount(value.toFixed(8))
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

const ONE_DOLLAR = 100000000n
const ONE_CENT = 1000000n

/**
 * Precision follows magnitude, because a fixed width either wastes digits on
 * large prices or says nothing about small ones. Three tiers keeps assets of
 * similar value looking alike, which two tiers did not: a stablecoin a hair
 * under a dollar rendered at eight decimals beside one at two.
 */
export interface MoneyParts {
  whole: string
  fraction: string
}

function decimalsFor(priceUsd: bigint): number {
  if (priceUsd > 0n && priceUsd < ONE_CENT) return 8
  if (priceUsd > 0n && priceUsd < ONE_DOLLAR) return 4
  return 2
}

/** Split so a template can mute the fraction. Spec 4.4. */
export function balanceParts(base: bigint, displayDecimals: number): MoneyParts {
  const plain = formatBalance(base, displayDecimals)
  const [whole = "0", fraction = ""] = plain.split(".")
  return { whole: group(whole), fraction }
}

export function usdParts(priceUsd: bigint): MoneyParts {
  return balanceParts(priceUsd, decimalsFor(priceUsd))
}

// A thin wrapper, so the split and the string can never disagree.
export function formatUsd(priceUsd: bigint): string {
  const { whole, fraction } = usdParts(priceUsd)
  return fraction ? `${whole}.${fraction}` : whole
}

/**
 * Direction is decided on the rounded figure, not the raw one. A change of
 * -0.0004 displays as 0.00% and must not carry a down arrow: an arrow beside
 * a zero reads as a bug to anyone looking at it.
 */
export function directionOf(change24h: number): "up" | "down" | "flat" {
  const rounded = Number(change24h.toFixed(2))
  if (rounded > 0) return "up"
  if (rounded < 0) return "down"
  return "flat"
}

export function formatChange(change24h: number): string {
  const rounded = Math.abs(change24h).toFixed(2)
  const direction = directionOf(change24h)
  if (direction === "flat") return `${rounded}%`
  return `${direction === "up" ? "▲" : "▼"}${rounded}%`
}

/** Compact money, the way every exchange writes market cap and volume. */
export function formatCompactUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "\u2014"
  const units: Array<[number, string]> = [
    [1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"],
  ]
  for (const [size, suffix] of units) {
    if (value >= size) {
      const scaled = value / size
      return `$${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(2)}${suffix}`
    }
  }
  return `$${value.toFixed(2)}`
}

export function toTickerRow(quote: Quote): TickerRow {
  return {
    symbol: quote.displaySymbol,
    price: formatUsd(quote.priceUsd),
    change: formatChange(quote.change24h),
    direction: directionOf(quote.change24h),
  }
}
