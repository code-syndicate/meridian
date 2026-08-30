import { LimitService } from "../../src/services/limits"
import { UsageRepository } from "../../src/db/repositories/usage"
import { priceFromFeed, type Quote } from "../../src/domain/prices"
import type { Database } from "bun:sqlite"

/** Every supported asset priced at $1 unless overridden, so amounts read as dollars. */
export function fakePrices(overrides: Record<string, number> = {}) {
  const symbols = [
    "BTC", "ETH", "USDT_ERC20", "USDC_ERC20", "TRX",
    "USDT_TRC20", "SOL", "USDC_SPL", "BNB", "USDT_BEP20",
  ]
  const quotes: Quote[] = symbols.map((symbol) => ({
    symbol,
    displaySymbol: symbol,
    name: symbol,
    priceUsd: priceFromFeed(overrides[symbol] ?? 1),
    change24h: 0,
    updatedAt: new Date().toISOString(),
    sparkline: [],
    marketCap: 0,
    volume24h: 0,
  }))
  return { snapshot: () => quotes }
}

/** Caps high enough that a test not about limits is unaffected by them. */
export function testLimits(
  db: Database,
  options: {
    prices?: { snapshot: () => Quote[] }
    freeTierLimitUsd?: number
    tier1DailyLimitUsd?: number
    tier2DailyLimitUsd?: number
  } = {},
): LimitService {
  return new LimitService({
    usage: new UsageRepository(db),
    prices: options.prices ?? fakePrices(),
    config: {
      freeTierLimitUsd: options.freeTierLimitUsd ?? 1_000_000_000,
      tier1DailyLimitUsd: options.tier1DailyLimitUsd ?? 1_000_000_000,
      tier2DailyLimitUsd: options.tier2DailyLimitUsd ?? 1_000_000_000,
    },
  })
}

/**
 * A pre-warmed feed. Route tests need one because limits fail closed without a
 * price, which is the intended behaviour but would otherwise fail every test.
 */
export async function warmPriceFeed(db: Database, usd = 1) {
  const { PriceFeed, COINGECKO_IDS } = await import("../../src/services/price-feed")
  const { AssetRepository } = await import("../../src/db/repositories/assets")
  const source = {
    async fetch() {
      return new Map(
        Object.values(COINGECKO_IDS).map((id) => [
          id,
          { usd, change24h: 0, sparkline: [], marketCap: 0, volume24h: 0 },
        ]),
      )
    },
  }
  const feed = new PriceFeed(source as never, new AssetRepository(db).all())
  await feed.refresh()
  return feed
}
