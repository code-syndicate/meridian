import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { NeverBreached } from "../../src/services/breach-check"
import { SandboxKycProvider } from "../../src/services/kyc-provider"
import { SandboxCustodyProvider } from "../../src/services/custody-provider"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { KycRepository } from "../../src/db/repositories/kyc"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { CustodyRepository } from "../../src/db/repositories/custody"
import { hashPassword } from "../../src/domain/identity/password"
import { encryptSecret, generateTotpSecret } from "../../src/domain/identity/totp"
import { post, cookiesFrom } from "../support/http"

const TOTP_KEY = "y".repeat(32)
const config = loadConfig({
  NODE_ENV: "test", DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32), TOTP_ENCRYPTION_KEY: TOTP_KEY,
})
const PASSWORD = "correct horse battery staple"

let db: Database
let app: App
let provider: SandboxCustodyProvider
let userId: number
let jar: string

async function signIn(verified: boolean, totp: boolean): Promise<void> {
  db = openDatabase(":memory:")
  migrate(db)
  provider = new SandboxCustodyProvider()
  app = createApp(config, {
    db, email: new CapturingEmailSender(), breach: new NeverBreached(),
    kycProvider: new SandboxKycProvider(), custodyProvider: provider,
  })
  const users = new UserRepository(db)
  userId = users.create("a@test.co", await hashPassword(PASSWORD))
  users.markEmailVerified(userId)
  if (verified) {
    const kyc = new KycRepository(db)
    kyc.decide(kyc.start(userId, 2), "approved")
  }
  // Sign in first. Enabling TOTP beforehand would stop login at the second
  // factor and never issue a session.
  jar = cookiesFrom(await post(app, "/login", { email: "a@test.co", password: PASSWORD }))
  if (totp) {
    users.setTotpSecret(userId, encryptSecret(generateTotpSecret(), TOTP_KEY))
    users.enableTotp(userId)
  }
}

async function get(path: string): Promise<Response> {
  return app.inject(path, { headers: { cookie: jar }, redirect: "manual" })
}

describe("access control", () => {
  test("wallet pages require authentication", async () => {
    await signIn(true, true)
    for (const path of ["/wallet/deposit", "/wallet/withdraw", "/wallet/transactions"]) {
      const res = await app.inject(path, { redirect: "manual" })
      expect(`${path}: ${res.headers.get("location")}`).toBe(`${path}: /login`)
    }
  })

  test("an unverified user is gated out of a deposit address", async () => {
    await signIn(false, true)
    const res = await get("/wallet/deposit/btc")
    expect(res.status).toBe(403)
    expect((await res.text()).toLowerCase()).toContain("verify your identity first")
  })

  test("an unverified user is gated out of withdrawing", async () => {
    await signIn(false, true)
    expect((await get("/wallet/withdraw/btc")).status).toBe(403)
  })

  test("an unknown asset 404s", async () => {
    await signIn(true, true)
    expect((await get("/wallet/deposit/doge")).status).toBe(404)
  })
})

describe("deposit", () => {
  beforeEach(async () => { await signIn(true, true) })

  test("lists every supported asset", async () => {
    const html = await (await get("/wallet/deposit")).text()
    for (const name of ["Bitcoin", "Ethereum", "Tether", "Solana"]) expect(html).toContain(name)
  })

  test("shows an address and a scannable QR code", async () => {
    const html = await (await get("/wallet/deposit/btc")).text()
    expect(html).toContain("bc1q")
    expect(html).toContain("<svg")
    expect(html).toContain("deposit-qr")
  })

  test("warns about the network before anything else", async () => {
    const html = await (await get("/wallet/deposit/usdt_trc20")).text()
    expect(html).toContain("Send only USDT on Tron (TRC20)")
    expect(html.toLowerCase()).toContain("lose the funds permanently")
  })

  test("returns the same address on a second visit", async () => {
    const first = (await (await get("/wallet/deposit/btc")).text()).match(/bc1q[a-f0-9]+/)![0]
    const second = (await (await get("/wallet/deposit/btc")).text()).match(/bc1q[a-f0-9]+/)![0]
    expect(second).toBe(first)
  })

  test("shows a credited deposit in the asset history", async () => {
    const html = await (await get("/wallet/deposit/btc")).text()
    const address = html.match(/bc1q[a-f0-9]+/)![0]
    provider.seedDeposit({
      asset: "BTC", address, txHash: "0xseeded", outputIndex: 0,
      nativeAmount: "100000000", confirmations: 6,
    })
    // Crediting happens through the service; drive it via the transactions view.
    const { CustodyService } = await import("../../src/services/custody")
    const { AssetRepository } = await import("../../src/db/repositories/assets")
    const { AuditRepository } = await import("../../src/db/repositories/audit")
    const svc = new CustodyService({
      assets: new AssetRepository(db), ledger: new LedgerRepository(db),
      custody: new CustodyRepository(db), audit: new AuditRepository(db), provider,
    })
    await svc.pollAndCredit()
    expect((await (await get("/wallet/deposit/btc")).text())).toContain("0xseeded")
  })
})

describe("withdraw", () => {
  async function fundBtc(amount: bigint): Promise<void> {
    const ledger = new LedgerRepository(db)
    const external = ledger.ensureAccount(null, "BTC", "external_deposit")
    const available = ledger.ensureAccount(userId, "BTC", "user_available")
    ledger.post({
      kind: "deposit", idempotencyKey: `fund-${amount}`,
      entries: [
        { accountId: external, asset: "BTC", amount: -amount },
        { accountId: available, asset: "BTC", amount },
      ],
    })
  }

  test("shows balance, fee, and limit", async () => {
    await signIn(true, true)
    await fundBtc(100000000n)
    const html = await (await get("/wallet/withdraw/btc")).text()
    expect(html).toContain("Available")
    expect(html).toContain("Network fee")
    expect(html).toContain("Daily limit")
  })

  test("refuses without two-factor authentication", async () => {
    await signIn(true, false)
    await fundBtc(100000000n)
    const res = await post(app, "/wallet/withdraw/btc",
      { destination: "bc1qdestination", amount: "0.1" }, jar)
    expect(res.status).toBe(403)
    expect((await res.text()).toLowerCase()).toContain("two-factor")
  })

  test("refuses an amount beyond the balance", async () => {
    await signIn(true, true)
    await fundBtc(10000000n)
    const res = await post(app, "/wallet/withdraw/btc",
      { destination: "bc1qdestination", amount: "5" }, jar)
    expect(res.status).toBe(400)
    expect((await res.text()).toLowerCase()).toContain("available balance")
  })

  test("refuses a missing destination", async () => {
    await signIn(true, true)
    await fundBtc(100000000n)
    const res = await post(app, "/wallet/withdraw/btc", { destination: "", amount: "0.1" }, jar)
    expect(res.status).toBe(400)
  })

  test("refuses a non-numeric amount", async () => {
    await signIn(true, true)
    await fundBtc(100000000n)
    const res = await post(app, "/wallet/withdraw/btc",
      { destination: "bc1qdestination", amount: "abc" }, jar)
    expect(res.status).toBe(400)
  })

  test("refuses a precision the network cannot send", async () => {
    await signIn(true, true)
    const ledger = new LedgerRepository(db)
    const external = ledger.ensureAccount(null, "USDT_TRC20", "external_deposit")
    const available = ledger.ensureAccount(userId, "USDT_TRC20", "user_available")
    ledger.post({
      kind: "deposit", idempotencyKey: "fund-usdt",
      entries: [
        { accountId: external, asset: "USDT_TRC20", amount: -100000000000n },
        { accountId: available, asset: "USDT_TRC20", amount: 100000000000n },
      ],
    })
    const res = await post(app, "/wallet/withdraw/usdt_trc20",
      { destination: "Tdestination", amount: "1.00000001" }, jar)
    expect(res.status).toBe(400)
    expect((await res.text()).toLowerCase()).toContain("fewer decimal places")
  })

  test("a valid request places a hold and confirms back to the user", async () => {
    await signIn(true, true)
    await fundBtc(100000000n)
    const res = await post(app, "/wallet/withdraw/btc",
      { destination: "bc1qdestination", amount: "0.5" }, jar)
    expect(res.status).toBe(303)
    const balance = new LedgerRepository(db).balance(userId, "BTC")
    expect(balance.held).toBe(50015000n)
    expect(balance.available).toBe(49985000n)
  })
})

describe("transactions", () => {
  test("shows an honest empty state", async () => {
    await signIn(true, true)
    const html = await (await get("/wallet/transactions")).text()
    expect(html.toLowerCase()).toContain("nothing has moved yet")
  })

  test("lists a deposit once it is credited", async () => {
    await signIn(true, true)
    const ledger = new LedgerRepository(db)
    const external = ledger.ensureAccount(null, "BTC", "external_deposit")
    const available = ledger.ensureAccount(userId, "BTC", "user_available")
    ledger.post({
      kind: "deposit", idempotencyKey: "tx-1",
      entries: [
        { accountId: external, asset: "BTC", amount: -100000000n },
        { accountId: available, asset: "BTC", amount: 100000000n },
      ],
    })
    const html = await (await get("/wallet/transactions")).text()
    expect(html).toContain("Deposit")
    expect(html).toContain("BTC")
  })
})
