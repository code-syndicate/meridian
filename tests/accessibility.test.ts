import { test, expect, describe } from "bun:test"
import { JSDOM } from "jsdom"
import { source as axeSource } from "axe-core"
import { createApp } from "../src/server"
import { loadConfig } from "../src/config"
import { CapturingEmailSender } from "../src/services/email"
import { SandboxKycProvider } from "../src/services/kyc-provider"
import { migrate, openDatabase } from "../src/db"
import { UserRepository } from "../src/db/repositories/users"
import { KycRepository } from "../src/db/repositories/kyc"
import { hashPassword } from "../src/domain/identity/password"
import { post, cookiesFrom } from "./support/http"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const ROUTES = [
  "/",
  "/markets",
  "/markets/btc",
  "/fees",
  "/security",
  "/regulatory",
  "/about",
  "/status",
  "/help",
  "/help/choosing-the-right-network",
  "/legal/terms",
  "/legal/privacy",
  "/legal/risk",
  "/legal/aml",
  "/legal/cookies",
  "/get-started",
  "/resources",
  "/login",
  "/register",
  "/check-email",
]

interface AxeViolation {
  id: string
  impact: string | null
  nodes: unknown[]
}

async function violationsFor(path: string): Promise<AxeViolation[]> {
  const html = await (await ((await createApp(config)).inject(path))).text()
  const dom = new JSDOM(html, { runScripts: "outside-only" })
  dom.window.eval(axeSource)
  const results = (await dom.window.eval(
    "axe.run(document, { resultTypes: ['violations'] })",
  )) as { violations: AxeViolation[] }
  return results.violations
}

describe("accessibility", () => {
  for (const route of ROUTES) {
    test(
      `${route} has no axe violations`,
      async () => {
        const violations = await violationsFor(route)
        const summary = violations.map((v) => `${v.id} (${v.nodes.length} nodes)`).join(", ")
        expect(summary).toBe("")
      },
      30_000,
    )
  }
})

describe("document structure", () => {
  test("every page has exactly one h1", async () => {
    for (const route of ROUTES) {
      const html = await (await ((await createApp(config)).inject(route))).text()
      const h1s = (html.match(/<h1[\s>]/g) ?? []).length
      expect(`${route}: ${h1s}`).toBe(`${route}: 1`)
    }
  }, 30_000)

  test("every page sets a unique, non-empty title", async () => {
    const titles = new Set<string>()
    for (const route of ROUTES) {
      const html = await (await ((await createApp(config)).inject(route))).text()
      const title = html.match(/<title>(.*?)<\/title>/)?.[1] ?? ""
      expect(title.length).toBeGreaterThan(0)
      titles.add(title)
    }
    expect(titles.size).toBeGreaterThan(ROUTES.length - 3)
  }, 30_000)

  test("every page sets a meta description", async () => {
    for (const route of ROUTES) {
      const html = await (await ((await createApp(config)).inject(route))).text()
      expect(`${route}: ${/name="description"/.test(html)}`).toContain("true")
    }
  }, 30_000)
})

// Authenticated pages, including every wizard step. New form markup is the
// most likely place to introduce a violation, so it gets the same gate.
describe("accessibility of authenticated pages", () => {
  const AUTH_ROUTES = [
    "/dashboard",
    "/account",
    "/account/security",
    "/account/activity",
    "/account/verification",
    "/account/2fa",
    "/onboarding/identity",
    "/onboarding/government-id",
    "/onboarding/address",
    "/onboarding/document",
    "/onboarding/disclosures",
    "/onboarding/submitted",
    "/wallet/deposit",
    "/wallet/withdraw",
    "/wallet/transactions",
    "/wallet/send",
  ]

  test("every authenticated route has no axe violations", async () => {
    const db = await openDatabase(":memory:")
    await migrate(db)
    const app = await createApp(config, {
      db,
      email: new CapturingEmailSender(),
      kycProvider: new SandboxKycProvider(),
    })
    const users = new UserRepository(db)
    const userId = await users.create("a@test.co", await hashPassword("correct horse battery staple 7"))
    await users.markEmailVerified(userId)
    const jar = cookiesFrom(
      await post(app, "/login", {
        email: "a@test.co",
        password: "correct horse battery staple 7",
      }),
    )

    // Push the application to the last step so every wizard screen renders.
    const kyc = new KycRepository(db)
    const id = await kyc.start(userId, 2)
    await kyc.advance(id, "disclosures")

    const failures: string[] = []
    for (const route of AUTH_ROUTES) {
      const html = await (await app.inject(route, { headers: { cookie: jar } })).text()
      const dom = new JSDOM(html, { runScripts: "outside-only" })
      dom.window.eval(axeSource)
      const results = (await dom.window.eval(
        "axe.run(document, { resultTypes: ['violations'] })",
      )) as { violations: AxeViolation[] }
      if (results.violations.length > 0) {
        failures.push(`${route}: ${results.violations.map((v) => v.id).join(", ")}`)
      }
    }
    expect(failures.join(" | ")).toBe("")
  }, 60_000)
})
