import { test, expect, describe } from "bun:test"
import { createApp } from "../src/server"
import { loadConfig } from "../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

describe("createApp", () => {
  test("serves a health check", async () => {
    const res = (await createApp(config)).inject("/health")
    expect((await res).status).toBe(200)
    expect(await (await res).json()).toMatchObject({ status: "ok" })
  })

  test("sets a content security policy with no unsafe directives", async () => {
    const res = (await createApp(config)).inject("/health")
    const csp = (await res).headers.get("content-security-policy") ?? ""
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain("unsafe-inline")
    expect(csp).not.toContain("unsafe-eval")
  })

  test("sets the remaining security headers", async () => {
    const res = (await createApp(config)).inject("/health")
    expect((await res).headers.get("x-content-type-options")).toBe("nosniff")
    expect((await res).headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
    expect((await res).headers.get("x-powered-by")).toBeNull()
  })

  test("returns 404 as JSON for an unknown route", async () => {
    const res = (await createApp(config)).inject("/nope")
    expect((await res).status).toBe(404)
  })
})
