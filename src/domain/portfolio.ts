import { INTERNAL_SCALE } from "./money"
import type { Quote } from "./prices"
import type { Asset } from "../db/repositories/assets"

export interface HoldingRow {
  symbol: string
  displaySymbol: string
  name: string
  networkLabel: string
  displayDecimals: number
  available: bigint
  held: bigint
  priceUsd: bigint | null
  valueUsd: bigint
}

export interface Portfolio {
  totalUsd: bigint
  rows: HoldingRow[]
  /** True once at least one held asset has a price. */
  priced: boolean
  /** True when the feed returned nothing at all. */
  pricesUnavailable: boolean
  empty: boolean
}

/**
 * Both operands are base units at 8 decimal places, so the product carries
 * 16 and must be divided back down. Division truncates, which means a value
 * is never overstated. That is the right direction for a balance.
 */
export function valueHolding(amount: bigint, priceUsd: bigint): bigint {
  return (amount * priceUsd) / INTERNAL_SCALE
}

export function buildPortfolio(input: {
  assets: Asset[]
  balances: Map<string, { available: bigint; held: bigint }>
  quotes: Quote[]
}): Portfolio {
  const prices = new Map(input.quotes.map((q) => [q.symbol, q.priceUsd]))
  let totalUsd = 0n
  let priced = false
  let empty = true

  const rows = input.assets.map((asset) => {
    const balance = input.balances.get(asset.symbol) ?? { available: 0n, held: 0n }
    const priceUsd = prices.get(asset.symbol) ?? null
    const owned = balance.available + balance.held
    const valueUsd = priceUsd === null ? 0n : valueHolding(owned, priceUsd)

    if (owned > 0n) {
      empty = false
      if (priceUsd !== null) priced = true
    }
    totalUsd += valueUsd

    return {
      symbol: asset.symbol,
      displaySymbol: asset.displaySymbol,
      name: asset.name,
      networkLabel: asset.networkLabel,
      displayDecimals: asset.displayDecimals,
      available: balance.available,
      held: balance.held,
      priceUsd,
      valueUsd,
    }
  })

  return {
    totalUsd,
    rows,
    priced,
    pricesUnavailable: input.quotes.length === 0,
    empty,
  }
}
