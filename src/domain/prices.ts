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

export function formatUsd(priceUsd: bigint): string {
  // Sub-dollar assets need more than two decimals to say anything at all.
  const decimals = priceUsd > 0n && priceUsd < 100000000n ? 8 : 2
  const plain = formatBalance(priceUsd, decimals)
  const [whole = "0", fraction = ""] = plain.split(".")
  return `${group(whole)}.${fraction}`
}

export function directionOf(change24h: number): "up" | "down" | "flat" {
  if (change24h > 0) return "up"
  if (change24h < 0) return "down"
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
