import { test, expect, describe } from "bun:test"
import { JSDOM } from "jsdom"
import { source as axeSource } from "axe-core"
import { createApp } from "../src/server"
import { loadConfig } from "../src/config"

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
  const html = await (await createApp(config).inject(path)).text()
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
      const html = await (await createApp(config).inject(route)).text()
      const h1s = (html.match(/<h1[\s>]/g) ?? []).length
      expect(`${route}: ${h1s}`).toBe(`${route}: 1`)
    }
  }, 30_000)

  test("every page sets a unique, non-empty title", async () => {
    const titles = new Set<string>()
    for (const route of ROUTES) {
      const html = await (await createApp(config).inject(route)).text()
      const title = html.match(/<title>(.*?)<\/title>/)?.[1] ?? ""
      expect(title.length).toBeGreaterThan(0)
      titles.add(title)
    }
    expect(titles.size).toBeGreaterThan(ROUTES.length - 3)
  }, 30_000)

  test("every page sets a meta description", async () => {
    for (const route of ROUTES) {
      const html = await (await createApp(config).inject(route)).text()
      expect(`${route}: ${/name="description"/.test(html)}`).toContain("true")
    }
  }, 30_000)
})
