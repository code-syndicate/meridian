import { test, expect, describe } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"
import { PriceFeed, type PriceSource, type RawPrice } from "../../src/services/price-feed"
import { openDatabase, migrate } from "../../src/db"
import { AssetRepository } from "../../src/db/repositories/assets"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

class FakeSource implements PriceSource {
  async fetch(): Promise<Map<string, RawPrice>> {
    return new Map([
      ["bitcoin", { usd: 67412.08, change24h: 2.41, sparkline: [], marketCap: 0, volume24h: 0 }],
      ["ethereum", { usd: 3120.5, change24h: -1.2, sparkline: [], marketCap: 0, volume24h: 0 }],
    ])
  }
}

function build() {
  const db = openDatabase(":memory:")
  migrate(db)
  const feed = new PriceFeed(new FakeSource(), new AssetRepository(db).all())
  return { feed, app: createApp(config, { priceFeed: feed }) }
}

describe("GET /api/prices", () => {
  test("returns an empty list before the first refresh", async () => {
    const { app } = build()
    const res = await app.inject("/api/prices")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ indicative: true, quotes: [] })
  })

  test("returns formatted rows after a refresh", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const body = (await (await app.inject("/api/prices")).json()) as {
      quotes: Array<{ symbol: string; price: string; change: string; direction: string }>
    }
    const btc = body.quotes.find((q) => q.symbol === "BTC")!
    expect(btc.price).toBe("67,412.08")
    expect(btc.change).toBe("▲2.41%")
    expect(btc.direction).toBe("up")
  })

  test("serialises prices as formatted strings, never raw numbers", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const body = (await (await app.inject("/api/prices")).json()) as {
      quotes: Array<Record<string, unknown>>
    }
    for (const quote of body.quotes) {
      expect(typeof quote.price).toBe("string")
      expect(quote).not.toHaveProperty("priceUsd")
    }
  })

  test("always flags the data as indicative", async () => {
    const { app, feed } = build()
    await feed.refresh()
    expect(await (await app.inject("/api/prices")).json()).toMatchObject({
      indicative: true,
    })
  })

  test("is not cached by intermediaries", async () => {
    const { app } = build()
    const res = await app.inject("/api/prices")
    expect(res.headers.get("cache-control")).toContain("no-store")
  })
})

describe("GET /api/prices/stream", () => {
  test("responds as an event stream", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const res = await app.inject("/api/prices/stream")
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expect(res.headers.get("cache-control")).toContain("no-store")
    await res.body?.cancel()
  })

  test("sends the current snapshot immediately on connect", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const res = await app.inject("/api/prices/stream")
    const reader = res.body!.getReader()
    const chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk).toContain("data:")
    expect(chunk).toContain("BTC")
    await reader.cancel()
  })

  test("frames messages as valid SSE", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const res = await app.inject("/api/prices/stream")
    const reader = res.body!.getReader()
    const chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk).toMatch(/^data: .+\n\n/m)
    const payload = JSON.parse(chunk.replace(/^data: /, "").trim())
    expect(payload.indicative).toBe(true)
    await reader.cancel()
  })
})
