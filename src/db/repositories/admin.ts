import type { Database } from "bun:sqlite"
import { moneyQuery } from "../index"

export interface AdminUserRow {
  id: number
  accountId: string
  email: string
  status: string
  role: string
  emailVerifiedAt: string | null
  totpEnabledAt: string | null
  kycStatus: string | null
  createdAt: string
}

export interface QueuedWithdrawal {
  id: number
  userId: number
  email: string
  accountId: string
  asset: string
  destination: string
  memo: string | null
  amount: bigint
  fee: bigint
  status: string
  requestedAt: string
  reviewNote: string | null
}

export interface AdminDeposit {
  id: number
  userId: number | null
  email: string | null
  asset: string
  address: string
  txHash: string
  amount: bigint
  status: string
  confirmations: number
  detectedAt: string
}

export interface KycQueueRow {
  id: number
  userId: number
  email: string
  accountId: string
  status: string
  targetTier: number
  currentStep: string | null
  submittedAt: string | null
  firstName: string | null
  lastName: string | null
  country: string | null
  region: string | null
  city: string | null
  phone: string | null
  idType: string | null
  idLast4: string | null
  dateOfBirth: string | null
}

export class AdminRepository {
  constructor(private readonly db: Database) {}

  counts(): { users: number; pendingWithdrawals: number; pendingKyc: number; suspended: number } {
    const one = (sql: string): number =>
      Number(this.db.query<{ c: number }, []>(sql).get()!.c)
    return {
      users: one("SELECT COUNT(*) AS c FROM users"),
      pendingWithdrawals: one("SELECT COUNT(*) AS c FROM withdrawals WHERE status = 'requested'"),
      pendingKyc: one(
        "SELECT COUNT(*) AS c FROM kyc_applications WHERE status IN ('submitted','in_review')",
      ),
      suspended: one("SELECT COUNT(*) AS c FROM users WHERE status = 'suspended'"),
    }
  }

  users(search: string, limit: number): AdminUserRow[] {
    const like = `%${search.trim().toLowerCase()}%`
    const rows = this.db
      .query<
        {
          id: number
          account_id: string
          email: string
          status: string
          role: string
          email_verified_at: string | null
          totp_enabled_at: string | null
          kyc_status: string | null
          created_at: string
        },
        [string, string, string, number]
      >(
        `SELECT u.id, u.account_id, u.email, u.status, u.role, u.email_verified_at,
                u.totp_enabled_at, u.created_at,
                (SELECT status FROM kyc_applications k WHERE k.user_id = u.id
                  ORDER BY k.id DESC LIMIT 1) AS kyc_status
           FROM users u
          WHERE (? = '%%' OR LOWER(u.email) LIKE ? OR u.account_id LIKE ?)
          ORDER BY u.id DESC
          LIMIT ?`,
      )
      .all(like, like, like.toUpperCase(), limit) as never as Array<{
        id: number
        account_id: string
        email: string
        status: string
        role: string
        email_verified_at: string | null
        totp_enabled_at: string | null
        kyc_status: string | null
        created_at: string
      }>
    return rows.map((row) => ({
      id: Number(row.id),
      accountId: row.account_id,
      email: row.email,
      status: row.status,
      role: row.role,
      emailVerifiedAt: row.email_verified_at,
      totpEnabledAt: row.totp_enabled_at,
      kycStatus: row.kyc_status,
      createdAt: row.created_at,
    }))
  }

  withdrawalQueue(status: string, limit: number): QueuedWithdrawal[] {
    const rows = moneyQuery<
      {
        id: bigint
        user_id: bigint
        email: string
        account_id: string
        asset: string
        destination: string
        memo: string | null
        amount: bigint
        fee: bigint
        status: string
        requested_at: string
        review_note: string | null
      },
      [string, string, number]
    >(
      this.db,
      `SELECT w.id, w.user_id, u.email, u.account_id, w.asset, w.destination, w.memo,
              w.amount, w.fee, w.status, w.requested_at, w.review_note
         FROM withdrawals w JOIN users u ON u.id = w.user_id
        WHERE (? = 'all' OR w.status = ?)
        ORDER BY w.id DESC LIMIT ?`,
    ).all(status, status, limit)
    return rows.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      email: row.email,
      accountId: row.account_id,
      asset: row.asset,
      destination: row.destination,
      memo: row.memo,
      amount: row.amount,
      fee: row.fee,
      status: row.status,
      requestedAt: row.requested_at,
      reviewNote: row.review_note,
    }))
  }

  deposits(limit: number): AdminDeposit[] {
    const rows = moneyQuery<
      {
        id: bigint
        user_id: bigint | null
        email: string | null
        asset: string
        address: string
        tx_hash: string
        credited_amount: bigint | null
        status: string
        confirmations: bigint
        first_seen_at: string
      },
      [number]
    >(
      this.db,
      `SELECT d.id, d.user_id, u.email, d.asset, d.address, d.tx_hash,
              d.credited_amount, d.status, d.confirmations, d.first_seen_at
         FROM deposits d LEFT JOIN users u ON u.id = d.user_id
        ORDER BY d.id DESC LIMIT ?`,
    ).all(limit)
    return rows.map((row) => ({
      id: Number(row.id),
      userId: row.user_id === null ? null : Number(row.user_id),
      email: row.email,
      asset: row.asset,
      address: row.address,
      txHash: row.tx_hash,
      amount: row.credited_amount ?? 0n,
      status: row.status,
      confirmations: Number(row.confirmations),
      detectedAt: row.first_seen_at,
    }))
  }

  kycQueue(status: string, limit: number): KycQueueRow[] {
    const rows = this.db
      .query<
        {
          id: number
          user_id: number
          email: string
          account_id: string
          status: string
          target_tier: number
          current_step: string | null
          submitted_at: string | null
          first_name: string | null
          last_name: string | null
          country: string | null
          region: string | null
          city: string | null
          phone: string | null
          government_id_type: string | null
          government_id_last4: string | null
          date_of_birth: string | null
        },
        [string, string, string, number]
      >(
        `SELECT k.id, k.user_id, u.email, u.account_id, k.status, k.target_tier,
                k.current_step, k.submitted_at,
                p.first_name, p.last_name, p.country, p.region, p.city, p.phone,
                p.government_id_type, p.government_id_last4, p.date_of_birth
           FROM kyc_applications k
           JOIN users u ON u.id = k.user_id
           LEFT JOIN kyc_profiles p ON p.application_id = k.id
          WHERE (? = 'all'
                 OR (? = 'pending' AND k.status IN ('submitted','in_review'))
                 OR k.status = ?)
          ORDER BY k.id DESC LIMIT ?`,
      )
      .all(status, status, status, limit)
    return rows.map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      email: row.email,
      accountId: row.account_id,
      status: row.status,
      targetTier: Number(row.target_tier),
      currentStep: row.current_step,
      submittedAt: row.submitted_at,
      firstName: row.first_name,
      lastName: row.last_name,
      country: row.country,
      region: row.region,
      city: row.city,
      phone: row.phone,
      idType: row.government_id_type,
      idLast4: row.government_id_last4,
      dateOfBirth: row.date_of_birth,
    }))
  }

  /** Every adjustment ever posted, for the review trail. */
  adjustments(limit: number): Array<{
    id: number
    createdAt: string
    metadata: string
    entries: Array<{ email: string | null; asset: string; amount: bigint; type: string }>
  }> {
    const txs = this.db
      .query<{ id: number; created_at: string; metadata: string }, [number]>(
        `SELECT id, created_at, metadata FROM ledger_transactions
          WHERE kind = 'adjustment' ORDER BY id DESC LIMIT ?`,
      )
      .all(limit)
    return txs.map((tx) => ({
      id: Number(tx.id),
      createdAt: tx.created_at,
      metadata: tx.metadata,
      entries: moneyQuery<
        { email: string | null; asset: string; amount: bigint; type: string },
        [number]
      >(
        this.db,
        `SELECT u.email, e.asset, e.amount, a.type
           FROM ledger_entries e
           JOIN accounts a ON a.id = e.account_id
           LEFT JOIN users u ON u.id = a.user_id
          WHERE e.transaction_id = ?`,
      ).all(Number(tx.id)),
    }))
  }

  /** What clients are owed in an asset: the platform's liability side. */
  liability(asset: string): bigint {
    const row = moneyQuery<{ owed: bigint }, [string]>(
      this.db,
      `SELECT COALESCE(SUM(e.amount), 0) AS owed
         FROM ledger_entries e JOIN accounts a ON a.id = e.account_id
        WHERE a.asset = ? AND a.type IN ('user_available', 'user_hold')`,
    ).get(asset)
    return row ? row.owed : 0n
  }
}
