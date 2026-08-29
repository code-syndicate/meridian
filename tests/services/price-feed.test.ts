import { test, expect, describe, beforeEach } from "bun:test"
import { PriceFeed, type PriceSource, type RawPrice } from "../../src/services/price-feed"
import { openDatabase, migrate } from "../../src/db"
import { AssetRepository } from "../../src/db/repositories/assets"

class FakeSource implements PriceSource {
  calls = 0
  failNext = false
  prices = new Map<string, RawPrice>([
    ["bitcoin", { usd: 67412.08, change24h: 2.41, sparkline: [] }],
    ["ethereum", { usd: 3120.5, change24h: -1.2, sparkline: [] }],
    ["tether", { usd: 1.0, change24h: 0.01, sparkline: [] }],
  ])

  async fetch(): Promise<Map<string, RawPrice>> {
    this.calls++
    if (this.failNext) {
      this.failNext = false
      throw new Error("upstream down")
    }
    return this.prices
  }
}

function assets() {
  const db = openDatabase(":memory:")
  migrate(db)
  return new AssetRepository(db).all()
}

let source: FakeSource
let feed: PriceFeed

beforeEach(() => {
  source = new FakeSource()
  feed = new PriceFeed(source, assets())
})

describe("snapshot", () => {
  test("is empty before the first refresh", () => {
    expect(feed.snapshot()).toEqual([])
  })

  test("returns quotes after a refresh", async () => {
    await feed.refresh()
    const btc = feed.snapshot().find((q) => q.symbol === "BTC")
    expect(btc).toBeDefined()
    expect(btc!.priceUsd).toBe(6741208000000n)
    expect(btc!.change24h).toBe(2.41)
  })

  test("carries prices as bigint, never number", async () => {
    await feed.refresh()
    expect(typeof feed.snapshot()[0]!.priceUsd).toBe("bigint")
  })

  test("omits assets the source has no price for", async () => {
    await feed.refresh()
    const symbols = feed.snapshot().map((q) => q.symbol)
    expect(symbols).toContain("BTC")
    expect(symbols).not.toContain("SOL")
  })

  test("prices every chain variant of a stablecoin from one source id", async () => {
    await feed.refresh()
    const symbols = feed.snapshot().map((q) => q.symbol)
    expect(symbols).toContain("USDT_ERC20")
    expect(symbols).toContain("USDT_TRC20")
    expect(symbols).toContain("USDT_BEP20")
  })

  test("orders quotes by the asset registry sort order", async () => {
    await feed.refresh()
    expect(feed.snapshot()[0]!.symbol).toBe("BTC")
  })

  test("stamps each quote with an update time", async () => {
    await feed.refresh()
    expect(feed.snapshot()[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe("caching", () => {
  test("serves a cached snapshot within the ttl", async () => {
    await feed.refresh()
    await feed.refresh()
    expect(source.calls).toBe(1)
  })

  test("refetches once the ttl expires", async () => {
    const shortLived = new PriceFeed(source, assets(), 0)
    await shortLived.refresh()
    await shortLived.refresh()
    expect(source.calls).toBe(2)
  })
})

describe("failure handling", () => {
  test("keeps serving the last good snapshot when the source fails", async () => {
    await feed.refresh()
    const before = feed.snapshot()

    const stale = new PriceFeed(source, assets(), 0)
    await stale.refresh()
    source.failNext = true
    await stale.refresh()

    expect(stale.snapshot()).toHaveLength(before.length)
  })

  test("does not throw when the source fails", async () => {
    source.failNext = true
    expect(feed.refresh()).resolves.toBeUndefined()
  })

  test("returns an empty snapshot if the very first fetch fails", async () => {
    source.failNext = true
    await feed.refresh()
    expect(feed.snapshot()).toEqual([])
  })
})

describe("subscribe", () => {
  test("notifies subscribers on refresh", async () => {
    let received = 0
    feed.subscribe(() => received++)
    await feed.refresh()
    expect(received).toBe(1)
  })

  test("stops notifying after unsubscribe", async () => {
    let received = 0
    const off = feed.subscribe(() => received++)
    off()
    await feed.refresh()
    expect(received).toBe(0)
  })

  test("a throwing subscriber does not break the others", async () => {
    let reached = false
    feed.subscribe(() => {
      throw new Error("subscriber blew up")
    })
    feed.subscribe(() => {
      reached = true
    })
    await feed.refresh()
    expect(reached).toBe(true)
  })

  test("does not notify when the source failed and nothing changed", async () => {
    const stale = new PriceFeed(source, assets(), 0)
    await stale.refresh()
    let received = 0
    stale.subscribe(() => received++)
    source.failNext = true
    await stale.refresh()
    expect(received).toBe(0)
  })
})
