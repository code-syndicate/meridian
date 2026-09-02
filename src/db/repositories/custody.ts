import type { Client, Executor, Tx } from "../index"
import { all, get, moneyAll, moneyGet, run, withTransaction } from "../index"

export interface DepositAddress {
  address: string
  memo: string | null
  provider: string
}

export interface DepositRecord {
  id: number
  userId: number
  asset: string
  txHash: string
  outputIndex: number
  nativeAmount: string
  creditedAmount: bigint
  confirmations: number
  status: "detected" | "confirming" | "credited" | "rejected"
  firstSeenAt: string
  creditedAt: string | null
}

export interface WithdrawalRecord {
  id: number
  userId: number
  asset: string
  destination: string
  memo: string | null
  amount: bigint
  fee: bigint
  status: "requested" | "signing" | "broadcast" | "confirmed" | "failed" | "cancelled"
  holdId: number | null
  providerRef: string | null
  txHash: string | null
  failureReason: string | null
  requestedAt: string
  settledAt: string | null
  limitWindow: string | null
  limitUsd: bigint | null
}

export class CustodyRepository {
  constructor(private readonly db: Client) {}

  // ---- addresses ----

  async findAddress(
    userId: number,
    asset: string,
    ex: Executor = this.db,
  ): Promise<DepositAddress | null> {
    const row = await get<{ address: string; memo: string | null; provider: string }>(
      ex,
      "SELECT address, memo, provider FROM deposit_addresses WHERE user_id = ? AND asset = ?",
      [userId, asset],
    )
    return row ? { address: row.address, memo: row.memo, provider: row.provider } : null
  }

  async saveAddress(
    input: {
      userId: number
      asset: string
      address: string
      memo: string | null
      provider: string
      providerRef: string
    },
    ex: Executor = this.db,
  ): Promise<void> {
    await run(
      ex,
      `INSERT INTO deposit_addresses (user_id, asset, address, memo, provider, provider_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, asset) DO NOTHING`,
      [
        input.userId,
        input.asset,
        input.address,
        input.memo,
        input.provider,
        input.providerRef,
        new Date().toISOString(),
      ],
    )
  }

  async ownerOfAddress(
    asset: string,
    address: string,
    ex: Executor = this.db,
  ): Promise<number | null> {
    const row = await get<{ user_id: number }>(
      ex,
      "SELECT user_id FROM deposit_addresses WHERE asset = ? AND address = ?",
      [asset, address],
    )
    return row ? Number(row.user_id) : null
  }

  // ---- deposits ----

  async findDeposit(
    asset: string,
    txHash: string,
    outputIndex: number,
    ex: Executor = this.db,
  ): Promise<DepositRecord | null> {
    const row = await moneyGet<{
      id: bigint
      user_id: bigint
      asset: string
      tx_hash: string
      output_index: bigint
      native_amount: string
      credited_amount: bigint
      confirmations: bigint
      status: DepositRecord["status"]
      first_seen_at: string
      credited_at: string | null
    }>(
      ex,
      `SELECT id, user_id, asset, tx_hash, output_index, native_amount, credited_amount,
              confirmations, status, first_seen_at, credited_at
       FROM deposits WHERE asset = ? AND tx_hash = ? AND output_index = ?`,
      [asset, txHash, outputIndex],
    )
    if (!row) return null
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      asset: row.asset,
      txHash: row.tx_hash,
      outputIndex: Number(row.output_index),
      nativeAmount: row.native_amount,
      creditedAmount: row.credited_amount,
      confirmations: Number(row.confirmations),
      status: row.status,
      firstSeenAt: row.first_seen_at,
      creditedAt: row.credited_at,
    }
  }

  async recordDeposit(
    input: {
      userId: number
      asset: string
      address: string
      txHash: string
      outputIndex: number
      nativeAmount: string
      confirmations: number
      status: DepositRecord["status"]
    },
    ex: Executor = this.db,
  ): Promise<number> {
    const now = new Date().toISOString()
    const result = await run(
      ex,
      `INSERT INTO deposits (user_id, asset, address, tx_hash, output_index, native_amount,
         confirmations, status, first_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.asset,
        input.address,
        input.txHash,
        input.outputIndex,
        input.nativeAmount,
        input.confirmations,
        input.status,
        now,
        now,
      ],
    )
    return Number(result.lastInsertRowid)
  }

  async updateDepositProgress(
    id: number,
    confirmations: number,
    status: DepositRecord["status"],
    ex: Executor = this.db,
  ): Promise<void> {
    await run(
      ex,
      "UPDATE deposits SET confirmations = ?, status = ?, updated_at = ? WHERE id = ?",
      [confirmations, status, new Date().toISOString(), id],
    )
  }

  async markDepositCredited(
    input: {
      id: number
      creditedAmount: bigint
      dustAmount: string
      ledgerTxId: number
      confirmations: number
    },
    ex: Executor = this.db,
  ): Promise<void> {
    const now = new Date().toISOString()
    await run(
      ex,
      `UPDATE deposits SET status = 'credited', credited_amount = ?, dust_amount = ?,
         ledger_tx_id = ?, confirmations = ?, credited_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.creditedAmount,
        input.dustAmount,
        input.ledgerTxId,
        input.confirmations,
        now,
        now,
        input.id,
      ],
    )
  }

  async depositsFor(
    userId: number,
    limit: number,
    ex: Executor = this.db,
  ): Promise<DepositRecord[]> {
    const rows = await moneyAll<{
      id: bigint
      user_id: bigint
      asset: string
      tx_hash: string
      output_index: bigint
      native_amount: string
      credited_amount: bigint
      confirmations: bigint
      status: DepositRecord["status"]
      first_seen_at: string
      credited_at: string | null
    }>(
      ex,
      `SELECT id, user_id, asset, tx_hash, output_index, native_amount, credited_amount,
              confirmations, status, first_seen_at, credited_at
       FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      [userId, limit],
    )
    return rows.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      asset: row.asset,
      txHash: row.tx_hash,
      outputIndex: Number(row.output_index),
      nativeAmount: row.native_amount,
      creditedAmount: row.credited_amount,
      confirmations: Number(row.confirmations),
      status: row.status,
      firstSeenAt: row.first_seen_at,
      creditedAt: row.credited_at,
    }))
  }

  // ---- dust ----

  async addDust(userId: number, asset: string, amount: bigint, ex: Tx = this.db): Promise<bigint> {
    const now = new Date().toISOString()
    return withTransaction(ex, async (tx) => {
      const row = await get<{ native_dust: string }>(
        tx,
        "SELECT native_dust FROM dust_remainders WHERE user_id = ? AND asset = ?",
        [userId, asset],
      )
      const total = BigInt(row?.native_dust ?? "0") + amount
      await run(
        tx,
        `INSERT INTO dust_remainders (user_id, asset, native_dust, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, asset) DO UPDATE SET native_dust = ?, updated_at = ?`,
        [userId, asset, total.toString(), now, total.toString(), now],
      )
      return total
    })
  }

  async setDust(
    userId: number,
    asset: string,
    amount: bigint,
    ex: Executor = this.db,
  ): Promise<void> {
    // Upsert: the first deposit for an asset has no row yet, and an UPDATE
    // would silently discard the remainder.
    const now = new Date().toISOString()
    await run(
      ex,
      `INSERT INTO dust_remainders (user_id, asset, native_dust, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, asset) DO UPDATE SET native_dust = ?, updated_at = ?`,
      [userId, asset, amount.toString(), now, amount.toString(), now],
    )
  }

  async dustFor(userId: number, asset: string, ex: Executor = this.db): Promise<bigint> {
    const row = await get<{ native_dust: string }>(
      ex,
      "SELECT native_dust FROM dust_remainders WHERE user_id = ? AND asset = ?",
      [userId, asset],
    )
    return BigInt(row?.native_dust ?? "0")
  }

  // ---- withdrawals ----

  async createWithdrawal(
    input: {
      userId: number
      asset: string
      destination: string
      memo: string | null
      amount: bigint
      fee: bigint
      holdId: number
      idempotencyKey: string
      limitWindow?: string | null
      limitUsd?: bigint | null
    },
    ex: Executor = this.db,
  ): Promise<number> {
    const now = new Date().toISOString()
    const result = await run(
      ex,
      `INSERT INTO withdrawals (user_id, asset, destination, memo, amount, fee, status,
         hold_id, idempotency_key, requested_at, updated_at, limit_window, limit_usd)
       VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.asset,
        input.destination,
        input.memo,
        input.amount,
        input.fee,
        input.holdId,
        input.idempotencyKey,
        now,
        now,
        input.limitWindow ?? null,
        input.limitUsd ?? null,
      ],
    )
    return Number(result.lastInsertRowid)
  }

  async findWithdrawal(id: number, ex: Executor = this.db): Promise<WithdrawalRecord | null> {
    const row = await moneyGet<{
      id: bigint
      user_id: bigint
      asset: string
      destination: string
      memo: string | null
      amount: bigint
      fee: bigint
      status: WithdrawalRecord["status"]
      hold_id: bigint | null
      provider_ref: string | null
      tx_hash: string | null
      failure_reason: string | null
      requested_at: string
      settled_at: string | null
      limit_window: string | null
      limit_usd: bigint | null
    }>(
      ex,
      `SELECT id, user_id, asset, destination, memo, amount, fee, status, hold_id,
              provider_ref, tx_hash, failure_reason, requested_at, settled_at,
              limit_window, limit_usd
       FROM withdrawals WHERE id = ?`,
      [id],
    )
    if (!row) return null
    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      asset: row.asset,
      destination: row.destination,
      memo: row.memo,
      amount: row.amount,
      fee: row.fee,
      status: row.status,
      holdId: row.hold_id === null ? null : Number(row.hold_id),
      providerRef: row.provider_ref,
      txHash: row.tx_hash,
      failureReason: row.failure_reason,
      requestedAt: row.requested_at,
      settledAt: row.settled_at,
      limitWindow: row.limit_window,
      limitUsd: row.limit_usd,
    }
  }

  async updateWithdrawal(
    id: number,
    patch: {
      status?: WithdrawalRecord["status"]
      provider?: string
      providerRef?: string | null
      txHash?: string | null
      failureReason?: string | null
      settled?: boolean
      reviewedBy?: number
      reviewedAt?: string
      reviewNote?: string | null
    },
    ex: Executor = this.db,
  ): Promise<void> {
    const now = new Date().toISOString()
    const sets: string[] = []
    const params: (string | null)[] = []
    if (patch.status) { sets.push("status = ?"); params.push(patch.status) }
    if (patch.provider !== undefined) { sets.push("provider = ?"); params.push(patch.provider) }
    if (patch.providerRef !== undefined) { sets.push("provider_ref = ?"); params.push(patch.providerRef) }
    if (patch.txHash !== undefined) { sets.push("tx_hash = ?"); params.push(patch.txHash) }
    if (patch.failureReason !== undefined) { sets.push("failure_reason = ?"); params.push(patch.failureReason) }
    if (patch.reviewedBy !== undefined) { sets.push("reviewed_by = ?"); params.push(String(patch.reviewedBy)) }
    if (patch.reviewedAt !== undefined) { sets.push("reviewed_at = ?"); params.push(patch.reviewedAt) }
    if (patch.reviewNote !== undefined) { sets.push("review_note = ?"); params.push(patch.reviewNote) }
    if (patch.settled) { sets.push("settled_at = ?"); params.push(now) }
    if (sets.length === 0) return
    await run(ex, `UPDATE withdrawals SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, [
      ...params,
      now,
      id,
    ])
  }

  async withdrawalsFor(
    userId: number,
    limit: number,
    ex: Executor = this.db,
  ): Promise<WithdrawalRecord[]> {
    const ids = await all<{ id: number }>(
      ex,
      "SELECT id FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ?",
      [userId, limit],
    )
    const found = await Promise.all(ids.map((row) => this.findWithdrawal(Number(row.id), ex)))
    return found.filter((row): row is WithdrawalRecord => row !== null)
  }

  // ---- reserves ----

  async setReserve(asset: string, confirmed: bigint, ex: Executor = this.db): Promise<void> {
    const now = new Date().toISOString()
    await run(
      ex,
      `INSERT INTO reserves (asset, confirmed, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(asset) DO UPDATE SET confirmed = ?, updated_at = ?`,
      [asset, confirmed, now, confirmed, now],
    )
  }
}
