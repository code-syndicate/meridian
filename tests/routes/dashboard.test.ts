import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { PriceFeed, type PriceSource, type RawPrice } from "../../src/services/price-feed"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { AssetRepository } from "../../src/db/repositories/assets"
import { hashPassword } from "../../src/domain/identity/password"
import { post, cookiesFrom } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test", DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32), TOTP_ENCRYPTION_KEY: "y".repeat(32),
})
const PASSWORD = "correct horse battery staple 7"

class Priced implements PriceSource {
  async fetch(): Promise<Map<string, RawPrice>> {
    return new Map([["bitcoin", { usd: 67412.08, change24h: 2.41, sparkline: [], marketCap: 0, volume24h: 0 }]])
  }
}
class Dead implements PriceSource {
  async fetch(): Promise<Map<string, RawPrice>> { throw new Error("down") }
}

let db: Database
let app: App
let userId: number
let jar: string

async function build(source: PriceSource): Promise<void> {
  db = openDatabase(":memory:")
  migrate(db)
  const feed = new PriceFeed(source, new AssetRepository(db).all())
  await feed.refresh()
  app = createApp(config, {
    db, priceFeed: feed,
    email: new CapturingEmailSender(),
  })
  const users = new UserRepository(db)
  userId = users.create("a@test.co", await hashPassword(PASSWORD))
  users.markEmailVerified(userId)
  jar = cookiesFrom(await post(app, "/login", { email: "a@test.co", password: PASSWORD }))
}

function creditBtc(amount: bigint): void {
  const ledger = new LedgerRepository(db)
  const external = ledger.ensureAccount(null, "BTC", "external_deposit")
  const available = ledger.ensureAccount(userId, "BTC", "user_available")
  ledger.post({
    kind: "deposit", idempotencyKey: `seed-${amount}`,
    entries: [
      { accountId: external, asset: "BTC", amount: -amount },
      { accountId: available, asset: "BTC", amount },
    ],
  })
}

async function html(): Promise<string> {
  return (await app.inject("/dashboard", { headers: { cookie: jar } })).text()
}

beforeEach(async () => { await build(new Priced()) })

describe("dashboard portfolio", () => {
  test("shows a total value of zero for a new account", async () => {
    const page = await html()
    expect(page).toContain("USD")
    expect(page).toContain('<span class="num-frac">.00</span>')
  })

  test("labels the total as indicative", async () => {
    expect((await html()).toLowerCase()).toContain("indicative prices")
  })

  test("shows a row for every supported asset", async () => {
    expect((await html()).match(/<tr>/g)!.length).toBeGreaterThanOrEqual(10)
  })

  test("shows an honest empty state rather than a fake chart", async () => {
    const page = await html()
    expect(page.toLowerCase()).toContain("no balances yet")
    expect(page).not.toContain("<canvas")
    // Interface icons are fine. A performance chart of a portfolio holding
    // nothing would be a fabrication, so no sparkline may appear here.
    expect(page).not.toContain('class="spark')
  })

  test("values a seeded balance at the indicative price", async () => {
    creditBtc(100000000n)
    const page = await html()
    expect(page).toContain("67,412")
  })

  test("counts held balance in the total", async () => {
    creditBtc(100000000n)
    new LedgerRepository(db).hold(userId, "BTC", 50000000n, "w", "h-1")
    const page = await html()
    // Half available, half held, total value unchanged.
    expect(page).toContain("67,412")
  })

  test("renders the fractional part in a muted span", async () => {
    creditBtc(100000000n)
    expect(await html()).toContain('class="num-frac"')
  })

  test("shows an asset the feed does not price as unpriced", async () => {
    expect(await html()).toContain("unpriced")
  })
})

describe("dashboard with no prices", () => {
  test("says prices are unavailable rather than showing a total of zero", async () => {
    await build(new Dead())
    creditBtc(100000000n)
    const page = await html()
    expect(page.toLowerCase()).toContain("price data unavailable")
    expect(page.toLowerCase()).toContain("balances below are accurate")
  })

  test("still shows the correct balances", async () => {
    await build(new Dead())
    creditBtc(150000000n)
    // Split across the muted-fraction span, so assert both parts.
    expect(await html()).toContain('<span class="num">1<span class="num-frac">.50000000</span>')
  })
})
