import { test, expect, describe } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"
import { HELP_ARTICLES } from "../../src/content/help"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

describe("GET /help", () => {
  test("responds 200", async () => {
    expect((await createApp(config).inject("/help")).status).toBe(200)
  })

  test("lists every article", async () => {
    const html = await (await createApp(config).inject("/help")).text()
    for (const article of HELP_ARTICLES) {
      expect(html).toContain(article.title)
      expect(html).toContain(`/help/${article.slug}`)
    }
  })

  test("groups articles by category", async () => {
    const html = await (await createApp(config).inject("/help")).text()
    for (const category of new Set(HELP_ARTICLES.map((a) => a.category))) {
      expect(html).toContain(category)
    }
  })
})

describe("GET /help/:slug", () => {
  for (const article of HELP_ARTICLES) {
    test(`${article.slug} renders`, async () => {
      const res = await createApp(config).inject(`/help/${article.slug}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain(article.title)
    })
  }

  test("returns 404 for an unknown article", async () => {
    expect((await createApp(config).inject("/help/nope")).status).toBe(404)
  })
})

describe("help content", () => {
  test("slugs are unique", () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  test("every article has a summary and at least one section", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.summary.trim().length).toBeGreaterThan(0)
      expect(article.sections.length).toBeGreaterThan(0)
    }
  })

  test("there is an article explaining networks, which is the costliest mistake", () => {
    const networks = HELP_ARTICLES.find((a) => a.slug === "choosing-the-right-network")
    expect(networks).toBeDefined()
    const text = networks!.sections.flatMap((s) => s.body).join(" ").toLowerCase()
    expect(text).toContain("permanently")
  })

  test("copy contains no em dashes", () => {
    for (const article of HELP_ARTICLES) {
      for (const section of article.sections) {
        for (const paragraph of section.body) {
          expect(paragraph).not.toContain("—")
        }
      }
    }
  })
})
