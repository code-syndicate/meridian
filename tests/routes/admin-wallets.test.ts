import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../src/db"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { migrate, openDatabase, all } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { HdCustodyProvider } from "../../src/services/custody-hd"
import { SandboxCustodyProvider, type CustodyProvider } from "../../src/services/custody-provider"
import { deriveAddress, derivePrivateKey, seedFromMnemonic } from "../../src/domain/custody/derive"
import { hashPassword } from "../../src/domain/identity/password"
import { post, cookiesFrom } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test", DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32), TOTP_ENCRYPTION_KEY: "y".repeat(32),
})
const PASSWORD = "correct horse battery staple 7"
const PHRASE = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
const seed = seedFromMnemonic(PHRASE)

let db: Client
let app: App
let adminJar: string
let customerJar: string
let funded: number
let empty: number

async function user(email: string, role: "user" | "admin" = "user"): Promise<number> {
  const users = new UserRepository(db)
  const id = await users.create(email, await hashPassword(PASSWORD))
  await users.markEmailVerified(id)
  if (role === "admin") await users.setRole(id, "admin")
  return id
}

async function credit(userId: number, asset: string, amount: bigint): Promise<void> {
  const ledger = new LedgerRepository(db)
  const external = await ledger.ensureAccount(null, asset, "external_deposit")
  const available = await ledger.ensureAccount(userId, asset, "user_available")
  await ledger.post({
    kind: "deposit", idempotencyKey: `seed:${userId}:${asset}`,
    entries: [
      { accountId: external, asset, amount: -amount },
      { accountId: available, asset, amount },
    ],
  })
}

async function build(provider: CustodyProvider): Promise<void> {
  db = await openDatabase(":memory:")
  await migrate(db)
  app = await createApp(config, { db, email: new CapturingEmailSender(), custodyProvider: provider })
  await user("admin@test.co", "admin")
  await user("customer@test.co")
  funded = await user("funded@test.co")
  empty = await user("empty@test.co")
  await credit(funded, "ETH", 150000000n)
  await credit(funded, "USDT_ERC20", 2500000000n)
  await credit(funded, "SOL", 300000000n)
  await new LedgerRepository(db).ensureAccount(empty, "BTC", "user_available")
  adminJar = cookiesFrom(await post(app, "/login", { email: "admin@test.co", password: PASSWORD }))
  customerJar = cookiesFrom(await post(app, "/login", { email: "customer@test.co", password: PASSWORD }))
}

async function reveal(fields: Record<string, string>, jar = adminJar): Promise<Response> {
  return await post(app, "/admin/wallets/key", fields, jar, "/admin/wallets")
}

async function auditActions(): Promise<Array<{ action: string; metadata: string | null }>> {
  return await all(db, "SELECT action, metadata FROM audit_log WHERE action LIKE 'admin.private_key%'")
}

describe("with the HD provider", () => {
  beforeEach(async () => { await build(new HdCustodyProvider(PHRASE)) })

  test("customers cannot see or use the page", async () => {
    expect((await app.inject("/admin/wallets", { headers: { cookie: customerJar } })).status).toBe(404)
    const res = await post(app, "/admin/wallets/key", { userId: String(funded), chain: "ethereum", password: PASSWORD }, customerJar, "/dashboard")
    expect(res.status).toBe(404)
  })

  test("lists only wallets holding something, one row per chain address", async () => {
    const html = await (await app.inject("/admin/wallets", { headers: { cookie: adminJar } })).text()
    expect(html).toContain("funded@test.co")
    expect(html).not.toContain("empty@test.co")
    expect(html).not.toContain("customer@test.co")
    // ETH and USDT (ERC20) share the one Ethereum address.
    const eth = deriveAddress(seed, "ethereum", funded)
    expect(html.split(`data-copy="${eth}"`).length - 1).toBe(1)
    expect(html).toContain(deriveAddress(seed, "solana", funded))
    expect(html).toContain("1.5")
    expect(html).toContain("25")
  })

  test("the list itself never carries a private key", async () => {
    const html = await (await app.inject("/admin/wallets", { headers: { cookie: adminJar } })).text()
    expect(html).not.toContain(derivePrivateKey(seed, "ethereum", funded))
    expect(html).not.toContain(derivePrivateKey(seed, "solana", funded))
  })

  test("the right password reveals the key, uncached, and the reveal is audited without it", async () => {
    const res = await reveal({ userId: String(funded), chain: "ethereum", password: PASSWORD })
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("no-store")
    const key = derivePrivateKey(seed, "ethereum", funded)
    const html = await res.text()
    expect(html).toContain(key)
    expect(html).toContain(deriveAddress(seed, "ethereum", funded))

    const rows = await auditActions()
    expect(rows.map((r) => r.action)).toEqual(["admin.private_key_revealed"])
    expect(rows[0]!.metadata).toContain("ethereum")
    expect(rows[0]!.metadata).not.toContain(key)
    expect(rows[0]!.metadata).not.toContain(key.slice(2))
  })

  test("a wrong password reveals nothing and is audited", async () => {
    const res = await reveal({ userId: String(funded), chain: "ethereum", password: "wrong password here" })
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/admin/wallets")
    expect((await auditActions()).map((r) => r.action)).toEqual(["admin.private_key_denied"])
  })

  test("refuses a chain it does not know", async () => {
    const res = await reveal({ userId: String(funded), chain: "dogecoin", password: PASSWORD })
    expect(res.status).toBe(303)
    expect((await auditActions()).map((r) => r.action)).toEqual([])
  })

  test("refuses a user that does not exist", async () => {
    const res = await reveal({ userId: "99999", chain: "ethereum", password: PASSWORD })
    expect(res.status).toBe(303)
  })

  test("refuses when the stored address is not the one this phrase derives", async () => {
    await db.execute({
      sql: `INSERT INTO deposit_addresses (user_id, asset, address, provider, created_at)
            VALUES (?, 'ETH', '0x000000000000000000000000000000000000dEaD', 'sandbox', '2026-01-01')`,
      args: [funded],
    })
    const res = await reveal({ userId: String(funded), chain: "ethereum", password: PASSWORD })
    expect(res.status).toBe(303)
    expect(await (await app.inject("/admin/wallets", { headers: { cookie: adminJar } })).text())
      .toContain("0x000000000000000000000000000000000000dEaD")
  })
})

describe("with a provider that holds no keys", () => {
  beforeEach(async () => { await build(new SandboxCustodyProvider()) })

  test("still lists the balances, but offers no key", async () => {
    const html = await (await app.inject("/admin/wallets", { headers: { cookie: adminJar } })).text()
    expect(html).toContain("funded@test.co")
    expect(html).not.toContain('action="/admin/wallets/key"')
  })

  test("a reveal request is refused", async () => {
    const res = await reveal({ userId: String(funded), chain: "ethereum", password: PASSWORD })
    expect(res.status).toBe(303)
    expect((await auditActions()).map((r) => r.action)).toEqual([])
  })
})
