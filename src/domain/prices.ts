import { parseAmount, formatBalance } from "./money"

export interface Quote {
  symbol: string
  displaySymbol: string
  name: string
  priceUsd: bigint
  change24h: number
  updatedAt: string
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
export function formatUsd(priceUsd: bigint): string {
  let decimals = 2
  if (priceUsd > 0n && priceUsd < ONE_CENT) decimals = 8
  else if (priceUsd > 0n && priceUsd < ONE_DOLLAR) decimals = 4

  const plain = formatBalance(priceUsd, decimals)
  const [whole = "0", fraction = ""] = plain.split(".")
  return `${group(whole)}.${fraction}`
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

export function toTickerRow(quote: Quote): TickerRow {
  return {
    symbol: quote.displaySymbol,
    price: formatUsd(quote.priceUsd),
    change: formatChange(quote.change24h),
    direction: directionOf(quote.change24h),
  }
}
