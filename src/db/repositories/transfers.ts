import type { Client, Executor } from "../index"
import { get, moneyAll, run } from "../index"

export interface TransferRow {
  id: number
  senderId: number
  recipientId: number
  asset: string
  amount: bigint
  note: string | null
  createdAt: string
  senderEmail: string
  recipientEmail: string
}

export class TransferRepository {
  constructor(private readonly db: Client) {}

  async record(
    input: {
      senderId: number
      recipientId: number
      asset: string
      amount: bigint
      note: string | null
      ledgerTxId: number
      idempotencyKey: string
    },
    ex: Executor = this.db,
  ): Promise<number> {
    const result = await run(
      ex,
      `INSERT INTO transfers (sender_id, recipient_id, asset, amount, note,
         ledger_tx_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.senderId,
        input.recipientId,
        input.asset,
        input.amount,
        input.note,
        input.ledgerTxId,
        input.idempotencyKey,
        new Date().toISOString(),
      ],
    )
    return Number(result.lastInsertRowid)
  }

  async findByIdempotencyKey(key: string, ex: Executor = this.db): Promise<number | null> {
    const row = await get<{ id: number }>(
      ex,
      "SELECT id FROM transfers WHERE idempotency_key = ?",
      [key],
    )
    return row ? Number(row.id) : null
  }

  async forUser(userId: number, limit: number, ex: Executor = this.db): Promise<TransferRow[]> {
    const rows = await moneyAll<{
      id: bigint
      sender_id: bigint
      recipient_id: bigint
      asset: string
      amount: bigint
      note: string | null
      created_at: string
      sender_email: string
      recipient_email: string
    }>(
      ex,
      `SELECT t.id, t.sender_id, t.recipient_id, t.asset, t.amount, t.note, t.created_at,
              s.email AS sender_email, r.email AS recipient_email
       FROM transfers t
       JOIN users s ON s.id = t.sender_id
       JOIN users r ON r.id = t.recipient_id
       WHERE t.sender_id = ? OR t.recipient_id = ?
       ORDER BY t.id DESC LIMIT ?`,
      [userId, userId, limit],
    )
    return rows.map((row) => ({
      id: Number(row.id),
      senderId: Number(row.sender_id),
      recipientId: Number(row.recipient_id),
      asset: row.asset,
      amount: row.amount,
      note: row.note,
      createdAt: row.created_at,
      senderEmail: row.sender_email,
      recipientEmail: row.recipient_email,
    }))
  }
}
