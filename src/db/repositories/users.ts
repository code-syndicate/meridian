import type { Client, Executor } from "../index"
import { get, run } from "../index"
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
  constructor(private readonly db: Client) {}

  async create(email: string, passwordHash: string, ex: Executor = this.db): Promise<number> {
    const now = new Date().toISOString()
    // Retried rather than trusted: 32^10 makes a clash vanishingly unlikely,
    // but the unique index is the thing that actually guarantees it.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await run(
          ex,
          `INSERT INTO users (account_id, email, email_normalized, password_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            generateAccountId((n) => crypto.getRandomValues(new Uint8Array(n))),
            email, normalizeEmail(email), passwordHash, now, now,
          ],
        )
        return Number(result.lastInsertRowid)
      } catch (error) {
        if (attempt === 4 || !String(error).includes("idx_users_account_id")) throw error
      }
    }
    throw new Error("could not allocate an account id")
  }

  async findByAccountId(accountId: string, ex: Executor = this.db): Promise<User | null> {
    const row = await get<UserRow>(ex, `SELECT ${COLUMNS} FROM users WHERE account_id = ?`, [
      normalizeAccountId(accountId),
    ])
    return row ? toUser(row) : null
  }

  async findByEmail(
    email: string,
    ex: Executor = this.db,
  ): Promise<(User & { passwordHash: string }) | null> {
    const row = await get<UserRow>(ex, `SELECT ${COLUMNS} FROM users WHERE email_normalized = ?`, [
      normalizeEmail(email),
    ])
    return row ? { ...toUser(row), passwordHash: row.password_hash } : null
  }

  async findById(id: number, ex: Executor = this.db): Promise<User | null> {
    const row = await get<UserRow>(ex, `SELECT ${COLUMNS} FROM users WHERE id = ?`, [id])
    return row ? toUser(row) : null
  }

  private async update(id: number, sql: string, value: string, ex: Executor): Promise<void> {
    await run(ex, `UPDATE users SET ${sql} = ?, updated_at = ? WHERE id = ?`, [
      value,
      new Date().toISOString(),
      id,
    ])
  }

  async markEmailVerified(id: number, ex: Executor = this.db): Promise<void> {
    await this.update(id, "email_verified_at", new Date().toISOString(), ex)
  }

  async setPasswordHash(id: number, hash: string, ex: Executor = this.db): Promise<void> {
    await this.update(id, "password_hash", hash, ex)
  }

  async setTotpSecret(id: number, encrypted: string, ex: Executor = this.db): Promise<void> {
    await this.update(id, "totp_secret_encrypted", encrypted, ex)
  }

  async enableTotp(id: number, ex: Executor = this.db): Promise<void> {
    await this.update(id, "totp_enabled_at", new Date().toISOString(), ex)
  }

  async disableTotp(id: number, ex: Executor = this.db): Promise<void> {
    await run(
      ex,
      `UPDATE users SET totp_enabled_at = NULL, totp_secret_encrypted = NULL, updated_at = ?
       WHERE id = ?`,
      [new Date().toISOString(), id],
    )
  }

  async getTotpSecret(id: number, ex: Executor = this.db): Promise<string | null> {
    const row = await get<{ totp_secret_encrypted: string | null }>(
      ex,
      "SELECT totp_secret_encrypted FROM users WHERE id = ?",
      [id],
    )
    return row?.totp_secret_encrypted ?? null
  }

  async setStatus(
    id: number,
    status: "active" | "suspended" | "closed",
    ex: Executor = this.db,
  ): Promise<void> {
    await run(ex, "UPDATE users SET status = ?, updated_at = ? WHERE id = ?", [
      status,
      new Date().toISOString(),
      id,
    ])
  }

  async setRole(id: number, role: "user" | "admin", ex: Executor = this.db): Promise<void> {
    await run(ex, "UPDATE users SET role = ?, updated_at = ? WHERE id = ?", [
      role,
      new Date().toISOString(),
      id,
    ])
  }
}
