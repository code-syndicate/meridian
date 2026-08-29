import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { AlwaysBreached, NeverBreached } from "../../src/services/breach-check"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { AuditRepository } from "../../src/db/repositories/audit"
import { post } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const PASSWORD = "correct horse battery staple"

let db: Database
let app: App
let email: CapturingEmailSender

function build(overrides: Record<string, unknown> = {}): void {
  db = openDatabase(":memory:")
  migrate(db)
  email = new CapturingEmailSender()
  app = createApp(config, { db, email, breach: new NeverBreached(), ...overrides })
}

beforeEach(() => build())

describe("GET /register", () => {
  test("renders the form", async () => {
    const res = await app.inject("/register")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('name="email"')
    expect(html).toContain('name="password"')
    expect(html).toContain('name="_csrf"')
  })

  test("states the password requirement up front", async () => {
    expect(await (await app.inject("/register")).text()).toContain("12")
  })
})

describe("POST /register", () => {
  test("creates a user and sends a verification email", async () => {
    const res = await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(303)
    expect(new UserRepository(db).findByEmail("a@test.co")).not.toBeNull()
    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]!.to).toBe("a@test.co")
  })

  test("the email carries a verification link with a token", async () => {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    expect(email.sent[0]!.text).toContain("/verify-email?token=")
  })

  test("never stores the password in plaintext", async () => {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    const stored = new UserRepository(db).findByEmail("a@test.co")!.passwordHash
    expect(stored).not.toContain("correct horse")
    expect(stored).toStartWith("$argon2id$")
  })

  test("stores the verification token hashed, not raw", async () => {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    const raw = email.sent[0]!.text.match(/token=([\w-]+)/)![1]!
    const row = db.query("SELECT token_hash FROM email_tokens").get() as { token_hash: string }
    expect(row.token_hash).not.toBe(raw)
  })

  test("writes an audit entry", async () => {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    const user = new UserRepository(db).findByEmail("a@test.co")!
    expect(new AuditRepository(db).forUser(user.id, 10).map((e) => e.action)).toContain(
      "user.registered",
    )
  })

  test("provisions a ledger account pair for every asset at registration", async () => {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    const user = new UserRepository(db).findByEmail("a@test.co")!
    const row = db
      .query<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?")
      .get(user.id)!
    // Ten assets, each with an available and a hold account.
    expect(row.n).toBe(20)
  })

  test("provisioned accounts all start at zero", async () => {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    const user = new UserRepository(db).findByEmail("a@test.co")!
    const nonZero = db
      .query<{ n: number }, [number]>(
        `SELECT COUNT(*) AS n FROM account_balances b
         JOIN accounts a ON a.id = b.account_id
         WHERE a.user_id = ? AND b.amount <> 0`,
      )
      .get(user.id)!
    expect(nonZero.n).toBe(0)
  })

  test("rejects a short password", async () => {
    const res = await post(app, "/register", { email: "a@test.co", password: "short" })
    expect(res.status).toBe(400)
    expect(new UserRepository(db).findByEmail("a@test.co")).toBeNull()
  })

  test("rejects a breached password", async () => {
    build({ breach: new AlwaysBreached() })
    const res = await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(400)
    expect((await res.text()).toLowerCase()).toContain("data breach")
  })

  test("does not reveal that an address is already registered", async () => {
    const first = await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    const second = await post(app, "/register", {
      email: "a@test.co",
      password: "a completely different passphrase",
    })
    expect(second.status).toBe(first.status)
    expect(second.headers.get("location")).toBe(first.headers.get("location"))
  })

  test("does not create a second account for a duplicate address", async () => {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    await post(app, "/register", { email: "a@test.co", password: "a different passphrase here" })
    expect((db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(1)
  })

  test("does not send a second verification email for a duplicate address", async () => {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    const before = email.sent.length
    await post(app, "/register", { email: "a@test.co", password: "a different passphrase here" })
    expect(email.sent.length).toBe(before)
  })
})

describe("GET /verify-email", () => {
  async function registerAndGetToken(): Promise<string> {
    await post(app, "/register", { email: "a@test.co", password: PASSWORD })
    return email.sent[0]!.text.match(/token=([\w-]+)/)![1]!
  }

  test("verifies the account and signs the user in", async () => {
    const token = await registerAndGetToken()
    const res = await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    expect(res.status).toBe(303)
    expect(res.headers.getSetCookie().some((c) => c.includes("session"))).toBe(true)
    expect(new UserRepository(db).findByEmail("a@test.co")!.emailVerifiedAt).not.toBeNull()
  })

  test("rejects an unknown token", async () => {
    const res = await app.inject("/verify-email?token=nonsense", { redirect: "manual" })
    expect(res.status).toBe(400)
  })

  test("rejects a token used twice", async () => {
    const token = await registerAndGetToken()
    await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    const res = await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    expect(res.status).toBe(400)
  })

  test("rejects an expired token", async () => {
    const token = await registerAndGetToken()
    db.query("UPDATE email_tokens SET expires_at = '2020-01-01T00:00:00.000Z'").run()
    const res = await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    expect(res.status).toBe(400)
  })

  test("writes an audit entry", async () => {
    const token = await registerAndGetToken()
    await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    const user = new UserRepository(db).findByEmail("a@test.co")!
    expect(new AuditRepository(db).forUser(user.id, 10).map((e) => e.action)).toContain(
      "user.email_verified",
    )
  })
})
