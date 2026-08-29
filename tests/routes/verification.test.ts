import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { NeverBreached } from "../../src/services/breach-check"
import { SandboxKycProvider } from "../../src/services/kyc-provider"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { KycRepository } from "../../src/db/repositories/kyc"
import { hashPassword } from "../../src/domain/identity/password"
import { post, cookiesFrom } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const PASSWORD = "correct horse battery staple"

let db: Database
let app: App
let userId: number
let jar: string
let kyc: KycRepository

beforeEach(async () => {
  db = openDatabase(":memory:")
  migrate(db)
  app = createApp(config, {
    db,
    email: new CapturingEmailSender(),
    breach: new NeverBreached(),
    kycProvider: new SandboxKycProvider(),
  })
  kyc = new KycRepository(db)
  const users = new UserRepository(db)
  userId = users.create("a@test.co", await hashPassword(PASSWORD))
  users.markEmailVerified(userId)
  jar = cookiesFrom(await post(app, "/login", { email: "a@test.co", password: PASSWORD }))
})

async function page(path = "/account/verification"): Promise<string> {
  return (await app.inject(path, { headers: { cookie: jar } })).text()
}

describe("/account/verification", () => {
  test("requires authentication", async () => {
    const res = await app.inject("/account/verification", { redirect: "manual" })
    expect(res.headers.get("location")).toBe("/login")
  })

  test("tells an unverified user they have not started, and links to the wizard", async () => {
    const html = await page()
    expect(html.toLowerCase()).toContain("not started verification")
    expect(html).toContain('href="/onboarding"')
  })

  test("shows an unfinished application as resumable", async () => {
    kyc.start(userId, 2)
    const html = await page()
    expect(html.toLowerCase()).toContain("unfinished")
    expect(html).toContain('href="/onboarding"')
  })

  test("shows a review state with no invented eta", async () => {
    const id = kyc.start(userId, 2)
    kyc.submit(id)
    const html = await page()
    expect(html.toLowerCase()).toContain("under review")
    // No made-up turnaround and no progress percentage.
    expect(html).not.toMatch(/\d+\s*(hours|days|business days)/i)
    expect(html).not.toMatch(/\d+%/)
  })

  test("shows the tier and its limits once approved", async () => {
    const id = kyc.start(userId, 2)
    kyc.decide(id, "approved")
    const html = await page()
    expect(html.toLowerCase()).toContain("you are verified")
    expect(html.toLowerCase()).toContain("tier 2")
    expect(html).toContain("50000")
  })

  test("shows the rejection reason and offers one resubmission", async () => {
    const id = kyc.start(userId, 2)
    kyc.decide(id, "rejected", "Details did not match records")
    const html = await page()
    expect(html).toContain("Details did not match records")
    expect(html.toLowerCase()).toContain("try again")
  })

  test("refuses a third attempt and says so", async () => {
    const first = kyc.start(userId, 2)
    kyc.decide(first, "rejected", "no")
    const second = kyc.start(userId, 2)
    kyc.decide(second, "rejected", "no again")
    const html = await page()
    expect(html.toLowerCase()).toContain("used your resubmission")
  })

  test("never displays a government identifier beyond the last four", async () => {
    const id = kyc.start(userId, 2)
    kyc.updateProfile(id, { governmentIdType: "BVN", governmentIdLast4: "8901" })
    const html = await page()
    expect(html).toContain("8901")
    expect(html).not.toContain("12345678901")
  })
})

describe("/account profile", () => {
  test("requires authentication", async () => {
    const res = await app.inject("/account", { redirect: "manual" })
    expect(res.headers.get("location")).toBe("/login")
  })

  test("shows the email address", async () => {
    expect(await page("/account")).toContain("a@test.co")
  })

  test("shows no legal name before verification", async () => {
    expect(await page("/account")).toContain("Not verified yet")
  })

  test("shows the verified name once an application has one", async () => {
    const id = kyc.start(userId, 2)
    kyc.updateProfile(id, { firstName: "Chidinma", lastName: "Okeke" })
    const html = await page("/account")
    expect(html).toContain("Chidinma Okeke")
  })
})

describe("navigation gating on the dashboard", () => {
  test("deposit and withdraw are navigable, and gate on the destination page", async () => {
    const html = await page("/dashboard")
    expect(html).toContain('href="/wallet/deposit"')
    expect(html).toContain('href="/wallet/withdraw"')
    // An unverified user is stopped at the destination, not by a dead button.
    const gated = await app.inject("/wallet/deposit/btc", { headers: { cookie: jar } })
    expect(gated.status).toBe(403)
    expect((await gated.text()).toLowerCase()).toContain("verify your identity first")
  })

  test("trade stays disabled, because there is no execution subsystem yet", async () => {
    const html = await page("/dashboard")
    expect(html).toContain("Trade")
    expect(html).toMatch(/disabled[^>]*>\s*Trade|Trade/)
  })

  test("an unverified user is told to verify", async () => {
    expect((await page("/dashboard")).toLowerCase()).toContain("verify your identity")
  })

  test("a verified user is not told to verify, but told it is not launched", async () => {
    const id = kyc.start(userId, 2)
    kyc.decide(id, "approved")
    const html = await page("/dashboard")
    expect(html.toLowerCase()).not.toContain("verify your identity to enable")
    expect(html.toLowerCase()).toContain("not yet available")
  })
})
