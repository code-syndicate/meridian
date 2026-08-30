import express from "express"
import type { Database } from "bun:sqlite"
import type { AssetRepository } from "../db/repositories/assets"
import type { UserRepository } from "../db/repositories/users"
import type { LedgerRepository } from "../db/repositories/ledger"
import type { CustodyRepository } from "../db/repositories/custody"
import type { KycRepository } from "../db/repositories/kyc"
import type { AuditRepository } from "../db/repositories/audit"
import type { AdminRepository } from "../db/repositories/admin"
import type { CustodyService } from "../services/custody"
import type { LimitService } from "../services/limits"
import { requireAuth } from "../middleware/session"
import { requireAdmin } from "../middleware/admin"
import { balanceParts } from "../domain/prices"
import { buildPortfolio } from "../domain/portfolio"
import { parseAmount, formatBalance } from "../domain/money"
import { tierFor } from "../domain/kyc/tiers"
import { formatAccountId } from "../domain/identity/account-id"

export interface AdminDeps {
  db: Database
  assets: AssetRepository
  users: UserRepository
  ledger: LedgerRepository
  custody: CustodyRepository
  kyc: KycRepository
  audit: AuditRepository
  admin: AdminRepository
  service: CustodyService
  limits: LimitService
}

const LIST_LIMIT = 100

export function createAdminRoutes(deps: AdminDeps): express.Router {
  const router = express.Router()
  router.use("/admin", requireAuth(), requireAdmin())

  function page(name: string, title: string) {
    return { view: `admin/${name}`, title: `${title} | Admin` }
  }

  // ---- overview ----

  router.get("/admin", (req, res) => {
    const counts = deps.admin.counts()
    const reserves = deps.assets.all().map((asset) => {
      const liability = deps.admin.liability(asset.symbol)
      return {
        symbol: asset.displaySymbol,
        network: asset.networkLabel,
        liability: balanceParts(liability, asset.displayDecimals),
      }
    })
    res.render("admin/overview", {
      ...page("overview", "Overview"),
      path: req.path,
      counts,
      reserves,
      queue: deps.admin.withdrawalQueue("requested", 5),
      kyc: deps.admin.kycQueue("pending", 5),
    })
  })

  // ---- users ----

  router.get("/admin/users", (req, res) => {
    const search = String(req.query.q ?? "")
    res.render("admin/users", {
      ...page("users", "Users"),
      path: req.path,
      search,
      rows: deps.admin.users(search, LIST_LIMIT),
    })
  })

  router.get("/admin/users/:id", (req, res, next) => {
    const user = deps.users.findById(Number(req.params.id))
    if (!user) return next()
    const application = deps.kyc.latestFor(user.id)
    const tier = application ? tierFor(application.status, application.targetTier) : 0
    const portfolio = buildPortfolio({
      assets: deps.assets.all(),
      balances: deps.ledger.balances(user.id),
      quotes: [],
    })
    res.render("admin/user", {
      ...page("user", user.email),
      path: `/admin/users/${user.id}`,
      subject: {
        ...user,
        accountIdFormatted: formatAccountId(user.accountId),
      },
      tier,
      allowance: deps.limits.status(user.id, tier),
      holdings: portfolio.rows
        .filter((row) => row.available + row.held > 0n)
        .map((row) => ({
          symbol: row.displaySymbol,
          network: row.networkLabel,
          available: balanceParts(row.available, row.displayDecimals),
          held: balanceParts(row.held, row.displayDecimals),
        })),
      assets: deps.assets.all(),
      withdrawals: deps.admin.withdrawalQueue("all", 20).filter((w) => w.userId === user.id),
      activity: deps.audit.forUser(user.id, 25),
    })
  })

  router.post("/admin/users/:id/status", (req, res, next) => {
    const user = deps.users.findById(Number(req.params.id))
    if (!user) return next()
    const body = req.body as Record<string, string | undefined>
    const status = String(body.status ?? "")
    if (status !== "active" && status !== "suspended" && status !== "closed") {
      res.flash("That is not a valid account status.")
      return res.redirect(303, `/admin/users/${user.id}`)
    }
    if (user.id === req.user!.id && status !== "active") {
      // An admin locking themselves out leaves nobody able to unlock them.
      res.flash("You cannot suspend your own account.")
      return res.redirect(303, `/admin/users/${user.id}`)
    }
    deps.users.setStatus(user.id, status)
    deps.audit.record({
      userId: user.id,
      actorType: "admin",
      action: "admin.status_changed",
      target: status,
      ip: req.ip ?? null,
      metadata: { adminId: req.user!.id, from: user.status, to: status },
    })
    res.flash(`${user.email} is now ${status}.`)
    res.redirect(303, `/admin/users/${user.id}`)
  })

  // ---- manual credits and debits ----

  router.post("/admin/users/:id/adjust", (req, res, next) => {
    const user = deps.users.findById(Number(req.params.id))
    if (!user) return next()
    const body = req.body as Record<string, string | undefined>
    const direction = String(body.direction ?? "")
    const symbol = String(body.asset ?? "").toUpperCase()
    const reason = String(body.reason ?? "").trim()
    const back = `/admin/users/${user.id}`

    const asset = deps.assets.find(symbol)
    if (!asset) {
      res.flash("Unknown asset.")
      return res.redirect(303, back)
    }
    if (direction !== "credit" && direction !== "debit") {
      res.flash("Choose credit or debit.")
      return res.redirect(303, back)
    }
    // An unexplained adjustment is indistinguishable from theft in a review,
    // so the reason is required rather than optional.
    if (reason.length < 8) {
      res.flash("Give a reason of at least 8 characters. It is part of the audit trail.")
      return res.redirect(303, back)
    }

    let amount: bigint
    try {
      amount = parseAmount(String(body.amount ?? ""))
    } catch {
      res.flash("Enter a valid amount.")
      return res.redirect(303, back)
    }
    if (amount <= 0n) {
      res.flash("Enter an amount greater than zero.")
      return res.redirect(303, back)
    }

    const treasury = deps.ledger.ensureAccount(null, asset.symbol, "platform_treasury")
    const available = deps.ledger.ensureAccount(user.id, asset.symbol, "user_available")
    const signed = direction === "credit" ? amount : -amount

    try {
      deps.ledger.post({
        kind: "adjustment",
        idempotencyKey: `adj:${user.id}:${asset.symbol}:${Date.now()}`,
        metadata: { direction, reason, adminId: req.user!.id, subjectId: user.id },
        entries: [
          { accountId: treasury, asset: asset.symbol, amount: -signed },
          { accountId: available, asset: asset.symbol, amount: signed },
        ],
      })
    } catch {
      res.flash("That would take the account below zero.")
      return res.redirect(303, back)
    }

    deps.audit.record({
      userId: user.id,
      actorType: "admin",
      action: `admin.${direction}`,
      target: asset.symbol,
      ip: req.ip ?? null,
      metadata: {
        adminId: req.user!.id,
        amount: formatBalance(amount, asset.displayDecimals),
        reason,
      },
    })
    res.flash(
      `${direction === "credit" ? "Credited" : "Debited"} ` +
      `${formatBalance(amount, asset.displayDecimals)} ${asset.displaySymbol}.`,
    )
    res.redirect(303, back)
  })

  router.get("/admin/adjustments", (req, res) => {
    res.render("admin/adjustments", {
      ...page("adjustments", "Adjustments"),
      path: req.path,
      rows: deps.admin.adjustments(LIST_LIMIT).map((tx) => {
        const meta = JSON.parse(tx.metadata) as Record<string, unknown>
        const userEntry = tx.entries.find((e) => e.type === "user_available")
        return {
          id: tx.id,
          createdAt: tx.createdAt,
          email: userEntry?.email ?? null,
          asset: userEntry?.asset ?? "",
          amount: userEntry ? formatBalance(
            userEntry.amount < 0n ? -userEntry.amount : userEntry.amount, 8,
          ) : "",
          direction: (meta.direction as string) ?? "",
          reason: (meta.reason as string) ?? "",
          adminId: meta.adminId ?? "",
        }
      }),
    })
  })

  // ---- withdrawals ----

  router.get("/admin/withdrawals", (req, res) => {
    const status = String(req.query.status ?? "requested")
    const decimals = new Map(deps.assets.all().map((a) => [a.symbol, a.displayDecimals]))
    res.render("admin/withdrawals", {
      ...page("withdrawals", "Withdrawals"),
      path: req.path,
      status,
      rows: deps.admin.withdrawalQueue(status, LIST_LIMIT).map((row) => ({
        ...row,
        amountText: formatBalance(row.amount, decimals.get(row.asset) ?? 8),
        feeText: formatBalance(row.fee, decimals.get(row.asset) ?? 8),
      })),
    })
  })

  router.post("/admin/withdrawals/:id/approve", async (req, res) => {
    const body = req.body as Record<string, string | undefined>
    const result = await deps.service.approveWithdrawal(
      Number(req.params.id),
      req.user!.id,
      String(body.note ?? "").trim() || null,
    )
    res.flash(result.ok ? "Withdrawal approved and submitted." : result.reason!)
    res.redirect(303, "/admin/withdrawals")
  })

  router.post("/admin/withdrawals/:id/reject", (req, res) => {
    const body = req.body as Record<string, string | undefined>
    const reason = String(body.reason ?? "").trim()
    if (reason.length < 8) {
      res.flash("Give a reason of at least 8 characters. The customer is told why.")
      return res.redirect(303, "/admin/withdrawals")
    }
    const result = deps.service.rejectWithdrawal(Number(req.params.id), req.user!.id, reason)
    res.flash(result.ok ? "Withdrawal rejected and the balance released." : result.reason!)
    res.redirect(303, "/admin/withdrawals")
  })

  // ---- deposits ----

  router.get("/admin/deposits", (req, res) => {
    const decimals = new Map(deps.assets.all().map((a) => [a.symbol, a.displayDecimals]))
    res.render("admin/deposits", {
      ...page("deposits", "Deposits"),
      path: req.path,
      rows: deps.admin.deposits(LIST_LIMIT).map((row) => ({
        ...row,
        amountText: formatBalance(row.amount, decimals.get(row.asset) ?? 8),
      })),
    })
  })

  router.post("/admin/deposits/poll", async (req, res) => {
    const result = await deps.service.pollAndCredit()
    res.flash(`Polled: ${result.credited} credited, ${result.confirming} still confirming.`)
    res.redirect(303, "/admin/deposits")
  })

  // ---- KYC ----

  router.get("/admin/kyc", (req, res) => {
    const status = String(req.query.status ?? "pending")
    res.render("admin/kyc", {
      ...page("kyc", "Verification"),
      path: req.path,
      status,
      rows: deps.admin.kycQueue(status, LIST_LIMIT),
    })
  })

  router.post("/admin/kyc/:id/decide", (req, res) => {
    const body = req.body as Record<string, string | undefined>
    const decision = String(body.decision ?? "")
    const reason = String(body.reason ?? "").trim()
    if (decision !== "approved" && decision !== "rejected") {
      res.flash("Choose approve or reject.")
      return res.redirect(303, "/admin/kyc")
    }
    if (decision === "rejected" && reason.length < 8) {
      res.flash("A rejection needs a reason. The applicant is shown it.")
      return res.redirect(303, "/admin/kyc")
    }
    const id = Number(req.params.id)
    deps.kyc.decide(id, decision, decision === "rejected" ? reason : undefined)
    deps.audit.record({
      actorType: "admin",
      action: `kyc.${decision}`,
      target: String(id),
      ip: req.ip ?? null,
      metadata: { adminId: req.user!.id, applicationId: id, reason: reason || null },
    })
    res.flash(`Application ${id} ${decision}.`)
    res.redirect(303, "/admin/kyc")
  })

  return router
}
