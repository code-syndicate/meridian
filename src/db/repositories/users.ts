import type { Database } from "bun:sqlite"
import { normalizeEmail } from "../../domain/identity/tokens"

export interface User {
  id: number
  email: string
  emailVerifiedAt: string | null
  totpEnabledAt: string | null
  status: "active" | "suspended" | "closed"
  kycTier: number
  createdAt: string
}

interface UserRow {
  id: number
  email: string
  password_hash: string
  email_verified_at: string | null
  totp_enabled_at: string | null
  status: "active" | "suspended" | "closed"
  kyc_tier: number
  created_at: string
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    emailVerifiedAt: row.email_verified_at,
    totpEnabledAt: row.totp_enabled_at,
    status: row.status,
    kycTier: row.kyc_tier,
    createdAt: row.created_at,
  }
}

const COLUMNS = `id, email, password_hash, email_verified_at, totp_enabled_at,
  status, kyc_tier, created_at`

export class UserRepository {
  constructor(private readonly db: Database) {}

  create(email: string, passwordHash: string): number {
    const now = new Date().toISOString()
    this.db
      .query(
        `INSERT INTO users (email, email_normalized, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(email, normalizeEmail(email), passwordHash, now, now)
    return Number(
      this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
    )
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
}
