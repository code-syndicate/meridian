import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../src/db"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { SandboxKycProvider } from "../../src/services/kyc-provider"
import { all, migrate, openDatabase } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { KycRepository } from "../../src/db/repositories/kyc"
import { AuditRepository } from "../../src/db/repositories/audit"
import { hashPassword } from "../../src/domain/identity/password"
import { post, cookiesFrom } from "../support/http"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const PASSWORD = "correct horse battery staple 7"
const DOC = "A01234567"

let db: Client
let app: App
let provider: SandboxKycProvider
let userId: number
let jar: string

const IDENTITY = {
  firstName: "Chidinma",
  middleName: "",
  lastName: "Okeke",
  dateOfBirth: "1994-05-12",
  phone: "+2348031234567",
}

const ADDRESS = {
  country: "GB",
  region: "Greater London",
  city: "London",
  streetAddress: "14 Finsbury Square",
  postalCode: "EC2A 1AH",
}

beforeEach(async () => {
  db = await openDatabase(":memory:")
  await migrate(db)
  provider = new SandboxKycProvider()
  app = await createApp(config, {
    db,
    email: new CapturingEmailSender(),
    kycProvider: provider,
  })
  const users = new UserRepository(db)
  userId = await users.create("a@test.co", await hashPassword(PASSWORD))
  await users.markEmailVerified(userId)
  jar = cookiesFrom(await post(app, "/login", { email: "a@test.co", password: PASSWORD }))
})

async function doIdentity(): Promise<Response> {
  return post(app, "/onboarding/identity", IDENTITY, jar)
}
async function doGovernmentId(idNumber = DOC): Promise<Response> {
  return post(app, "/onboarding/government-id", { idType: "PASSPORT", idNumber }, jar)
}
async function doAddress(): Promise<Response> {
  return post(app, "/onboarding/address", ADDRESS, jar)
}
async function doDocument(): Promise<void> {
  await app.inject("/onboarding/document", { headers: { cookie: jar } })
  const session = (await new KycRepository(db).openFor(userId))!.documentSession!
  provider.complete(session, "passed")
  await app.inject("/onboarding/document", { headers: { cookie: jar }, redirect: "manual" })
}

describe("access", () => {
  test("redirects an anonymous visitor to sign in", async () => {
    const res = await app.inject("/onboarding", { redirect: "manual" })
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/login")
  })

  test("starts an application and lands on the identity step", async () => {
    const res = await app.inject("/onboarding", { headers: { cookie: jar }, redirect: "manual" })
    expect(res.headers.get("location")).toBe("/onboarding/identity")
    expect(await new KycRepository(db).openFor(userId)).not.toBeNull()
  })

  test("writes an audit entry when the application starts", async () => {
    await app.inject("/onboarding", { headers: { cookie: jar }, redirect: "manual" })
    expect((await new AuditRepository(db).forUser(userId, 20)).map((e) => e.action)).toContain(
      "kyc.started",
    )
  })

  test("resumes at the saved step on return", async () => {
    await doIdentity()
    const res = await app.inject("/onboarding", { headers: { cookie: jar }, redirect: "manual" })
    expect(res.headers.get("location")).toBe("/onboarding/government-id")
  })
})

describe("step 1, identity", () => {
  test("saves valid details and advances", async () => {
    const res = await doIdentity()
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/onboarding/government-id")
    expect((await new KycRepository(db).openFor(userId))!.currentStep).toBe("government_id")
  })

  test("stores the phone in international format", async () => {
    await doIdentity()
    const app_ = (await new KycRepository(db).openFor(userId))!
    expect((await new KycRepository(db).profileFor(app_.id))!.phone).toBe("+2348031234567")
  })

  test("rejects a name containing digits and stays on the step", async () => {
    const res = await post(
      app,
      "/onboarding/identity",
      { ...IDENTITY, firstName: "Ade2" },
      jar,
    )
    expect(res.status).toBe(400)
    expect((await new KycRepository(db).openFor(userId))!.currentStep).toBe("identity")
  })

  test("rejects someone under eighteen with a clear message", async () => {
    const under = new Date()
    under.setUTCFullYear(under.getUTCFullYear() - 15)
    const res = await post(
      app,
      "/onboarding/identity",
      { ...IDENTITY, dateOfBirth: under.toISOString().slice(0, 10) },
      jar,
    )
    expect(res.status).toBe(400)
    expect((await res.text()).toLowerCase()).toContain("18 or older")
  })

  test("rejects a number without a country code", async () => {
    const res = await post(
      app,
      "/onboarding/identity",
      { ...IDENTITY, phone: "07700900123" },
      jar,
    )
    expect(res.status).toBe(400)
    expect((await res.text()).toLowerCase()).toContain("international format")
  })

  test("redisplays what the user typed after a validation failure", async () => {
    const res = await post(
      app,
      "/onboarding/identity",
      { ...IDENTITY, firstName: "Ade2", lastName: "Okonkwo" },
      jar,
    )
    expect(await res.text()).toContain("Okonkwo")
  })

  test("accepts an optional empty middle name", async () => {
    expect((await doIdentity()).status).toBe(303)
  })
})

describe("step 2, government id", () => {
  test("cannot be reached before identity is complete", async () => {
    const res = await app.inject("/onboarding/government-id", {
      headers: { cookie: jar },
      redirect: "manual",
    })
    expect(res.headers.get("location")).toBe("/onboarding/identity")
  })

  test("verifies a valid identifier and advances", async () => {
    await doIdentity()
    const res = await doGovernmentId()
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/onboarding/address")
  })

  test("stores only the last four digits", async () => {
    await doIdentity()
    await doGovernmentId()
    const kyc = new KycRepository(db)
    const profile = (await kyc.profileFor((await kyc.openFor(userId))!.id))!
    expect(profile.governmentIdLast4).toBe("4567")
    expect(profile.governmentIdType).toBe("PASSPORT")
  })

  test("never writes the full identifier anywhere in the database", async () => {
    await doIdentity()
    await doGovernmentId()
    const tables = await all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    expect(tables.length).toBeGreaterThan(5)
    for (const { name } of tables) {
      const dump = JSON.stringify(await all(db, `SELECT * FROM ${name}`))
      expect(`${name}: ${dump.includes(DOC)}`).toBe(`${name}: false`)
    }
  })

  test("a failed verification keeps the user on the step with the reason", async () => {
    await doIdentity()
    const res = await doGovernmentId("A01230000")
    expect(res.status).toBe(400)
    expect((await res.text()).toLowerCase()).toContain("do not match")
    expect((await new KycRepository(db).openFor(userId))!.currentStep).toBe("government_id")
  })

  test("a failed verification writes an audit entry", async () => {
    await doIdentity()
    await doGovernmentId("A01230000")
    expect((await new AuditRepository(db).forUser(userId, 30)).map((e) => e.action)).toContain(
      "kyc.government_id_failed",
    )
  })

  test("records the provider name on the application", async () => {
    await doIdentity()
    await doGovernmentId()
    expect((await new KycRepository(db).openFor(userId))!.provider).toBe("sandbox")
  })

  test("rejects a malformed identifier before calling the provider", async () => {
    await doIdentity()
    const res = await post(app, "/onboarding/government-id", { idType: "PASSPORT", idNumber: "123" }, jar)
    expect(res.status).toBe(400)
    expect((await res.text()).toLowerCase()).toContain("valid passport")
  })
})

describe("step 3, address", () => {
  test("cannot be reached before the government id step", async () => {
    await doIdentity()
    const res = await app.inject("/onboarding/address", {
      headers: { cookie: jar },
      redirect: "manual",
    })
    expect(res.headers.get("location")).toBe("/onboarding/government-id")
  })

  test("saves a valid address and advances", async () => {
    await doIdentity()
    await doGovernmentId()
    const res = await doAddress()
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/onboarding/document")
  })

  test("rejects a state not in the reference list", async () => {
    await doIdentity()
    await doGovernmentId()
    const res = await post(app, "/onboarding/address", { ...ADDRESS, country: "ZZ" }, jar)
    expect(res.status).toBe(400)
  })

  test("offers a multi-country list, not one market", async () => {
    await doIdentity()
    await doGovernmentId()
    const html = await (
      await app.inject("/onboarding/address", { headers: { cookie: jar } })
    ).text()
    expect((html.match(/<option value="[A-Z]{2}"/g) ?? []).length).toBeGreaterThan(20)
    for (const code of ["GB", "NG", "SG", "BR"]) {
      expect(html).toContain(`<option value="${code}"`)
    }
  })
})

describe("step 4, document", () => {
  test("creates a provider session and links to it", async () => {
    await doIdentity()
    await doGovernmentId()
    await doAddress()
    const html = await (
      await app.inject("/onboarding/document", { headers: { cookie: jar } })
    ).text()
    expect(html).toContain("/onboarding/document/sandbox?session=")
    expect((await new KycRepository(db).openFor(userId))!.documentSession).not.toBeNull()
  })

  test("no image or file is ever posted to our host", async () => {
    await doIdentity()
    await doGovernmentId()
    await doAddress()
    const html = await (
      await app.inject("/onboarding/document", { headers: { cookie: jar } })
    ).text()
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain("multipart/form-data")
  })

  test("a pending result keeps the user on the step", async () => {
    await doIdentity()
    await doGovernmentId()
    await doAddress()
    await app.inject("/onboarding/document", { headers: { cookie: jar } })
    const res = await app.inject("/onboarding/document", {
      headers: { cookie: jar },
      redirect: "manual",
    })
    expect(res.status).toBe(200)
    expect((await new KycRepository(db).openFor(userId))!.currentStep).toBe("document")
  })

  test("a passed result advances to disclosures", async () => {
    await doIdentity()
    await doGovernmentId()
    await doAddress()
    await doDocument()
    expect((await new KycRepository(db).openFor(userId))!.currentStep).toBe("disclosures")
  })

  test("a failed result explains why and offers a retry", async () => {
    await doIdentity()
    await doGovernmentId()
    await doAddress()
    await app.inject("/onboarding/document", { headers: { cookie: jar } })
    const session = (await new KycRepository(db).openFor(userId))!.documentSession!
    provider.complete(session, "failed")
    const html = await (
      await app.inject("/onboarding/document", { headers: { cookie: jar } })
    ).text()
    expect(html.toLowerCase()).toContain("could not be verified")
    expect((await new KycRepository(db).openFor(userId))!.currentStep).toBe("document")
  })
})

describe("step 5, disclosures", () => {
  async function reachDisclosures(): Promise<void> {
    await doIdentity()
    await doGovernmentId()
    await doAddress()
    await doDocument()
  }

  test("shows four separate checkboxes, none pre-ticked", async () => {
    await reachDisclosures()
    const html = await (
      await app.inject("/onboarding/disclosures", { headers: { cookie: jar } })
    ).text()
    for (const name of ["terms", "privacy", "risk", "aml"]) {
      expect(html).toContain(`name="${name}"`)
    }
    expect(html).not.toContain("checked")
  })

  test("refuses submission when any box is unticked", async () => {
    await reachDisclosures()
    const res = await post(
      app,
      "/onboarding/disclosures",
      { terms: "on", privacy: "on", risk: "on" },
      jar,
    )
    expect(res.status).toBe(400)
    expect((await new KycRepository(db).openFor(userId))!.status).toBe("draft")
  })

  test("records one consent row per document with version and ip", async () => {
    await reachDisclosures()
    await post(
      app,
      "/onboarding/disclosures",
      { terms: "on", privacy: "on", risk: "on", aml: "on" },
      jar,
    )
    const rows = await all<{ document: string; version: string; ip: string | null }>(db, "SELECT document, version, ip FROM kyc_consents")
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.document).sort()).toEqual(["aml", "privacy", "risk", "terms"])
    for (const row of rows) {
      expect(row.version).toBe("2026-08-29")
      expect(row.ip).not.toBeNull()
    }
  })

  test("submitting moves the application to in_review and stamps the time", async () => {
    await reachDisclosures()
    const res = await post(
      app,
      "/onboarding/disclosures",
      { terms: "on", privacy: "on", risk: "on", aml: "on" },
      jar,
    )
    expect(res.status).toBe(303)
    const application = (await new KycRepository(db).openFor(userId))!
    expect(application.status).toBe("in_review")
    expect(application.submittedAt).not.toBeNull()
  })

  test("writes an audit entry on submission", async () => {
    await reachDisclosures()
    await post(
      app,
      "/onboarding/disclosures",
      { terms: "on", privacy: "on", risk: "on", aml: "on" },
      jar,
    )
    expect((await new AuditRepository(db).forUser(userId, 40)).map((e) => e.action)).toContain(
      "kyc.submitted",
    )
  })

  test("a submitted application cannot be edited further", async () => {
    await reachDisclosures()
    await post(
      app,
      "/onboarding/disclosures",
      { terms: "on", privacy: "on", risk: "on", aml: "on" },
      jar,
    )
    const res = await app.inject("/onboarding/identity", {
      headers: { cookie: jar },
      redirect: "manual",
    })
    expect(res.headers.get("location")).toBe("/account/verification")
  })
})

describe("progress rail", () => {
  test("shows step position as a count, never a percentage", async () => {
    const html = await (
      await app.inject("/onboarding/identity", { headers: { cookie: jar } })
    ).text()
    expect(html).toContain("Step 1 of 5")
    expect(html).not.toMatch(/\d+%/)
  })

  test("marks completed steps", async () => {
    await doIdentity()
    const html = await (
      await app.inject("/onboarding/government-id", { headers: { cookie: jar } })
    ).text()
    expect(html).toContain('class="done"')
    expect(html).toContain('class="active"')
  })
})
