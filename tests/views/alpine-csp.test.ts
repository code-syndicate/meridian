import { test, expect, describe, beforeAll } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const componentsSource = readFileSync("public/js/alpine-components.js", "utf8")

describe("alpine components file", () => {
  test("registers every component through Alpine.data", () => {
    expect(componentsSource).toContain("Alpine.data(")
    expect(componentsSource).toContain('Alpine.data("ticker"')
  })

  test("registers on the alpine:init event", () => {
    expect(componentsSource).toContain("alpine:init")
  })

  test("uses no eval or Function constructor", () => {
    expect(componentsSource).not.toMatch(/\beval\s*\(/)
    expect(componentsSource).not.toMatch(/new\s+Function\s*\(/)
  })
})

describe("templates obey the CSP build's rules", () => {
  function pugFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...pugFiles(full))
      else if (entry.name.endsWith(".pug")) out.push(full)
    }
    return out
  }

  const sources = pugFiles("src/views").map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }))

  test("finds templates to check", () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  test("x-data never contains an inline object literal", () => {
    for (const { path, text } of sources) {
      const matches = text.match(/x-data\s*=\s*"([^"]*)"/g) ?? []
      for (const match of matches) {
        expect(`${path}: ${match}`).not.toContain("{")
      }
    }
  })

  test("x-on handlers name a method rather than an expression", () => {
    for (const { path, text } of sources) {
      const matches = text.match(/x-on:[a-z]+\s*=\s*"([^"]*)"/g) ?? []
      for (const match of matches) {
        const body = match.split('="')[1]!.slice(0, -1)
        expect(body).toMatch(/^[A-Za-z_$][\w$]*$/)
      }
    }
  })
})

describe("rendered pages", () => {
  let html: string
  beforeAll(async () => {
    html = await (await createApp(config).inject("/")).text()
  })

  test("load alpine from our own origin", () => {
    expect(html).toContain('src="/static/js/alpine.js?v=')
    expect(html).not.toContain("unpkg.com")
    expect(html).not.toContain("jsdelivr")
  })

  test("load the component registrations before alpine itself", () => {
    expect(html.indexOf("alpine-components.js")).toBeLessThan(html.indexOf('/static/js/alpine.js?v='))
  })
})
