import type { Client } from "../db/index"
import { withTransaction } from "../db/index"
import type { Asset } from "../db/repositories/assets"
import type { LedgerRepository } from "../db/repositories/ledger"
import type { UserRepository } from "../db/repositories/users"
import type { AuditRepository } from "../db/repositories/audit"
import type { TransferRepository } from "../db/repositories/transfers"
import type { LimitService } from "./limits"
import { looksLikeAccountId } from "../domain/identity/account-id"

export class TransferError extends Error {
  constructor(
    readonly code:
      | "self"
      | "unknown_recipient"
      | "inactive_recipient"
      | "amount"
      | "over_limit"
      | "no_price",
    message: string,
  ) {
    super(message)
    this.name = "TransferError"
  }
}

export interface TransferRecord {
  id: number
  direction: "sent" | "received"
  counterparty: string
  asset: string
  amount: bigint
  note: string | null
  createdAt: string
}

/**
 * Shows enough of an address to confirm the right person without printing it.
 * Transfers must confirm the recipient exists, because a transfer into a void
 * is worse than a small enumeration surface; masking plus rate limiting is
 * the usual trade.
 */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@")
  const head = local.slice(0, 1)
  const tail = local.length > 2 ? local.slice(-1) : ""
  const [name = "", ...rest] = domain.split(".")
  return `${head}${"•".repeat(Math.max(1, local.length - 2))}${tail}@${name.slice(0, 1)}${"•".repeat(Math.max(1, name.length - 1))}.${rest.join(".")}`
}

export interface TransferDeps {
  db: Client
  ledger: LedgerRepository
  users: UserRepository
  audit: AuditRepository
  transfers: TransferRepository
  limits: LimitService
}

export class TransferService {
  constructor(private readonly deps: TransferDeps) {}

  /**
   * Takes an account ID or an email address. Which one was used never changes
   * what comes back, so neither can be used to probe for the other.
   */
  async resolve(
    senderId: number,
    recipientRef: string,
  ): Promise<{ id: number; masked: string }> {
    const reference = recipientRef.trim()
    const recipient = looksLikeAccountId(reference)
      ? await this.deps.users.findByAccountId(reference)
      : await this.deps.users.findByEmail(reference)
    if (!recipient) {
      throw new TransferError(
        "unknown_recipient",
        "No Meridian account matches that. Check the account ID or email address.",
      )
    }
    if (recipient.id === senderId) {
      throw new TransferError("self", "You cannot send to your own account.")
    }
    if (recipient.status !== "active") {
      throw new TransferError("inactive_recipient", "That account cannot receive transfers.")
    }
    return { id: recipient.id, masked: maskEmail(recipient.email) }
  }

  async send(input: {
    senderId: number
    recipientRef: string
    tier: number
    asset: Asset
    amount: bigint
    note: string | null
    idempotencyKey: string
    ip: string | null
  }): Promise<{ transferId: number; masked: string }> {
    if (input.amount <= 0n) {
      throw new TransferError("amount", "Enter an amount greater than zero.")
    }
    const recipient = await this.resolve(input.senderId, input.recipientRef)

    // Reserved before the post, and given back below if the post fails.
    const reservation = await this.deps.limits.reserveOutbound({
      userId: input.senderId,
      tier: input.tier,
      symbol: input.asset.symbol,
      amount: input.amount,
    })
    if (!reservation.ok) {
      throw new TransferError(reservation.denial.code, reservation.denial.message)
    }

    const from = await this.deps.ledger.ensureAccount(
      input.senderId,
      input.asset.symbol,
      "user_available",
    )
    const to = await this.deps.ledger.ensureAccount(
      recipient.id,
      input.asset.symbol,
      "user_available",
    )

    try {
      return await withTransaction(this.deps.db, async (tx) => {
        // One balanced transaction. Both sides settle or neither does.
        const { transactionId, replayed } = await this.deps.ledger.post(
          {
            kind: "transfer",
            idempotencyKey: input.idempotencyKey,
            metadata: { internal: true },
            entries: [
              { accountId: from, asset: input.asset.symbol, amount: -input.amount },
              { accountId: to, asset: input.asset.symbol, amount: input.amount },
            ],
          },
          tx,
        )

        // The ledger already no-ops a replay. Recording a second transfer row
        // would hit the unique key, so return the original instead.
        if (replayed) {
          const existing = await this.deps.transfers.findByIdempotencyKey(
            input.idempotencyKey,
            tx,
          )
          if (existing !== null) return { transferId: existing, masked: recipient.masked }
        }

        const transferId = await this.deps.transfers.record(
          {
            senderId: input.senderId,
            recipientId: recipient.id,
            asset: input.asset.symbol,
            amount: input.amount,
            note: input.note,
            ledgerTxId: transactionId,
            idempotencyKey: input.idempotencyKey,
          },
          tx,
        )

        for (const [userId, action] of [
          [input.senderId, "transfer.sent"],
          [recipient.id, "transfer.received"],
        ] as const) {
          await this.deps.audit.record(
            {
              userId,
              actorType: "user",
              action,
              target: input.asset.symbol,
              ip: input.ip,
              metadata: { transferId },
            },
            tx,
          )
        }

        return { transferId, masked: recipient.masked }
      })
    } catch (error) {
      await this.deps.limits.releaseOutbound(
        input.senderId,
        reservation.windowKey,
        reservation.amountUsd,
      )
      throw error
    }
  }

  async historyFor(userId: number, limit: number): Promise<TransferRecord[]> {
    const rows = await this.deps.transfers.forUser(userId, limit)
    return rows.map((row) => {
      const sent = row.senderId === userId
      return {
        id: row.id,
        direction: sent ? ("sent" as const) : ("received" as const),
        counterparty: maskEmail(sent ? row.recipientEmail : row.senderEmail),
        asset: row.asset,
        amount: row.amount,
        note: row.note,
        createdAt: row.createdAt,
      }
    })
  }
}
