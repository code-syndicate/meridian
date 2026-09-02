import { migrate, openDatabase } from "../src/db"
import { loadConfig } from "../src/config"
import { UserRepository } from "../src/db/repositories/users"
import { AssetRepository } from "../src/db/repositories/assets"
import { LedgerRepository } from "../src/db/repositories/ledger"
import { KycRepository } from "../src/db/repositories/kyc"
import { AuditRepository } from "../src/db/repositories/audit"
import { hashPassword } from "../src/domain/identity/password"

/**
 * Rebuilds a working demonstration from nothing. Free hosting has no
 * persistent disk, so the database is empty after every deploy and after the
 * service sleeps; without this a stakeholder would arrive at a sign-in page
 * with no account behind it.
 */
const config = loadConfig()
if (config.env === "production") {
  throw new Error("seed-demo will not run in production")
}

const db = await openDatabase(config.databasePath, config.databaseAuthToken)
await migrate(db)

const users = new UserRepository(db)
if (await users.findByEmail("admin@meridian.demo")) {
  console.log(JSON.stringify({ msg: "demo_seed_skipped", reason: "already seeded" }))
  process.exit(0)
}

const assets = new AssetRepository(db)
const ledger = new LedgerRepository(db)
const kyc = new KycRepository(db)
const audit = new AuditRepository(db)
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234"

async function makeUser(email: string, admin = false): Promise<number> {
  const id = await users.create(email, await hashPassword(PASSWORD))
  await users.markEmailVerified(id)
  if (admin) await users.setRole(id, "admin")
  for (const asset of await assets.all()) {
    await ledger.ensureAccount(id, asset.symbol, "user_available")
  }
  return id
}

async function credit(userId: number, symbol: string, amount: bigint, key: string): Promise<void> {
  const external = await ledger.ensureAccount(null, symbol, "external_deposit")
  const available = await ledger.ensureAccount(userId, symbol, "user_available")
  await ledger.post({
    kind: "deposit",
    idempotencyKey: key,
    metadata: { demo: true },
    entries: [
      { accountId: external, asset: symbol, amount: -amount },
      { accountId: available, asset: symbol, amount },
    ],
  })
}

const adminId = await makeUser("admin@meridian.demo", true)
const aliceId = await makeUser("alice@meridian.demo")
const bobId = await makeUser("bob@meridian.demo")

// Alice is verified and funded, so the portfolio and transfer screens have
// something in them. Bob is unverified, which shows the tier limit in place.
await kyc.decide(await kyc.start(aliceId, 2), "approved")
await credit(aliceId, "BTC", 250000000n, "demo:alice:btc")
await credit(aliceId, "ETH", 4000000000n, "demo:alice:eth")
await credit(aliceId, "USDT_TRC20", 850000000000n, "demo:alice:usdt")
await credit(bobId, "SOL", 1200000000n, "demo:bob:sol")

// One application waiting, so the verification queue is not empty.
await kyc.submit(await kyc.start(bobId, 2))

await audit.record({
  actorType: "system",
  action: "demo.seeded",
  target: "demo",
  metadata: { accounts: 3 },
})

console.log(JSON.stringify({
  msg: "demo_seeded",
  admin: "admin@meridian.demo",
  users: ["alice@meridian.demo", "bob@meridian.demo"],
  adminId,
}))
