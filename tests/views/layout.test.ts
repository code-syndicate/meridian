import { test, expect, describe, beforeAll } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

let html: string

beforeAll(async () => {
  const res = (await createApp(config)).inject("/")
  html = await (await res).text()
})

describe("base layout", () => {
  test("renders a complete HTML document", async () => {
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('lang="en"')
  })

  test("carries the wordmark and primary navigation", async () => {
    expect(html).toContain("MERIDIAN")
    expect(html).toContain('href="/markets"')
    expect(html).toContain('href="/regulatory"')
  })

  test("links the stylesheet rather than inlining styles", async () => {
    expect(html).toContain('href="/static/css/app.css?v=')
  })

  test("has no inline style attribute anywhere", async () => {
    expect(html).not.toMatch(/\sstyle\s*=/)
  })

  test("has no style block anywhere", async () => {
    expect(html).not.toMatch(/<style[\s>]/)
  })

  test("has no inline script body", async () => {
    const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) ?? []
    for (const tag of scripts) {
      expect(tag).toContain("src=")
      expect(tag.replace(/<script\b[^>]*>|<\/script>/g, "").trim()).toBe("")
    }
  })

  test("has no inline event handler attributes", async () => {
    expect(html).not.toMatch(/\son(click|load|error|submit|change|input)\s*=/i)
  })

  test("preloads both self-hosted fonts and references no external origin", async () => {
    expect(html).toContain('href="/static/fonts/inter-variable.woff2"')
    expect(html).toContain('href="/static/fonts/jetbrains-mono-400.woff2"')
    expect(html).not.toContain("fonts.googleapis.com")
    expect(html).not.toContain("fonts.gstatic.com")
    expect(html).not.toContain("cdn.")
  })

  test("carries the risk warning in the footer", async () => {
    expect(html).toContain("Risk warning")
    expect(html).toContain("lose the entire value")
  })

  test("carries a risk warning and claims no licence it does not hold", async () => {
    expect(html.toLowerCase()).toContain("risk warning")
    expect(html.toLowerCase()).toContain("you can lose")
    expect(html).not.toMatch(/\bfully (licensed|regulated)\b/i)
    expect(html).not.toMatch(/\b(we|meridian) (are|is) (licensed|registered|regulated|approved)\b/i)
  })

  test("carries no pre-launch scaffolding, so nothing must be swept out at launch", async () => {
    const lowered = html.toLowerCase()
    for (const banned of ["not yet", "licence application", "before launch", "coming soon"]) {
      expect(lowered).not.toContain(banned)
    }
  })

  test("carries no single-market framing", async () => {
    expect(html.toLowerCase()).not.toContain("nigeria")
  })

  test("includes a skip link as the first focusable element", async () => {
    expect(html).toContain('href="#main"')
    expect(html).toContain("Skip to content")
  })
})

describe("static assets", () => {
  test("serves the stylesheet", async () => {
    const res = (await createApp(config)).inject("/static/css/app.css")
    expect((await res).status).toBe(200)
    expect((await res).headers.get("content-type")).toContain("text/css")
  })

  test("serves fonts with long-lived immutable caching", async () => {
    const res = (await createApp(config)).inject("/static/fonts/inter-variable.woff2")
    expect((await res).status).toBe(200)
    expect((await res).headers.get("cache-control")).toContain("immutable")
  })

  test("still sets the strict CSP on rendered pages", async () => {
    const res = (await createApp(config)).inject("/")
    const csp = (await res).headers.get("content-security-policy") ?? ""
    expect(csp).not.toContain("unsafe-inline")
    expect(csp).not.toContain("unsafe-eval")
  })
})
