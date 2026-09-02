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
  test("parses a complete environment", async () => {
    const config = loadConfig(valid)
    expect(config.env).toBe("test")
    expect(config.port).toBe(3000)
    expect(config.databasePath).toBe("./data/meridian.db")
  })

  test("throws naming every missing variable at once", async () => {
    const { SESSION_SECRET, TOTP_ENCRYPTION_KEY, ...rest } = valid
    expect(() => loadConfig(rest)).toThrow(
      /SESSION_SECRET.*TOTP_ENCRYPTION_KEY|TOTP_ENCRYPTION_KEY.*SESSION_SECRET/,
    )
  })

  test("rejects a session secret under 32 characters", async () => {
    expect(() => loadConfig({ ...valid, SESSION_SECRET: "short" })).toThrow(
      /at least 32 characters/,
    )
  })

  test("rejects a non-numeric port", async () => {
    expect(() => loadConfig({ ...valid, PORT: "not-a-port" })).toThrow(/PORT/)
  })

  test("defaults port to 3000 when absent", async () => {
    const { PORT, ...rest } = valid
    expect(loadConfig(rest).port).toBe(3000)
  })

  test("rejects an unknown NODE_ENV", async () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: "staging" })).toThrow(/NODE_ENV/)
  })
})

describe("smtp configuration", () => {
  test("defaults the port to 587 and leaves credentials unset", async () => {
    const config = loadConfig(valid)
    expect(config.smtpPort).toBe(587)
    expect(config.smtpHost).toBeNull()
    expect(config.smtpUser).toBeNull()
    expect(config.smtpPassword).toBeNull()
  })

  test("reads smtp settings when present", async () => {
    const config = loadConfig({
      ...valid,
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_USER: "postmaster",
      SMTP_PASSWORD: "secret",
      EMAIL_FROM: "Meridian <hello@example.com>",
    })
    expect(config.smtpHost).toBe("smtp.example.com")
    expect(config.smtpPort).toBe(465)
    expect(config.emailFrom).toBe("Meridian <hello@example.com>")
  })

  test("rejects a non-numeric smtp port", async () => {
    expect(() => loadConfig({ ...valid, SMTP_PORT: "nope" })).toThrow(/SMTP_PORT/)
  })

  test("production refuses to start without smtp credentials", async () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: "production" })).toThrow(/SMTP_HOST/)
  })

  test("production starts when smtp and the kyc provider are both configured", async () => {
    expect(() =>
      loadConfig({
        ...valid,
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "postmaster",
        SMTP_PASSWORD: "secret",
        KYC_PROVIDER: "smile_id",
        CUSTODY_PROVIDER: "fireblocks",
      }),
    ).not.toThrow()
  })
})

describe("custody provider configuration", () => {
  test("defaults to sandbox outside production", async () => {
    expect(loadConfig(valid).custodyProvider).toBe("sandbox")
  })

  test("production refuses to start with the sandbox custody provider", async () => {
    expect(() =>
      loadConfig({
        ...valid, NODE_ENV: "production",
        SMTP_HOST: "s", SMTP_USER: "u", SMTP_PASSWORD: "p",
        KYC_PROVIDER: "smile_id", CUSTODY_PROVIDER: "sandbox",
      }),
    ).toThrow(/CUSTODY_PROVIDER/)
  })

  test("production starts with a named custody provider", async () => {
    expect(
      loadConfig({
        ...valid, NODE_ENV: "production",
        SMTP_HOST: "s", SMTP_USER: "u", SMTP_PASSWORD: "p",
        KYC_PROVIDER: "smile_id", CUSTODY_PROVIDER: "fireblocks",
      }).custodyProvider,
    ).toBe("fireblocks")
  })
})

describe("kyc provider configuration", () => {
  test("defaults to sandbox outside production", async () => {
    expect(loadConfig(valid).kycProvider).toBe("sandbox")
  })

  test("production refuses to start with the sandbox provider", async () => {
    expect(() =>
      loadConfig({
        ...valid,
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
        KYC_PROVIDER: "sandbox",
      }),
    ).toThrow(/KYC_PROVIDER/)
  })

  test("production refuses to start with no provider configured", async () => {
    expect(() =>
      loadConfig({
        ...valid,
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
      }),
    ).toThrow(/KYC_PROVIDER/)
  })

  test("production starts with a named provider", async () => {
    expect(
      loadConfig({
        ...valid,
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
        KYC_PROVIDER: "smile_id",
        CUSTODY_PROVIDER: "fireblocks",
      }).kycProvider,
    ).toBe("smile_id")
  })
})
