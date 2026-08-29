import { test, expect, describe, beforeEach } from "bun:test"
import { readFileSync } from "node:fs"
import type { Database } from "bun:sqlite"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { NeverBreached } from "../../src/services/breach-check"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { hashPassword } from "../../src/domain/identity/password"
import { post, cookiesFrom } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test", DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32), TOTP_ENCRYPTION_KEY: "y".repeat(32),
})
const PASSWORD = "correct horse battery staple"
const source = readFileSync("public/js/alpine-components.js", "utf8")

let db: Database
let app: App
let jar: string

beforeEach(async () => {
  db = openDatabase(":memory:")
  migrate(db)
  app = createApp(config, { db, email: new CapturingEmailSender(), breach: new NeverBreached() })
  const users = new UserRepository(db)
  const id = users.create("a@test.co", await hashPassword(PASSWORD))
  users.markEmailVerified(id)
  jar = cookiesFrom(await post(app, "/login", { email: "a@test.co", password: PASSWORD }))
})

describe("command palette", () => {
  test("is registered as a CSP-safe Alpine component", () => {
    expect(source).toContain('Alpine.data("palette"')
    expect(source).toContain('Alpine.data("shortcuts"')
  })

  test("uses no eval or Function constructor", () => {
    expect(source).not.toMatch(/\beval\s*\(/)
    expect(source).not.toMatch(/new\s+Function\s*\(/)
  })

  test("is hidden using the hidden attribute rather than inline style", async () => {
    const html = await (await app.inject("/")).text()
    expect(html).toContain('class="palette"')
    expect(html).toContain("hidden")
    expect(html).not.toMatch(/\sstyle\s*=/)
  })

  test("lists public destinations for an anonymous visitor", async () => {
    const html = await (await app.inject("/")).text()
    expect(html).toContain('data-label="Markets"')
    expect(html).toContain('data-label="Risk disclosure"')
  })

  test("does not list account destinations for an anonymous visitor", async () => {
    const html = await (await app.inject("/")).text()
    expect(html).not.toContain('data-label="Security settings"')
  })

  test("lists account destinations for a signed-in user", async () => {
    const html = await (await app.inject("/dashboard", { headers: { cookie: jar } })).text()
    expect(html).toContain('data-label="Dashboard"')
    expect(html).toContain('data-label="Security settings"')
  })

  test("has an accessible dialog role and label", async () => {
    const html = await (await app.inject("/")).text()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Go to page"')
  })

  test("its input has an associated label", async () => {
    const html = await (await app.inject("/")).text()
    expect(html).toContain('for="palette-input"')
    expect(html).toContain('id="palette-input"')
  })
})

describe("keyboard shortcuts", () => {
  test("the sheet documents the palette, navigation, and search keys", async () => {
    const html = await (await app.inject("/")).text()
    expect(html).toContain("Keyboard shortcuts")
    expect(html).toContain("Go to dashboard")
    expect(html).toContain("Go to markets")
  })

  test("shortcuts are ignored while focus is in a form field", () => {
    expect(source).toContain("function editing(")
    expect(source).toContain('tag === "INPUT"')
    expect(source).toContain("isContentEditable")
  })

  test("the sheet says shortcuts are only an accelerator", async () => {
    const html = await (await app.inject("/")).text()
    expect(html.toLowerCase()).toContain("also a normal link")
  })
})

describe("progressive enhancement", () => {
  test("every palette destination is a real link with a real href", async () => {
    const html = await (await app.inject("/dashboard", { headers: { cookie: jar } })).text()
    const labels = [...html.matchAll(/data-label="([^"]+)"/g)].map((m) => m[1])
    expect(labels.length).toBeGreaterThan(10)
    for (const label of labels) {
      const pattern = new RegExp(`<a href="[^"]+" data-label="${label}"`)
      expect(`${label}: ${pattern.test(html)}`).toBe(`${label}: true`)
    }
  })

  test("every shortcut target is reachable without javascript", async () => {
    const html = await (await app.inject("/dashboard", { headers: { cookie: jar } })).text()
    for (const href of ["/dashboard", "/markets", "/account"]) {
      expect(`${href}: ${html.includes(`href="${href}"`)}`).toBe(`${href}: true`)
    }
  })
})
