import { test, expect, describe } from "bun:test"
import { loadConfig } from "../src/config"

const valid = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_PATH: "./data/meridian.db",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
}

describe("loadConfig", () => {
  test("parses a complete environment", () => {
    const config = loadConfig(valid)
    expect(config.env).toBe("test")
    expect(config.port).toBe(3000)
    expect(config.databasePath).toBe("./data/meridian.db")
  })

  test("throws naming every missing variable at once", () => {
    const { SESSION_SECRET, TOTP_ENCRYPTION_KEY, ...rest } = valid
    expect(() => loadConfig(rest)).toThrow(
      /SESSION_SECRET.*TOTP_ENCRYPTION_KEY|TOTP_ENCRYPTION_KEY.*SESSION_SECRET/,
    )
  })

  test("rejects a session secret under 32 characters", () => {
    expect(() => loadConfig({ ...valid, SESSION_SECRET: "short" })).toThrow(
      /at least 32 characters/,
    )
  })

  test("rejects a non-numeric port", () => {
    expect(() => loadConfig({ ...valid, PORT: "not-a-port" })).toThrow(/PORT/)
  })

  test("defaults port to 3000 when absent", () => {
    const { PORT, ...rest } = valid
    expect(loadConfig(rest).port).toBe(3000)
  })

  test("rejects an unknown NODE_ENV", () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: "staging" })).toThrow(/NODE_ENV/)
  })
})
