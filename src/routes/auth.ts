import express from "express"
import { createHmac, timingSafeEqual } from "node:crypto"
import type { Client } from "../db"
import type { Config } from "../config"
import type { UserRepository } from "../db/repositories/users"
import type { SessionRepository } from "../db/repositories/sessions"
import type { AuditRepository } from "../db/repositories/audit"
import type { RateLimitRepository } from "../db/repositories/rate-limits"
import type { EmailTokenRepository } from "../db/repositories/email-tokens"
import type { AssetRepository } from "../db/repositories/assets"
import type { LedgerRepository } from "../db/repositories/ledger"
import type { EmailSender } from "../services/email"
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  needsRehash,
} from "../domain/identity/password"
import { verifyTotp, decryptSecret } from "../domain/identity/totp"
import { randomToken, normalizeEmail } from "../domain/identity/tokens"
import { IdentityError } from "../domain/identity/errors"
import { rateLimit } from "../middleware/rate-limit"
import { setSessionCookie, clearSessionCookie } from "../middleware/session"

export interface AuthDeps {
  users: UserRepository
  sessions: SessionRepository
  audit: AuditRepository
  limits: RateLimitRepository
  emailTokens: EmailTokenRepository
  assets: AssetRepository
  ledger: LedgerRepository
  email: EmailSender
  config: Config
  db: Client
}

const VERIFY_TTL_MS = 24 * 3600 * 1000
const PENDING_COOKIE = "meridian_pending_2fa"

function signPending(userId: number, secret: string): string {
  const payload = `${userId}.${Date.now() + 5 * 60_000}`
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`
}

function readPending(value: string | undefined, secret: string): number | null {
  if (!value) return null
  const parts = value.split(".")
  if (parts.length !== 3) return null
  const [id, expiry, mac] = parts as [string, string, string]
  const expected = createHmac("sha256", secret).update(`${id}.${expiry}`).digest("base64url")
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(expiry) < Date.now()) return null
  return Number(id)
}

async function completeLogin(
  req: express.Request,
  res: express.Response,
  deps: AuthDeps,
  userId: number,
  meta: { twoFactor: boolean },
): Promise<void> {
  const sessionId = await deps.sessions.create(userId, {
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  })
  await deps.audit.record({
    userId,
    actorType: "user",
    action: "user.login",
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    metadata: meta,
  })
  res.clearCookie(PENDING_COOKIE, { path: "/" })
  setSessionCookie(res, sessionId, deps.config.env === "production")
  res.redirect(303, "/dashboard")
}

export function createAuthRoutes(deps: AuthDeps): express.Router {
  const router = express.Router()
  const secure = deps.config.env === "production"

  router.get("/register", async (req, res) => {
    res.render("auth/register", {
      title: "Open an account | Meridian Exchanger",
      description: "Create a Meridian account.",
      path: req.path,
      error: null,
      email: typeof req.query.email === "string" ? req.query.email.slice(0, 254) : "",
    })
  })

  router.post(
    "/register",
    rateLimit({
      repo: deps.limits,
      audit: deps.audit,
      bucket: (req) => `register:${req.ip}`,
      capacity: 10,
      refillPerSecond: 10 / 3600,
      lockSeconds: 0,
      action: "register",
    }),
    async (req, res) => {
      const body = req.body as { email?: string; password?: string }
      const email = String(body.email ?? "").trim()
      const password = String(body.password ?? "")

      const fail = (message: string): void => {
        res.status(400).render("auth/register", {
          title: "Open an account | Meridian Exchanger",
          description: "Create a Meridian account.",
          path: req.path,
          error: message,
          email,
        })
      }

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return fail("Enter a valid email address.")
      }

      try {
        validatePasswordPolicy(password)
      } catch (error) {
        return fail(
          error instanceof IdentityError
            ? error.message
            : "That password cannot be used.",
        )
      }

      // The response below is identical whether or not the address is taken,
      // so registration cannot be used to enumerate accounts.
      const existing = await deps.users.findByEmail(email)
      if (!existing) {
        const userId = await deps.users.create(email, await hashPassword(password))

        // Spec 8.3: provision ledger accounts now rather than lazily on first
        // deposit, so Slice 2's chain callbacks always have a destination and
        // there is no create-on-write race between concurrent confirmations.
        for (const asset of await deps.assets.all()) {
          await deps.ledger.ensureAccount(userId, asset.symbol, "user_available")
          await deps.ledger.ensureAccount(userId, asset.symbol, "user_hold")
        }

        const token = randomToken(32)
        await deps.emailTokens.issue(userId, "verify_email", token, VERIFY_TTL_MS)

        await deps.audit.record({
          userId,
          actorType: "user",
          action: "user.registered",
          ip: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        })

        await deps.email.send({
          to: email,
          subject: "Confirm your Meridian account",
          text: [
            "Confirm your email address to finish setting up your Meridian account.",
            "",
            `${req.protocol}://${req.get("host")}/verify-email?token=${token}`,
            "",
            "This link works once and expires in 24 hours.",
            "If you did not create an account, ignore this message.",
          ].join("\n"),
        })
      }

      res.redirect(303, "/check-email")
    },
  )

  router.get("/check-email", async (req, res) => {
    res.render("auth/check-email", {
      title: "Check your email | Meridian Exchanger",
      description: "Confirm your email address.",
      path: req.path,
    })
  })

  router.get("/verify-email", async (req, res) => {
    const token = String(req.query.token ?? "")
    const claim = await deps.emailTokens.consume(token, "verify_email")

    if (!claim) {
      res.status(400).render("error", {
        title: "Link not valid | Meridian Exchanger",
        description: "This verification link is not valid.",
        path: req.path,
        heading: "That link is not valid.",
        message:
          "It may have expired or already been used. Register again to get a new one.",
      })
      return
    }

    await deps.users.markEmailVerified(claim.userId)
    await deps.audit.record({
      userId: claim.userId,
      actorType: "user",
      action: "user.email_verified",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })

    const sessionId = await deps.sessions.create(claim.userId, {
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    setSessionCookie(res, sessionId, secure)
    res.redirect(303, "/dashboard")
  })

  router.get("/login", async (req, res) => {
    res.render("auth/login", {
      title: "Sign in | Meridian Exchanger",
      description: "Sign in to Meridian.",
      path: req.path,
      error: null,
      email: "",
    })
  })

  router.post(
    "/login",
    rateLimit({
      repo: deps.limits,
      audit: deps.audit,
      bucket: (req) =>
        `login:${normalizeEmail(String((req.body as { email?: string }).email ?? ""))}`,
      capacity: 5,
      refillPerSecond: 5 / 900,
      lockSeconds: 900,
      action: "login",
    }),
    async (req, res) => {
      const body = req.body as { email?: string; password?: string }
      const email = String(body.email ?? "").trim()
      const password = String(body.password ?? "")

      const reject = (): void => {
        res.status(400).render("auth/login", {
          title: "Sign in | Meridian Exchanger",
          description: "Sign in to Meridian.",
          path: "/login",
          error: "Those details do not match an account.",
          email: "",
        })
      }

      const user = await deps.users.findByEmail(email)
      // Hash a throwaway value when the account is unknown so the response
      // time does not reveal whether the address exists.
      const hash = user?.passwordHash ?? (await hashPassword("absent-account-placeholder"))
      const ok = await verifyPassword(password, hash)

      if (!user || !ok) {
        await deps.audit.record({
          userId: user?.id ?? null,
          actorType: "user",
          action: "user.login_failed",
          ip: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        })
        return reject()
      }

      if (needsRehash(user.passwordHash)) {
        await deps.users.setPasswordHash(user.id, await hashPassword(password))
      }

      if (user.totpEnabledAt) {
        res.cookie(PENDING_COOKIE, signPending(user.id, deps.config.sessionSecret), {
          httpOnly: true,
          secure,
          sameSite: "lax",
          path: "/",
          maxAge: 5 * 60_000,
        })
        res.redirect(303, "/login/verify")
        return
      }

      await completeLogin(req, res, deps, user.id, { twoFactor: false })
    },
  )

  router.get("/login/verify", async (req, res) => {
    if (!readPending(req.cookies?.[PENDING_COOKIE], deps.config.sessionSecret)) {
      res.redirect(303, "/login")
      return
    }
    res.render("auth/totp-challenge", {
      title: "Two-factor code | Meridian Exchanger",
      description: "Enter your authentication code.",
      path: req.path,
      error: null,
    })
  })

  router.post("/login/verify", async (req, res) => {
    const userId = readPending(req.cookies?.[PENDING_COOKIE], deps.config.sessionSecret)
    if (!userId) {
      res.redirect(303, "/login")
      return
    }

    const encrypted = await deps.users.getTotpSecret(userId)
    const token = String((req.body as { token?: string }).token ?? "")
    const valid =
      encrypted !== null &&
      verifyTotp(decryptSecret(encrypted, deps.config.totpEncryptionKey), token)

    if (!valid) {
      await deps.audit.record({
        userId,
        actorType: "user",
        action: "user.totp_failed",
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      })
      res.status(400).render("auth/totp-challenge", {
        title: "Two-factor code | Meridian Exchanger",
        description: "Enter your authentication code.",
        path: "/login/verify",
        error: "That code is not right. Codes change every 30 seconds.",
      })
      return
    }

    await completeLogin(req, res, deps, userId, { twoFactor: true })
  })

  router.post("/logout", async (req, res) => {
    if (req.sessionId) {
      await deps.sessions.revoke(req.sessionId)
      await deps.audit.record({
        userId: req.user?.id ?? null,
        actorType: "user",
        action: "user.logout",
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      })
    }
    clearSessionCookie(res, secure)
    res.redirect(303, "/")
  })

  return router
}
