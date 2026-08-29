import type { Database } from "bun:sqlite"
import { moneyQuery } from "../index"

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
}

export class CustodyRepository {
  constructor(private readonly db: Database) {}

  // ---- addresses ----

  findAddress(userId: number, asset: string): DepositAddress | null {
    const row = this.db
      .query<{ address: string; memo: string | null; provider: string }, [number, string]>(
        "SELECT address, memo, provider FROM deposit_addresses WHERE user_id = ? AND asset = ?",
      )
      .get(userId, asset)
    return row ? { address: row.address, memo: row.memo, provider: row.provider } : null
  }

  saveAddress(input: {
    userId: number
    asset: string
    address: string
    memo: string | null
    provider: string
    providerRef: string
  }): void {
    this.db
      .query(
        `INSERT INTO deposit_addresses (user_id, asset, address, memo, provider, provider_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, asset) DO NOTHING`,
      )
      .run(
        input.userId,
        input.asset,
        input.address,
        input.memo,
        input.provider,
        input.providerRef,
        new Date().toISOString(),
      )
  }

  ownerOfAddress(asset: string, address: string): number | null {
    const row = this.db
      .query<{ user_id: number }, [string, string]>(
        "SELECT user_id FROM deposit_addresses WHERE asset = ? AND address = ?",
      )
      .get(asset, address)
    return row ? Number(row.user_id) : null
  }

  // ---- deposits ----

  findDeposit(asset: string, txHash: string, outputIndex: number): DepositRecord | null {
    const row = moneyQuery<
      {
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
      },
      [string, string, number]
    >(
      this.db,
      `SELECT id, user_id, asset, tx_hash, output_index, native_amount, credited_amount,
              confirmations, status, first_seen_at, credited_at
       FROM deposits WHERE asset = ? AND tx_hash = ? AND output_index = ?`,
    ).get(asset, txHash, outputIndex)
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

  recordDeposit(input: {
    userId: number
    asset: string
    address: string
    txHash: string
    outputIndex: number
    nativeAmount: string
    confirmations: number
    status: DepositRecord["status"]
  }): number {
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO deposits (user_id, asset, address, tx_hash, output_index, native_amount,
           confirmations, status, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      )
    return Number(
      this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
    )
  }

  updateDepositProgress(id: number, confirmations: number, status: DepositRecord["status"]): void {
    this.db
      .query("UPDATE deposits SET confirmations = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(confirmations, status, new Date().toISOString(), id)
  }

  markDepositCredited(input: {
    id: number
    creditedAmount: bigint
    dustAmount: string
    ledgerTxId: number
    confirmations: number
  }): void {
    const now = new Date().toISOString()
    this.db
      .query(
        `UPDATE deposits SET status = 'credited', credited_amount = ?, dust_amount = ?,
           ledger_tx_id = ?, confirmations = ?, credited_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.creditedAmount,
        input.dustAmount,
        input.ledgerTxId,
        input.confirmations,
        now,
        now,
        input.id,
      )
  }

  depositsFor(userId: number, limit: number): DepositRecord[] {
    return moneyQuery<
      {
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
      },
      [number, number]
    >(
      this.db,
      `SELECT id, user_id, asset, tx_hash, output_index, native_amount, credited_amount,
              confirmations, status, first_seen_at, credited_at
       FROM deposits WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    )
      .all(userId, limit)
      .map((row) => ({
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

  addDust(userId: number, asset: string, amount: bigint): bigint {
    const now = new Date().toISOString()
    return this.db.transaction(() => {
      const row = this.db
        .query<{ native_dust: string }, [number, string]>(
          "SELECT native_dust FROM dust_remainders WHERE user_id = ? AND asset = ?",
        )
        .get(userId, asset)
      const total = BigInt(row?.native_dust ?? "0") + amount
      this.db
        .query(
          `INSERT INTO dust_remainders (user_id, asset, native_dust, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, asset) DO UPDATE SET native_dust = ?, updated_at = ?`,
        )
        .run(userId, asset, total.toString(), now, total.toString(), now)
      return total
    })()
  }

  setDust(userId: number, asset: string, amount: bigint): void {
    // Upsert: the first deposit for an asset has no row yet, and an UPDATE
    // would silently discard the remainder.
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO dust_remainders (user_id, asset, native_dust, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, asset) DO UPDATE SET native_dust = ?, updated_at = ?`,
      )
      .run(userId, asset, amount.toString(), now, amount.toString(), now)
  }

  dustFor(userId: number, asset: string): bigint {
    const row = this.db
      .query<{ native_dust: string }, [number, string]>(
        "SELECT native_dust FROM dust_remainders WHERE user_id = ? AND asset = ?",
      )
      .get(userId, asset)
    return BigInt(row?.native_dust ?? "0")
  }

  // ---- withdrawals ----

  createWithdrawal(input: {
    userId: number
    asset: string
    destination: string
    memo: string | null
    amount: bigint
    fee: bigint
    holdId: number
    idempotencyKey: string
  }): number {
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO withdrawals (user_id, asset, destination, memo, amount, fee, status,
           hold_id, idempotency_key, requested_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?)`,
      )
      .run(
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
      )
    return Number(
      this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
    )
  }

  findWithdrawal(id: number): WithdrawalRecord | null {
    const row = moneyQuery<
      {
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
      },
      [number]
    >(
      this.db,
      `SELECT id, user_id, asset, destination, memo, amount, fee, status, hold_id,
              provider_ref, tx_hash, failure_reason, requested_at, settled_at
       FROM withdrawals WHERE id = ?`,
    ).get(id)
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
    }
  }

  updateWithdrawal(
    id: number,
    patch: {
      status?: WithdrawalRecord["status"]
      provider?: string
      providerRef?: string | null
      txHash?: string | null
      failureReason?: string | null
      settled?: boolean
    },
  ): void {
    const now = new Date().toISOString()
    const sets: string[] = []
    const params: (string | null)[] = []
    if (patch.status) { sets.push("status = ?"); params.push(patch.status) }
    if (patch.provider !== undefined) { sets.push("provider = ?"); params.push(patch.provider) }
    if (patch.providerRef !== undefined) { sets.push("provider_ref = ?"); params.push(patch.providerRef) }
    if (patch.txHash !== undefined) { sets.push("tx_hash = ?"); params.push(patch.txHash) }
    if (patch.failureReason !== undefined) { sets.push("failure_reason = ?"); params.push(patch.failureReason) }
    if (patch.settled) { sets.push("settled_at = ?"); params.push(now) }
    if (sets.length === 0) return
    this.db
      .query(`UPDATE withdrawals SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
      .run(...params, now, id)
  }

  withdrawalsFor(userId: number, limit: number): WithdrawalRecord[] {
    const ids = this.db
      .query<{ id: number }, [number, number]>(
        "SELECT id FROM withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(userId, limit)
    return ids.map((row) => this.findWithdrawal(Number(row.id))!).filter(Boolean)
  }

  // ---- reserves ----

  setReserve(asset: string, confirmed: bigint): void {
    this.db
      .query(
        `INSERT INTO reserves (asset, confirmed, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(asset) DO UPDATE SET confirmed = ?, updated_at = ?`,
      )
      .run(asset, confirmed, new Date().toISOString(), confirmed, new Date().toISOString())
  }
}
