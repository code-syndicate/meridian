import { test, expect, describe } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CONTENT_PAGES, LEGAL_PAGES } from "../../src/content/pages"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const ROUTES = [
  "/fees",
  "/security",
  "/regulatory",
  "/about",
  "/status",
  "/legal/terms",
  "/legal/privacy",
  "/legal/risk",
  "/legal/aml",
  "/legal/cookies",
]

describe("content routes", () => {
  for (const route of ROUTES) {
    test(`${route} responds 200 with a heading`, async () => {
      const res = await createApp(config).inject(route)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain("<h1")
      expect(html).toContain("Risk warning")
    })
  }

  test("an unknown legal page 404s", async () => {
    expect((await createApp(config).inject("/legal/nope")).status).toBe(404)
  })
})

describe("content data", () => {
  const all = [...CONTENT_PAGES, ...LEGAL_PAGES]

  test("every page has a slug, title, heading, and at least one section", () => {
    for (const page of all) {
      expect(page.slug.length).toBeGreaterThan(0)
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.heading.length).toBeGreaterThan(0)
      expect(page.sections.length).toBeGreaterThan(0)
    }
  })

  test("no section is empty", () => {
    for (const page of all) {
      for (const section of page.sections) {
        expect(section.heading.length).toBeGreaterThan(0)
        expect(section.body.length).toBeGreaterThan(0)
        for (const paragraph of section.body) {
          expect(paragraph.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  test("slugs are unique", () => {
    const slugs = all.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  test("copy contains no em dashes", () => {
    for (const page of all) {
      for (const section of page.sections) {
        for (const paragraph of section.body) {
          expect(paragraph).not.toContain("—")
          expect(paragraph).not.toContain("–")
        }
      }
    }
  })

  test("copy contains no placeholder text", () => {
    for (const page of all) {
      for (const section of page.sections) {
        for (const paragraph of section.body) {
          const lowered = paragraph.toLowerCase()
          expect(lowered).not.toContain("lorem ipsum")
          expect(lowered).not.toContain("tbd")
          expect(lowered).not.toContain("coming soon")
          expect(lowered).not.toContain("placeholder")
        }
      }
    }
  })

  test("copy makes no claim that Meridian is licensed or registered", () => {
    for (const page of all) {
      for (const section of page.sections) {
        for (const paragraph of section.body) {
          for (const pattern of [
            /\b(we|meridian) (are|is) (licensed|registered|regulated|approved)\b/i,
            /\bSEC[- ](licensed|registered|approved)\b/i,
            /\bfully (licensed|regulated)\b/i,
          ]) {
            expect(paragraph).not.toMatch(pattern)
          }
        }
      }
    }
  })

  test("copy makes no return or safety promise", () => {
    for (const page of all) {
      for (const section of page.sections) {
        for (const paragraph of section.body) {
          const lowered = paragraph.toLowerCase()
          for (const banned of ["guaranteed return", "risk-free", "your funds are safe"]) {
            expect(lowered).not.toContain(banned)
          }
        }
      }
    }
  })

  test("the risk disclosure states total loss plainly", async () => {
    const html = await (await createApp(config).inject("/legal/risk")).text()
    expect(html.toLowerCase()).toContain("lose")
    expect(html.toLowerCase()).toContain("entire")
  })

  test("the regulatory page states the current licensing stage", async () => {
    const html = await (await createApp(config).inject("/regulatory")).text()
    expect(html.toLowerCase()).toContain("not yet licensed")
    expect(html.toLowerCase()).toContain("licence applications")
  })

  test("the regulatory page names no single market as the whole business", async () => {
    const html = (await (await createApp(config).inject("/regulatory")).text()).toLowerCase()
    expect(html).not.toContain("nigeria")
    expect(html).not.toContain("securities and exchange commission")
  })

  test("the security page describes third-party custody", async () => {
    const html = await (await createApp(config).inject("/security")).text()
    expect(html.toLowerCase()).toContain("custody provider")
    expect(html.toLowerCase()).toContain("multi-party")
  })

  test("the fees page states deposits are free", async () => {
    const html = await (await createApp(config).inject("/fees")).text()
    expect(html.toLowerCase()).toContain("deposits are free")
  })
})
