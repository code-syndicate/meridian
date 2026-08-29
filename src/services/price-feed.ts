import type { Asset } from "../db/repositories/assets"
import { priceFromFeed, type Quote } from "../domain/prices"
import { COINGECKO_IDS, type PriceSource, type RawPrice } from "./price-source"

export type { PriceSource, RawPrice }
export { CoinGeckoSource, COINGECKO_IDS } from "./price-source"

const DEFAULT_TTL_MS = 10_000

export class PriceFeed {
  private quotes: Quote[] = []
  private fetchedAt = 0
  private subscribers = new Set<(quotes: Quote[]) => void>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly source: PriceSource,
    private readonly assets: Asset[],
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  snapshot(): Quote[] {
    return this.quotes
  }

  async refresh(): Promise<void> {
    if (this.quotes.length > 0 && Date.now() - this.fetchedAt < this.ttlMs) {
      return
    }

    let raw: Map<string, RawPrice>
    try {
      const ids = this.assets
        .map((asset) => COINGECKO_IDS[asset.symbol])
        .filter((id): id is string => Boolean(id))
      raw = await this.source.fetch(ids)
    } catch (error) {
      // Serving a slightly stale indicative price beats serving nothing.
      console.error(
        JSON.stringify({ msg: "price_refresh_failed", error: String(error) }),
      )
      return
    }

    const updatedAt = new Date().toISOString()
    const next: Quote[] = []
    for (const asset of this.assets) {
      const id = COINGECKO_IDS[asset.symbol]
      if (!id) continue
      const price = raw.get(id)
      if (!price) continue
      next.push({
        symbol: asset.symbol,
        displaySymbol: asset.displaySymbol,
        name: asset.name,
        priceUsd: priceFromFeed(price.usd),
        change24h: price.change24h,
        updatedAt,
      })
    }

    this.quotes = next
    this.fetchedAt = Date.now()

    for (const subscriber of this.subscribers) {
      try {
        subscriber(next)
      } catch (error) {
        console.error(
          JSON.stringify({ msg: "price_subscriber_failed", error: String(error) }),
        )
      }
    }
  }

  subscribe(fn: (quotes: Quote[]) => void): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.ttlMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
