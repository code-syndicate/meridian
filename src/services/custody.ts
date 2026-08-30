import type { AssetRepository, Asset } from "../db/repositories/assets"
import type { LedgerRepository } from "../db/repositories/ledger"
import type { AuditRepository } from "../db/repositories/audit"
import type { CustodyRepository } from "../db/repositories/custody"
import type { LimitService, LimitDenial } from "./limits"
import type { CustodyProvider, ChainDeposit } from "./custody-provider"
import { fromNative, toNative, isRepresentableAtNative } from "../domain/money"
import { LedgerError } from "../domain/ledger/types"

export class LimitError extends Error {
  constructor(readonly denial: LimitDenial) {
    super(denial.message)
    this.name = "LimitError"
  }
}

export interface CustodyDeps {
  assets: AssetRepository
  ledger: LedgerRepository
  custody: CustodyRepository
  audit: AuditRepository
  provider: CustodyProvider
  limits: LimitService
}

export interface CreditResult {
  status: "credited" | "confirming" | "ignored" | "replayed"
  creditedBase?: bigint
  dustNative?: bigint
}

export class CustodyService {
  constructor(private readonly deps: CustodyDeps) {}

  /** Issues a deposit address once per user and asset, then reuses it. */
  async addressFor(userId: number, asset: Asset): Promise<{ address: string; memo: string | null }> {
    const existing = this.deps.custody.findAddress(userId, asset.symbol)
    if (existing) return { address: existing.address, memo: existing.memo }

    const issued = await this.deps.provider.issueAddress({ userId, asset: asset.symbol })
    this.deps.custody.saveAddress({
      userId,
      asset: asset.symbol,
      address: issued.address,
      memo: issued.memo,
      provider: this.deps.provider.name,
      providerRef: issued.providerRef,
    })
    this.deps.audit.record({
      userId,
      actorType: "system",
      action: "custody.address_issued",
      target: asset.symbol,
    })
    const saved = this.deps.custody.findAddress(userId, asset.symbol)!
    return { address: saved.address, memo: saved.memo }
  }

  /**
   * Applies one observed chain deposit. Safe to call repeatedly with the same
   * output: the unique constraint on (asset, txHash, outputIndex) plus the
   * ledger's idempotency key make replay a no-op.
   */
  creditDeposit(observed: ChainDeposit): CreditResult {
    const asset = this.deps.assets.find(observed.asset)
    if (!asset) return { status: "ignored" }

    const userId = this.deps.custody.ownerOfAddress(asset.symbol, observed.address)
    if (userId === null) return { status: "ignored" }

    const existing = this.deps.custody.findDeposit(
      asset.symbol,
      observed.txHash,
      observed.outputIndex,
    )
    if (existing?.status === "credited") return { status: "replayed" }

    const depositId =
      existing?.id ??
      this.deps.custody.recordDeposit({
        userId,
        asset: asset.symbol,
        address: observed.address,
        txHash: observed.txHash,
        outputIndex: observed.outputIndex,
        nativeAmount: observed.nativeAmount,
        confirmations: observed.confirmations,
        status: "detected",
      })

    if (observed.confirmations < asset.confirmationsRequired) {
      this.deps.custody.updateDepositProgress(depositId, observed.confirmations, "confirming")
      return { status: "confirming" }
    }

    // Truncate to internal precision. The remainder is banked against the
    // user, never discarded, and credited once it exceeds one base unit.
    const native = BigInt(observed.nativeAmount)
    const carried = this.deps.custody.dustFor(userId, asset.symbol)
    const { base, dust } = fromNative(native + carried, asset.nativeDecimals)

    if (base <= 0n) {
      this.deps.custody.addDust(userId, asset.symbol, native)
      this.deps.custody.updateDepositProgress(depositId, observed.confirmations, "confirming")
      return { status: "confirming", dustNative: native + carried }
    }

    const external = this.deps.ledger.ensureAccount(null, asset.symbol, "external_deposit")
    const available = this.deps.ledger.ensureAccount(userId, asset.symbol, "user_available")

    const { transactionId } = this.deps.ledger.post({
      kind: "deposit",
      idempotencyKey: `deposit:${asset.symbol}:${observed.txHash}:${observed.outputIndex}`,
      externalRef: observed.txHash,
      metadata: { chain: asset.chain, confirmations: observed.confirmations },
      entries: [
        { accountId: external, asset: asset.symbol, amount: -base },
        { accountId: available, asset: asset.symbol, amount: base },
      ],
    })

    this.deps.custody.setDust(userId, asset.symbol, dust)
    // Deposits are recorded for monitoring but never refused: the funds have
    // already arrived on chain and there is nothing to reject.
    this.deps.limits.recordInbound(userId, asset.symbol, base)
    this.deps.custody.markDepositCredited({
      id: depositId,
      creditedAmount: base,
      dustAmount: dust.toString(),
      ledgerTxId: transactionId,
      confirmations: observed.confirmations,
    })
    this.deps.audit.record({
      userId,
      actorType: "system",
      action: "custody.deposit_credited",
      target: asset.symbol,
      metadata: { txHash: observed.txHash, confirmations: observed.confirmations },
    })

    return { status: "credited", creditedBase: base, dustNative: dust }
  }

  /** One polling pass over the provider. Never throws into a caller. */
  async pollAndCredit(): Promise<{ credited: number; confirming: number }> {
    let credited = 0
    let confirming = 0
    let observed: ChainDeposit[]
    try {
      observed = await this.deps.provider.pollDeposits()
    } catch (error) {
      console.error(JSON.stringify({ msg: "custody_poll_failed", error: String(error) }))
      return { credited, confirming }
    }
    for (const deposit of observed) {
      const result = this.creditDeposit(deposit)
      if (result.status === "credited") credited++
      if (result.status === "confirming") confirming++
    }
    return { credited, confirming }
  }

  /**
   * Places a hold, then submits to the provider. The hold is what stops the
   * same balance being withdrawn twice while the first is in flight.
   */
  async requestWithdrawal(input: {
    userId: number
    tier: number
    asset: Asset
    destination: string
    memo: string | null
    amount: bigint
    fee: bigint
    idempotencyKey: string
  }): Promise<{ withdrawalId: number }> {
    const total = input.amount + input.fee
    if (!isRepresentableAtNative(total, input.asset.nativeDecimals)) {
      throw new LedgerError(
        "insufficient_balance",
        `${input.asset.displaySymbol} cannot represent that many decimal places on ${input.asset.networkLabel}`,
      )
    }

    // Reserved against the tier allowance before any hold is placed, and
    // given back on every path where the money does not leave.
    const reservation = this.deps.limits.reserveOutbound({
      userId: input.userId,
      tier: input.tier,
      symbol: input.asset.symbol,
      amount: total,
    })
    if (!reservation.ok) {
      throw new LimitError(reservation.denial)
    }

    let holdId: number
    try {
      ;({ holdId } = this.deps.ledger.hold(
        input.userId,
      input.asset.symbol,
      total,
        `withdrawal:${input.idempotencyKey}`,
        `wd-hold:${input.idempotencyKey}`,
      ))
    } catch (error) {
      this.deps.limits.releaseOutbound(input.userId, reservation.windowKey, reservation.amountUsd)
      throw error
    }

    const withdrawalId = this.deps.custody.createWithdrawal({
      userId: input.userId,
      asset: input.asset.symbol,
      destination: input.destination,
      memo: input.memo,
      amount: input.amount,
      fee: input.fee,
      holdId,
      idempotencyKey: input.idempotencyKey,
      limitWindow: reservation.windowKey,
      limitUsd: reservation.amountUsd,
    })

    this.deps.audit.record({
      userId: input.userId,
      actorType: "user",
      action: "custody.withdrawal_requested",
      target: input.asset.symbol,
      metadata: { withdrawalId },
    })

    // Nothing is submitted here. The value is held and the request waits for
    // an operator, which is the point of having a queue: an automated path
    // straight to the chain has no place to stop a fraudulent withdrawal.
    return { withdrawalId }
  }

  /** Sends an approved withdrawal to the provider. */
  async approveWithdrawal(
    withdrawalId: number,
    adminId: number,
    note: string | null,
  ): Promise<{ ok: boolean; reason?: string }> {
    const withdrawal = this.deps.custody.findWithdrawal(withdrawalId)
    if (!withdrawal) return { ok: false, reason: "No such withdrawal." }
    if (withdrawal.status !== "requested") {
      return { ok: false, reason: `That withdrawal is already ${withdrawal.status}.` }
    }
    const asset = this.deps.assets.find(withdrawal.asset)
    if (!asset) return { ok: false, reason: "Unknown asset." }

    this.deps.custody.updateWithdrawal(withdrawalId, {
      status: "signing",
      reviewedBy: adminId,
      reviewedAt: new Date().toISOString(),
      reviewNote: note,
    })

    try {
      const submission = await this.deps.provider.submitWithdrawal({
        asset: withdrawal.asset,
        destination: withdrawal.destination,
        memo: withdrawal.memo,
        nativeAmount: toNative(withdrawal.amount, asset.nativeDecimals).toString(),
        idempotencyKey: `approve:${withdrawalId}`,
      })
      this.deps.custody.updateWithdrawal(withdrawalId, {
        status: "broadcast",
        provider: this.deps.provider.name,
        providerRef: submission.providerRef,
        txHash: submission.txHash,
      })
    } catch (error) {
      // Submission failed, so the money never left. Release the hold and the
      // limit headroom rather than stranding either.
      this.failWithdrawal(withdrawalId, String(error))
      this.releaseReservation(withdrawal)
      return { ok: false, reason: "The provider rejected the submission." }
    }

    this.deps.audit.record({
      userId: withdrawal.userId,
      actorType: "admin",
      action: "custody.withdrawal_approved",
      target: withdrawal.asset,
      metadata: { withdrawalId, note, adminId },
    })
    return { ok: true }
  }

  /** Refuses a withdrawal: the hold and the limit headroom both come back. */
  rejectWithdrawal(
    withdrawalId: number,
    adminId: number,
    reason: string,
  ): { ok: boolean; reason?: string } {
    const withdrawal = this.deps.custody.findWithdrawal(withdrawalId)
    if (!withdrawal) return { ok: false, reason: "No such withdrawal." }
    if (withdrawal.status !== "requested") {
      return { ok: false, reason: `That withdrawal is already ${withdrawal.status}.` }
    }

    if (withdrawal.holdId !== null) {
      this.deps.ledger.release(withdrawal.holdId, `wd-reject:${withdrawalId}`)
    }
    this.releaseReservation(withdrawal)
    this.deps.custody.updateWithdrawal(withdrawalId, {
      status: "cancelled",
      failureReason: reason,
      reviewedBy: adminId,
      reviewedAt: new Date().toISOString(),
      reviewNote: reason,
    })
    this.deps.audit.record({
      userId: withdrawal.userId,
      actorType: "admin",
      action: "custody.withdrawal_rejected",
      target: withdrawal.asset,
      metadata: { withdrawalId, reason, adminId },
    })
    return { ok: true }
  }

  private releaseReservation(withdrawal: { userId: number; limitWindow: string | null; limitUsd: bigint | null }): void {
    if (withdrawal.limitWindow === null || withdrawal.limitUsd === null) return
    this.deps.limits.releaseOutbound(withdrawal.userId, withdrawal.limitWindow, withdrawal.limitUsd)
  }

  /** Consumes the hold: the value leaves for the external account. */
  confirmWithdrawal(withdrawalId: number, txHash: string | null): void {
    const record = this.deps.custody.findWithdrawal(withdrawalId)
    if (!record || record.holdId === null) return
    if (record.status === "confirmed" || record.status === "failed") return

    const external = this.deps.ledger.ensureAccount(
      null,
      record.asset,
      "external_withdrawal",
    )
    this.deps.ledger.consume(record.holdId, external, `wd-consume:${record.id}`)
    this.deps.custody.updateWithdrawal(withdrawalId, {
      status: "confirmed",
      txHash,
      settled: true,
    })
    this.deps.audit.record({
      userId: record.userId,
      actorType: "system",
      action: "custody.withdrawal_confirmed",
      target: record.asset,
      metadata: { withdrawalId },
    })
  }

  /** Releases the hold: the balance returns to the user. */
  failWithdrawal(withdrawalId: number, reason: string): void {
    const record = this.deps.custody.findWithdrawal(withdrawalId)
    if (!record || record.holdId === null) return
    if (record.status === "confirmed" || record.status === "failed") return

    this.deps.ledger.release(record.holdId, `wd-release:${record.id}`)
    this.deps.custody.updateWithdrawal(withdrawalId, {
      status: "failed",
      failureReason: reason,
      settled: true,
    })
    this.deps.audit.record({
      userId: record.userId,
      actorType: "system",
      action: "custody.withdrawal_failed",
      target: record.asset,
      metadata: { withdrawalId },
    })
  }

  /** Polls in-flight withdrawals and settles them. */
  async settleWithdrawals(userId: number): Promise<void> {
    for (const record of this.deps.custody.withdrawalsFor(userId, 50)) {
      if (record.status !== "broadcast" || !record.providerRef) continue
      const status = await this.deps.provider.getWithdrawal(record.providerRef)
      if (status.status === "confirmed") this.confirmWithdrawal(record.id, status.txHash)
      if (status.status === "failed") {
        this.failWithdrawal(record.id, status.reason ?? "The transaction failed.")
      }
    }
  }
}
