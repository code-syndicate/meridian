import { test, expect, describe, beforeEach } from "bun:test"
import * as OTPAuth from "otpauth"
import type { Client } from "../../src/db"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { migrate, openDatabase } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { AuditRepository } from "../../src/db/repositories/audit"
import { SessionRepository } from "../../src/db/repositories/sessions"
import { hashPassword } from "../../src/domain/identity/password"
import { encryptSecret, generateTotpSecret } from "../../src/domain/identity/totp"
import { post, cookiesFrom, withoutCsrf } from "../support/http"

const TOTP_KEY = "y".repeat(32)
const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: TOTP_KEY,
})

const PASSWORD = "correct horse battery staple 7"

let db: Client
let app: App
let userId: number

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
})

describe("POST /login", () => {
  test("signs in with correct credentials", async () => {
    const res = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/dashboard")
    expect(res.headers.getSetCookie().some((c) => c.includes("session"))).toBe(true)
  })

  test("rejects a wrong password", async () => {
    const res = await post(app, "/login", {
      email: "a@test.co",
      password: "wrong passphrase xx",
    })
    expect(res.status).toBe(400)
  })

  test("gives the same response for an unknown address as for a wrong password", async () => {
    const unknown = await post(app, "/login", { email: "nobody@test.co", password: PASSWORD })
    const wrong = await post(app, "/login", {
      email: "a@test.co",
      password: "wrong passphrase xx",
    })
    expect(unknown.status).toBe(wrong.status)
    // Only the per-request CSRF token may differ between the two responses.
    expect(withoutCsrf(await unknown.text())).toBe(withoutCsrf(await wrong.text()))
  })

  test("writes an audit entry on success", async () => {
    await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    expect((await new AuditRepository(db).forUser(userId, 10)).map((e) => e.action)).toContain(
      "user.login",
    )
  })

  test("writes an audit entry on failure", async () => {
    await post(app, "/login", { email: "a@test.co", password: "wrong passphrase xx" })
    expect((await new AuditRepository(db).forUser(userId, 10)).map((e) => e.action)).toContain(
      "user.login_failed",
    )
  })

  test("locks the account after repeated failures", async () => {
    for (let i = 0; i < 6; i++) {
      await post(app, "/login", { email: "a@test.co", password: "wrong passphrase xx" })
    }
    const res = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(429)
  })

  test("the lock survives a process restart", async () => {
    for (let i = 0; i < 6; i++) {
      await post(app, "/login", { email: "a@test.co", password: "wrong passphrase xx" })
    }
    const restarted = await createApp(config, {
      db,
      email: new CapturingEmailSender(),
    })
    const res = await post(restarted, "/login", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(429)
  })

  test("issues a different session id on each login", async () => {
    const first = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    const second = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    expect(cookiesFrom(first)).not.toBe(cookiesFrom(second))
  })

  test("sets an http-only same-site session cookie", async () => {
    const res = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session"))!
    expect(cookie.toLowerCase()).toContain("httponly")
    expect(cookie.toLowerCase()).toContain("samesite=lax")
  })
})

describe("login with totp enabled", () => {
  let secret: string

  beforeEach(async () => {
    secret = generateTotpSecret()
    const users = new UserRepository(db)
    await users.setTotpSecret(userId, encryptSecret(secret, TOTP_KEY))
    await users.enableTotp(userId)
  })

  function currentToken(): string {
    return new OTPAuth.TOTP({
      issuer: "Meridian",
      label: "a@test.co",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate()
  }

  test("password alone does not create a full session", async () => {
    const res = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/login/verify")
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(0)
  })

  test("a correct code completes the sign in", async () => {
    const first = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    const res = await post(app, "/login/verify", { token: currentToken() }, cookiesFrom(first))
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/dashboard")
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(1)
  })

  test("a wrong code does not complete the sign in", async () => {
    const first = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    const res = await post(app, "/login/verify", { token: "000000" }, cookiesFrom(first))
    expect(res.status).toBe(400)
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(0)
  })

  test("a wrong code writes an audit entry", async () => {
    const first = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    await post(app, "/login/verify", { token: "000000" }, cookiesFrom(first))
    expect((await new AuditRepository(db).forUser(userId, 10)).map((e) => e.action)).toContain(
      "user.totp_failed",
    )
  })

  test("the challenge cannot be reached without passing the password step", async () => {
    const res = await post(app, "/login/verify", { token: currentToken() })
    // Bouncing back to /login is the correct answer here, not an error page.
    expect(res.headers.get("location")).toBe("/login")
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(0)
  })

  test("a forged pending cookie does not pass the challenge", async () => {
    const forged = "meridian_pending_2fa=" + `${userId}.${Date.now() + 60000}.forgedmac`
    const res = await post(app, "/login/verify", { token: currentToken() }, forged)
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(0)
    expect(res.headers.get("location")).toBe("/login")
  })
})

describe("POST /logout", () => {
  test("revokes the session", async () => {
    const login = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    const res = await post(app, "/logout", {}, cookiesFrom(login), "/account/security")
    expect(res.status).toBe(303)
    expect(await new SessionRepository(db).listActive(userId)).toHaveLength(0)
  })

  test("writes an audit entry", async () => {
    const login = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    await post(app, "/logout", {}, cookiesFrom(login), "/account/security")
    expect((await new AuditRepository(db).forUser(userId, 10)).map((e) => e.action)).toContain(
      "user.logout",
    )
  })
})
