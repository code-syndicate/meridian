import type { Client, Tx } from "../index"
import { get, moneyAll, moneyGet, run, withTransaction } from "../index"
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
  constructor(private readonly db: Client) {}

  async ensureAccount(
    userId: number | null,
    asset: string,
    type: AccountType,
    ex: Tx = this.db,
  ): Promise<number> {
    const existing = await get<{ id: number }>(
      ex,
      `SELECT id FROM accounts
       WHERE user_id IS ? AND asset = ? AND type = ?`,
      [userId, asset, type],
    )
    if (existing) return Number(existing.id)

    const now = new Date().toISOString()
    return withTransaction(ex, async (tx) => {
      const inserted = await run(
        tx,
        "INSERT INTO accounts (user_id, asset, type, created_at) VALUES (?, ?, ?, ?)",
        [userId, asset, type, now],
      )
      const id = Number(inserted.lastInsertRowid)
      await run(
        tx,
        "INSERT INTO account_balances (account_id, amount, last_entry_id, updated_at) VALUES (?, 0, 0, ?)",
        [id, now],
      )
      return id
    })
  }

  async post(
    input: PostingInput,
    ex: Tx = this.db,
  ): Promise<{ transactionId: number; replayed: boolean }> {
    validatePosting(input)

    const existing = await get<{ id: number }>(
      ex,
      "SELECT id FROM ledger_transactions WHERE idempotency_key = ?",
      [input.idempotencyKey],
    )
    if (existing) {
      return { transactionId: Number(existing.id), replayed: true }
    }

    const now = new Date().toISOString()

    return withTransaction(ex, async (tx) => {
      const accounts = new Map<number, AccountRow>()
      for (const entry of input.entries) {
        const row = await get<AccountRow>(
          tx,
          "SELECT id, user_id, asset, type FROM accounts WHERE id = ?",
          [entry.accountId],
        )
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

      const insertedTx = await run(
        tx,
        `INSERT INTO ledger_transactions (kind, idempotency_key, external_ref, metadata, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          input.kind,
          input.idempotencyKey,
          input.externalRef ?? null,
          JSON.stringify(input.metadata ?? {}),
          now,
        ],
      )
      const transactionId = Number(insertedTx.lastInsertRowid)

      for (const entry of input.entries) {
        const insertedEntry = await run(
          tx,
          `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          [transactionId, entry.accountId, entry.asset, entry.amount, now],
        )
        const entryId = Number(insertedEntry.lastInsertRowid)

        await run(
          tx,
          `UPDATE account_balances
           SET amount = amount + ?, last_entry_id = ?, updated_at = ?
           WHERE account_id = ?`,
          [entry.amount, entryId, now, entry.accountId],
        )

        const account = accounts.get(entry.accountId)!
        if (USER_ACCOUNT_TYPES.has(account.type)) {
          const balance = (await moneyGet<{ amount: bigint }>(
            tx,
            "SELECT amount FROM account_balances WHERE account_id = ?",
            [entry.accountId],
          ))!
          if (balance.amount < 0n) {
            throw new LedgerError(
              "insufficient_balance",
              `Account ${entry.accountId} would fall to ${balance.amount}, user accounts may not go negative`,
            )
          }
        }
      }

      return { transactionId, replayed: false }
    })
  }

  async balance(
    userId: number,
    asset: string,
    ex: Tx = this.db,
  ): Promise<{ available: bigint; held: bigint }> {
    const rows = await moneyAll<{ type: string; amount: bigint }>(
      ex,
      `SELECT a.type, COALESCE(b.amount, 0) AS amount
       FROM accounts a
       LEFT JOIN account_balances b ON b.account_id = a.id
       WHERE a.user_id = ? AND a.asset = ?`,
      [userId, asset],
    )

    let available = 0n
    let held = 0n
    for (const row of rows) {
      if (row.type === "user_available") available = row.amount
      if (row.type === "user_hold") held = row.amount
    }
    return { available, held }
  }

  async balances(
    userId: number,
    ex: Tx = this.db,
  ): Promise<Map<string, { available: bigint; held: bigint }>> {
    const rows = await moneyAll<{ asset: string; type: string; amount: bigint }>(
      ex,
      `SELECT a.asset, a.type, COALESCE(b.amount, 0) AS amount
       FROM accounts a
       LEFT JOIN account_balances b ON b.account_id = a.id
       WHERE a.user_id = ?`,
      [userId],
    )

    const result = new Map<string, { available: bigint; held: bigint }>()
    for (const row of rows) {
      const current = result.get(row.asset) ?? { available: 0n, held: 0n }
      if (row.type === "user_available") current.available = row.amount
      if (row.type === "user_hold") current.held = row.amount
      result.set(row.asset, current)
    }
    return result
  }

  async history(
    userId: number,
    opts: { asset?: string; cursor?: number; limit: number },
    ex: Tx = this.db,
  ): Promise<{ entries: LedgerEntry[]; nextCursor: number | null }> {
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

    const rows = await moneyAll<{
      id: bigint
      transaction_id: bigint
      kind: string
      asset: string
      amount: bigint
      external_ref: string | null
      created_at: string
    }>(
      ex,
      `SELECT e.id, e.transaction_id, t.kind, e.asset, e.amount, t.external_ref, e.created_at
       FROM ledger_entries e
       JOIN accounts a ON a.id = e.account_id
       JOIN ledger_transactions t ON t.id = e.transaction_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.id DESC
       LIMIT ?`,
      params,
    )

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

  async hold(
    userId: number,
    asset: string,
    amount: bigint,
    reference: string,
    idempotencyKey: string,
    ex: Tx = this.db,
  ): Promise<{ holdId: number }> {
    const available = await this.ensureAccount(userId, asset, "user_available", ex)
    const held = await this.ensureAccount(userId, asset, "user_hold", ex)
    const now = new Date().toISOString()

    return withTransaction(ex, async (tx) => {
      const { transactionId } = await this.post(
        {
          kind: "hold",
          idempotencyKey,
          externalRef: reference,
          entries: [
            { accountId: available, asset, amount: -amount },
            { accountId: held, asset, amount },
          ],
        },
        tx,
      )

      const inserted = await run(
        tx,
        `INSERT INTO holds (user_id, asset, amount, status, reference,
           place_transaction_id, created_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
        [userId, asset, amount, reference, transactionId, now],
      )

      return { holdId: Number(inserted.lastInsertRowid) }
    })
  }

  private async closeHold(
    holdId: number,
    idempotencyKey: string,
    status: "released" | "consumed",
    destinationAccountId: number | null,
    ex: Tx,
  ): Promise<void> {
    const hold = await moneyGet<{
      id: bigint
      user_id: bigint
      asset: string
      amount: bigint
      status: string
    }>(ex, "SELECT id, user_id, asset, amount, status FROM holds WHERE id = ?", [holdId])

    if (!hold || hold.status !== "active") {
      throw new LedgerError("hold_not_active", `Hold ${holdId} is not active`)
    }

    const userId = Number(hold.user_id)
    const heldAccount = await this.ensureAccount(userId, hold.asset, "user_hold", ex)
    const destination =
      destinationAccountId ?? (await this.ensureAccount(userId, hold.asset, "user_available", ex))
    const amount = hold.amount
    const now = new Date().toISOString()

    await withTransaction(ex, async (tx) => {
      const { transactionId } = await this.post(
        {
          kind: status === "released" ? "hold_release" : "hold_consume",
          idempotencyKey,
          entries: [
            { accountId: heldAccount, asset: hold.asset, amount: -amount },
            { accountId: destination, asset: hold.asset, amount },
          ],
        },
        tx,
      )

      await run(
        tx,
        "UPDATE holds SET status = ?, close_transaction_id = ?, closed_at = ? WHERE id = ?",
        [status, transactionId, now, holdId],
      )
    })
  }

  async release(holdId: number, idempotencyKey: string, ex: Tx = this.db): Promise<void> {
    await this.closeHold(holdId, idempotencyKey, "released", null, ex)
  }

  async consume(
    holdId: number,
    destinationAccountId: number,
    idempotencyKey: string,
    ex: Tx = this.db,
  ): Promise<void> {
    await this.closeHold(holdId, idempotencyKey, "consumed", destinationAccountId, ex)
  }
}
