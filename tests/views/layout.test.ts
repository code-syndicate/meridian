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
  const res = await createApp(config).inject("/")
  html = await res.text()
})

describe("base layout", () => {
  test("renders a complete HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('lang="en"')
  })

  test("carries the wordmark and primary navigation", () => {
    expect(html).toContain("MERIDIAN")
    expect(html).toContain('href="/markets"')
    expect(html).toContain('href="/regulatory"')
  })

  test("links the stylesheet rather than inlining styles", () => {
    expect(html).toContain('href="/static/css/app.css"')
  })

  test("has no inline style attribute anywhere", () => {
    expect(html).not.toMatch(/\sstyle\s*=/)
  })

  test("has no style block anywhere", () => {
    expect(html).not.toMatch(/<style[\s>]/)
  })

  test("has no inline script body", () => {
    const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) ?? []
    for (const tag of scripts) {
      expect(tag).toContain("src=")
      expect(tag.replace(/<script\b[^>]*>|<\/script>/g, "").trim()).toBe("")
    }
  })

  test("has no inline event handler attributes", () => {
    expect(html).not.toMatch(/\son(click|load|error|submit|change|input)\s*=/i)
  })

  test("preloads both self-hosted fonts and references no external origin", () => {
    expect(html).toContain('href="/static/fonts/inter-variable.woff2"')
    expect(html).toContain('href="/static/fonts/jetbrains-mono-400.woff2"')
    expect(html).not.toContain("fonts.googleapis.com")
    expect(html).not.toContain("fonts.gstatic.com")
    expect(html).not.toContain("cdn.")
  })

  test("carries the risk warning in the footer", () => {
    expect(html).toContain("Risk warning")
    expect(html).toContain("lose the entire value")
  })

  test("states licensing status without claiming registration", () => {
    expect(html).toContain("not yet registered")
    expect(html).not.toMatch(/\bSEC[- ]registered\b/i)
  })

  test("includes a skip link as the first focusable element", () => {
    expect(html).toContain('href="#main"')
    expect(html).toContain("Skip to content")
  })
})

describe("static assets", () => {
  test("serves the stylesheet", async () => {
    const res = await createApp(config).inject("/static/css/app.css")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/css")
  })

  test("serves fonts with long-lived immutable caching", async () => {
    const res = await createApp(config).inject("/static/fonts/inter-variable.woff2")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("immutable")
  })

  test("still sets the strict CSP on rendered pages", async () => {
    const res = await createApp(config).inject("/")
    const csp = res.headers.get("content-security-policy") ?? ""
    expect(csp).not.toContain("unsafe-inline")
    expect(csp).not.toContain("unsafe-eval")
  })
})
