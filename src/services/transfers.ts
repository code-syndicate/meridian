import type { Database } from "bun:sqlite"
import type { Asset } from "../db/repositories/assets"
import type { LedgerRepository } from "../db/repositories/ledger"
import type { UserRepository } from "../db/repositories/users"
import type { AuditRepository } from "../db/repositories/audit"
import type { TransferRepository } from "../db/repositories/transfers"

export class TransferError extends Error {
  constructor(
    readonly code: "self" | "unknown_recipient" | "inactive_recipient" | "amount",
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
  db: Database
  ledger: LedgerRepository
  users: UserRepository
  audit: AuditRepository
  transfers: TransferRepository
}

export class TransferService {
  constructor(private readonly deps: TransferDeps) {}

  /** Resolves a recipient without revealing more than a masked address. */
  resolve(senderId: number, email: string): { id: number; masked: string } {
    const recipient = this.deps.users.findByEmail(email)
    if (!recipient) {
      throw new TransferError("unknown_recipient", "No Meridian account uses that address.")
    }
    if (recipient.id === senderId) {
      throw new TransferError("self", "You cannot send to your own account.")
    }
    if (recipient.status !== "active") {
      throw new TransferError("inactive_recipient", "That account cannot receive transfers.")
    }
    return { id: recipient.id, masked: maskEmail(recipient.email) }
  }

  send(input: {
    senderId: number
    recipientEmail: string
    asset: Asset
    amount: bigint
    note: string | null
    idempotencyKey: string
    ip: string | null
  }): { transferId: number; masked: string } {
    if (input.amount <= 0n) {
      throw new TransferError("amount", "Enter an amount greater than zero.")
    }
    const recipient = this.resolve(input.senderId, input.recipientEmail)

    const from = this.deps.ledger.ensureAccount(input.senderId, input.asset.symbol, "user_available")
    const to = this.deps.ledger.ensureAccount(recipient.id, input.asset.symbol, "user_available")

    return this.deps.db.transaction(() => {
      // One balanced transaction. Both sides settle or neither does.
      const { transactionId, replayed } = this.deps.ledger.post({
        kind: "transfer",
        idempotencyKey: input.idempotencyKey,
        metadata: { internal: true },
        entries: [
          { accountId: from, asset: input.asset.symbol, amount: -input.amount },
          { accountId: to, asset: input.asset.symbol, amount: input.amount },
        ],
      })

      // The ledger already no-ops a replay. Recording a second transfer row
      // would hit the unique key, so return the original instead.
      if (replayed) {
        const existing = this.deps.transfers.findByIdempotencyKey(input.idempotencyKey)
        if (existing !== null) return { transferId: existing, masked: recipient.masked }
      }

      const transferId = this.deps.transfers.record({
        senderId: input.senderId,
        recipientId: recipient.id,
        asset: input.asset.symbol,
        amount: input.amount,
        note: input.note,
        ledgerTxId: transactionId,
        idempotencyKey: input.idempotencyKey,
      })

      for (const [userId, action] of [
        [input.senderId, "transfer.sent"],
        [recipient.id, "transfer.received"],
      ] as const) {
        this.deps.audit.record({
          userId,
          actorType: "user",
          action,
          target: input.asset.symbol,
          ip: input.ip,
          metadata: { transferId },
        })
      }

      return { transferId, masked: recipient.masked }
    })()
  }

  historyFor(userId: number, limit: number): TransferRecord[] {
    return this.deps.transfers.forUser(userId, limit).map((row) => {
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
