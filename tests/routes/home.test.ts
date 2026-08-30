import { test, expect, describe, beforeAll } from "bun:test"
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
    return new Map([["bitcoin", { usd: 67412.08, change24h: 2.41, sparkline: [], marketCap: 0, volume24h: 0 }]])
  }
}

let html: string

beforeAll(async () => {
  const db = openDatabase(":memory:")
  migrate(db)
  const feed = new PriceFeed(new FakeSource(), new AssetRepository(db).all())
  await feed.refresh()
  html = await (await createApp(config, { priceFeed: feed }).inject("/")).text()
})

describe("home page", () => {
  test("carries the positioning headline", () => {
    // Split so the second clause can take the gradient treatment.
    expect(html).toContain("Custody you can")
    expect(html).toContain('class="headline-accent">actually examine.')
  })

  test("shows a product preview in the hero rather than describing one", () => {
    expect(html).toContain('class="preview')
    expect(html).toContain("Total value, USD")
    expect(html).toContain("preview-rows")
  })

  test("labels the preview as illustrative, because it is not a real balance", () => {
    expect(html.toLowerCase()).toContain("illustrative")
  })

  test("leads with custody rather than features", () => {
    expect(html.toLowerCase()).toContain("custody")
    expect(html.toLowerCase()).toContain("reserves")
  })

  test("shows a market strip of at most six assets", () => {
    const rows = html.match(/data-strip-row/g) ?? []
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(6)
  })

  test("offers exactly one primary action", () => {
    expect((html.match(/btn-primary/g) ?? []).length).toBe(1)
  })

  test("states licensing status accurately", () => {
    expect(html.toLowerCase()).toContain("not yet licensed")
  })

  test("is not scoped to a single market", () => {
    expect(html.toLowerCase()).not.toContain("nigeria")
    expect(html.toLowerCase()).not.toContain("securities and exchange commission")
  })

  test("never claims Meridian itself is licensed or registered", () => {
    // "a licensed custody provider" is fine and true. A claim about us is not.
    for (const pattern of [
      /\b(we|meridian) (are|is) (licensed|registered|regulated|approved)\b/i,
      /\blicensed (exchange|platform|broker)\b/i,
      /\bSEC[- ](licensed|registered|approved)\b/i,
      /\bfully (licensed|regulated)\b/i,
    ]) {
      expect(html).not.toMatch(pattern)
    }
  })

  test("makes no claim about returns or performance", () => {
    const lowered = html.toLowerCase()
    for (const banned of [
      "guaranteed",
      "high return",
      "profit",
      "risk-free",
      "safe investment",
      "double your",
    ]) {
      expect(lowered).not.toContain(banned)
    }
  })

  test("cites no invented metrics", () => {
    expect(html).not.toMatch(/\$\s?\d+(\.\d+)?\s?(B|M)\b/)
    expect(html.toLowerCase()).not.toContain("customers trust")
    expect(html.toLowerCase()).not.toContain("trusted by")
  })

  test("has no testimonial or partner logo markup", () => {
    const lowered = html.toLowerCase()
    expect(lowered).not.toContain("testimonial")
    expect(lowered).not.toContain("as featured in")
  })

  test("links to the fee schedule", () => {
    expect(html).toContain('href="/fees"')
  })
})
