import { migrate, openDatabase } from "../src/db"
import { loadConfig } from "../src/config"
import { UserRepository } from "../src/db/repositories/users"
import { AssetRepository } from "../src/db/repositories/assets"
import { LedgerRepository } from "../src/db/repositories/ledger"
import { AuditRepository } from "../src/db/repositories/audit"
import { hashPassword, validatePasswordPolicy } from "../src/domain/identity/password"

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error("Usage: bun run set-password <email> <password>")
  process.exit(1)
}
validatePasswordPolicy(password)

const config = loadConfig()
if (config.env === "production") {
  throw new Error("set-password is a development tool and will not run in production")
}

const db = await openDatabase(config.databasePath, config.databaseAuthToken)
await migrate(db)
const users = new UserRepository(db)
const audit = new AuditRepository(db)
const existing = await users.findByEmail(email)

if (existing) {
  await users.setPasswordHash(existing.id, await hashPassword(password))
  await audit.record({
    userId: existing.id, actorType: "system",
    action: "auth.password_reset", target: email,
    metadata: { via: "set-password script" },
  })
  console.log(`Password updated for ${email}.`)
} else {
  const id = await users.create(email, await hashPassword(password))
  await users.markEmailVerified(id)
  // Registration provisions these, so an account made here needs them too.
  const ledger = new LedgerRepository(db)
  for (const asset of await new AssetRepository(db).all()) {
    await ledger.ensureAccount(id, asset.symbol, "user_available")
  }
  await audit.record({
    userId: id, actorType: "system",
    action: "auth.registered", target: email,
    metadata: { via: "set-password script" },
  })
  console.log(`Created ${email} with account ID ${(await users.findById(id))!.accountId}.`)
}
