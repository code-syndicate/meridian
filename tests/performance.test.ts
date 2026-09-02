import { test, expect, describe } from "bun:test"
import { statSync, readFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { createApp } from "../src/server"
import { loadConfig } from "../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const KB = 1024

describe("asset budget", () => {
  test("total javascript stays under 120KB", async () => {
    const total =
      statSync("public/js/alpine.js").size + statSync("public/js/alpine-components.js").size
    expect(total).toBeLessThan(120 * KB)
  })

  // Raw size is not what ships. The stylesheet is served gzipped and cached
  // immutably behind a content hash, so the transfer cost is what matters.
  test("stylesheet stays under 64KB raw", async () => {
    expect(statSync("public/css/app.css").size).toBeLessThan(64 * KB)
  })

  test("stylesheet stays under 12KB gzipped, which is what is transferred", async () => {
    const gzipped = gzipSync(readFileSync("public/css/app.css"), { level: 9 })
    expect(gzipped.byteLength).toBeLessThan(12 * KB)
  })

  test("each font face stays under 200KB", async () => {
    for (const font of [
      "public/fonts/inter-variable.woff2",
      "public/fonts/jetbrains-mono-400.woff2",
      "public/fonts/jetbrains-mono-500.woff2",
    ]) {
      expect(statSync(font).size).toBeLessThan(200 * KB)
    }
  })
})

describe("page weight", () => {
  const ROUTES = ["/", "/markets", "/fees", "/legal/risk"]

  for (const route of ROUTES) {
    test(`${route} HTML stays under 60KB`, async () => {
      const html = await (await ((await createApp(config)).inject(route))).text()
      expect(Buffer.byteLength(html, "utf8")).toBeLessThan(60 * KB)
    })
  }

  test("no page loads more than three scripts", async () => {
    for (const route of ROUTES) {
      const html = await (await ((await createApp(config)).inject(route))).text()
      expect(`${route}: ${(html.match(/<script/g) ?? []).length}`).toMatch(/: [0-3]$/)
    }
  })
})
