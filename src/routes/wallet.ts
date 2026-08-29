import express from "express"
import QRCode from "qrcode"
import type { Config } from "../config"
import type { AssetRepository } from "../db/repositories/assets"
import type { LedgerRepository } from "../db/repositories/ledger"
import type { CustodyRepository } from "../db/repositories/custody"
import type { KycRepository } from "../db/repositories/kyc"
import type { CustodyService } from "../services/custody"
import { balanceParts, usdParts } from "../domain/prices"
import { parseAmount, isRepresentableAtNative } from "../domain/money"
import { tierFor, limitsFor } from "../domain/kyc/tiers"
import { LedgerError } from "../domain/ledger/types"
import { requireAuth } from "../middleware/session"

export interface WalletDeps {
  assets: AssetRepository
  ledger: LedgerRepository
  custody: CustodyRepository
  kyc: KycRepository
  service: CustodyService
  config: Config
}

/** Flat withdrawal fee per asset, in base units. Published on /fees. */
const WITHDRAWAL_FEE: Record<string, bigint> = {
  BTC: 15000n, ETH: 300000n, USDT_ERC20: 250000000n, USDC_ERC20: 250000000n,
  TRX: 100000000n, USDT_TRC20: 100000000n, SOL: 500000n, USDC_SPL: 10000000n,
  BNB: 100000n, USDT_BEP20: 50000000n,
}

export function createWalletRoutes(deps: WalletDeps): express.Router {
  const router = express.Router()
  router.use("/wallet", requireAuth())

  function tierOf(userId: number): number {
    const app = deps.kyc.latestFor(userId)
    return app ? tierFor(app.status, app.targetTier) : 0
  }

  function assetRows(userId: number) {
    const balances = deps.ledger.balances(userId)
    return deps.assets.all().map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      displaySymbol: asset.displaySymbol,
      networkLabel: asset.networkLabel,
      available: balanceParts(balances.get(asset.symbol)?.available ?? 0n, asset.displayDecimals),
      depositEnabled: asset.depositEnabled,
      withdrawalEnabled: asset.withdrawalEnabled,
    }))
  }

  // ---- deposit ----

  router.get("/wallet/deposit", (req, res) => {
    res.render("app/deposit-index", {
      title: "Deposit | Meridian",
      description: "Choose an asset to deposit.",
      path: req.path,
      tier: tierOf(req.user!.id),
      rows: assetRows(req.user!.id),
    })
  })

  router.get("/wallet/deposit/:symbol", async (req, res, next) => {
    const asset = deps.assets.find(String(req.params.symbol).toUpperCase())
    if (!asset) return next()
    const user = req.user!
    const tier = tierOf(user.id)

    if (tier === 0) {
      return res.status(403).render("app/gated", {
        title: "Verify first | Meridian",
        description: "Identity verification is required.",
        path: req.path,
        heading: "Verify your identity first.",
        message: "Deposits need a verified account. It takes a few minutes and you can leave and come back.",
        cta: { href: "/onboarding", label: "Start verification" },
      })
    }

    const { address, memo } = await deps.service.addressFor(user.id, asset)
    // Server-rendered SVG, so no client library and no CSP exception.
    const qr = await QRCode.toString(address, {
      type: "svg", margin: 0, errorCorrectionLevel: "M",
      color: { dark: "#ECEFF2", light: "#0000" },
    })

    res.render("app/deposit", {
      title: `Deposit ${asset.displaySymbol} | Meridian`,
      description: `Deposit ${asset.displaySymbol} on ${asset.networkLabel}.`,
      path: req.path,
      asset, address, memo, qr,
      enabled: asset.depositEnabled,
      deposits: deps.custody.depositsFor(user.id, 10).filter((d) => d.asset === asset.symbol),
    })
  })

  // ---- withdraw ----

  router.get("/wallet/withdraw", (req, res) => {
    res.render("app/withdraw-index", {
      title: "Withdraw | Meridian",
      description: "Choose an asset to withdraw.",
      path: req.path,
      tier: tierOf(req.user!.id),
      rows: assetRows(req.user!.id),
    })
  })

  function renderWithdraw(
    req: express.Request,
    res: express.Response,
    status: number,
    asset: ReturnType<AssetRepository["find"]>,
    error: string | null,
    values: { destination: string; amount: string; memo: string },
  ): void {
    const user = req.user!
    const balance = deps.ledger.balance(user.id, asset!.symbol)
    const tier = tierOf(user.id)
    res.status(status).render("app/withdraw", {
      title: `Withdraw ${asset!.displaySymbol} | Meridian`,
      description: `Withdraw ${asset!.displaySymbol} on ${asset!.networkLabel}.`,
      path: `/wallet/withdraw/${asset!.symbol.toLowerCase()}`,
      asset: asset!,
      error, values,
      enabled: asset!.withdrawalEnabled,
      available: balanceParts(balance.available, asset!.displayDecimals),
      held: balanceParts(balance.held, asset!.displayDecimals),
      fee: balanceParts(WITHDRAWAL_FEE[asset!.symbol] ?? 0n, asset!.displayDecimals),
      dailyLimit: limitsFor(tier).dailyWithdrawalUsd,
      withdrawals: deps.custody.withdrawalsFor(user.id, 10)
        .filter((w) => w.asset === asset!.symbol)
        .map((w) => ({
          ...w,
          amountParts: balanceParts(w.amount, asset!.displayDecimals),
        })),
    })
  }

  router.get("/wallet/withdraw/:symbol", async (req, res, next) => {
    const asset = deps.assets.find(String(req.params.symbol).toUpperCase())
    if (!asset) return next()
    if (tierOf(req.user!.id) === 0) {
      return res.status(403).render("app/gated", {
        title: "Verify first | Meridian",
        description: "Identity verification is required.",
        path: req.path,
        heading: "Verify your identity first.",
        message: "Withdrawals need a verified account with two-factor authentication turned on.",
        cta: { href: "/onboarding", label: "Start verification" },
      })
    }
    await deps.service.settleWithdrawals(req.user!.id)
    renderWithdraw(req, res, 200, asset, null, { destination: "", amount: "", memo: "" })
  })

  router.post("/wallet/withdraw/:symbol", async (req, res, next) => {
    const asset = deps.assets.find(String(req.params.symbol).toUpperCase())
    if (!asset) return next()
    const user = req.user!
    const body = req.body as Record<string, string | undefined>
    const values = {
      destination: String(body.destination ?? "").trim(),
      amount: String(body.amount ?? "").trim(),
      memo: String(body.memo ?? "").trim(),
    }

    if (tierOf(user.id) === 0) {
      return renderWithdraw(req, res, 403, asset, "Verify your identity before withdrawing.", values)
    }
    if (!user.totpEnabledAt) {
      return renderWithdraw(
        req, res, 403, asset,
        "Turn on two-factor authentication before withdrawing. It is required for every withdrawal.",
        values,
      )
    }
    if (!asset.withdrawalEnabled) {
      return renderWithdraw(req, res, 403, asset, "Withdrawals are not enabled yet.", values)
    }
    if (values.destination.length < 8) {
      return renderWithdraw(req, res, 400, asset, "Enter the destination address.", values)
    }

    let amount: bigint
    try {
      amount = parseAmount(values.amount)
    } catch {
      return renderWithdraw(req, res, 400, asset, "Enter a valid amount.", values)
    }
    if (amount <= 0n) {
      return renderWithdraw(req, res, 400, asset, "Enter an amount greater than zero.", values)
    }

    const fee = WITHDRAWAL_FEE[asset.symbol] ?? 0n
    // Checked here rather than inferred from an error message downstream.
    if (!isRepresentableAtNative(amount + fee, asset.nativeDecimals)) {
      return renderWithdraw(
        req, res, 400, asset,
        `That amount is finer than ${asset.networkLabel} can send. Use fewer decimal places.`,
        values,
      )
    }

    try {
      await deps.service.requestWithdrawal({
        userId: user.id,
        asset,
        destination: values.destination,
        memo: values.memo || null,
        amount,
        fee,
        idempotencyKey: `wd:${user.id}:${asset.symbol}:${Date.now()}`,
      })
    } catch (error) {
      const message =
        error instanceof LedgerError && error.code === "insufficient_balance"
          ? "That is more than your available balance, once the network fee is included."
          : "We could not submit that withdrawal."
      return renderWithdraw(req, res, 400, asset, message, values)
    }

    res.flash("Withdrawal submitted. It will settle once the network confirms it.")
    res.redirect(303, `/wallet/withdraw/${asset.symbol.toLowerCase()}`)
  })

  // ---- transactions ----

  router.get("/wallet/transactions", async (req, res) => {
    const user = req.user!
    await deps.service.settleWithdrawals(user.id)
    const bySymbol = new Map(deps.assets.all().map((a) => [a.symbol, a]))

    const entries = deps.ledger.history(user.id, { limit: 100 }).entries.map((entry) => {
      const asset = bySymbol.get(entry.asset)!
      const outgoing = entry.amount < 0n
      const magnitude = outgoing ? -entry.amount : entry.amount
      return {
        kind: entry.kind,
        label:
          entry.kind === "deposit" ? "Deposit"
          : entry.kind === "hold" ? "Withdrawal held"
          : entry.kind === "hold_release" ? "Hold released"
          : entry.kind === "hold_consume" ? "Withdrawal sent"
          : entry.kind,
        asset: asset.displaySymbol,
        network: asset.networkLabel,
        amount: balanceParts(magnitude, asset.displayDecimals),
        outgoing,
        ref: entry.externalRef,
        at: entry.createdAt,
      }
    })

    res.render("app/transactions", {
      title: "Transactions | Meridian",
      description: "Every movement on your account.",
      path: req.path,
      entries,
      empty: entries.length === 0,
    })
  })

  return router
}
