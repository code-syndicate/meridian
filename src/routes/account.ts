import express from "express"
import { createHmac, timingSafeEqual } from "node:crypto"
import type { Config } from "../config"
import type { UserRepository } from "../db/repositories/users"
import type { SessionRepository, Session } from "../db/repositories/sessions"
import type { AuditRepository } from "../db/repositories/audit"
import type { AssetRepository } from "../db/repositories/assets"
import type { LedgerRepository } from "../db/repositories/ledger"
import type { RecoveryCodeRepository } from "../db/repositories/recovery-codes"
import type { KycRepository } from "../db/repositories/kyc"
import { tierFor, limitsFor } from "../domain/kyc/tiers"
import { canResubmit } from "../domain/kyc/steps"
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
} from "../domain/identity/password"
import {
  generateTotpSecret,
  totpUri,
  verifyTotp,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "../domain/identity/totp"
import { balanceParts, usdParts } from "../domain/prices"
import { buildPortfolio } from "../domain/portfolio"
import { IdentityError } from "../domain/identity/errors"
import { requireAuth, setSessionCookie } from "../middleware/session"

export interface AccountDeps {
  users: UserRepository
  sessions: SessionRepository
  audit: AuditRepository
  assets: AssetRepository
  ledger: LedgerRepository
  feed: { snapshot(): import("../domain/prices").Quote[] }
  recoveryCodes: RecoveryCodeRepository
  kyc: KycRepository
  config: Config
}

const ACTION_LABELS: Record<string, string> = {
  "user.registered": "Account created",
  "user.email_verified": "Email address confirmed",
  "user.login": "Signed in",
  "user.login_failed": "Failed sign in attempt",
  "user.logout": "Signed out",
  "user.password_changed": "Password changed",
  "user.totp_enabled": "Two-factor authentication turned on",
  "user.totp_disabled": "Two-factor authentication turned off",
  "user.totp_failed": "Failed two-factor code",
  "user.sessions_revoked": "Signed out of other devices",
}

const ENROL_COOKIE = "meridian_totp_enrol"

/** Spec 8.6: a disabled action must say why, accurately for this viewer. */
function actionReason(tier: number): string {
  if (tier === 0) return "Verify your identity to enable this."
  return "Not yet available. Deposits and trading open when we complete registration."
}

// The candidate secret lives in a signed short-lived cookie, never in the user
// row, so an abandoned enrolment cannot leave a usable secret behind.
function signEnrolment(secret: string, key: string): string {
  const payload = `${secret}.${Date.now() + 10 * 60_000}`
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`
}

function readEnrolment(value: string | undefined, key: string): string | null {
  if (!value) return null
  const parts = value.split(".")
  if (parts.length !== 3) return null
  const [secret, expiry, mac] = parts as [string, string, string]
  const expected = createHmac("sha256", key).update(`${secret}.${expiry}`).digest("base64url")
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(expiry) < Date.now()) return null
  return secret
}

function describeSession(session: Session, current: boolean) {
  const agent = session.userAgent ?? ""
  let label = "Unknown device"
  if (/firefox/i.test(agent)) label = "Firefox"
  else if (/edg/i.test(agent)) label = "Edge"
  else if (/chrome/i.test(agent)) label = "Chrome"
  else if (/safari/i.test(agent)) label = "Safari"
  return { label, ip: session.ip ?? "unknown", lastSeen: session.lastSeenAt, current }
}

export function createAccountRoutes(deps: AccountDeps): express.Router {
  const router = express.Router()
  const secure = deps.config.env === "production"

  router.use("/account", requireAuth())
  router.use("/dashboard", requireAuth())

  function renderSecurity(
    req: express.Request,
    res: express.Response,
    status: number,
    error: string | null,
  ): void {
    const user = req.user!
    res.status(status).render("account/security", {
      title: "Security | Meridian",
      description: "Manage your password, two-factor authentication, and sessions.",
      path: "/account/security",
      error,
      totpEnabled: user.totpEnabledAt !== null,
      sessions: deps.sessions
        .listActive(user.id)
        .map((s) => describeSession(s, s.id === req.sessionId)),
    })
  }

  router.get("/dashboard", (req, res) => {
    const user = req.user!
    const application = deps.kyc.latestFor(user.id)
    const kycTier = application ? tierFor(application.status, application.targetTier) : 0
    const portfolio = buildPortfolio({
      assets: deps.assets.all(),
      balances: deps.ledger.balances(user.id),
      quotes: deps.feed.snapshot(),
    })

    res.render("app/dashboard", {
      title: "Dashboard | Meridian",
      description: "Your Meridian account.",
      path: req.path,
      tier: kycTier,
      actionReason: actionReason(kycTier),
      total: usdParts(portfolio.totalUsd),
      empty: portfolio.empty,
      pricesUnavailable: portfolio.pricesUnavailable,
      balances: portfolio.rows.map((row) => ({
        name: row.name,
        displaySymbol: row.displaySymbol,
        networkLabel: row.networkLabel,
        available: balanceParts(row.available, row.displayDecimals),
        held: balanceParts(row.held, row.displayDecimals),
        hasHold: row.held > 0n,
        value: row.priceUsd === null ? null : usdParts(row.valueUsd),
      })),
    })
  })

  router.get("/account", (req, res) => {
    const user = req.user!
    const application = deps.kyc.latestFor(user.id)
    const profile = application ? deps.kyc.profileFor(application.id) : null
    res.render("account/profile", {
      title: "Account | Meridian",
      description: "Your account details.",
      path: req.path,
      email: user.email,
      // Names come from the verified application, never from free user input.
      fullName: profile?.firstName
        ? [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
        : null,
      phone: profile?.phone ?? null,
      tier: application ? tierFor(application.status, application.targetTier) : 0,
    })
  })

  router.get("/account/verification", (req, res) => {
    const user = req.user!
    const application = deps.kyc.latestFor(user.id)
    const tier = application ? tierFor(application.status, application.targetTier) : 0
    const profile = application ? deps.kyc.profileFor(application.id) : null
    res.render("account/verification", {
      title: "Verification | Meridian",
      description: "Your identity verification status.",
      path: req.path,
      status: application?.status ?? null,
      currentStep: application?.currentStep ?? null,
      rejectionReason: application?.rejectionReason ?? null,
      tier,
      limits: limitsFor(tier),
      last4: profile?.governmentIdLast4 ?? null,
      canResubmit: application
        ? canResubmit(application.status, deps.kyc.attemptsFor(user.id))
        : false,
    })
  })

  router.get("/account/security", (req, res) => renderSecurity(req, res, 200, null))

  router.post("/account/password", async (req, res) => {
    const user = req.user!
    const body = req.body as { current?: string; next?: string }
    const stored = deps.users.findByEmail(user.email)!

    if (!(await verifyPassword(String(body.current ?? ""), stored.passwordHash))) {
      return renderSecurity(req, res, 400, "That is not your current password.")
    }

    const next = String(body.next ?? "")
    try {
      validatePasswordPolicy(next)
    } catch (error) {
      return renderSecurity(
        req,
        res,
        400,
        error instanceof IdentityError
          ? "Use a new password of at least 12 characters."
          : "That password cannot be used.",
      )
    }

    deps.users.setPasswordHash(user.id, await hashPassword(next))
    deps.sessions.revokeAllFor(user.id)
    deps.audit.record({
      userId: user.id,
      actorType: "user",
      action: "user.password_changed",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })

    // A password change is a privilege change, so the session identifier
    // rotates rather than surviving.
    const fresh = deps.sessions.create(user.id, {
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    setSessionCookie(res, fresh, secure)
    res.redirect(303, "/account/security")
  })

  router.get("/account/2fa", (req, res) => {
    const user = req.user!
    const secret = generateTotpSecret()
    res.cookie(ENROL_COOKIE, signEnrolment(secret, deps.config.sessionSecret), {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60_000,
    })
    res.render("account/totp-setup", {
      title: "Two-factor authentication | Meridian",
      description: "Turn on two-factor authentication.",
      path: req.path,
      error: null,
      secret,
      uri: totpUri(secret, user.email),
    })
  })

  router.post("/account/2fa", async (req, res) => {
    const user = req.user!
    const secret = readEnrolment(req.cookies?.[ENROL_COOKIE], deps.config.sessionSecret)
    const token = String((req.body as { token?: string }).token ?? "")

    if (!secret || !verifyTotp(secret, token)) {
      const replacement = secret ?? generateTotpSecret()
      res.status(400).render("account/totp-setup", {
        title: "Two-factor authentication | Meridian",
        description: "Turn on two-factor authentication.",
        path: "/account/2fa",
        error: "That code is not right. Codes change every 30 seconds.",
        secret: replacement,
        uri: totpUri(replacement, user.email),
      })
      return
    }

    deps.users.setTotpSecret(user.id, encryptSecret(secret, deps.config.totpEncryptionKey))
    deps.users.enableTotp(user.id)
    res.clearCookie(ENROL_COOKIE, { path: "/" })

    const codes = generateRecoveryCodes()
    const now = new Date().toISOString()
    for (const code of codes) {
      deps.recoveryCodes.store(user.id, await hashRecoveryCode(code), now)
    }

    deps.audit.record({
      userId: user.id,
      actorType: "user",
      action: "user.totp_enabled",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })

    // Shown once. We store only hashes, so we cannot show them again.
    res.render("account/recovery-codes", {
      title: "Recovery codes | Meridian",
      description: "Save your recovery codes.",
      path: "/account/2fa",
      codes,
    })
  })

  router.post("/account/2fa/disable", (req, res) => {
    const user = req.user!
    deps.users.disableTotp(user.id)
    deps.recoveryCodes.deleteAllFor(user.id)
    deps.audit.record({
      userId: user.id,
      actorType: "user",
      action: "user.totp_disabled",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    res.redirect(303, "/account/security")
  })

  router.post("/account/sessions/revoke-others", (req, res) => {
    const user = req.user!
    const current = req.sessionId
    for (const session of deps.sessions.listActive(user.id)) {
      if (session.id !== current) deps.sessions.revoke(session.id)
    }
    deps.audit.record({
      userId: user.id,
      actorType: "user",
      action: "user.sessions_revoked",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    res.redirect(303, "/account/security")
  })

  router.get("/account/activity", (req, res) => {
    const user = req.user!
    res.render("account/activity", {
      title: "Activity | Meridian",
      description: "Recent activity on your account.",
      path: req.path,
      entries: deps.audit.forUser(user.id, 100).map((entry) => ({
        label: ACTION_LABELS[entry.action] ?? entry.action,
        ip: entry.ip ?? "unknown",
        at: entry.createdAt,
      })),
    })
  })

  return router
}
