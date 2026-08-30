import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { hashPassword } from "../../src/domain/identity/password"
import { post, cookiesFrom, mergeCookies } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test", DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32), TOTP_ENCRYPTION_KEY: "y".repeat(32),
})
const PASSWORD = "correct horse battery staple 7"

let db: Database
let app: App
let jar: string

beforeEach(async () => {
  db = openDatabase(":memory:")
  migrate(db)
  app = createApp(config, { db, email: new CapturingEmailSender(), })
  const users = new UserRepository(db)
  const id = users.create("a@test.co", await hashPassword(PASSWORD))
  users.markEmailVerified(id)
  jar = cookiesFrom(await post(app, "/login", { email: "a@test.co", password: PASSWORD }))
})

describe("flash", () => {
  test("renders nothing when there is no message", async () => {
    const html = await (await app.inject("/dashboard", { headers: { cookie: jar } })).text()
    expect(html).not.toContain('class="flash"')
  })

  test("survives a redirect, which is the whole point", async () => {
    const res = await post(
      app, "/account/sessions/revoke-others", {}, jar, "/account/security",
    )
    const after = mergeCookies(jar, res)
    const html = await (
      await app.inject("/account/security", { headers: { cookie: after } })
    ).text()
    expect(html).toContain("Signed out of your other devices.")
  })

  test("renders only once", async () => {
    const res = await post(
      app, "/account/sessions/revoke-others", {}, jar, "/account/security",
    )
    let after = mergeCookies(jar, res)
    const first = await app.inject("/account/security", { headers: { cookie: after } })
    expect(await first.text()).toContain("Signed out of your other devices.")

    after = mergeCookies(after, first)
    const second = await app.inject("/account/security", { headers: { cookie: after } })
    expect(await second.text()).not.toContain("Signed out of your other devices.")
  })

  test("confirms a password change", async () => {
    const res = await post(
      app, "/account/password",
      { current: PASSWORD, next: "an entirely different passphrase 4" },
      jar, "/account/security",
    )
    const after = mergeCookies(jar, res)
    const html = await (
      await app.inject("/account/security", { headers: { cookie: after } })
    ).text()
    expect(html).toContain("Password changed")
  })

  test("a forged flash cookie is ignored", async () => {
    const forged = `${jar}; meridian_flash=${Buffer.from("You have won a prize", "utf8").toString("base64url")}.${Date.now() + 60000}.forgedmac`
    const html = await (
      await app.inject("/dashboard", { headers: { cookie: forged } })
    ).text()
    expect(html).not.toContain("You have won a prize")
  })

  test("an expired flash cookie is ignored", async () => {
    const encoded = Buffer.from("Stale message", "utf8").toString("base64url")
    const stale = `${jar}; meridian_flash=${encoded}.1.mac`
    const html = await (await app.inject("/dashboard", { headers: { cookie: stale } })).text()
    expect(html).not.toContain("Stale message")
  })

  test("works with no javascript, because it is server rendered", async () => {
    const res = await post(
      app, "/account/sessions/revoke-others", {}, jar, "/account/security",
    )
    const after = mergeCookies(jar, res)
    const html = await (
      await app.inject("/account/security", { headers: { cookie: after } })
    ).text()
    // Present in the HTML itself, not injected by a script.
    expect(html).toContain('<div class="flash" role="status">')
  })
})
