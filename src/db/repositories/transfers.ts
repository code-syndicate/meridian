import type { Database } from "bun:sqlite"
import { moneyQuery } from "../index"

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
  constructor(private readonly db: Database) {}

  record(input: {
    senderId: number
    recipientId: number
    asset: string
    amount: bigint
    note: string | null
    ledgerTxId: number
    idempotencyKey: string
  }): number {
    this.db
      .query(
        `INSERT INTO transfers (sender_id, recipient_id, asset, amount, note,
           ledger_tx_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.senderId,
        input.recipientId,
        input.asset,
        input.amount,
        input.note,
        input.ledgerTxId,
        input.idempotencyKey,
        new Date().toISOString(),
      )
    return Number(
      this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
    )
  }

  findByIdempotencyKey(key: string): number | null {
    const row = this.db
      .query<{ id: number }, [string]>("SELECT id FROM transfers WHERE idempotency_key = ?")
      .get(key)
    return row ? Number(row.id) : null
  }

  forUser(userId: number, limit: number): TransferRow[] {
    return moneyQuery<
      {
        id: bigint
        sender_id: bigint
        recipient_id: bigint
        asset: string
        amount: bigint
        note: string | null
        created_at: string
        sender_email: string
        recipient_email: string
      },
      [number, number, number]
    >(
      this.db,
      `SELECT t.id, t.sender_id, t.recipient_id, t.asset, t.amount, t.note, t.created_at,
              s.email AS sender_email, r.email AS recipient_email
       FROM transfers t
       JOIN users s ON s.id = t.sender_id
       JOIN users r ON r.id = t.recipient_id
       WHERE t.sender_id = ? OR t.recipient_id = ?
       ORDER BY t.id DESC LIMIT ?`,
    )
      .all(userId, userId, limit)
      .map((row) => ({
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
