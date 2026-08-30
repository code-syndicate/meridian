import type { Database } from "bun:sqlite"
import { generateAccountId, normalizeAccountId } from "../../domain/identity/account-id"
import { normalizeEmail } from "../../domain/identity/tokens"

export interface User {
  id: number
  accountId: string
  email: string
  emailVerifiedAt: string | null
  totpEnabledAt: string | null
  status: "active" | "suspended" | "closed"
  role: "user" | "admin"
  kycTier: number
  createdAt: string
}

interface UserRow {
  id: number
  account_id: string
  email: string
  password_hash: string
  email_verified_at: string | null
  totp_enabled_at: string | null
  status: "active" | "suspended" | "closed"
  role: "user" | "admin"
  kyc_tier: number
  created_at: string
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    accountId: row.account_id,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    totpEnabledAt: row.totp_enabled_at,
    status: row.status,
    role: row.role,
    kycTier: row.kyc_tier,
    createdAt: row.created_at,
  }
}

const COLUMNS = `id, account_id, email, password_hash, email_verified_at, totp_enabled_at,
  status, role, kyc_tier, created_at`

export class UserRepository {
  constructor(private readonly db: Database) {}

  create(email: string, passwordHash: string): number {
    const now = new Date().toISOString()
    // Retried rather than trusted: 32^10 makes a clash vanishingly unlikely,
    // but the unique index is the thing that actually guarantees it.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        this.db
          .query(
            `INSERT INTO users (account_id, email, email_normalized, password_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            generateAccountId((n) => crypto.getRandomValues(new Uint8Array(n))),
            email, normalizeEmail(email), passwordHash, now, now,
          )
        return Number(
          this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
        )
      } catch (error) {
        if (attempt === 4 || !String(error).includes("idx_users_account_id")) throw error
      }
    }
    throw new Error("could not allocate an account id")
  }

  findByAccountId(accountId: string): User | null {
    const row = this.db
      .query<UserRow, [string]>(`SELECT ${COLUMNS} FROM users WHERE account_id = ?`)
      .get(normalizeAccountId(accountId))
    return row ? toUser(row) : null
  }

  findByEmail(email: string): (User & { passwordHash: string }) | null {
    const row = this.db
      .query<UserRow, [string]>(`SELECT ${COLUMNS} FROM users WHERE email_normalized = ?`)
      .get(normalizeEmail(email))
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null
  }

  findById(id: number): User | null {
    const row = this.db
      .query<UserRow, [number]>(`SELECT ${COLUMNS} FROM users WHERE id = ?`)
      .get(id)
    return row ? toUser(row) : null
  }

  private update(id: number, sql: string, value: string): void {
    this.db
      .query(`UPDATE users SET ${sql} = ?, updated_at = ? WHERE id = ?`)
      .run(value, new Date().toISOString(), id)
  }

  markEmailVerified(id: number): void {
    this.update(id, "email_verified_at", new Date().toISOString())
  }

  setPasswordHash(id: number, hash: string): void {
    this.update(id, "password_hash", hash)
  }

  setTotpSecret(id: number, encrypted: string): void {
    this.update(id, "totp_secret_encrypted", encrypted)
  }

  enableTotp(id: number): void {
    this.update(id, "totp_enabled_at", new Date().toISOString())
  }

  disableTotp(id: number): void {
    this.db
      .query(
        `UPDATE users SET totp_enabled_at = NULL, totp_secret_encrypted = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), id)
  }

  getTotpSecret(id: number): string | null {
    const row = this.db
      .query<{ totp_secret_encrypted: string | null }, [number]>(
        "SELECT totp_secret_encrypted FROM users WHERE id = ?",
      )
      .get(id)
    return row?.totp_secret_encrypted ?? null
  }

  setStatus(id: number, status: "active" | "suspended" | "closed"): void {
    this.db
      .query("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, new Date().toISOString(), id)
  }

  setRole(id: number, role: "user" | "admin"): void {
    this.db
      .query("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
      .run(role, new Date().toISOString(), id)
  }
}
