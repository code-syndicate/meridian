import { test, expect, describe, beforeAll } from "bun:test"
import type { Client } from "../../src/db"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { migrate, openDatabase } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { hashPassword } from "../../src/domain/identity/password"
import { post, cookiesFrom } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test", DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32), TOTP_ENCRYPTION_KEY: "y".repeat(32),
})
const PASSWORD = "correct horse battery staple 7"

let db: Client
let app: App
let customer: string
let admin: string

async function signIn(email: string, role: "user" | "admin"): Promise<string> {
  const users = new UserRepository(db)
  const id = await users.create(email, await hashPassword(PASSWORD))
  await users.markEmailVerified(id)
  if (role === "admin") await users.setRole(id, "admin")
  return cookiesFrom(await post(app, "/login", { email, password: PASSWORD }))
}

async function page(path: string, cookie = ""): Promise<Response> {
  return await app.inject(path, cookie ? { headers: { cookie } } : undefined)
}

beforeAll(async () => {
  db = await openDatabase(":memory:")
  await migrate(db)
  app = await createApp(config, { db, email: new CapturingEmailSender() })
  customer = await signIn("customer@test.co", "user")
  admin = await signIn("admin@test.co", "admin")
})

describe("sign out", () => {
  test("a signed-in page offers a sign-out form that posts to /logout with a CSRF token", async () => {
    const html = await (await page("/dashboard", customer)).text()
    const form = html.match(/<form[^>]*action="\/logout"[\s\S]*?<\/form>/g) ?? []
    expect(form.length).toBeGreaterThan(0)
    for (const f of form) {
      expect(f).toContain('method="post"')
      expect(f).toContain('name="_csrf"')
      expect(f).toContain("Sign out")
    }
  })

  test("is on public pages too, once signed in", async () => {
    const html = await (await page("/markets", customer)).text()
    expect(html).toContain('action="/logout"')
  })

  test("is absent when signed out, which offers sign in instead", async () => {
    const html = await (await page("/")).text()
    expect(html).not.toContain('action="/logout"')
    expect(html).toContain('href="/login"')
  })
})

describe("mobile menu", () => {
  test("the primary navigation has a menu toggle", async () => {
    const html = await (await page("/")).text()
    expect(html).toMatch(/<details[^>]*class="[^"]*\bmenu\b/)
    expect(html).toMatch(/<summary[^>]*>[\s\S]*?Menu/)
  })

  test("the signed-in menu lists the account pages and sign out", async () => {
    const html = await (await page("/", customer)).text()
    const menu = html.match(/<details[^>]*class="[^"]*\bmenu\b[\s\S]*?<\/details>/)?.[0] ?? ""
    for (const href of ["/dashboard", "/wallet/deposit", "/wallet/withdraw", "/wallet/send", "/account/security"]) {
      expect(menu).toContain(`href="${href}"`)
    }
    expect(menu).toContain('action="/logout"')
  })

  test("account tabs collapse to a dropdown naming the current section", async () => {
    const html = await (await page("/wallet/deposit", customer)).text()
    const select = html.match(/<details[^>]*class="[^"]*\btabs-menu\b[\s\S]*?<\/details>/)?.[0] ?? ""
    expect(select).toMatch(/<summary[^>]*>[\s\S]*?Deposit/)
    expect(select).toContain('href="/wallet/transactions"')
  })
})

describe("admin navigation is for admins only", () => {
  test("a customer sees no admin link anywhere", async () => {
    for (const path of ["/", "/dashboard", "/markets", "/account/security"]) {
      const html = await (await page(path, customer)).text()
      expect(`${path}: ${html.includes('href="/admin')}`).toBe(`${path}: false`)
    }
  })

  test("a signed-out visitor sees no admin link", async () => {
    const html = await (await page("/")).text()
    expect(html).not.toContain('href="/admin')
  })

  test("an admin sees the admin link in both the bar and the menu", async () => {
    const html = await (await page("/", admin)).text()
    const menu = html.match(/<details[^>]*class="[^"]*\bmenu\b[\s\S]*?<\/details>/)?.[0] ?? ""
    expect(menu).toContain('href="/admin"')
    expect(html.split('href="/admin"').length - 1).toBeGreaterThanOrEqual(2)
  })

  test("a customer asking for an admin page gets the ordinary 404", async () => {
    for (const path of ["/admin", "/admin/users", "/admin/withdrawals"]) {
      expect((await page(path, customer)).status).toBe(404)
    }
  })

  test("an admin gets the admin pages", async () => {
    expect((await page("/admin", admin)).status).toBe(200)
  })
})
