import type { Database } from "bun:sqlite"
import { moneyQuery } from "../index"
import { validatePosting } from "../../domain/ledger/validate"
import { LedgerError, type PostingInput } from "../../domain/ledger/types"

export type AccountType =
  | "user_available"
  | "user_hold"
  | "platform_fee"
  | "platform_treasury"
  | "platform_dust"
  | "external_deposit"
  | "external_withdrawal"

const USER_ACCOUNT_TYPES = new Set<AccountType>(["user_available", "user_hold"])

interface AccountRow {
  id: number
  user_id: number | null
  asset: string
  type: AccountType
}

export interface LedgerEntry {
  id: number
  transactionId: number
  kind: string
  asset: string
  amount: bigint
  externalRef: string | null
  createdAt: string
}

export class LedgerRepository {
  constructor(private readonly db: Database) {}

  ensureAccount(userId: number | null, asset: string, type: AccountType): number {
    const existing = this.db
      .query<{ id: number }, [number | null, string, string]>(
        `SELECT id FROM accounts
         WHERE user_id IS ? AND asset = ? AND type = ?`,
      )
      .get(userId, asset, type)
    if (existing) return Number(existing.id)

    const now = new Date().toISOString()
    return this.db.transaction(() => {
      this.db
        .query("INSERT INTO accounts (user_id, asset, type, created_at) VALUES (?, ?, ?, ?)")
        .run(userId, asset, type, now)
      const id = Number(
        this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
      )
      this.db
        .query(
          "INSERT INTO account_balances (account_id, amount, last_entry_id, updated_at) VALUES (?, 0, 0, ?)",
        )
        .run(id, now)
      return id
    })()
  }

  post(input: PostingInput): { transactionId: number; replayed: boolean } {
    validatePosting(input)

    const existing = this.db
      .query<{ id: number }, [string]>(
        "SELECT id FROM ledger_transactions WHERE idempotency_key = ?",
      )
      .get(input.idempotencyKey)
    if (existing) {
      return { transactionId: Number(existing.id), replayed: true }
    }

    const now = new Date().toISOString()

    return this.db.transaction(() => {
      const accounts = new Map<number, AccountRow>()
      for (const entry of input.entries) {
        const row = this.db
          .query<AccountRow, [number]>(
            "SELECT id, user_id, asset, type FROM accounts WHERE id = ?",
          )
          .get(entry.accountId)
        if (!row) {
          throw new LedgerError("account_not_found", `Account ${entry.accountId} does not exist`)
        }
        if (row.asset !== entry.asset) {
          throw new LedgerError(
            "asset_mismatch",
            `Account ${entry.accountId} holds ${row.asset}, entry declares ${entry.asset}`,
          )
        }
        accounts.set(entry.accountId, row)
      }

      this.db
        .query(
          `INSERT INTO ledger_transactions (kind, idempotency_key, external_ref, metadata, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.kind,
          input.idempotencyKey,
          input.externalRef ?? null,
          JSON.stringify(input.metadata ?? {}),
          now,
        )
      const transactionId = Number(
        this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
      )

      for (const entry of input.entries) {
        this.db
          .query(
            `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(transactionId, entry.accountId, entry.asset, entry.amount, now)
        const entryId = Number(
          this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
        )

        this.db
          .query(
            `UPDATE account_balances
             SET amount = amount + ?, last_entry_id = ?, updated_at = ?
             WHERE account_id = ?`,
          )
          .run(entry.amount, entryId, now, entry.accountId)

        const account = accounts.get(entry.accountId)!
        if (USER_ACCOUNT_TYPES.has(account.type)) {
          const balance = moneyQuery<{ amount: bigint }, [number]>(
            this.db,
            "SELECT amount FROM account_balances WHERE account_id = ?",
          ).get(entry.accountId)!
          if (balance.amount < 0n) {
            throw new LedgerError(
              "insufficient_balance",
              `Account ${entry.accountId} would fall to ${balance.amount}, user accounts may not go negative`,
            )
          }
        }
      }

      return { transactionId, replayed: false }
    })()
  }

  balance(userId: number, asset: string): { available: bigint; held: bigint } {
    const rows = moneyQuery<{ type: string; amount: bigint }, [number, string]>(
      this.db,
      `SELECT a.type, COALESCE(b.amount, 0) AS amount
       FROM accounts a
       LEFT JOIN account_balances b ON b.account_id = a.id
       WHERE a.user_id = ? AND a.asset = ?`,
    ).all(userId, asset)

    let available = 0n
    let held = 0n
    for (const row of rows) {
      if (row.type === "user_available") available = row.amount
      if (row.type === "user_hold") held = row.amount
    }
    return { available, held }
  }

  balances(userId: number): Map<string, { available: bigint; held: bigint }> {
    const rows = moneyQuery<{ asset: string; type: string; amount: bigint }, [number]>(
      this.db,
      `SELECT a.asset, a.type, COALESCE(b.amount, 0) AS amount
       FROM accounts a
       LEFT JOIN account_balances b ON b.account_id = a.id
       WHERE a.user_id = ?`,
    ).all(userId)

    const result = new Map<string, { available: bigint; held: bigint }>()
    for (const row of rows) {
      const current = result.get(row.asset) ?? { available: 0n, held: 0n }
      if (row.type === "user_available") current.available = row.amount
      if (row.type === "user_hold") current.held = row.amount
      result.set(row.asset, current)
    }
    return result
  }

  history(
    userId: number,
    opts: { asset?: string; cursor?: number; limit: number },
  ): { entries: LedgerEntry[]; nextCursor: number | null } {
    const conditions = ["a.user_id = ?"]
    const params: (number | string)[] = [userId]

    if (opts.asset) {
      conditions.push("e.asset = ?")
      params.push(opts.asset)
    }
    if (opts.cursor !== undefined) {
      conditions.push("e.id < ?")
      params.push(opts.cursor)
    }
    params.push(opts.limit + 1)

    const rows = moneyQuery<
      {
        id: bigint
        transaction_id: bigint
        kind: string
        asset: string
        amount: bigint
        external_ref: string | null
        created_at: string
      },
      (number | string)[]
    >(
      this.db,
      `SELECT e.id, e.transaction_id, t.kind, e.asset, e.amount, t.external_ref, e.created_at
       FROM ledger_entries e
       JOIN accounts a ON a.id = e.account_id
       JOIN ledger_transactions t ON t.id = e.transaction_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.id DESC
       LIMIT ?`,
    ).all(...params)

    const hasMore = rows.length > opts.limit
    const page = hasMore ? rows.slice(0, opts.limit) : rows

    return {
      entries: page.map((row) => ({
        id: Number(row.id),
        transactionId: Number(row.transaction_id),
        kind: row.kind,
        asset: row.asset,
        amount: row.amount,
        externalRef: row.external_ref,
        createdAt: row.created_at,
      })),
      nextCursor: hasMore ? Number(page[page.length - 1]!.id) : null,
    }
  }

  hold(
    userId: number,
    asset: string,
    amount: bigint,
    reference: string,
    idempotencyKey: string,
  ): { holdId: number } {
    const available = this.ensureAccount(userId, asset, "user_available")
    const held = this.ensureAccount(userId, asset, "user_hold")
    const now = new Date().toISOString()

    return this.db.transaction(() => {
      const { transactionId } = this.post({
        kind: "hold",
        idempotencyKey,
        externalRef: reference,
        entries: [
          { accountId: available, asset, amount: -amount },
          { accountId: held, asset, amount },
        ],
      })

      this.db
        .query(
          `INSERT INTO holds (user_id, asset, amount, status, reference,
             place_transaction_id, created_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(userId, asset, amount, reference, transactionId, now)

      return {
        holdId: Number(
          this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
        ),
      }
    })()
  }

  private closeHold(
    holdId: number,
    idempotencyKey: string,
    status: "released" | "consumed",
    destinationAccountId: number | null,
  ): void {
    const hold = moneyQuery<
      { id: bigint; user_id: bigint; asset: string; amount: bigint; status: string },
      [number]
    >(this.db, "SELECT id, user_id, asset, amount, status FROM holds WHERE id = ?").get(
      holdId,
    )

    if (!hold || hold.status !== "active") {
      throw new LedgerError("hold_not_active", `Hold ${holdId} is not active`)
    }

    const userId = Number(hold.user_id)
    const heldAccount = this.ensureAccount(userId, hold.asset, "user_hold")
    const destination =
      destinationAccountId ?? this.ensureAccount(userId, hold.asset, "user_available")
    const amount = hold.amount
    const now = new Date().toISOString()

    this.db.transaction(() => {
      const { transactionId } = this.post({
        kind: status === "released" ? "hold_release" : "hold_consume",
        idempotencyKey,
        entries: [
          { accountId: heldAccount, asset: hold.asset, amount: -amount },
          { accountId: destination, asset: hold.asset, amount },
        ],
      })

      this.db
        .query(
          "UPDATE holds SET status = ?, close_transaction_id = ?, closed_at = ? WHERE id = ?",
        )
        .run(status, transactionId, now, holdId)
    })()
  }

  release(holdId: number, idempotencyKey: string): void {
    this.closeHold(holdId, idempotencyKey, "released", null)
  }

  consume(holdId: number, destinationAccountId: number, idempotencyKey: string): void {
    this.closeHold(holdId, idempotencyKey, "consumed", destinationAccountId)
  }
}
