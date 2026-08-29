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
    return new Map([["bitcoin", { usd: 67412.08, change24h: 2.41 }]])
  }
}

async function build() {
  const db = openDatabase(":memory:")
  migrate(db)
  const feed = new PriceFeed(new FakeSource(), new AssetRepository(db).all())
  await feed.refresh()
  return createApp(config, { priceFeed: feed })
}

describe("GET /markets", () => {
  test("responds 200", async () => {
    expect((await (await build()).inject("/markets")).status).toBe(200)
  })

  test("lists every supported asset", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    for (const name of ["Bitcoin", "Ethereum", "Tether", "USD Coin", "Solana", "BNB"]) {
      expect(html).toContain(name)
    }
  })

  test("distinguishes chain variants by network label", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html).toContain("Tron (TRC20)")
    expect(html).toContain("Ethereum (ERC20)")
    expect(html).toContain("BNB Chain (BEP20)")
  })

  test("shows a price for an asset the feed covers", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    // Split so the fraction can be muted, per spec 4.4.
    expect(html).toContain("67,412")
    expect(html).toContain('<span class="num-frac">.08</span>')
  })

  test("labels the prices as indicative", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html.toLowerCase()).toContain("indicative")
  })

  test("uses a table rather than card markup", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html).toContain('class="table"')
    expect(html).not.toContain('class="card"')
  })

  test("makes clear that trading is not live", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html.toLowerCase()).toContain("not yet")
  })
})

describe("GET /markets/:symbol", () => {
  test("renders a known asset", async () => {
    const res = await (await build()).inject("/markets/btc")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("Bitcoin")
    expect(html).toContain("2 confirmations")
  })

  test("is case insensitive on the symbol", async () => {
    expect((await (await build()).inject("/markets/BTC")).status).toBe(200)
  })

  test("shows the contract address for a token", async () => {
    const html = await (await (await build()).inject("/markets/usdt_trc20")).text()
    expect(html).toContain("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
  })

  test("shows no contract address for a native asset", async () => {
    const html = await (await (await build()).inject("/markets/btc")).text()
    expect(html).not.toContain("Contract address")
  })

  test("returns 404 for an unknown symbol", async () => {
    expect((await (await build()).inject("/markets/doge")).status).toBe(404)
  })

  test("warns about sending on the wrong network", async () => {
    const html = await (await (await build()).inject("/markets/usdt_trc20")).text()
    expect(html.toLowerCase()).toContain("wrong network")
  })
})
