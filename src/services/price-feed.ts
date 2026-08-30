import type { Asset } from "../db/repositories/assets"
import { priceFromFeed, type Quote } from "../domain/prices"
import { COINGECKO_IDS, PriceSourceError, type PriceSource, type RawPrice } from "./price-source"

type SerializedQuote = Omit<Quote, "priceUsd"> & { priceUsd: string }

export type { PriceSource, RawPrice }
export { CoinGeckoSource, COINGECKO_IDS } from "./price-source"

// CoinGecko's free tier is a handful of calls a minute across the whole IP.
// Ten seconds guaranteed 429s, and a rate-limited feed is worse than a
// slightly older one.
const DEFAULT_TTL_MS = 60_000
const MAX_BACKOFF_MS = 15 * 60_000
const CACHE_FILE = "data/price-cache.json"

export class PriceFeed {
  private quotes: Quote[] = []
  private fetchedAt = 0
  private subscribers = new Set<(quotes: Quote[]) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<void> | null = null
  private failures = 0
  private nextAttemptAt = 0

  constructor(
    private readonly source: PriceSource,
    private readonly assets: Asset[],
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly cachePath: string | null = CACHE_FILE,
  ) {}

  snapshot(): Quote[] {
    return this.quotes
  }

  /** Age of the served prices, so callers can label them honestly. */
  ageMs(): number {
    return this.fetchedAt === 0 ? Infinity : Date.now() - this.fetchedAt
  }

  async refresh(): Promise<void> {
    // Two callers arriving at once must not become two upstream calls.
    if (this.inFlight) return this.inFlight
    this.inFlight = this.doRefresh().finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private async doRefresh(): Promise<void> {
    const now = Date.now()
    if (this.quotes.length > 0 && now - this.fetchedAt < this.ttlMs) {
      return
    }
    // Backing off after a rejection. Retrying on the normal cadence is what
    // turns one 429 into a steady stream of them.
    if (now < this.nextAttemptAt) {
      return
    }

    let raw: Map<string, RawPrice>
    try {
      const ids = this.assets
        .map((asset) => COINGECKO_IDS[asset.symbol])
        .filter((id): id is string => Boolean(id))
      raw = await this.source.fetch(ids)
    } catch (error) {
      this.failures++
      const advised = error instanceof PriceSourceError ? error.retryAfterMs : null
      const backoff = Math.min(this.ttlMs * 2 ** this.failures, MAX_BACKOFF_MS)
      const wait = Math.max(advised ?? 0, backoff)
      this.nextAttemptAt = Date.now() + wait
      // Logged once per failure, not once per tick, because the ticks now stop.
      console.error(JSON.stringify({
        msg: "price_refresh_failed",
        error: String(error),
        failures: this.failures,
        retryInSeconds: Math.round(wait / 1000),
        servingCached: this.quotes.length > 0,
      }))
      return
    }
    this.failures = 0
    this.nextAttemptAt = 0

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
        sparkline: price.sparkline,
        marketCap: price.marketCap,
        volume24h: price.volume24h,
        updatedAt,
      })
    }

    if (next.length === 0) return
    this.quotes = next
    this.fetchedAt = Date.now()
    void this.writeCache()

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

  /**
   * Last good prices from disk. A restart then serves immediately and does not
   * need an upstream call to render its first page, which is most of what was
   * burning the rate limit during development reloads.
   */
  async loadCache(): Promise<void> {
    if (!this.cachePath) return
    try {
      const file = Bun.file(this.cachePath)
      if (!(await file.exists())) return
      const cached = (await file.json()) as { fetchedAt: number; quotes: SerializedQuote[] }
      if (!Array.isArray(cached.quotes) || cached.quotes.length === 0) return
      this.quotes = cached.quotes.map((q) => ({ ...q, priceUsd: BigInt(q.priceUsd) }))
      this.fetchedAt = cached.fetchedAt
    } catch (error) {
      console.error(JSON.stringify({ msg: "price_cache_read_failed", error: String(error) }))
    }
  }

  private async writeCache(): Promise<void> {
    if (!this.cachePath) return
    try {
      await Bun.write(this.cachePath, JSON.stringify({
        fetchedAt: this.fetchedAt,
        quotes: this.quotes.map((q) => ({ ...q, priceUsd: q.priceUsd.toString() })),
      }))
    } catch (error) {
      console.error(JSON.stringify({ msg: "price_cache_write_failed", error: String(error) }))
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
