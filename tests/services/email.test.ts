import { test, expect, describe } from "bun:test"
import {
  createEmailSender,
  ConsoleEmailSender,
  SmtpEmailSender,
  CapturingEmailSender,
} from "../../src/services/email"

const base = {
  smtpHost: null,
  smtpPort: 587,
  smtpUser: null,
  smtpPassword: null,
  emailFrom: "Meridian <no-reply@example.com>",
}

describe("createEmailSender", () => {
  test("falls back to the console sender outside production", async () => {
    expect(createEmailSender({ ...base, env: "development" })).toBeInstanceOf(ConsoleEmailSender)
  })

  test("falls back to the console sender in test", async () => {
    expect(createEmailSender({ ...base, env: "test" })).toBeInstanceOf(ConsoleEmailSender)
  })

  test("refuses to fall back in production", async () => {
    expect(() => createEmailSender({ ...base, env: "production" })).toThrow(/SMTP/)
  })

  test("uses smtp when fully configured", async () => {
    const sender = createEmailSender({
      ...base,
      env: "development",
      smtpHost: "smtp.example.com",
      smtpUser: "postmaster",
      smtpPassword: "secret",
    })
    expect(sender).toBeInstanceOf(SmtpEmailSender)
  })

  test("treats a partially configured smtp as unconfigured", async () => {
    const sender = createEmailSender({
      ...base,
      env: "development",
      smtpHost: "smtp.example.com",
    })
    expect(sender).toBeInstanceOf(ConsoleEmailSender)
  })
})

describe("CapturingEmailSender", () => {
  test("records what was sent", async () => {
    const sender = new CapturingEmailSender()
    await sender.send({ to: "a@test.co", subject: "Hi", text: "body" })
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]!.to).toBe("a@test.co")
  })
})
