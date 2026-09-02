import { test, expect, describe, beforeEach } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { Client } from "../src/db"
import { createApp, type App } from "../src/server"
import { loadConfig } from "../src/config"
import { CapturingEmailSender } from "../src/services/email"
import { migrate, openDatabase, run } from "../src/db"
import { UserRepository } from "../src/db/repositories/users"
import { SessionRepository } from "../src/db/repositories/sessions"
import { hashPassword } from "../src/domain/identity/password"
import { post, cookiesFrom } from "./support/http"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const PASSWORD = "correct horse battery staple 7"

const PROTECTED = ["/dashboard", "/account/security", "/account/activity", "/account/2fa"]
const STATE_CHANGING = [
  "/register",
  "/login",
  "/logout",
  "/account/password",
  "/account/2fa",
  "/account/2fa/disable",
  "/account/sessions/revoke-others",
]

let db: Client
let app: App

beforeEach(async () => {
  db = await openDatabase(":memory:")
  await migrate(db)
  app = await createApp(config, {
    db,
    email: new CapturingEmailSender(),
  })
})

async function signedInJar(): Promise<{ jar: string; userId: number }> {
  const users = new UserRepository(db)
  const userId = await users.create("a@test.co", await hashPassword(PASSWORD))
  await users.markEmailVerified(userId)
  const res = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
  return { jar: cookiesFrom(res), userId }
}

describe("every protected route requires authentication", () => {
  for (const route of PROTECTED) {
    test(`${route} redirects an anonymous visitor to sign in`, async () => {
      const res = await app.inject(route, { redirect: "manual" })
      expect(`${route}: ${res.status}`).toBe(`${route}: 303`)
      expect(res.headers.get("location")).toBe("/login")
    })
  }
})

describe("every state-changing route requires a csrf token", () => {
  for (const route of STATE_CHANGING) {
    test(`${route} rejects a POST with no token`, async () => {
      const res = await app.inject(route, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
        redirect: "manual",
      })
      expect(`${route}: ${res.status}`).toBe(`${route}: 403`)
    })
  }

  test("a token from a different jar is rejected", async () => {
    const pageA = await app.inject("/login")
    const pageB = await app.inject("/login")
    const tokenB = (await pageB.text()).match(/name="_csrf" value="([^"]+)"/)![1]!
    const res = await app.inject("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookiesFrom(pageA),
      },
      body: new URLSearchParams({ email: "a@test.co", password: PASSWORD, _csrf: tokenB }).toString(),
      redirect: "manual",
    })
    expect(res.status).toBe(403)
  })
})

describe("secrets never reach the client", () => {
  test("no rendered page contains a password hash", async () => {
    const { jar } = await signedInJar()
    for (const route of ["/", "/login", "/register", "/markets", "/dashboard", "/account/security"]) {
      const html = await (await app.inject(route, { headers: { cookie: jar } })).text()
      expect(`${route}: ${html.includes("$argon2id$")}`).toBe(`${route}: false`)
    }
  })

  test("no rendered page contains a live session identifier", async () => {
    const { jar, userId } = await signedInJar()
    const sessionId = (await new SessionRepository(db).listActive(userId))[0]!.id
    for (const route of ["/dashboard", "/account/security", "/account/activity"]) {
      const html = await (await app.inject(route, { headers: { cookie: jar } })).text()
      expect(`${route}: ${html.includes(sessionId)}`).toBe(`${route}: false`)
    }
  })

  test("the session cookie is http-only", async () => {
    const users = new UserRepository(db)
    const id = await users.create("a@test.co", await hashPassword(PASSWORD))
    await users.markEmailVerified(id)
    const res = await post(app, "/login", { email: "a@test.co", password: PASSWORD })
    const session = res.headers.getSetCookie().find((c) => c.includes("session"))!
    expect(session.toLowerCase()).toContain("httponly")
  })

  test("one user cannot see another user's activity", async () => {
    const { jar } = await signedInJar()
    const other = new UserRepository(db).create("b@test.co", await hashPassword(PASSWORD))
    await run(db, `INSERT INTO audit_log (user_id, actor_type, action, ip, created_at)
       VALUES (?, 'user', 'user.login', '198.51.100.9', '2026-01-01')`, [await other])
    const html = await (
      await app.inject("/account/activity", { headers: { cookie: jar } })
    ).text()
    expect(html).not.toContain("198.51.100.9")
  })
})

describe("source-level guarantees", () => {
  function filesUnder(dir: string, ext: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...filesUnder(full, ext))
      else if (entry.name.endsWith(ext)) out.push(full)
    }
    return out
  }

  test("no template renders a secret-bearing field", async () => {
    for (const path of filesUnder("src/views", ".pug")) {
      const text = readFileSync(path, "utf8")
      for (const banned of ["totpSecretEncrypted", "passwordHash", "session.id"]) {
        expect(`${path}: ${text.includes(banned)}`).toBe(`${path}: false`)
      }
    }
  })

  test("no source file logs a password, token, or secret variable", async () => {
    for (const path of filesUnder("src", ".ts")) {
      const text = readFileSync(path, "utf8")
      const logs = text.match(/console\.(log|error|warn)\([^;]*?\)/gs) ?? []
      for (const line of logs) {
        const offending = /\b(password|passwordHash|secret|totpSecret|recoveryCode)\b/.test(line)
        expect(`${path}: ${offending}`).toBe(`${path}: false`)
      }
    }
  })

  test("no source file logs a name, identifier, or address", async () => {
    for (const path of filesUnder("src", ".ts")) {
      const text = readFileSync(path, "utf8")
      const logs = text.match(/console\.(log|error|warn)\([^;]*?\)/gs) ?? []
      for (const line of logs) {
        const offending =
          /\b(idNumber|governmentId|bvn|nin|firstName|lastName|dateOfBirth|streetAddress|phone)\b/i.test(
            line,
          )
        expect(`${path}: ${offending}`).toBe(`${path}: false`)
      }
    }
  })

  test("no template renders a full government identifier", async () => {
    // An input NAMED idNumber is required: that is where the user types it.
    // What must never happen is a template interpolating the value back out.
    const rendering = [
      /=\s*idNumber\b/,
      /value\s*=\s*idNumber\b/,
      /#\{\s*idNumber\s*\}/,
      /\bprofile\.(bvn|nin|governmentId)\b/,
      /\bgovernmentIdFull\b/,
    ]
    for (const path of filesUnder("src/views", ".pug")) {
      const text = readFileSync(path, "utf8")
      for (const pattern of rendering) {
        expect(`${path} ${pattern}: ${pattern.test(text)}`).toBe(
          `${path} ${pattern}: false`,
        )
      }
    }
  })

  test("kyc consents keep their append-only triggers", async () => {
    const migrations = filesUnder("src/db/migrations", ".sql")
      .map((p) => readFileSync(p, "utf8"))
      .join("\n")
    expect(migrations).toContain("kyc_consents_no_update")
    expect(migrations).toContain("kyc_consents_no_delete")
  })

  test("domain code imports neither express nor bun:sqlite", async () => {
    for (const path of filesUnder("src/domain", ".ts")) {
      const text = readFileSync(path, "utf8")
      expect(`${path}: ${/from "express"/.test(text)}`).toBe(`${path}: false`)
      expect(`${path}: ${/from "bun:sqlite"/.test(text)}`).toBe(`${path}: false`)
    }
  })

  test("no SQL lives outside the repository layer", async () => {
    for (const path of filesUnder("src", ".ts")) {
      if (path.startsWith("src/db/")) continue
      const text = readFileSync(path, "utf8")
      const hasSql = /\b(SELECT .+ FROM|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/.test(text)
      expect(`${path}: ${hasSql}`).toBe(`${path}: false`)
    }
  })

  test("the ledger and audit log keep their append-only triggers", async () => {
    const migrations = filesUnder("src/db/migrations", ".sql")
      .map((p) => readFileSync(p, "utf8"))
      .join("\n")
    for (const table of ["ledger_transactions", "ledger_entries", "audit_log"]) {
      expect(migrations).toContain(`${table}_no_update`)
      expect(migrations).toContain(`${table}_no_delete`)
    }
  })
})
