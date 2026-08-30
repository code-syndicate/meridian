import { openDatabase, migrate } from "../src/db"
import { loadConfig } from "../src/config"
import { UserRepository } from "../src/db/repositories/users"
import { AuditRepository } from "../src/db/repositories/audit"

const email = process.argv[2]
if (!email) {
  console.error("Usage: bun run make-admin <email>")
  process.exit(1)
}

const config = loadConfig()
const db = openDatabase(config.databasePath)
migrate(db)
const users = new UserRepository(db)
const user = users.findByEmail(email)
if (!user) {
  console.error(`No account uses ${email}`)
  process.exit(1)
}
users.setRole(user.id, "admin")
new AuditRepository(db).record({
  userId: user.id,
  actorType: "system",
  action: "admin.role_granted",
  target: email,
  metadata: { via: "make-admin script" },
})
console.log(`${email} is now an admin.`)
