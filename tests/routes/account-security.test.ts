import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../src/db"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { get, migrate, openDatabase, run } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { SessionRepository } from "../../src/db/repositories/sessions"
import { AuditRepository } from "../../src/db/repositories/audit"
import { hashPassword, verifyPassword } from "../../src/domain/identity/password"
import { post, cookiesFrom } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const PASSWORD = "correct horse battery staple 7"

let db: Client
let app: App
let userId: number
let jar: string

beforeEach(async () => {
  db = await openDatabase(":memory:")
  await migrate(db)
  app = await createApp(config, {
    db,
    email: new CapturingEmailSender(),
  })
  const users = new UserRepository(db)
  userId = await users.create("a@test.co", await hashPassword(PASSWORD))
  await users.markEmailVerified(userId)
  jar = cookiesFrom(await post(app, "/login", { email: "a@test.co", password: PASSWORD }))
})

describe("session list", () => {
  test("renders for a signed-in user", async () => {
    expect((await app.inject("/account/security", { headers: { cookie: jar } })).status).toBe(200)
  })

  test("never renders a session identifier", async () => {
    const sessionId = (await new SessionRepository(db).listActive(userId))[0]!.id
    const html = await (
      await app.inject("/account/security", { headers: { cookie: jar } })
    ).text()
    expect(html).not.toContain(sessionId)
  })

  test("revokes every other session but keeps the current one", async () => {
    await new SessionRepository(db).create(userId, { ip: null, userAgent: null })
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(2)
    const res = await post(
      app,
      "/account/sessions/revoke-others",
      {},
      jar,
      "/account/security",
    )
    expect(res.status).toBe(303)
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(1)
  })
})

describe("password change", () => {
  test("changes the password when the current one is correct", async () => {
    const res = await post(
      app,
      "/account/password",
      { current: PASSWORD, next: "an entirely different passphrase 4" },
      jar,
      "/account/security",
    )
    expect(res.status).toBe(303)
    const stored = (await new UserRepository(db).findByEmail("a@test.co"))!.passwordHash
    expect(await verifyPassword("an entirely different passphrase 4", stored)).toBe(true)
  })

  test("rejects a wrong current password", async () => {
    const res = await post(
      app,
      "/account/password",
      { current: "not the password", next: "an entirely different passphrase 4" },
      jar,
      "/account/security",
    )
    expect(res.status).toBe(400)
    const stored = (await new UserRepository(db).findByEmail("a@test.co"))!.passwordHash
    expect(await verifyPassword(PASSWORD, stored)).toBe(true)
  })

  test("rejects a new password that fails the policy", async () => {
    const res = await post(
      app,
      "/account/password",
      { current: PASSWORD, next: "short" },
      jar,
      "/account/security",
    )
    expect(res.status).toBe(400)
  })

  test("revokes other sessions and rotates the current one", async () => {
    await new SessionRepository(db).create(userId, { ip: null, userAgent: null })
    await post(
      app,
      "/account/password",
      { current: PASSWORD, next: "an entirely different passphrase 4" },
      jar,
      "/account/security",
    )
    // The old sessions are gone; only the freshly rotated one remains.
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(1)
  })

  test("writes an audit entry", async () => {
    await post(
      app,
      "/account/password",
      { current: PASSWORD, next: "an entirely different passphrase 4" },
      jar,
      "/account/security",
    )
    expect((await new AuditRepository(db).forUser(userId, 20)).map((e) => e.action)).toContain(
      "user.password_changed",
    )
  })
})

describe("two-factor enrolment", () => {
  test("shows a scannable QR and the key behind it", async () => {
    const html = await (await app.inject("/account/2fa", { headers: { cookie: jar } })).text()
    expect(html).toContain("enrol-qr")
    expect(html).toContain("<svg")
    expect(html).toContain("Setup key")
    // The key is copyable rather than something to retype off the screen.
    expect(html).toContain('x-data="copyField"')
  })

  test("rejects enrolment with a wrong code and does not enable", async () => {
    const res = await post(app, "/account/2fa", { token: "000000" }, jar)
    expect(res.status).toBe(400)
    expect((await new UserRepository(db).findById(userId))!.totpEnabledAt).toBeNull()
  })

  test("issues no recovery codes on a failed enrolment", async () => {
    await post(app, "/account/2fa", { token: "000000" }, jar)
    const row = await get(db, "SELECT COUNT(*) AS n FROM recovery_codes") as { n: number }
    expect(row.n).toBe(0)
  })
})

describe("activity log", () => {
  test("shows the user's own events in plain language", async () => {
    const html = await (
      await app.inject("/account/activity", { headers: { cookie: jar } })
    ).text()
    expect(html).toContain("Signed in")
  })

  test("does not show another user's events", async () => {
    const other = new UserRepository(db).create("b@test.co", await hashPassword(PASSWORD))
    await run(db, `INSERT INTO audit_log (user_id, actor_type, action, ip, created_at)
       VALUES (?, 'user', 'user.login', '198.51.100.9', '2026-01-01')`, [await other])
    const html = await (
      await app.inject("/account/activity", { headers: { cookie: jar } })
    ).text()
    expect(html).not.toContain("198.51.100.9")
  })
})
