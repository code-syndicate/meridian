import express from "express"
import type { Client } from "../db"
import type { AssetRepository } from "../db/repositories/assets"
import type { UserRepository } from "../db/repositories/users"
import type { LedgerRepository } from "../db/repositories/ledger"
import type { CustodyRepository } from "../db/repositories/custody"
import type { KycRepository } from "../db/repositories/kyc"
import type { AuditRepository } from "../db/repositories/audit"
import type { AdminRepository } from "../db/repositories/admin"
import type { CustodyService } from "../services/custody"
import type { RateLimitRepository } from "../db/repositories/rate-limits"
import { HdCustodyProvider } from "../services/custody-hd"
import { rateLimit } from "../middleware/rate-limit"
import { verifyPassword } from "../domain/identity/password"
import type { LimitService } from "../services/limits"
import { requireAuth } from "../middleware/session"
import { requireAdmin } from "../middleware/admin"
import { balanceParts } from "../domain/prices"
import { buildPortfolio } from "../domain/portfolio"
import { parseAmount, formatBalance } from "../domain/money"
import { tierFor } from "../domain/kyc/tiers"
import { formatAccountId } from "../domain/identity/account-id"

export interface AdminDeps {
  db: Client
  assets: AssetRepository
  users: UserRepository
  ledger: LedgerRepository
  custody: CustodyRepository
  kyc: KycRepository
  audit: AuditRepository
  admin: AdminRepository
  service: CustodyService
  limits: LimitService
  rateLimits: RateLimitRepository
  /** Set only when custody runs on a phrase we hold, so keys can be derived. */
  keys: HdCustodyProvider | null
}

const LIST_LIMIT = 100

export function createAdminRoutes(deps: AdminDeps): express.Router {
  const router = express.Router()
  router.use("/admin", requireAuth(), requireAdmin())

  async function page(name: string, title: string) {
    return { view: `admin/${name}`, title: `${title} | Admin` }
  }

  // ---- overview ----

  router.get("/admin", async (req, res) => {
    const counts = await deps.admin.counts()
    const reserves = await Promise.all(
      (await deps.assets.all()).map(async (asset) => {
        const liability = await deps.admin.liability(asset.symbol)
        return {
          symbol: asset.displaySymbol,
          network: asset.networkLabel,
          liability: balanceParts(liability, asset.displayDecimals),
        }
      }),
    )
    res.render("admin/overview", {
      ...await page("overview", "Overview"),
      path: req.path,
      counts,
      reserves,
      queue: await deps.admin.withdrawalQueue("requested", 5),
      kyc: await deps.admin.kycQueue("pending", 5),
    })
  })

  // ---- users ----

  router.get("/admin/users", async (req, res) => {
    const search = String(req.query.q ?? "")
    res.render("admin/users", {
      ...await page("users", "Users"),
      path: req.path,
      search,
      rows: await deps.admin.users(search, LIST_LIMIT),
    })
  })

  router.get("/admin/users/:id", async (req, res, next) => {
    const user = await deps.users.findById(Number(req.params.id))
    if (!user) return next()
    const application = await deps.kyc.latestFor(user.id)
    const tier = application ? tierFor(application.status, application.targetTier) : 0
    const portfolio = buildPortfolio({
      assets: await deps.assets.all(),
      balances: await deps.ledger.balances(user.id),
      quotes: [],
    })
    res.render("admin/user", {
      ...await page("user", user.email),
      path: `/admin/users/${user.id}`,
      subject: {
        ...user,
        accountIdFormatted: formatAccountId(user.accountId),
      },
      tier,
      allowance: await deps.limits.status(user.id, tier),
      holdings: portfolio.rows
        .filter((row) => row.available + row.held > 0n)
        .map((row) => ({
          symbol: row.displaySymbol,
          network: row.networkLabel,
          available: balanceParts(row.available, row.displayDecimals),
          held: balanceParts(row.held, row.displayDecimals),
        })),
      assets: await deps.assets.all(),
      withdrawals: (await deps.admin.withdrawalQueue("all", 20)).filter((w) => w.userId === user.id),
      activity: await deps.audit.forUser(user.id, 25),
    })
  })

  router.post("/admin/users/:id/status", async (req, res, next) => {
    const user = await deps.users.findById(Number(req.params.id))
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
    await deps.users.setStatus(user.id, status)
    await deps.audit.record({
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

  router.post("/admin/users/:id/adjust", async (req, res, next) => {
    const user = await deps.users.findById(Number(req.params.id))
    if (!user) return next()
    const body = req.body as Record<string, string | undefined>
    const direction = String(body.direction ?? "")
    const symbol = String(body.asset ?? "").toUpperCase()
    const reason = String(body.reason ?? "").trim()
    const back = `/admin/users/${user.id}`

    const asset = await deps.assets.find(symbol)
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

    const treasury = await deps.ledger.ensureAccount(null, asset.symbol, "platform_treasury")
    const available = await deps.ledger.ensureAccount(user.id, asset.symbol, "user_available")
    const signed = direction === "credit" ? amount : -amount

    try {
      await deps.ledger.post({
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

    await deps.audit.record({
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

  router.get("/admin/adjustments", async (req, res) => {
    res.render("admin/adjustments", {
      ...await page("adjustments", "Adjustments"),
      path: req.path,
      rows: (await deps.admin.adjustments(LIST_LIMIT)).map((tx) => {
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

  router.get("/admin/withdrawals", async (req, res) => {
    const status = String(req.query.status ?? "requested")
    const decimals = new Map((await deps.assets.all()).map((a) => [a.symbol, a.displayDecimals]))
    res.render("admin/withdrawals", {
      ...await page("withdrawals", "Withdrawals"),
      path: req.path,
      status,
      rows: (await deps.admin.withdrawalQueue(status, LIST_LIMIT)).map((row) => ({
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

  router.post("/admin/withdrawals/:id/reject", async (req, res) => {
    const body = req.body as Record<string, string | undefined>
    const reason = String(body.reason ?? "").trim()
    if (reason.length < 8) {
      res.flash("Give a reason of at least 8 characters. The customer is told why.")
      return res.redirect(303, "/admin/withdrawals")
    }
    const result = await deps.service.rejectWithdrawal(Number(req.params.id), req.user!.id, reason)
    res.flash(result.ok ? "Withdrawal rejected and the balance released." : result.reason!)
    res.redirect(303, "/admin/withdrawals")
  })

  // ---- deposits ----

  router.get("/admin/deposits", async (req, res) => {
    const decimals = new Map((await deps.assets.all()).map((a) => [a.symbol, a.displayDecimals]))
    res.render("admin/deposits", {
      ...await page("deposits", "Deposits"),
      path: req.path,
      rows: (await deps.admin.deposits(LIST_LIMIT)).map((row) => ({
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

  router.get("/admin/kyc", async (req, res) => {
    const status = String(req.query.status ?? "pending")
    res.render("admin/kyc", {
      ...await page("kyc", "Verification"),
      path: req.path,
      status,
      rows: await deps.admin.kycQueue(status, LIST_LIMIT),
    })
  })

  router.post("/admin/kyc/:id/decide", async (req, res) => {
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
    await deps.kyc.decide(id, decision, decision === "rejected" ? reason : undefined)
    await deps.audit.record({
      actorType: "admin",
      action: `kyc.${decision}`,
      target: String(id),
      ip: req.ip ?? null,
      metadata: { adminId: req.user!.id, applicationId: id, reason: reason || null },
    })
    res.flash(`Application ${id} ${decision}.`)
    res.redirect(303, "/admin/kyc")
  })

  // ---- wallets and their keys ----

  /** Chain of an asset, or null for an asset with no chain mapping. */
  function chainOf(asset: string): string | null {
    try {
      return HdCustodyProvider.chainFor(asset)
    } catch {
      return null
    }
  }

  /**
   * One wallet is one address: a user's assets on the same chain share it.
   * The key is offered only when the phrase we hold derives the address shown,
   * so a key never belongs to some other address.
   */
  async function fundedWallets() {
    const assets = new Map((await deps.assets.all()).map((a) => [a.symbol, a]))
    const wallets = new Map<string, {
      userId: number; email: string; accountId: string; chain: string
      address: string | null; keyAvailable: boolean
      holdings: Array<{ symbol: string; network: string; balance: ReturnType<typeof balanceParts> }>
    }>()
    for (const row of await deps.admin.fundedWallets()) {
      const chain = chainOf(row.asset) ?? row.asset
      const id = `${row.userId}:${chain}`
      const derived = deps.keys && chainOf(row.asset) ? deps.keys.addressFor(chain, row.userId) : null
      const address = row.address ?? derived
      const matches = derived !== null && address === derived
      const asset = assets.get(row.asset)
      const wallet = wallets.get(id) ?? {
        userId: row.userId,
        email: row.email,
        accountId: formatAccountId(row.accountId),
        chain,
        address,
        keyAvailable: matches,
        holdings: [],
      }
      // One asset on the chain with a foreign address is enough to withhold the key.
      if (!matches) wallet.keyAvailable = false
      if (row.address && wallet.address !== row.address) wallet.address = row.address
      wallet.holdings.push({
        symbol: asset?.displaySymbol ?? row.asset,
        network: asset?.networkLabel ?? chain,
        balance: balanceParts(row.balance, asset?.displayDecimals ?? 8),
      })
      wallets.set(id, wallet)
    }
    return [...wallets.values()]
  }

  router.get("/admin/wallets", async (req, res) => {
    res.render("admin/wallets", {
      ...await page("wallets", "Wallets"),
      path: req.path,
      keysHeld: deps.keys !== null,
      wallets: await fundedWallets(),
    })
  })

  router.post(
    "/admin/wallets/key",
    rateLimit({
      repo: deps.rateLimits,
      audit: deps.audit,
      bucket: (req) => `admin-key:${req.user!.id}`,
      capacity: 100,
      refillPerSecond: 100 / 3600,
      lockSeconds: 0,
      action: "admin_key",
    }),
    async (req, res) => {
      const body = req.body as Record<string, string | undefined>
      const back = "/admin/wallets"
      const chain = String(body.chain ?? "")
      const subject = await deps.users.findById(Number(body.userId))
      const wallet = subject
        ? (await fundedWallets()).find((w) => w.userId === subject.id && w.chain === chain)
        : undefined
      if (!deps.keys) {
        res.flash("Custody is not running on a phrase this server holds, so there is no key to show.")
        return res.redirect(303, back)
      }
      if (!subject || !wallet) {
        res.flash("That wallet holds nothing, or does not exist.")
        return res.redirect(303, back)
      }
      if (!wallet.keyAvailable) {
        res.flash("That address was not derived from the phrase this server holds, so its key is not here.")
        return res.redirect(303, back)
      }

      // The session alone is not enough to take a key: confirm it is the admin.
      const admin = await deps.users.findByEmail(req.user!.email)
      if (!admin || !(await verifyPassword(String(body.password ?? ""), admin.passwordHash))) {
        await deps.audit.record({
          userId: subject.id,
          actorType: "admin",
          action: "admin.private_key_denied",
          target: chain,
          ip: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
          metadata: { adminId: req.user!.id, chain, reason: "password" },
        })
        res.flash("That password is not right. No key was shown.")
        return res.redirect(303, back)
      }

      const exported = deps.keys.exportKey(chain, subject.id)
      // Recorded without the key: the audit log is read by more people than this page.
      await deps.audit.record({
        userId: subject.id,
        actorType: "admin",
        action: "admin.private_key_revealed",
        target: chain,
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
        metadata: { adminId: req.user!.id, chain, address: exported.address, path: exported.path },
      })
      res.set("Cache-Control", "no-store")
      res.render("admin/wallet-key", {
        ...await page("wallets", "Wallet key"),
        path: back,
        wallet,
        exported,
      })
    },
  )

  return router
}
