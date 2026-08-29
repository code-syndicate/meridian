# Meridian Slice 1, Plan 3: Identity Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build authentication that a regulator could examine: Argon2id passwords, TOTP two-factor, server-side sessions with revocation, CSRF protection, rate limiting, and an append-only audit log.

**Architecture:** Security rules live in `src/domain/identity/` as pure functions with no Express and no SQL, which is what makes them exhaustively testable. Sessions are opaque random identifiers with the server-side row as the source of truth, never a signed token carrying claims. Every authentication event, security change, and administrative action writes an audit row inside the same transaction as the change it records.

**Tech Stack:** Bun (`Bun.password` for Argon2id), Express 5, Pug, `otpauth`, `node:crypto` for AES-256-GCM, `bun:sqlite`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-29-meridian-design.md` (section 8)

## Global Constraints

Every task's requirements implicitly include this section.

- **Bun only.** Never npm, yarn, or pnpm.
- **CSP carries no `unsafe-inline` and no `unsafe-eval`.** No inline styles, scripts, or `on*=` handlers. Alpine components register via `Alpine.data()`. Existing tests enforce this and will fail if a new template breaks it.
- **No SQL outside `src/db/repositories/`.** `src/domain/` imports neither Express nor `bun:sqlite`.
- **`audit_log` is append-only**, enforced by SQLite triggers, exactly like the ledger.
- **Never log or store a secret.** Passwords, TOTP secrets, session identifiers, recovery codes, BVN, and NIN never appear in a log line, an error message, or a rendered page.
- **Responses must not reveal whether an account exists.** Registration, login, and password reset return the same response and take comparable time either way.
- **Every state-changing request requires a valid CSRF token.** `SameSite=Lax` alone is not treated as sufficient.
- **Session identifiers rotate on every privilege change:** login, 2FA enrolment, password change.
- **Copy voice:** plain and direct. No em dashes, no marketing inflation. Existing content tests enforce this style.
- **Git identity is `timileyindev <timmypelumy@gmail.com>`.**

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/migrations/0004-identity.sql` | sessions, email tokens, audit log, rate limits |
| `src/domain/identity/password.ts` | Policy, hashing, verification. Pure apart from the hash call. |
| `src/domain/identity/totp.ts` | Secret generation, encryption at rest, verification, recovery codes |
| `src/domain/identity/tokens.ts` | Random identifier and token generation |
| `src/domain/identity/errors.ts` | Typed identity errors |
| `src/db/repositories/users.ts` | User reads and writes |
| `src/db/repositories/sessions.ts` | Session lifecycle |
| `src/db/repositories/audit.ts` | Append-only audit writes and reads |
| `src/db/repositories/rate-limits.ts` | Token bucket persistence |
| `src/services/email.ts` | `EmailSender` interface plus a dev implementation |
| `src/services/breach-check.ts` | `BreachCheck` interface plus the HIBP implementation |
| `src/middleware/session.ts` | Loads the session, exposes `req.user` |
| `src/middleware/csrf.ts` | Double-submit token issue and verify |
| `src/middleware/rate-limit.ts` | Per-IP and per-account throttling |
| `src/routes/auth.ts` | register, verify, login, logout, password reset |
| `src/routes/account.ts` | security settings, 2FA, session list |
| `src/views/auth/*.pug`, `src/views/account/*.pug` | Templates |

---

## Task 1: Identity schema and the audit log

**Files:**
- Create: `src/db/migrations/0004-identity.sql`
- Create: `src/db/repositories/audit.ts`
- Test: `tests/db/identity-schema.test.ts`, `tests/db/repositories/audit.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `migrate` from plan 1
- Produces:
  - Tables `sessions`, `email_tokens`, `audit_log`, `rate_limits`
  - `type AuditActor = "user" | "admin" | "system"`
  - `interface AuditEntry { id: number; userId: number | null; actorType: AuditActor; action: string; target: string | null; ip: string | null; userAgent: string | null; metadata: Record<string, unknown>; createdAt: string }`
  - `class AuditRepository { constructor(db: Database); record(entry: { userId?: number | null; actorType: AuditActor; action: string; target?: string | null; ip?: string | null; userAgent?: string | null; metadata?: Record<string, unknown> }): number; forUser(userId: number, limit: number): AuditEntry[] }`

- [ ] **Step 1: Write the failing tests**

Create `tests/db/identity-schema.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { freshDb, createUser } from "../support/fixtures"

let db: Database
let userId: number

beforeEach(() => {
  db = freshDb()
  userId = createUser(db)
})

describe("audit_log", () => {
  test("rejects updating a row", () => {
    db.query(
      `INSERT INTO audit_log (user_id, actor_type, action, created_at)
       VALUES (?, 'user', 'login', '2026-01-01')`,
    ).run(userId)
    expect(() => db.query("UPDATE audit_log SET action = 'x'").run()).toThrow(/append-only/)
  })

  test("rejects deleting a row", () => {
    db.query(
      `INSERT INTO audit_log (user_id, actor_type, action, created_at)
       VALUES (?, 'user', 'login', '2026-01-01')`,
    ).run(userId)
    expect(() => db.query("DELETE FROM audit_log").run()).toThrow(/append-only/)
  })

  test("rejects an unknown actor type", () => {
    expect(() =>
      db
        .query(
          `INSERT INTO audit_log (user_id, actor_type, action, created_at)
           VALUES (?, 'robot', 'login', '2026-01-01')`,
        )
        .run(userId),
    ).toThrow()
  })

  test("allows a system actor with no user", () => {
    expect(() =>
      db
        .query(
          `INSERT INTO audit_log (user_id, actor_type, action, created_at)
           VALUES (NULL, 'system', 'startup', '2026-01-01')`,
        )
        .run(),
    ).not.toThrow()
  })
})

describe("sessions", () => {
  test("stores a session keyed by its opaque id", () => {
    db.query(
      `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
       VALUES ('abc', ?, '2026-01-01', '2026-01-01', '2026-02-01')`,
    ).run(userId)
    const row = db.query("SELECT id FROM sessions WHERE id = 'abc'").get()
    expect(row).toMatchObject({ id: "abc" })
  })

  test("rejects a session with no user", () => {
    expect(() =>
      db
        .query(
          `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
           VALUES ('x', NULL, '2026-01-01', '2026-01-01', '2026-02-01')`,
        )
        .run(),
    ).toThrow()
  })

  test("rejects a duplicate session id", () => {
    const insert = `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at)
                    VALUES ('dup', ?, '2026-01-01', '2026-01-01', '2026-02-01')`
    db.query(insert).run(userId)
    expect(() => db.query(insert).run(userId)).toThrow()
  })
})

describe("email_tokens", () => {
  test("rejects an unknown purpose", () => {
    expect(() =>
      db
        .query(
          `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
           VALUES ('h', ?, 'nonsense', '2026-02-01', '2026-01-01')`,
        )
        .run(userId),
    ).toThrow()
  })

  test("accepts the two real purposes", () => {
    for (const purpose of ["verify_email", "reset_password"]) {
      expect(() =>
        db
          .query(
            `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
             VALUES (?, ?, ?, '2026-02-01', '2026-01-01')`,
          )
          .run(`hash-${purpose}`, userId, purpose),
      ).not.toThrow()
    }
  })
})
```

Create `tests/db/repositories/audit.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { AuditRepository } from "../../../src/db/repositories/audit"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let audit: AuditRepository
let userId: number

beforeEach(() => {
  db = freshDb()
  audit = new AuditRepository(db)
  userId = createUser(db)
})

describe("record", () => {
  test("writes an entry and returns its id", () => {
    const id = audit.record({ userId, actorType: "user", action: "login" })
    expect(id).toBeGreaterThan(0)
  })

  test("stores metadata as structured data", () => {
    audit.record({
      userId,
      actorType: "user",
      action: "login",
      metadata: { method: "password", twoFactor: true },
    })
    const entry = audit.forUser(userId, 10)[0]!
    expect(entry.metadata).toEqual({ method: "password", twoFactor: true })
  })

  test("captures request context", () => {
    audit.record({
      userId,
      actorType: "user",
      action: "login",
      ip: "203.0.113.4",
      userAgent: "Firefox",
    })
    const entry = audit.forUser(userId, 10)[0]!
    expect(entry.ip).toBe("203.0.113.4")
    expect(entry.userAgent).toBe("Firefox")
  })

  test("accepts a system entry with no user", () => {
    expect(() => audit.record({ actorType: "system", action: "startup" })).not.toThrow()
  })
})

describe("forUser", () => {
  test("returns most recent first", () => {
    audit.record({ userId, actorType: "user", action: "first" })
    audit.record({ userId, actorType: "user", action: "second" })
    expect(audit.forUser(userId, 10)[0]!.action).toBe("second")
  })

  test("respects the limit", () => {
    for (let i = 0; i < 10; i++) {
      audit.record({ userId, actorType: "user", action: `a-${i}` })
    }
    expect(audit.forUser(userId, 3)).toHaveLength(3)
  })

  test("excludes other users' entries", () => {
    const other = createUser(db, "other@test.co")
    audit.record({ userId: other, actorType: "user", action: "theirs" })
    audit.record({ userId, actorType: "user", action: "mine" })
    expect(audit.forUser(userId, 10).map((e) => e.action)).toEqual(["mine"])
  })

  test("never returns a secret-bearing field", () => {
    audit.record({ userId, actorType: "user", action: "login" })
    const entry = audit.forUser(userId, 10)[0]!
    expect(Object.keys(entry)).not.toContain("password")
    expect(Object.keys(entry)).not.toContain("token")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/db/identity-schema.test.ts tests/db/repositories/audit.test.ts`
Expected: FAIL, "no such table: audit_log".

- [ ] **Step 3: Write `src/db/migrations/0004-identity.sql`**

```sql
CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  ip             TEXT,
  user_agent     TEXT,
  revoked_at     TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE email_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  purpose     TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, purpose);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('user', 'admin', 'system')),
  action       TEXT NOT NULL,
  target       TEXT,
  ip           TEXT,
  user_agent   TEXT,
  metadata     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_audit_user ON audit_log(user_id, id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

CREATE TABLE rate_limits (
  bucket       TEXT PRIMARY KEY,
  tokens       REAL NOT NULL,
  updated_at   TEXT NOT NULL,
  locked_until TEXT
);
```

Note: `sessions.user_id` is `NOT NULL`, so the "rejects a session with no user" test passes on the null constraint.

- [ ] **Step 4: Implement `src/db/repositories/audit.ts`**

```ts
import type { Database } from "bun:sqlite"

export type AuditActor = "user" | "admin" | "system"

export interface AuditEntry {
  id: number
  userId: number | null
  actorType: AuditActor
  action: string
  target: string | null
  ip: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

interface AuditRow {
  id: number
  user_id: number | null
  actor_type: AuditActor
  action: string
  target: string | null
  ip: string | null
  user_agent: string | null
  metadata: string
  created_at: string
}

export class AuditRepository {
  constructor(private readonly db: Database) {}

  record(entry: {
    userId?: number | null
    actorType: AuditActor
    action: string
    target?: string | null
    ip?: string | null
    userAgent?: string | null
    metadata?: Record<string, unknown>
  }): number {
    this.db
      .query(
        `INSERT INTO audit_log (user_id, actor_type, action, target, ip, user_agent, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.userId ?? null,
        entry.actorType,
        entry.action,
        entry.target ?? null,
        entry.ip ?? null,
        entry.userAgent ?? null,
        JSON.stringify(entry.metadata ?? {}),
        new Date().toISOString(),
      )
    return Number(
      this.db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id,
    )
  }

  forUser(userId: number, limit: number): AuditEntry[] {
    return this.db
      .query<AuditRow, [number, number]>(
        `SELECT id, user_id, actor_type, action, target, ip, user_agent, metadata, created_at
         FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(userId, limit)
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        actorType: row.actor_type,
        action: row.action,
        target: row.target,
        ip: row.ip,
        userAgent: row.user_agent,
        metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        createdAt: row.created_at,
      }))
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/db/identity-schema.test.ts tests/db/repositories/audit.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: identity schema with append-only audit log"
```

---

## Task 2: Password policy and hashing

**Files:**
- Create: `src/domain/identity/errors.ts`
- Create: `src/domain/identity/password.ts`
- Create: `src/services/breach-check.ts`
- Test: `tests/domain/identity/password.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `class IdentityError extends Error { readonly code: IdentityErrorCode }`
  - `type IdentityErrorCode = "weak_password" | "breached_password" | "invalid_credentials" | "email_taken" | "token_invalid" | "token_expired" | "token_consumed" | "totp_invalid" | "totp_not_enabled" | "rate_limited" | "csrf_invalid" | "session_invalid"`
  - `validatePasswordPolicy(password: string): void`
  - `hashPassword(password: string): Promise<string>`
  - `verifyPassword(password: string, hash: string): Promise<boolean>`
  - `needsRehash(hash: string): boolean`
  - `interface BreachCheck { isBreached(password: string): Promise<boolean> }`
  - `class HibpBreachCheck implements BreachCheck`
  - `class NeverBreached implements BreachCheck` for tests

- [ ] **Step 1: Write `src/domain/identity/errors.ts`**

```ts
export type IdentityErrorCode =
  | "weak_password"
  | "breached_password"
  | "invalid_credentials"
  | "email_taken"
  | "token_invalid"
  | "token_expired"
  | "token_consumed"
  | "totp_invalid"
  | "totp_not_enabled"
  | "rate_limited"
  | "csrf_invalid"
  | "session_invalid"

export class IdentityError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "IdentityError"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/domain/identity/password.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
  needsRehash,
  MINIMUM_LENGTH,
} from "../../../src/domain/identity/password"
import { IdentityError } from "../../../src/domain/identity/errors"

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof IdentityError) return error.code
    throw error
  }
  throw new Error("expected a throw")
}

describe("validatePasswordPolicy", () => {
  test("accepts a long passphrase", () => {
    expect(() => validatePasswordPolicy("correct horse battery staple")).not.toThrow()
  })

  test("requires at least twelve characters", () => {
    expect(MINIMUM_LENGTH).toBe(12)
    expect(codeOf(() => validatePasswordPolicy("short1!A"))).toBe("weak_password")
  })

  test("accepts exactly the minimum length", () => {
    expect(() => validatePasswordPolicy("a".repeat(12))).not.toThrow()
  })

  test("imposes no composition rules, which make passwords worse", () => {
    // All lowercase, no digits, no symbols. Long is what matters.
    expect(() => validatePasswordPolicy("thequickbrownfoxjumps")).not.toThrow()
  })

  test("rejects an empty password", () => {
    expect(codeOf(() => validatePasswordPolicy(""))).toBe("weak_password")
  })

  test("caps length so a huge input cannot burn CPU in the hash", () => {
    expect(codeOf(() => validatePasswordPolicy("a".repeat(1025)))).toBe("weak_password")
  })
})

describe("hashPassword", () => {
  test("produces an argon2id hash", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(hash).toStartWith("$argon2id$")
  })

  test("never returns the password itself", async () => {
    const password = "correct horse battery staple"
    expect(await hashPassword(password)).not.toContain(password)
  })

  test("salts, so the same password hashes differently each time", async () => {
    const a = await hashPassword("correct horse battery staple")
    const b = await hashPassword("correct horse battery staple")
    expect(a).not.toBe(b)
  })
})

describe("verifyPassword", () => {
  test("accepts the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true)
  })

  test("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(await verifyPassword("wrong horse battery staple", hash)).toBe(false)
  })

  test("returns false rather than throwing on a malformed hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false)
  })

  test("returns false on an empty hash", async () => {
    expect(await verifyPassword("anything", "")).toBe(false)
  })
})

describe("needsRehash", () => {
  test("accepts a current argon2id hash", async () => {
    expect(needsRehash(await hashPassword("correct horse battery staple"))).toBe(false)
  })

  test("flags a bcrypt hash for upgrade", () => {
    expect(needsRehash("$2b$12$abcdefghijklmnopqrstuv")).toBe(true)
  })

  test("flags a hash with a weaker memory cost", () => {
    expect(needsRehash("$argon2id$v=19$m=4096,t=2,p=1$abc$def")).toBe(true)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/domain/identity/password.test.ts`
Expected: FAIL, cannot resolve `password`.

- [ ] **Step 4: Implement `src/domain/identity/password.ts`**

```ts
import { IdentityError } from "./errors"

export const MINIMUM_LENGTH = 12
const MAXIMUM_LENGTH = 1024

// OWASP's current Argon2id guidance. Raising these later is fine: needsRehash
// detects the older parameters and login upgrades the stored hash in place.
const MEMORY_COST = 19456
const TIME_COST = 2

export function validatePasswordPolicy(password: string): void {
  if (password.length < MINIMUM_LENGTH) {
    throw new IdentityError(
      "weak_password",
      `Password must be at least ${MINIMUM_LENGTH} characters`,
    )
  }
  if (password.length > MAXIMUM_LENGTH) {
    throw new IdentityError(
      "weak_password",
      `Password must be at most ${MAXIMUM_LENGTH} characters`,
    )
  }
}

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, {
    algorithm: "argon2id",
    memoryCost: MEMORY_COST,
    timeCost: TIME_COST,
  })
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false
  try {
    return await Bun.password.verify(password, hash)
  } catch {
    // A malformed stored hash is a data problem, not a reason to 500 a login.
    return false
  }
}

export function needsRehash(hash: string): boolean {
  if (!hash.startsWith("$argon2id$")) return true
  const memory = hash.match(/m=(\d+)/)?.[1]
  const time = hash.match(/t=(\d+)/)?.[1]
  if (!memory || !time) return true
  return Number(memory) < MEMORY_COST || Number(time) < TIME_COST
}
```

- [ ] **Step 5: Implement `src/services/breach-check.ts`**

```ts
export interface BreachCheck {
  isBreached(password: string): Promise<boolean>
}

/**
 * Have I Been Pwned range API, using k-anonymity: only the first five
 * characters of the SHA-1 hash leave this process, and the full password
 * never does. A network failure must not block a registration, so this
 * fails open and says "not breached".
 */
export class HibpBreachCheck implements BreachCheck {
  constructor(private readonly timeoutMs = 3000) {}

  async isBreached(password: string): Promise<boolean> {
    const digest = new Bun.CryptoHasher("sha1").update(password).digest("hex").toUpperCase()
    const prefix = digest.slice(0, 5)
    const suffix = digest.slice(5)

    try {
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { "add-padding": "true" },
      })
      if (!response.ok) return false
      const body = await response.text()
      for (const line of body.split("\n")) {
        const [hashSuffix, countRaw] = line.trim().split(":")
        if (hashSuffix === suffix && Number(countRaw ?? "0") > 0) return true
      }
      return false
    } catch {
      return false
    }
  }
}

export class NeverBreached implements BreachCheck {
  async isBreached(): Promise<boolean> {
    return false
  }
}

export class AlwaysBreached implements BreachCheck {
  async isBreached(): Promise<boolean> {
    return true
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/domain/identity/password.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: argon2id password hashing, length-only policy, and breach check"
```

---

## Task 3: TOTP and recovery codes

**Files:**
- Create: `src/domain/identity/crypto.ts`
- Create: `src/domain/identity/totp.ts`
- Test: `tests/domain/identity/totp.test.ts`

**Interfaces:**
- Consumes: `IdentityError` from Task 2
- Produces:
  - `encryptSecret(plaintext: string, key: string): string` returning `iv.ciphertext.tag` base64url
  - `decryptSecret(payload: string, key: string): string`
  - `generateTotpSecret(): string` base32
  - `totpUri(secret: string, email: string): string`
  - `verifyTotp(secret: string, token: string): boolean`
  - `generateRecoveryCodes(count?: number): string[]`
  - `hashRecoveryCode(code: string): Promise<string>`
  - `verifyRecoveryCode(code: string, hash: string): Promise<boolean>`

- [ ] **Step 1: Install the TOTP library**

```bash
bun add otpauth
```

Hand-rolling RFC 6238 is only HMAC and truncation, but a maintained library is easier to defend in a regulatory review and removes a class of subtle bug. Use the library.

- [ ] **Step 2: Write the failing test**

Create `tests/domain/identity/totp.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import * as OTPAuth from "otpauth"
import {
  encryptSecret,
  decryptSecret,
  generateTotpSecret,
  totpUri,
  verifyTotp,
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyRecoveryCode,
} from "../../../src/domain/identity/totp"

const KEY = "k".repeat(32)

describe("secret encryption at rest", () => {
  test("round trips", () => {
    const secret = generateTotpSecret()
    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret)
  })

  test("ciphertext does not contain the plaintext", () => {
    const secret = generateTotpSecret()
    expect(encryptSecret(secret, KEY)).not.toContain(secret)
  })

  test("uses a fresh iv, so the same input encrypts differently", () => {
    const secret = generateTotpSecret()
    expect(encryptSecret(secret, KEY)).not.toBe(encryptSecret(secret, KEY))
  })

  test("rejects decryption under the wrong key", () => {
    const payload = encryptSecret(generateTotpSecret(), KEY)
    expect(() => decryptSecret(payload, "j".repeat(32))).toThrow()
  })

  test("rejects a tampered ciphertext, because GCM authenticates", () => {
    const payload = encryptSecret(generateTotpSecret(), KEY)
    const parts = payload.split(".")
    const flipped = parts[1]!.slice(0, -2) + (parts[1]!.endsWith("AA") ? "BB" : "AA")
    expect(() => decryptSecret(`${parts[0]}.${flipped}.${parts[2]}`, KEY)).toThrow()
  })
})

describe("generateTotpSecret", () => {
  test("returns a base32 secret of at least 32 characters", () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(secret.length).toBeGreaterThanOrEqual(32)
  })

  test("returns a different secret each time", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })
})

describe("totpUri", () => {
  test("builds a provisioning uri an authenticator app understands", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "user@example.com")
    expect(uri).toStartWith("otpauth://totp/")
    expect(uri).toContain("Meridian")
    expect(uri).toContain("user%40example.com")
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP")
  })
})

describe("verifyTotp", () => {
  function currentToken(secret: string): string {
    return new OTPAuth.TOTP({
      issuer: "Meridian",
      label: "test",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate()
  }

  test("accepts the current token", () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, currentToken(secret))).toBe(true)
  })

  test("rejects a wrong token", () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, "000000")).toBe(false)
  })

  test("rejects a malformed token", () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, "abc")).toBe(false)
    expect(verifyTotp(secret, "")).toBe(false)
    expect(verifyTotp(secret, "1234567")).toBe(false)
  })

  test("tolerates whitespace a user pastes in", () => {
    const secret = generateTotpSecret()
    const token = currentToken(secret)
    expect(verifyTotp(secret, `${token.slice(0, 3)} ${token.slice(3)}`)).toBe(true)
  })

  test("returns false rather than throwing on a malformed secret", () => {
    expect(verifyTotp("not base32!!!", "123456")).toBe(false)
  })
})

describe("recovery codes", () => {
  test("issues ten codes by default", () => {
    expect(generateRecoveryCodes()).toHaveLength(10)
  })

  test("issues codes that are unique", () => {
    const codes = generateRecoveryCodes()
    expect(new Set(codes).size).toBe(codes.length)
  })

  test("formats codes so a person can read them back", () => {
    for (const code of generateRecoveryCodes()) {
      expect(code).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/)
    }
  })

  test("hashes so a database leak does not hand over the codes", async () => {
    const [code] = generateRecoveryCodes()
    const hash = await hashRecoveryCode(code!)
    expect(hash).not.toContain(code!)
    expect(hash).toStartWith("$argon2id$")
  })

  test("verifies a correct code", async () => {
    const [code] = generateRecoveryCodes()
    expect(await verifyRecoveryCode(code!, await hashRecoveryCode(code!))).toBe(true)
  })

  test("rejects a wrong code", async () => {
    const [a, b] = generateRecoveryCodes()
    expect(await verifyRecoveryCode(b!, await hashRecoveryCode(a!))).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/domain/identity/totp.test.ts`
Expected: FAIL, cannot resolve `totp`.

- [ ] **Step 4: Implement `src/domain/identity/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

function keyFrom(key: string): Buffer {
  // The configured key is a passphrase, not raw bytes. Derive a fixed 32-byte
  // key from it so any sufficiently long configured value works.
  return createHash("sha256").update(key).digest()
}

export function encryptSecret(plaintext: string, key: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, keyFrom(key), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, ciphertext, tag].map((b) => b.toString("base64url")).join(".")
}

export function decryptSecret(payload: string, key: string): string {
  const [ivPart, ciphertextPart, tagPart] = payload.split(".")
  if (!ivPart || !ciphertextPart || !tagPart) {
    throw new Error("Malformed encrypted payload")
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    keyFrom(key),
    Buffer.from(ivPart, "base64url"),
  )
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
```

- [ ] **Step 5: Implement `src/domain/identity/totp.ts`**

```ts
import * as OTPAuth from "otpauth"
import { randomBytes } from "node:crypto"

export { encryptSecret, decryptSecret } from "./crypto"

const ISSUER = "Meridian"
const PERIOD = 30
const DIGITS = 6
// One step either side, per RFC 6238, to absorb clock drift without opening
// a meaningfully wider window.
const WINDOW = 1

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

export function generateTotpSecret(): string {
  const bytes = randomBytes(20)
  let out = ""
  for (const byte of bytes) {
    out += BASE32[byte % 32]
    out += BASE32[(byte >> 3) % 32]
  }
  return out.slice(0, 32)
}

function totpFor(secret: string, label: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  })
}

export function totpUri(secret: string, email: string): string {
  return totpFor(secret, email).toString()
}

export function verifyTotp(secret: string, token: string): boolean {
  const cleaned = token.replace(/\s+/g, "")
  if (!/^\d{6}$/.test(cleaned)) return false
  try {
    return totpFor(secret, "verify").validate({ token: cleaned, window: WINDOW }) !== null
  } catch {
    return false
  }
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes = new Set<string>()
  while (codes.size < count) {
    const bytes = randomBytes(10)
    let code = ""
    for (let i = 0; i < 10; i++) {
      code += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length]
      if (i === 4) code += "-"
    }
    codes.add(code)
  }
  return [...codes]
}

export async function hashRecoveryCode(code: string): Promise<string> {
  return Bun.password.hash(code, { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 })
}

export async function verifyRecoveryCode(code: string, hash: string): Promise<boolean> {
  if (!hash) return false
  try {
    return await Bun.password.verify(code, hash)
  } catch {
    return false
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/domain/identity/totp.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: totp with encrypted secrets at rest and hashed recovery codes"
```

---

## Task 4: User and session repositories

**Files:**
- Create: `src/domain/identity/tokens.ts`
- Create: `src/db/repositories/users.ts`
- Create: `src/db/repositories/sessions.ts`
- Test: `tests/db/repositories/users.test.ts`, `tests/db/repositories/sessions.test.ts`

**Interfaces:**
- Consumes: Task 1 schema, Task 2 hashing
- Produces:
  - `randomToken(bytes?: number): string` base64url
  - `hashToken(token: string): string` SHA-256 hex, for storing email tokens
  - `normalizeEmail(email: string): string`
  - `interface User { id: number; email: string; emailVerifiedAt: string | null; totpEnabledAt: string | null; status: "active" | "suspended" | "closed"; kycTier: number; createdAt: string }`
  - `class UserRepository { create(email, passwordHash): number; findByEmail(email): (User & { passwordHash: string }) | null; findById(id): User | null; markEmailVerified(id): void; setPasswordHash(id, hash): void; setTotpSecret(id, encrypted): void; enableTotp(id): void; disableTotp(id): void; getTotpSecret(id): string | null }`
  - `interface Session { id: string; userId: number; createdAt: string; lastSeenAt: string; expiresAt: string; ip: string | null; userAgent: string | null }`
  - `class SessionRepository { create(userId, ctx): string; find(id): Session | null; touch(id): void; revoke(id): void; revokeAllFor(userId): number; listActive(userId): Session[] }`

- [ ] **Step 1: Write `src/domain/identity/tokens.ts`**

```ts
import { randomBytes, createHash } from "node:crypto"

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url")
}

/**
 * Email tokens are stored hashed. A leaked database therefore does not hand
 * an attacker a working password-reset link. SHA-256 is right here rather
 * than Argon2id: the token is already 256 bits of entropy, so there is
 * nothing to brute force and no reason to pay the cost.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/db/repositories/users.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { UserRepository } from "../../../src/db/repositories/users"
import { hashPassword } from "../../../src/domain/identity/password"
import { freshDb } from "../../support/fixtures"

let db: Database
let users: UserRepository
let hash: string

beforeEach(async () => {
  db = freshDb()
  users = new UserRepository(db)
  hash = await hashPassword("correct horse battery staple")
})

describe("create", () => {
  test("returns a new id", () => {
    expect(users.create("a@test.co", hash)).toBeGreaterThan(0)
  })

  test("starts unverified, with no totp and tier zero", () => {
    const user = users.findById(users.create("a@test.co", hash))!
    expect(user.emailVerifiedAt).toBeNull()
    expect(user.totpEnabledAt).toBeNull()
    expect(user.kycTier).toBe(0)
    expect(user.status).toBe("active")
  })

  test("rejects a duplicate email", () => {
    users.create("a@test.co", hash)
    expect(() => users.create("a@test.co", hash)).toThrow()
  })

  test("rejects a duplicate email differing only in case", () => {
    users.create("a@test.co", hash)
    expect(() => users.create("A@TEST.CO", hash)).toThrow()
  })

  test("preserves the address as typed while matching case insensitively", () => {
    users.create("Someone@Test.CO", hash)
    expect(users.findByEmail("someone@test.co")!.email).toBe("Someone@Test.CO")
  })
})

describe("findByEmail", () => {
  test("returns null for an unknown address", () => {
    expect(users.findByEmail("nobody@test.co")).toBeNull()
  })

  test("exposes the password hash for verification", () => {
    users.create("a@test.co", hash)
    expect(users.findByEmail("a@test.co")!.passwordHash).toBe(hash)
  })
})

describe("findById", () => {
  test("does not expose the password hash", () => {
    const user = users.findById(users.create("a@test.co", hash))!
    expect(user).not.toHaveProperty("passwordHash")
  })
})

describe("mutations", () => {
  test("marks email verified", () => {
    const id = users.create("a@test.co", hash)
    users.markEmailVerified(id)
    expect(users.findById(id)!.emailVerifiedAt).not.toBeNull()
  })

  test("replaces the password hash", async () => {
    const id = users.create("a@test.co", hash)
    const next = await hashPassword("a completely different passphrase")
    users.setPasswordHash(id, next)
    expect(users.findByEmail("a@test.co")!.passwordHash).toBe(next)
  })

  test("stores and reads back an encrypted totp secret", () => {
    const id = users.create("a@test.co", hash)
    users.setTotpSecret(id, "encrypted-payload")
    expect(users.getTotpSecret(id)).toBe("encrypted-payload")
  })

  test("enabling totp records the time", () => {
    const id = users.create("a@test.co", hash)
    users.setTotpSecret(id, "encrypted-payload")
    users.enableTotp(id)
    expect(users.findById(id)!.totpEnabledAt).not.toBeNull()
  })

  test("disabling totp clears both the flag and the secret", () => {
    const id = users.create("a@test.co", hash)
    users.setTotpSecret(id, "encrypted-payload")
    users.enableTotp(id)
    users.disableTotp(id)
    expect(users.findById(id)!.totpEnabledAt).toBeNull()
    expect(users.getTotpSecret(id)).toBeNull()
  })
})
```

Create `tests/db/repositories/sessions.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { SessionRepository } from "../../../src/db/repositories/sessions"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let sessions: SessionRepository
let userId: number

beforeEach(() => {
  db = freshDb()
  sessions = new SessionRepository(db)
  userId = createUser(db)
})

const ctx = { ip: "203.0.113.4", userAgent: "Firefox" }

describe("create", () => {
  test("returns an opaque high-entropy id", () => {
    const id = sessions.create(userId, ctx)
    expect(id.length).toBeGreaterThanOrEqual(43)
    expect(id).not.toContain(String(userId))
  })

  test("returns a different id every time", () => {
    expect(sessions.create(userId, ctx)).not.toBe(sessions.create(userId, ctx))
  })

  test("records request context", () => {
    const session = sessions.find(sessions.create(userId, ctx))!
    expect(session.ip).toBe("203.0.113.4")
    expect(session.userAgent).toBe("Firefox")
  })
})

describe("find", () => {
  test("returns null for an unknown id", () => {
    expect(sessions.find("nope")).toBeNull()
  })

  test("returns null for a revoked session", () => {
    const id = sessions.create(userId, ctx)
    sessions.revoke(id)
    expect(sessions.find(id)).toBeNull()
  })

  test("returns null for an expired session", () => {
    const id = sessions.create(userId, ctx)
    db.query("UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id)
    expect(sessions.find(id)).toBeNull()
  })
})

describe("revocation", () => {
  test("revokeAllFor revokes every active session and reports the count", () => {
    sessions.create(userId, ctx)
    sessions.create(userId, ctx)
    expect(sessions.revokeAllFor(userId)).toBe(2)
    expect(sessions.listActive(userId)).toHaveLength(0)
  })

  test("revokeAllFor leaves other users alone", () => {
    const other = createUser(db, "other@test.co")
    const theirs = sessions.create(other, ctx)
    sessions.create(userId, ctx)
    sessions.revokeAllFor(userId)
    expect(sessions.find(theirs)).not.toBeNull()
  })

  test("revoking twice is harmless", () => {
    const id = sessions.create(userId, ctx)
    sessions.revoke(id)
    expect(() => sessions.revoke(id)).not.toThrow()
  })
})

describe("listActive", () => {
  test("lists only active sessions, newest first", () => {
    const first = sessions.create(userId, ctx)
    const second = sessions.create(userId, ctx)
    sessions.revoke(first)
    expect(sessions.listActive(userId).map((s) => s.id)).toEqual([second])
  })
})

describe("touch", () => {
  test("advances last seen", () => {
    const id = sessions.create(userId, ctx)
    const before = sessions.find(id)!.lastSeenAt
    db.query("UPDATE sessions SET last_seen_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id)
    sessions.touch(id)
    expect(sessions.find(id)!.lastSeenAt).not.toBe("2020-01-01T00:00:00.000Z")
    expect(before).toBeDefined()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test tests/db/repositories/users.test.ts tests/db/repositories/sessions.test.ts`
Expected: FAIL, cannot resolve the repositories.

- [ ] **Step 4: Implement `src/db/repositories/users.ts`**

```ts
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

  private update(id: number, sql: string, ...params: (string | null)[]): void {
    this.db
      .query(`UPDATE users SET ${sql}, updated_at = ? WHERE id = ?`)
      .run(...params, new Date().toISOString(), id)
  }

  markEmailVerified(id: number): void {
    this.update(id, "email_verified_at = ?", new Date().toISOString())
  }

  setPasswordHash(id: number, hash: string): void {
    this.update(id, "password_hash = ?", hash)
  }

  setTotpSecret(id: number, encrypted: string): void {
    this.update(id, "totp_secret_encrypted = ?", encrypted)
  }

  enableTotp(id: number): void {
    this.update(id, "totp_enabled_at = ?", new Date().toISOString())
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
```

- [ ] **Step 5: Implement `src/db/repositories/sessions.ts`**

```ts
import type { Database } from "bun:sqlite"
import { randomToken } from "../../domain/identity/tokens"

export interface Session {
  id: string
  userId: number
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  ip: string | null
  userAgent: string | null
}

interface SessionRow {
  id: string
  user_id: number
  created_at: string
  last_seen_at: string
  expires_at: string
  ip: string | null
  user_agent: string | null
}

const ABSOLUTE_DAYS = 30

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    ip: row.ip,
    userAgent: row.user_agent,
  }
}

export class SessionRepository {
  constructor(private readonly db: Database) {}

  create(userId: number, ctx: { ip?: string | null; userAgent?: string | null }): string {
    const id = randomToken(32)
    const now = new Date()
    const expires = new Date(now.getTime() + ABSOLUTE_DAYS * 86_400_000)
    this.db
      .query(
        `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        now.toISOString(),
        now.toISOString(),
        expires.toISOString(),
        ctx.ip ?? null,
        ctx.userAgent ?? null,
      )
    return id
  }

  find(id: string): Session | null {
    const row = this.db
      .query<SessionRow, [string, string]>(
        `SELECT id, user_id, created_at, last_seen_at, expires_at, ip, user_agent
         FROM sessions
         WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .get(id, new Date().toISOString())
    return row ? toSession(row) : null
  }

  touch(id: string): void {
    this.db
      .query("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id)
  }

  revoke(id: string): void {
    this.db
      .query("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), id)
  }

  revokeAllFor(userId: number): number {
    const active = this.listActive(userId).length
    this.db
      .query("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), userId)
    return active
  }

  listActive(userId: number): Session[] {
    return this.db
      .query<SessionRow, [number, string]>(
        `SELECT id, user_id, created_at, last_seen_at, expires_at, ip, user_agent
         FROM sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY created_at DESC, rowid DESC`,
      )
      .all(userId, new Date().toISOString())
      .map(toSession)
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/db/repositories/users.test.ts tests/db/repositories/sessions.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: user and session repositories with opaque server-side sessions"
```

---

## Task 5: CSRF and rate limiting middleware

**Files:**
- Create: `src/db/repositories/rate-limits.ts`
- Create: `src/middleware/csrf.ts`
- Create: `src/middleware/rate-limit.ts`
- Test: `tests/middleware/csrf.test.ts`, `tests/db/repositories/rate-limits.test.ts`

**Interfaces:**
- Consumes: Task 1 `rate_limits` table
- Produces:
  - `class RateLimitRepository { consume(bucket: string, capacity: number, refillPerSecond: number, lockSeconds: number): { allowed: boolean; lockedUntil: string | null } }`
  - `csrfMiddleware(): express.RequestHandler` issuing `res.locals.csrfToken` and rejecting bad tokens
  - `rateLimit(opts: { bucket: (req) => string; capacity: number; refillPerSecond: number; lockSeconds: number; repo: RateLimitRepository }): express.RequestHandler`

- [ ] **Step 1: Write the failing tests**

Create `tests/db/repositories/rate-limits.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { RateLimitRepository } from "../../../src/db/repositories/rate-limits"
import { freshDb } from "../../support/fixtures"

let db: Database
let limits: RateLimitRepository

beforeEach(() => {
  db = freshDb()
  limits = new RateLimitRepository(db)
})

describe("consume", () => {
  test("allows requests up to capacity", () => {
    for (let i = 0; i < 5; i++) {
      expect(limits.consume("login:a", 5, 0, 900).allowed).toBe(true)
    }
  })

  test("blocks the request past capacity", () => {
    for (let i = 0; i < 5; i++) limits.consume("login:a", 5, 0, 900)
    expect(limits.consume("login:a", 5, 0, 900).allowed).toBe(false)
  })

  test("reports when the lock expires", () => {
    for (let i = 0; i < 6; i++) limits.consume("login:a", 5, 0, 900)
    expect(limits.consume("login:a", 5, 0, 900).lockedUntil).not.toBeNull()
  })

  test("keeps buckets independent", () => {
    for (let i = 0; i < 5; i++) limits.consume("login:a", 5, 0, 900)
    expect(limits.consume("login:b", 5, 0, 900).allowed).toBe(true)
  })

  test("refills over time", () => {
    for (let i = 0; i < 5; i++) limits.consume("login:c", 5, 1, 0)
    expect(limits.consume("login:c", 5, 1, 0).allowed).toBe(false)
    db.query("UPDATE rate_limits SET updated_at = ? WHERE bucket = 'login:c'").run(
      new Date(Date.now() - 10_000).toISOString(),
    )
    expect(limits.consume("login:c", 5, 1, 0).allowed).toBe(true)
  })

  test("survives a restart, because the bucket is persisted", () => {
    for (let i = 0; i < 5; i++) limits.consume("login:d", 5, 0, 900)
    const reopened = new RateLimitRepository(db)
    expect(reopened.consume("login:d", 5, 0, 900).allowed).toBe(false)
  })
})
```

Create `tests/middleware/csrf.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
}

function tokenFrom(html: string): string {
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? ""
}

describe("csrf", () => {
  test("issues a token cookie on a GET that renders a form", async () => {
    const res = await createApp(config).inject("/login")
    expect(res.headers.getSetCookie().some((c) => c.includes("csrf"))).toBe(true)
  })

  test("embeds a matching token in the form", async () => {
    const res = await createApp(config).inject("/login")
    expect(tokenFrom(await res.text()).length).toBeGreaterThan(20)
  })

  test("rejects a POST with no token", async () => {
    const res = await createApp(config).inject("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a@test.co&password=whatever12345",
    })
    expect(res.status).toBe(403)
  })

  test("rejects a POST whose token does not match the cookie", async () => {
    const app = createApp(config)
    const page = await app.inject("/login")
    const res = await app.inject("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookiesFrom(page),
      },
      body: "_csrf=forged&email=a@test.co&password=whatever12345",
    })
    expect(res.status).toBe(403)
  })

  test("accepts a POST whose token matches the cookie", async () => {
    const app = createApp(config)
    const page = await app.inject("/login")
    const token = tokenFrom(await page.text())
    const res = await app.inject("/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookiesFrom(page),
      },
      body: `_csrf=${encodeURIComponent(token)}&email=a@test.co&password=whatever12345`,
    })
    expect(res.status).not.toBe(403)
  })

  test("does not require a token on GET", async () => {
    expect((await createApp(config).inject("/login")).status).toBe(200)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/db/repositories/rate-limits.test.ts tests/middleware/csrf.test.ts`
Expected: FAIL. The repository does not exist and `/login` 404s.

- [ ] **Step 3: Implement `src/db/repositories/rate-limits.ts`**

```ts
import type { Database } from "bun:sqlite"

export class RateLimitRepository {
  constructor(private readonly db: Database) {}

  /**
   * Token bucket, persisted so a restart does not hand an attacker a fresh
   * allowance. Returns whether this request may proceed.
   */
  consume(
    bucket: string,
    capacity: number,
    refillPerSecond: number,
    lockSeconds: number,
  ): { allowed: boolean; lockedUntil: string | null } {
    const now = new Date()
    const nowIso = now.toISOString()

    return this.db.transaction(() => {
      const row = this.db
        .query<{ tokens: number; updated_at: string; locked_until: string | null }, [string]>(
          "SELECT tokens, updated_at, locked_until FROM rate_limits WHERE bucket = ?",
        )
        .get(bucket)

      if (row?.locked_until && new Date(row.locked_until) > now) {
        return { allowed: false, lockedUntil: row.locked_until }
      }

      let tokens = capacity
      if (row) {
        const elapsed = (now.getTime() - new Date(row.updated_at).getTime()) / 1000
        tokens = Math.min(capacity, row.tokens + elapsed * refillPerSecond)
      }

      if (tokens < 1) {
        const lockedUntil =
          lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1000).toISOString() : null
        this.db
          .query(
            `INSERT INTO rate_limits (bucket, tokens, updated_at, locked_until)
             VALUES (?, 0, ?, ?)
             ON CONFLICT(bucket) DO UPDATE SET tokens = 0, updated_at = ?, locked_until = ?`,
          )
          .run(bucket, nowIso, lockedUntil, nowIso, lockedUntil)
        return { allowed: false, lockedUntil }
      }

      const remaining = tokens - 1
      this.db
        .query(
          `INSERT INTO rate_limits (bucket, tokens, updated_at, locked_until)
           VALUES (?, ?, ?, NULL)
           ON CONFLICT(bucket) DO UPDATE SET tokens = ?, updated_at = ?, locked_until = NULL`,
        )
        .run(bucket, remaining, nowIso, remaining, nowIso)
      return { allowed: true, lockedUntil: null }
    })()
  }
}
```

- [ ] **Step 4: Implement `src/middleware/csrf.ts`**

```ts
import type { RequestHandler } from "express"
import { timingSafeEqual } from "node:crypto"
import { randomToken } from "../domain/identity/tokens"

const COOKIE = "meridian_csrf"
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function matches(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length || left.length === 0) return false
  return timingSafeEqual(left, right)
}

/**
 * Double-submit cookie. SameSite=Lax already blocks most cross-site POSTs,
 * but it is a browser policy rather than a check we perform, so we perform
 * the check too.
 */
export function csrfMiddleware(secure: boolean): RequestHandler {
  return (req, res, next) => {
    let token = req.cookies?.[COOKIE] as string | undefined

    if (!token) {
      token = randomToken(24)
      res.cookie(COOKIE, token, {
        httpOnly: false,
        secure,
        sameSite: "lax",
        path: "/",
      })
    }
    res.locals.csrfToken = token

    if (SAFE_METHODS.has(req.method)) return next()

    const submitted = String(
      (req.body as Record<string, unknown> | undefined)?._csrf ??
        req.get("x-csrf-token") ??
        "",
    )
    if (!matches(submitted, token)) {
      res.status(403).render("error", {
        title: "Request rejected | Meridian",
        description: "The form could not be submitted.",
        path: req.path,
        heading: "That form has expired.",
        message: "Go back, reload the page, and try again.",
      })
      return
    }
    next()
  }
}
```

- [ ] **Step 5: Implement `src/middleware/rate-limit.ts`**

```ts
import type { Request, RequestHandler } from "express"
import type { RateLimitRepository } from "../db/repositories/rate-limits"
import type { AuditRepository } from "../db/repositories/audit"

export interface RateLimitOptions {
  repo: RateLimitRepository
  audit: AuditRepository
  bucket: (req: Request) => string
  capacity: number
  refillPerSecond: number
  lockSeconds: number
  action: string
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const key = options.bucket(req)
    const result = options.repo.consume(
      key,
      options.capacity,
      options.refillPerSecond,
      options.lockSeconds,
    )

    if (result.allowed) return next()

    options.audit.record({
      actorType: "system",
      action: `rate_limited.${options.action}`,
      target: key,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })

    res.status(429).render("error", {
      title: "Too many attempts | Meridian",
      description: "Too many attempts.",
      path: req.path,
      heading: "Too many attempts.",
      message: "Wait a few minutes and try again.",
    })
  }
}
```

- [ ] **Step 6: Create `src/views/error.pug`**

```pug
extends layouts/base.pug

block content
  .shell
    .section
      .eyebrow Error
      h1= heading
      p= message
```

- [ ] **Step 7: Wire cookies and CSRF into `src/server.ts`**

```bash
bun add cookie-parser
bun add -d @types/cookie-parser
```

Add to `src/server.ts`, after the body parsers and before the route mounts:

```ts
import cookieParser from "cookie-parser"
import { csrfMiddleware } from "./middleware/csrf"
```

```ts
  app.use(cookieParser())
  app.use(csrfMiddleware(config.env === "production"))
```

The `secure` flag is off outside production because a `Secure` cookie is not
sent over plain HTTP and local development is HTTP.

- [ ] **Step 8: Run the rate limit tests**

Run: `bun test tests/db/repositories/rate-limits.test.ts`
Expected: PASS, 6 tests.

The CSRF tests still fail because `/login` does not exist. Task 6 adds it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: persisted token-bucket rate limiting and double-submit csrf"
```

---

## Task 6: Registration and email verification

**Files:**
- Create: `src/services/email.ts`
- Create: `src/routes/auth.ts`
- Create: `src/views/auth/register.pug`, `src/views/auth/login.pug`, `src/views/auth/check-email.pug`, `src/views/auth/verified.pug`
- Modify: `src/server.ts`
- Test: `tests/routes/auth-register.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 5
- Produces:
  - `interface OutboundEmail { to: string; subject: string; text: string }`
  - `interface EmailSender { send(email: OutboundEmail): Promise<void> }`
  - `class ConsoleEmailSender implements EmailSender`
  - `class CapturingEmailSender implements EmailSender { readonly sent: OutboundEmail[] }` for tests
  - `createAuthRoutes(deps: AuthDeps): express.Router`
  - `interface AuthDeps { users: UserRepository; sessions: SessionRepository; audit: AuditRepository; limits: RateLimitRepository; assets: AssetRepository; ledger: LedgerRepository; email: EmailSender; breach: BreachCheck; config: Config; db: Database }`

Add a test to `tests/routes/auth-register.test.ts` pinning the provisioning requirement:

```ts
  test("provisions a ledger account pair for every asset at registration", async () => {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    const user = new UserRepository(db).findByEmail("a@test.co")!
    const row = db
      .query<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?",
      )
      .get(user.id)!
    // Ten assets, each with an available and a hold account.
    expect(row.n).toBe(20)
  })

  test("provisioned accounts all start at zero", async () => {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    const user = new UserRepository(db).findByEmail("a@test.co")!
    const nonZero = db
      .query<{ n: number }, [number]>(
        `SELECT COUNT(*) AS n FROM account_balances b
         JOIN accounts a ON a.id = b.account_id
         WHERE a.user_id = ? AND b.amount <> 0`,
      )
      .get(user.id)!
    expect(nonZero.n).toBe(0)
  })
```

- [ ] **Step 1: Write the failing test**

Create `tests/routes/auth-register.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { AlwaysBreached } from "../../src/services/breach-check"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { AuditRepository } from "../../src/db/repositories/audit"
import type { Database } from "bun:sqlite"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

let db: Database
let app: App
let email: CapturingEmailSender

function build(overrides: Record<string, unknown> = {}) {
  db = openDatabase(":memory:")
  migrate(db)
  email = new CapturingEmailSender()
  app = createApp(config, { db, email, ...overrides })
}

function cookiesFrom(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
}

function tokenFrom(html: string): string {
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? ""
}

async function post(path: string, fields: Record<string, string>): Promise<Response> {
  const page = await app.inject(path)
  const body = new URLSearchParams({ ...fields, _csrf: tokenFrom(await page.text()) })
  return app.inject(path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookiesFrom(page),
    },
    body: body.toString(),
    redirect: "manual",
  })
}

beforeEach(() => build())

describe("GET /register", () => {
  test("renders the form", async () => {
    const res = await app.inject("/register")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('name="email"')
    expect(html).toContain('name="password"')
    expect(html).toContain('name="_csrf"')
  })

  test("states the password requirement up front", async () => {
    const html = await (await app.inject("/register")).text()
    expect(html).toContain("12")
  })
})

describe("POST /register", () => {
  test("creates a user and sends a verification email", async () => {
    const res = await post("/register", {
      email: "a@test.co",
      password: "correct horse battery staple",
    })
    expect(res.status).toBe(303)
    expect(new UserRepository(db).findByEmail("a@test.co")).not.toBeNull()
    expect(email.sent).toHaveLength(1)
    expect(email.sent[0]!.to).toBe("a@test.co")
  })

  test("the email carries a verification link with a token", async () => {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    expect(email.sent[0]!.text).toContain("/verify-email?token=")
  })

  test("never stores the password in plaintext", async () => {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    const stored = new UserRepository(db).findByEmail("a@test.co")!.passwordHash
    expect(stored).not.toContain("correct horse")
    expect(stored).toStartWith("$argon2id$")
  })

  test("stores the verification token hashed, not raw", async () => {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    const raw = email.sent[0]!.text.match(/token=([\w-]+)/)![1]!
    const row = db.query("SELECT token_hash FROM email_tokens").get() as { token_hash: string }
    expect(row.token_hash).not.toBe(raw)
  })

  test("writes an audit entry", async () => {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    const user = new UserRepository(db).findByEmail("a@test.co")!
    const actions = new AuditRepository(db).forUser(user.id, 10).map((e) => e.action)
    expect(actions).toContain("user.registered")
  })

  test("rejects a short password", async () => {
    const res = await post("/register", { email: "a@test.co", password: "short" })
    expect(res.status).toBe(400)
    expect(new UserRepository(db).findByEmail("a@test.co")).toBeNull()
  })

  test("rejects a breached password", async () => {
    build({ breach: new AlwaysBreached() })
    const res = await post("/register", {
      email: "a@test.co",
      password: "correct horse battery staple",
    })
    expect(res.status).toBe(400)
    expect((await res.text()).toLowerCase()).toContain("data breach")
  })

  test("does not reveal that an address is already registered", async () => {
    const first = await post("/register", {
      email: "a@test.co",
      password: "correct horse battery staple",
    })
    const second = await post("/register", {
      email: "a@test.co",
      password: "a completely different passphrase",
    })
    expect(second.status).toBe(first.status)
    expect(second.headers.get("location")).toBe(first.headers.get("location"))
  })

  test("does not create a second account for a duplicate address", async () => {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    await post("/register", { email: "a@test.co", password: "a different passphrase here" })
    const count = db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number }
    expect(count.n).toBe(1)
  })

  test("does not send a second verification email for a duplicate address", async () => {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    const before = email.sent.length
    await post("/register", { email: "a@test.co", password: "a different passphrase here" })
    expect(email.sent.length).toBe(before)
  })
})

describe("GET /verify-email", () => {
  async function registerAndGetToken(): Promise<string> {
    await post("/register", { email: "a@test.co", password: "correct horse battery staple" })
    return email.sent[0]!.text.match(/token=([\w-]+)/)![1]!
  }

  test("verifies the account and signs the user in", async () => {
    const token = await registerAndGetToken()
    const res = await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    expect(res.status).toBe(303)
    expect(res.headers.getSetCookie().some((c) => c.includes("session"))).toBe(true)
    const user = new UserRepository(db).findByEmail("a@test.co")!
    expect(user.emailVerifiedAt).not.toBeNull()
  })

  test("rejects an unknown token", async () => {
    const res = await app.inject("/verify-email?token=nonsense", { redirect: "manual" })
    expect(res.status).toBe(400)
  })

  test("rejects a token used twice", async () => {
    const token = await registerAndGetToken()
    await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    const res = await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    expect(res.status).toBe(400)
  })

  test("rejects an expired token", async () => {
    const token = await registerAndGetToken()
    db.query("UPDATE email_tokens SET expires_at = '2020-01-01T00:00:00.000Z'").run()
    const res = await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    expect(res.status).toBe(400)
  })

  test("writes an audit entry", async () => {
    const token = await registerAndGetToken()
    await app.inject(`/verify-email?token=${token}`, { redirect: "manual" })
    const user = new UserRepository(db).findByEmail("a@test.co")!
    expect(new AuditRepository(db).forUser(user.id, 10).map((e) => e.action)).toContain(
      "user.email_verified",
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/routes/auth-register.test.ts`
Expected: FAIL, `/register` 404s.

- [ ] **Step 3: Implement `src/services/email.ts`**

```ts
export interface OutboundEmail {
  to: string
  subject: string
  text: string
}

export interface EmailSender {
  send(email: OutboundEmail): Promise<void>
}

/**
 * No email vendor is selected yet. Development prints to the log so the
 * verification link is reachable. Replace this with a real sender before
 * anything ships, and never log the body once you do.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(email: OutboundEmail): Promise<void> {
    console.log(
      JSON.stringify({ msg: "email_sent", to: email.to, subject: email.subject }),
    )
    console.log(email.text)
  }
}

export class CapturingEmailSender implements EmailSender {
  readonly sent: OutboundEmail[] = []
  async send(email: OutboundEmail): Promise<void> {
    this.sent.push(email)
  }
}
```

- [ ] **Step 4: Implement `src/routes/auth.ts`**

```ts
import express from "express"
import type { Config } from "../config"
import type { UserRepository } from "../db/repositories/users"
import type { SessionRepository } from "../db/repositories/sessions"
import type { AuditRepository } from "../db/repositories/audit"
import type { RateLimitRepository } from "../db/repositories/rate-limits"
import type { EmailSender } from "../services/email"
import type { BreachCheck } from "../services/breach-check"
import {
  validatePasswordPolicy,
  hashPassword,
} from "../domain/identity/password"
import { randomToken, hashToken, normalizeEmail } from "../domain/identity/tokens"
import { IdentityError } from "../domain/identity/errors"
import { rateLimit } from "../middleware/rate-limit"
import { setSessionCookie } from "../middleware/session"

export interface AuthDeps {
  users: UserRepository
  sessions: SessionRepository
  audit: AuditRepository
  limits: RateLimitRepository
  email: EmailSender
  breach: BreachCheck
  config: Config
  db: import("bun:sqlite").Database
}

const VERIFY_TTL_MS = 24 * 3600 * 1000

export function createAuthRoutes(deps: AuthDeps): express.Router {
  const router = express.Router()

  router.get("/register", (req, res) => {
    res.render("auth/register", {
      title: "Open an account | Meridian",
      description: "Create a Meridian account.",
      path: req.path,
      error: null,
      email: "",
    })
  })

  router.post(
    "/register",
    rateLimit({
      repo: deps.limits,
      audit: deps.audit,
      bucket: (req) => `register:${req.ip}`,
      capacity: 3,
      refillPerSecond: 3 / 3600,
      lockSeconds: 0,
      action: "register",
    }),
    async (req, res) => {
      const body = req.body as { email?: string; password?: string }
      const email = String(body.email ?? "").trim()
      const password = String(body.password ?? "")

      const fail = (message: string): void => {
        res.status(400).render("auth/register", {
          title: "Open an account | Meridian",
          description: "Create a Meridian account.",
          path: req.path,
          error: message,
          email,
        })
      }

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return fail("Enter a valid email address.")
      }

      try {
        validatePasswordPolicy(password)
      } catch (error) {
        return fail(
          error instanceof IdentityError
            ? "Use a password of at least 12 characters."
            : "That password cannot be used.",
        )
      }

      if (await deps.breach.isBreached(password)) {
        return fail(
          "That password has appeared in a known data breach. Choose a different one.",
        )
      }

      // The response below is identical whether or not the address is taken,
      // so registration cannot be used to enumerate accounts.
      const existing = deps.users.findByEmail(email)
      if (!existing) {
        const userId = deps.users.create(email, await hashPassword(password))

        // Spec 8.3: provision ledger accounts now rather than lazily on first
        // deposit, so Slice 2's chain callbacks always have a destination and
        // there is no create-on-write race between concurrent confirmations.
        for (const asset of deps.assets.all()) {
          deps.ledger.ensureAccount(userId, asset.symbol, "user_available")
          deps.ledger.ensureAccount(userId, asset.symbol, "user_hold")
        }

        const token = randomToken(32)
        deps.db
          .query(
            `INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at, created_at)
             VALUES (?, ?, 'verify_email', ?, ?)`,
          )
          .run(
            hashToken(token),
            userId,
            new Date(Date.now() + VERIFY_TTL_MS).toISOString(),
            new Date().toISOString(),
          )

        deps.audit.record({
          userId,
          actorType: "user",
          action: "user.registered",
          ip: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        })

        await deps.email.send({
          to: email,
          subject: "Confirm your Meridian account",
          text: [
            "Confirm your email address to finish setting up your Meridian account.",
            "",
            `${req.protocol}://${req.get("host")}/verify-email?token=${token}`,
            "",
            "This link works once and expires in 24 hours.",
            "If you did not create an account, ignore this message.",
          ].join("\n"),
        })
      }

      res.redirect(303, "/check-email")
    },
  )

  router.get("/check-email", (req, res) => {
    res.render("auth/check-email", {
      title: "Check your email | Meridian",
      description: "Confirm your email address.",
      path: req.path,
    })
  })

  router.get("/verify-email", (req, res) => {
    const token = String(req.query.token ?? "")
    const now = new Date().toISOString()

    const row = deps.db
      .query<{ user_id: number; expires_at: string; consumed_at: string | null }, [string]>(
        `SELECT user_id, expires_at, consumed_at FROM email_tokens
         WHERE token_hash = ? AND purpose = 'verify_email'`,
      )
      .get(hashToken(token))

    const invalid = (): void => {
      res.status(400).render("error", {
        title: "Link not valid | Meridian",
        description: "This verification link is not valid.",
        path: req.path,
        heading: "That link is not valid.",
        message: "It may have expired or already been used. Register again to get a new one.",
      })
    }

    if (!row || row.consumed_at || row.expires_at < now) return invalid()

    deps.db
      .query("UPDATE email_tokens SET consumed_at = ? WHERE token_hash = ?")
      .run(now, hashToken(token))
    deps.users.markEmailVerified(row.user_id)
    deps.audit.record({
      userId: row.user_id,
      actorType: "user",
      action: "user.email_verified",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })

    const sessionId = deps.sessions.create(row.user_id, {
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    setSessionCookie(res, sessionId, deps.config.env === "production")
    res.redirect(303, "/dashboard")
  })

  return router
}
```

- [ ] **Step 5: Implement the session cookie helper in `src/middleware/session.ts`**

```ts
import type { Response, RequestHandler } from "express"
import type { SessionRepository } from "../db/repositories/sessions"
import type { UserRepository, User } from "../db/repositories/users"

// The __Host- prefix requires Secure, which requires HTTPS. Local development
// is HTTP, so the prefixed name is used only where it can actually work.
export const SESSION_COOKIE_SECURE = "__Host-meridian_session"
export const SESSION_COOKIE_PLAIN = "meridian_session"

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_PLAIN
}

export function setSessionCookie(res: Response, id: string, secure: boolean): void {
  res.cookie(sessionCookieName(secure), id, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 86_400_000,
  })
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(sessionCookieName(secure), { path: "/" })
}

declare global {
  namespace Express {
    interface Request {
      user?: User
      sessionId?: string
    }
  }
}

export function sessionMiddleware(deps: {
  sessions: SessionRepository
  users: UserRepository
  secure: boolean
}): RequestHandler {
  return (req, res, next) => {
    const id = req.cookies?.[sessionCookieName(deps.secure)] as string | undefined
    if (!id) return next()

    const session = deps.sessions.find(id)
    if (!session) {
      clearSessionCookie(res, deps.secure)
      return next()
    }

    const user = deps.users.findById(session.userId)
    if (!user || user.status !== "active") {
      deps.sessions.revoke(id)
      clearSessionCookie(res, deps.secure)
      return next()
    }

    deps.sessions.touch(id)
    req.user = user
    req.sessionId = id
    res.locals.user = user
    next()
  }
}

export function requireAuth(): RequestHandler {
  return (req, res, next) => {
    if (!req.user) return res.redirect(303, "/login")
    next()
  }
}
```

- [ ] **Step 6: Write the templates**

`src/views/auth/register.pug`:

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Open an account
      h1 Create your account.
      if error
        p.form-error= error
      form(method="post" action="/register")
        input(type="hidden" name="_csrf" value=csrfToken)
        .field
          label(for="email") Email address
          input#email(type="email" name="email" value=email required autocomplete="email")
        .field
          label(for="password") Password
          input#password(type="password" name="password" required autocomplete="new-password" minlength="12")
          p.field-hint At least 12 characters. Length matters more than symbols, so a phrase you can remember beats something you cannot.
        button.btn.btn-primary(type="submit") Create account
      p Already have an account?
        |  
        a(href="/login") Sign in
```

`src/views/auth/check-email.pug`:

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Almost there
      h1 Check your email.
      p If that address does not already have an account, we have sent it a confirmation link. It works once and expires in 24 hours.
      p Nothing arrived? Check your spam folder, then try registering again.
```

`src/views/auth/login.pug`:

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Sign in
      h1 Sign in to Meridian.
      if error
        p.form-error= error
      form(method="post" action="/login")
        input(type="hidden" name="_csrf" value=csrfToken)
        .field
          label(for="email") Email address
          input#email(type="email" name="email" value=email required autocomplete="email")
        .field
          label(for="password") Password
          input#password(type="password" name="password" required autocomplete="current-password")
        button.btn.btn-primary(type="submit") Sign in
      p New here?
        |  
        a(href="/register") Open an account
```

- [ ] **Step 7: Add form styles to `public/css/app.css`**

```css
.field { margin-bottom: calc(var(--u) * 5); max-width: 420px; }
.field label {
  display: block;
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin-bottom: calc(var(--u) * 2);
}
.field input {
  width: 100%;
  height: 40px;
  padding: 0 calc(var(--u) * 3);
  background: var(--surface-2);
  border: 1px solid var(--hairline-strong);
  border-radius: 2px;
  color: var(--text);
  font: inherit;
  font-size: 0.9375rem;
}
.field input:focus { border-color: var(--accent); }
.field-hint {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin: calc(var(--u) * 2) 0 0;
}
.form-error {
  border-left: 2px solid var(--down);
  padding-left: calc(var(--u) * 3);
  color: var(--text);
  max-width: 420px;
}
```

- [ ] **Step 8: Wire the routes into `src/server.ts`**

Extend `AppDeps` with `db?`, `email?`, and `breach?`, construct the repositories once from a single shared database connection, and mount:

```ts
  app.use(sessionMiddleware({ sessions, users, secure: config.env === "production" }))
  app.use(createAuthRoutes({ users, sessions, audit, limits, email, breach, config, db }))
```

Consolidate the two database connections opened in plan 2 into this single shared instance, since identity now writes.

- [ ] **Step 9: Run the tests**

Run: `bun test tests/routes/auth-register.test.ts tests/middleware/csrf.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: registration and email verification without account enumeration"
```

---

## Task 7: Login, logout, and the TOTP challenge

**Files:**
- Modify: `src/routes/auth.ts`
- Create: `src/views/auth/totp-challenge.pug`
- Test: `tests/routes/auth-login.test.ts`

**Interfaces:**
- Consumes: Task 6
- Produces: `POST /login`, `GET /login/verify`, `POST /login/verify`, `POST /logout`

- [ ] **Step 1: Write the failing test**

Create `tests/routes/auth-login.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import * as OTPAuth from "otpauth"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { AuditRepository } from "../../src/db/repositories/audit"
import { SessionRepository } from "../../src/db/repositories/sessions"
import { hashPassword } from "../../src/domain/identity/password"
import { encryptSecret, generateTotpSecret } from "../../src/domain/identity/totp"
import type { Database } from "bun:sqlite"

const TOTP_KEY = "y".repeat(32)
const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: TOTP_KEY,
})

const PASSWORD = "correct horse battery staple"

let db: Database
let app: App
let userId: number

async function seedUser(): Promise<number> {
  const users = new UserRepository(db)
  const id = users.create("a@test.co", await hashPassword(PASSWORD))
  users.markEmailVerified(id)
  return id
}

function cookiesFrom(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
}

function tokenFrom(html: string): string {
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? ""
}

async function post(
  path: string,
  fields: Record<string, string>,
  cookie?: string,
): Promise<Response> {
  const page = await app.inject(path, cookie ? { headers: { cookie } } : undefined)
  const jar = cookie ?? cookiesFrom(page)
  return app.inject(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar },
    body: new URLSearchParams({ ...fields, _csrf: tokenFrom(await page.text()) }).toString(),
    redirect: "manual",
  })
}

beforeEach(async () => {
  db = openDatabase(":memory:")
  migrate(db)
  app = createApp(config, { db, email: new CapturingEmailSender() })
  userId = await seedUser()
})

describe("POST /login", () => {
  test("signs in with correct credentials", async () => {
    const res = await post("/login", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/dashboard")
    expect(res.headers.getSetCookie().some((c) => c.includes("session"))).toBe(true)
  })

  test("rejects a wrong password", async () => {
    const res = await post("/login", { email: "a@test.co", password: "wrong passphrase xx" })
    expect(res.status).toBe(400)
  })

  test("gives the same response for an unknown address as for a wrong password", async () => {
    const unknown = await post("/login", { email: "nobody@test.co", password: PASSWORD })
    const wrong = await post("/login", { email: "a@test.co", password: "wrong passphrase xx" })
    expect(unknown.status).toBe(wrong.status)
    expect(await unknown.text()).toBe(await wrong.text())
  })

  test("writes an audit entry on success", async () => {
    await post("/login", { email: "a@test.co", password: PASSWORD })
    expect(new AuditRepository(db).forUser(userId, 10).map((e) => e.action)).toContain(
      "user.login",
    )
  })

  test("writes an audit entry on failure", async () => {
    await post("/login", { email: "a@test.co", password: "wrong passphrase xx" })
    expect(new AuditRepository(db).forUser(userId, 10).map((e) => e.action)).toContain(
      "user.login_failed",
    )
  })

  test("locks the account after repeated failures", async () => {
    for (let i = 0; i < 6; i++) {
      await post("/login", { email: "a@test.co", password: "wrong passphrase xx" })
    }
    const res = await post("/login", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(429)
  })

  test("issues a different session id on each login", async () => {
    const first = await post("/login", { email: "a@test.co", password: PASSWORD })
    const second = await post("/login", { email: "a@test.co", password: PASSWORD })
    expect(cookiesFrom(first)).not.toBe(cookiesFrom(second))
  })

  test("sets an http-only session cookie", async () => {
    const res = await post("/login", { email: "a@test.co", password: PASSWORD })
    const cookie = res.headers.getSetCookie().find((c) => c.includes("session"))!
    expect(cookie.toLowerCase()).toContain("httponly")
    expect(cookie.toLowerCase()).toContain("samesite=lax")
  })
})

describe("login with totp enabled", () => {
  let secret: string

  beforeEach(() => {
    secret = generateTotpSecret()
    const users = new UserRepository(db)
    users.setTotpSecret(userId, encryptSecret(secret, TOTP_KEY))
    users.enableTotp(userId)
  })

  function currentToken(): string {
    return new OTPAuth.TOTP({
      issuer: "Meridian",
      label: "a@test.co",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).generate()
  }

  test("password alone does not create a full session", async () => {
    const res = await post("/login", { email: "a@test.co", password: PASSWORD })
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/login/verify")
    expect(new SessionRepository(db).listActive(userId)).toHaveLength(0)
  })

  test("a correct code completes the sign in", async () => {
    const first = await post("/login", { email: "a@test.co", password: PASSWORD })
    const res = await post("/login/verify", { token: currentToken() }, cookiesFrom(first))
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/dashboard")
    expect(new SessionRepository(db).listActive(userId)).toHaveLength(1)
  })

  test("a wrong code does not complete the sign in", async () => {
    const first = await post("/login", { email: "a@test.co", password: PASSWORD })
    const res = await post("/login/verify", { token: "000000" }, cookiesFrom(first))
    expect(res.status).toBe(400)
    expect(new SessionRepository(db).listActive(userId)).toHaveLength(0)
  })

  test("the challenge cannot be reached without passing the password step", async () => {
    const res = await post("/login/verify", { token: currentToken() })
    expect(res.status).not.toBe(303)
    expect(new SessionRepository(db).listActive(userId)).toHaveLength(0)
  })
})

describe("POST /logout", () => {
  test("revokes the session and clears the cookie", async () => {
    const login = await post("/login", { email: "a@test.co", password: PASSWORD })
    const jar = cookiesFrom(login)
    const res = await post("/logout", {}, jar)
    expect(res.status).toBe(303)
    expect(new SessionRepository(db).listActive(userId)).toHaveLength(0)
  })

  test("writes an audit entry", async () => {
    const login = await post("/login", { email: "a@test.co", password: PASSWORD })
    await post("/logout", {}, cookiesFrom(login))
    expect(new AuditRepository(db).forUser(userId, 10).map((e) => e.action)).toContain(
      "user.logout",
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/routes/auth-login.test.ts`
Expected: FAIL, `POST /login` does not exist.

- [ ] **Step 3: Add the login routes to `src/routes/auth.ts`**

Key design points, all of which the tests above check:

- The pending-2FA state is a short-lived signed cookie holding only the user id and an expiry, not a session row. No session exists until the second factor passes.
- A failed login and an unknown address render the identical response body.
- Both outcomes write an audit row; the failure row is attached to the user when one exists.
- Rate limiting is keyed on the normalized email as well as the IP, so an attacker cannot rotate IPs to keep guessing one account.

```ts
  const pendingCookie = "meridian_pending_2fa"

  router.post(
    "/login",
    rateLimit({
      repo: deps.limits,
      audit: deps.audit,
      bucket: (req) => `login:${normalizeEmail(String((req.body as { email?: string }).email ?? ""))}`,
      capacity: 5,
      refillPerSecond: 5 / 900,
      lockSeconds: 900,
      action: "login",
    }),
    async (req, res) => {
      const body = req.body as { email?: string; password?: string }
      const email = String(body.email ?? "").trim()
      const password = String(body.password ?? "")

      const reject = (): void => {
        res.status(400).render("auth/login", {
          title: "Sign in | Meridian",
          description: "Sign in to Meridian.",
          path: "/login",
          error: "Those details do not match an account.",
          email: "",
        })
      }

      const user = deps.users.findByEmail(email)
      // Hash a throwaway value when the account is unknown so the response
      // time does not reveal whether the address exists.
      const hash = user?.passwordHash ?? (await hashPassword("absent-account-placeholder"))
      const ok = await verifyPassword(password, hash)

      if (!user || !ok) {
        deps.audit.record({
          userId: user?.id ?? null,
          actorType: "user",
          action: "user.login_failed",
          ip: req.ip ?? null,
          userAgent: req.get("user-agent") ?? null,
        })
        return reject()
      }

      if (needsRehash(user.passwordHash)) {
        deps.users.setPasswordHash(user.id, await hashPassword(password))
      }

      if (user.totpEnabledAt) {
        res.cookie(pendingCookie, signPending(user.id, deps.config.sessionSecret), {
          httpOnly: true,
          secure: deps.config.env === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 5 * 60_000,
        })
        return res.redirect(303, "/login/verify")
      }

      completeLogin(req, res, deps, user.id, { twoFactor: false })
    },
  )
```

Implement `signPending`, `readPending`, and `completeLogin` as module-level helpers in the same file:

```ts
import { createHmac, timingSafeEqual } from "node:crypto"

function signPending(userId: number, secret: string): string {
  const payload = `${userId}.${Date.now() + 5 * 60_000}`
  const mac = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${mac}`
}

function readPending(value: string | undefined, secret: string): number | null {
  if (!value) return null
  const parts = value.split(".")
  if (parts.length !== 3) return null
  const [id, expiry, mac] = parts as [string, string, string]
  const expected = createHmac("sha256", secret).update(`${id}.${expiry}`).digest("base64url")
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(expiry) < Date.now()) return null
  return Number(id)
}

function completeLogin(
  req: express.Request,
  res: express.Response,
  deps: AuthDeps,
  userId: number,
  meta: { twoFactor: boolean },
): void {
  const sessionId = deps.sessions.create(userId, {
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  })
  deps.audit.record({
    userId,
    actorType: "user",
    action: "user.login",
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    metadata: meta,
  })
  res.clearCookie("meridian_pending_2fa", { path: "/" })
  setSessionCookie(res, sessionId, deps.config.env === "production")
  res.redirect(303, "/dashboard")
}
```

Then the challenge and logout routes:

```ts
  router.get("/login/verify", (req, res) => {
    if (!readPending(req.cookies?.[pendingCookie], deps.config.sessionSecret)) {
      return res.redirect(303, "/login")
    }
    res.render("auth/totp-challenge", {
      title: "Two-factor code | Meridian",
      description: "Enter your authentication code.",
      path: req.path,
      error: null,
    })
  })

  router.post("/login/verify", (req, res) => {
    const userId = readPending(req.cookies?.[pendingCookie], deps.config.sessionSecret)
    if (!userId) return res.redirect(303, "/login")

    const encrypted = deps.users.getTotpSecret(userId)
    const token = String((req.body as { token?: string }).token ?? "")
    const valid =
      encrypted !== null &&
      verifyTotp(decryptSecret(encrypted, deps.config.totpEncryptionKey), token)

    if (!valid) {
      deps.audit.record({
        userId,
        actorType: "user",
        action: "user.totp_failed",
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      })
      return res.status(400).render("auth/totp-challenge", {
        title: "Two-factor code | Meridian",
        description: "Enter your authentication code.",
        path: "/login/verify",
        error: "That code is not right. Codes change every 30 seconds.",
      })
    }

    completeLogin(req, res, deps, userId, { twoFactor: true })
  })

  router.post("/logout", (req, res) => {
    if (req.sessionId) {
      deps.sessions.revoke(req.sessionId)
      deps.audit.record({
        userId: req.user?.id ?? null,
        actorType: "user",
        action: "user.logout",
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
      })
    }
    clearSessionCookie(res, deps.config.env === "production")
    res.redirect(303, "/")
  })
```

Add the imports this needs at the top of the file: `verifyPassword`, `needsRehash` from `../domain/identity/password`, and `verifyTotp`, `decryptSecret` from `../domain/identity/totp`.

- [ ] **Step 4: Write `src/views/auth/totp-challenge.pug`**

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Two-factor
      h1 Enter your code.
      p Open your authenticator app and enter the six digit code for Meridian.
      if error
        p.form-error= error
      form(method="post" action="/login/verify")
        input(type="hidden" name="_csrf" value=csrfToken)
        .field
          label(for="token") Authentication code
          input#token(type="text" name="token" required autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]*" autofocus)
        button.btn.btn-primary(type="submit") Verify
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/routes/auth-login.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: login with totp second factor and session revocation on logout"
```

---

## Task 8: Account security page

**Files:**
- Create: `src/routes/account.ts`
- Create: `src/views/account/security.pug`, `src/views/account/totp-setup.pug`, `src/views/account/recovery-codes.pug`, `src/views/account/activity.pug`
- Create: `src/db/migrations/0005-recovery-codes.sql`
- Modify: `src/server.ts`
- Test: `tests/routes/account-security.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 7
- Produces: `GET /account/security`, `POST /account/password`, `GET|POST /account/2fa`, `POST /account/2fa/disable`, `POST /account/sessions/:id/revoke`, `GET /account/activity`

- [ ] **Step 1: Write `src/db/migrations/0005-recovery-codes.sql`**

```sql
CREATE TABLE recovery_codes (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  code_hash  TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_recovery_user ON recovery_codes(user_id) WHERE used_at IS NULL;
```

- [ ] **Step 2: Write the failing test**

Create `tests/routes/account-security.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import { createApp, type App } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CapturingEmailSender } from "../../src/services/email"
import { openDatabase, migrate } from "../../src/db"
import { UserRepository } from "../../src/db/repositories/users"
import { SessionRepository } from "../../src/db/repositories/sessions"
import { AuditRepository } from "../../src/db/repositories/audit"
import { hashPassword, verifyPassword } from "../../src/domain/identity/password"
import type { Database } from "bun:sqlite"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const PASSWORD = "correct horse battery staple"

let db: Database
let app: App
let userId: number
let jar: string

function cookiesFrom(res: Response): string {
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
}
function tokenFrom(html: string): string {
  return html.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? ""
}
async function post(
  path: string,
  fields: Record<string, string>,
  cookie: string,
): Promise<Response> {
  const page = await app.inject(path.split("?")[0]!, { headers: { cookie } })
  return app.inject(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ ...fields, _csrf: tokenFrom(await page.text()) }).toString(),
    redirect: "manual",
  })
}

beforeEach(async () => {
  db = openDatabase(":memory:")
  migrate(db)
  app = createApp(config, { db, email: new CapturingEmailSender() })
  const users = new UserRepository(db)
  userId = users.create("a@test.co", await hashPassword(PASSWORD))
  users.markEmailVerified(userId)

  const page = await app.inject("/login")
  const res = await app.inject("/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookiesFrom(page),
    },
    body: new URLSearchParams({
      email: "a@test.co",
      password: PASSWORD,
      _csrf: tokenFrom(await page.text()),
    }).toString(),
    redirect: "manual",
  })
  jar = cookiesFrom(res)
})

describe("access control", () => {
  test("redirects an anonymous visitor to sign in", async () => {
    const res = await app.inject("/account/security", { redirect: "manual" })
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe("/login")
  })

  test("renders for a signed-in user", async () => {
    const res = await app.inject("/account/security", { headers: { cookie: jar } })
    expect(res.status).toBe(200)
  })
})

describe("session list", () => {
  test("shows the current session", async () => {
    const html = await (
      await app.inject("/account/security", { headers: { cookie: jar } })
    ).text()
    expect(html.toLowerCase()).toContain("session")
  })

  test("never renders a session identifier", async () => {
    const sessionId = new SessionRepository(db).listActive(userId)[0]!.id
    const html = await (
      await app.inject("/account/security", { headers: { cookie: jar } })
    ).text()
    expect(html).not.toContain(sessionId)
  })

  test("revokes every other session", async () => {
    new SessionRepository(db).create(userId, { ip: null, userAgent: null })
    expect(new SessionRepository(db).listActive(userId).length).toBe(2)
    const res = await post("/account/sessions/revoke-others", {}, jar)
    expect(res.status).toBe(303)
    expect(new SessionRepository(db).listActive(userId)).toHaveLength(1)
  })
})

describe("password change", () => {
  test("changes the password when the current one is correct", async () => {
    const res = await post(
      "/account/password",
      { current: PASSWORD, next: "an entirely different passphrase" },
      jar,
    )
    expect(res.status).toBe(303)
    const stored = new UserRepository(db).findByEmail("a@test.co")!.passwordHash
    expect(await verifyPassword("an entirely different passphrase", stored)).toBe(true)
  })

  test("rejects a wrong current password", async () => {
    const res = await post(
      "/account/password",
      { current: "not the password", next: "an entirely different passphrase" },
      jar,
    )
    expect(res.status).toBe(400)
    const stored = new UserRepository(db).findByEmail("a@test.co")!.passwordHash
    expect(await verifyPassword(PASSWORD, stored)).toBe(true)
  })

  test("rejects a new password that fails the policy", async () => {
    const res = await post("/account/password", { current: PASSWORD, next: "short" }, jar)
    expect(res.status).toBe(400)
  })

  test("revokes other sessions on success", async () => {
    new SessionRepository(db).create(userId, { ip: null, userAgent: null })
    await post(
      "/account/password",
      { current: PASSWORD, next: "an entirely different passphrase" },
      jar,
    )
    expect(new SessionRepository(db).listActive(userId)).toHaveLength(1)
  })

  test("writes an audit entry", async () => {
    await post(
      "/account/password",
      { current: PASSWORD, next: "an entirely different passphrase" },
      jar,
    )
    expect(new AuditRepository(db).forUser(userId, 20).map((e) => e.action)).toContain(
      "user.password_changed",
    )
  })
})

describe("two-factor enrolment", () => {
  test("shows a secret and a provisioning uri", async () => {
    const html = await (
      await app.inject("/account/2fa", { headers: { cookie: jar } })
    ).text()
    expect(html).toContain("otpauth://totp/")
  })

  test("rejects enrolment with a wrong code", async () => {
    const res = await post("/account/2fa", { token: "000000" }, jar)
    expect(res.status).toBe(400)
    expect(new UserRepository(db).findById(userId)!.totpEnabledAt).toBeNull()
  })
})

describe("activity log", () => {
  test("shows the user's own events", async () => {
    const html = await (
      await app.inject("/account/activity", { headers: { cookie: jar } })
    ).text()
    expect(html.toLowerCase()).toContain("signed in")
  })

  test("does not show another user's events", async () => {
    const other = new UserRepository(db).create("b@test.co", await hashPassword(PASSWORD))
    new AuditRepository(db).record({
      userId: other,
      actorType: "user",
      action: "user.login",
      ip: "198.51.100.9",
    })
    const html = await (
      await app.inject("/account/activity", { headers: { cookie: jar } })
    ).text()
    expect(html).not.toContain("198.51.100.9")
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/routes/account-security.test.ts`
Expected: FAIL, `/account/security` 404s.

- [ ] **Step 4: Implement `src/routes/account.ts`**

```ts
import express from "express"
import { createHmac, timingSafeEqual } from "node:crypto"
import type { Database } from "bun:sqlite"
import type { Config } from "../config"
import type { UserRepository } from "../db/repositories/users"
import type { SessionRepository } from "../db/repositories/sessions"
import type { AuditRepository } from "../db/repositories/audit"
import {
  validatePasswordPolicy,
  hashPassword,
  verifyPassword,
} from "../domain/identity/password"
import {
  generateTotpSecret,
  totpUri,
  verifyTotp,
  encryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
} from "../domain/identity/totp"
import { IdentityError } from "../domain/identity/errors"
import { requireAuth, setSessionCookie } from "../middleware/session"

export interface AccountDeps {
  users: UserRepository
  sessions: SessionRepository
  audit: AuditRepository
  config: Config
  db: Database
}

const ACTION_LABELS: Record<string, string> = {
  "user.registered": "Account created",
  "user.email_verified": "Email address confirmed",
  "user.login": "Signed in",
  "user.login_failed": "Failed sign in attempt",
  "user.logout": "Signed out",
  "user.password_changed": "Password changed",
  "user.totp_enabled": "Two-factor authentication turned on",
  "user.totp_disabled": "Two-factor authentication turned off",
  "user.totp_failed": "Failed two-factor code",
  "user.sessions_revoked": "Signed out of other devices",
}

const ENROL_COOKIE = "meridian_totp_enrol"

// The candidate secret lives in a signed short-lived cookie, never in the user
// row, so an abandoned enrolment cannot leave a usable secret behind.
function signEnrolment(secret: string, key: string): string {
  const payload = `${secret}.${Date.now() + 10 * 60_000}`
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`
}

function readEnrolment(value: string | undefined, key: string): string | null {
  if (!value) return null
  const parts = value.split(".")
  if (parts.length !== 3) return null
  const [secret, expiry, mac] = parts as [string, string, string]
  const expected = createHmac("sha256", key).update(`${secret}.${expiry}`).digest("base64url")
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (Number(expiry) < Date.now()) return null
  return secret
}

function describeSession(
  session: { ip: string | null; userAgent: string | null; lastSeenAt: string; createdAt: string },
  current: boolean,
): { label: string; ip: string; lastSeen: string; current: boolean } {
  const agent = session.userAgent ?? ""
  let label = "Unknown device"
  if (/firefox/i.test(agent)) label = "Firefox"
  else if (/edg/i.test(agent)) label = "Edge"
  else if (/chrome/i.test(agent)) label = "Chrome"
  else if (/safari/i.test(agent)) label = "Safari"
  return {
    label,
    ip: session.ip ?? "unknown",
    lastSeen: session.lastSeenAt,
    current,
  }
}

export function createAccountRoutes(deps: AccountDeps): express.Router {
  const router = express.Router()
  router.use("/account", requireAuth())

  const secure = deps.config.env === "production"

  function renderSecurity(
    req: express.Request,
    res: express.Response,
    status: number,
    error: string | null,
  ): void {
    const user = req.user!
    res.status(status).render("account/security", {
      title: "Security | Meridian",
      description: "Manage your password, two-factor authentication, and sessions.",
      path: "/account/security",
      error,
      totpEnabled: user.totpEnabledAt !== null,
      sessions: deps.sessions
        .listActive(user.id)
        .map((s) => describeSession(s, s.id === req.sessionId)),
    })
  }

  router.get("/account/security", (req, res) => renderSecurity(req, res, 200, null))

  router.post("/account/password", async (req, res) => {
    const user = req.user!
    const body = req.body as { current?: string; next?: string }
    const stored = deps.users.findByEmail(user.email)!

    if (!(await verifyPassword(String(body.current ?? ""), stored.passwordHash))) {
      return renderSecurity(req, res, 400, "That is not your current password.")
    }

    const next = String(body.next ?? "")
    try {
      validatePasswordPolicy(next)
    } catch (error) {
      return renderSecurity(
        req,
        res,
        400,
        error instanceof IdentityError
          ? "Use a new password of at least 12 characters."
          : "That password cannot be used.",
      )
    }

    deps.users.setPasswordHash(user.id, await hashPassword(next))
    deps.sessions.revokeAllFor(user.id)
    deps.audit.record({
      userId: user.id,
      actorType: "user",
      action: "user.password_changed",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })

    // A password change is a privilege change, so the session identifier
    // rotates rather than surviving.
    const fresh = deps.sessions.create(user.id, {
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    setSessionCookie(res, fresh, secure)
    res.redirect(303, "/account/security")
  })

  router.get("/account/2fa", (req, res) => {
    const user = req.user!
    const secret = generateTotpSecret()
    res.cookie(ENROL_COOKIE, signEnrolment(secret, deps.config.sessionSecret), {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60_000,
    })
    res.render("account/totp-setup", {
      title: "Two-factor authentication | Meridian",
      description: "Turn on two-factor authentication.",
      path: req.path,
      error: null,
      secret,
      uri: totpUri(secret, user.email),
    })
  })

  router.post("/account/2fa", async (req, res) => {
    const user = req.user!
    const secret = readEnrolment(req.cookies?.[ENROL_COOKIE], deps.config.sessionSecret)
    const token = String((req.body as { token?: string }).token ?? "")

    if (!secret || !verifyTotp(secret, token)) {
      const replacement = secret ?? generateTotpSecret()
      return res.status(400).render("account/totp-setup", {
        title: "Two-factor authentication | Meridian",
        description: "Turn on two-factor authentication.",
        path: "/account/2fa",
        error: "That code is not right. Codes change every 30 seconds.",
        secret: replacement,
        uri: totpUri(replacement, user.email),
      })
    }

    deps.users.setTotpSecret(user.id, encryptSecret(secret, deps.config.totpEncryptionKey))
    deps.users.enableTotp(user.id)
    res.clearCookie(ENROL_COOKIE, { path: "/" })

    const codes = generateRecoveryCodes()
    const now = new Date().toISOString()
    for (const code of codes) {
      deps.db
        .query(
          "INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)",
        )
        .run(user.id, await hashRecoveryCode(code), now)
    }

    deps.audit.record({
      userId: user.id,
      actorType: "user",
      action: "user.totp_enabled",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })

    // Shown once. We store only hashes, so we cannot show them again.
    res.render("account/recovery-codes", {
      title: "Recovery codes | Meridian",
      description: "Save your recovery codes.",
      path: "/account/2fa",
      codes,
    })
  })

  router.post("/account/2fa/disable", (req, res) => {
    const user = req.user!
    deps.users.disableTotp(user.id)
    deps.db.query("DELETE FROM recovery_codes WHERE user_id = ?").run(user.id)
    deps.audit.record({
      userId: user.id,
      actorType: "user",
      action: "user.totp_disabled",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    res.redirect(303, "/account/security")
  })

  router.post("/account/sessions/revoke-others", (req, res) => {
    const user = req.user!
    const current = req.sessionId
    for (const session of deps.sessions.listActive(user.id)) {
      if (session.id !== current) deps.sessions.revoke(session.id)
    }
    deps.audit.record({
      userId: user.id,
      actorType: "user",
      action: "user.sessions_revoked",
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    })
    res.redirect(303, "/account/security")
  })

  router.get("/account/activity", (req, res) => {
    const user = req.user!
    res.render("account/activity", {
      title: "Activity | Meridian",
      description: "Recent activity on your account.",
      path: req.path,
      entries: deps.audit.forUser(user.id, 100).map((entry) => ({
        label: ACTION_LABELS[entry.action] ?? entry.action,
        ip: entry.ip ?? "unknown",
        at: entry.createdAt,
      })),
    })
  })

  return router
}
```

Templates. `src/views/account/security.pug`:

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Account
      h1 Security.
      if error
        p.form-error= error

    .section
      h2 Password
      form(method="post" action="/account/password")
        input(type="hidden" name="_csrf" value=csrfToken)
        .field
          label(for="current") Current password
          input#current(type="password" name="current" required autocomplete="current-password")
        .field
          label(for="next") New password
          input#next(type="password" name="next" required autocomplete="new-password" minlength="12")
        button.btn(type="submit") Change password
      p.field-hint Changing your password signs you out everywhere else.

    .section
      h2 Two-factor authentication
      if totpEnabled
        p Two-factor authentication is on. It will be required before any withdrawal.
        form(method="post" action="/account/2fa/disable")
          input(type="hidden" name="_csrf" value=csrfToken)
          button.btn(type="submit") Turn off
      else
        p Two-factor authentication is off. Turn it on now: it will be required before any withdrawal.
        a.btn.btn-primary(href="/account/2fa") Turn on

    .section
      h2 Where you are signed in
      .table-scroll
        table.table
          thead
            tr
              th Device
              th IP address
              th Last active
          tbody
            each session in sessions
              tr
                td
                  = session.label
                  if session.current
                    |  (this device)
                td.num= session.ip
                td.num= session.lastSeen
      form(method="post" action="/account/sessions/revoke-others")
        input(type="hidden" name="_csrf" value=csrfToken)
        button.btn(type="submit") Sign out of other devices
```

`src/views/account/totp-setup.pug`:

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Two-factor
      h1 Turn on two-factor authentication.
      p Add this key to an authenticator app, then enter the code it shows. Use an app rather than SMS: SIM swap fraud is common and effective.
      if error
        p.form-error= error
      p.num= secret
      p.field-hint= uri
      form(method="post" action="/account/2fa")
        input(type="hidden" name="_csrf" value=csrfToken)
        .field
          label(for="token") Code from your app
          input#token(type="text" name="token" required inputmode="numeric" autocomplete="one-time-code" autofocus)
        button.btn.btn-primary(type="submit") Turn on
```

`src/views/account/recovery-codes.pug`:

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Two-factor
      h1 Save your recovery codes.
      p These get you back in if you lose your phone. Each one works once. Store them somewhere you can reach without your phone.
      p
        strong This is the only time we can show them.
        |  We store them hashed, so we cannot display them again.
      ul.codes
        each code in codes
          li.num= code
      a.btn.btn-primary(href="/account/security") I have saved them
```

`src/views/account/activity.pug`:

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Account
      h1 Activity.
      p Every sign in and security change on your account. If something here was not you, change your password and turn on two-factor authentication.
      .table-scroll
        table.table
          thead
            tr
              th Event
              th IP address
              th When
          tbody
            each entry in entries
              tr
                td= entry.label
                td.num= entry.ip
                td.num= entry.at
```

Add to `public/css/app.css`:

```css
.codes { list-style: none; margin: 0 0 calc(var(--u) * 6); padding: 0; }
.codes li {
  padding: calc(var(--u) * 2) 0;
  border-bottom: 1px solid var(--hairline);
  letter-spacing: 0.1em;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/routes/account-security.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: account security page with 2fa enrolment, password change, and session revocation"
```

---

## Task 9: Dashboard shell and security regression suite

**Files:**
- Create: `src/views/app/dashboard.pug`
- Modify: `src/routes/account.ts`
- Test: `tests/security.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: `GET /dashboard` behind `requireAuth()`

- [ ] **Step 1: Write the failing security suite**

Create `tests/security.test.ts`. This is the file that fails loudly if a later change quietly weakens the system.

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createApp, type App } from "../src/server"
import { loadConfig } from "../src/config"
import { CapturingEmailSender } from "../src/services/email"
import { openDatabase, migrate } from "../src/db"
import { UserRepository } from "../src/db/repositories/users"
import { hashPassword } from "../src/domain/identity/password"
import type { Database } from "bun:sqlite"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const PROTECTED = ["/dashboard", "/account/security", "/account/activity", "/account/2fa"]
const STATE_CHANGING = [
  "/register",
  "/login",
  "/logout",
  "/account/password",
  "/account/2fa",
  "/account/sessions/revoke-others",
]

let db: Database
let app: App

beforeEach(() => {
  db = openDatabase(":memory:")
  migrate(db)
  app = createApp(config, { db, email: new CapturingEmailSender() })
})

describe("every protected route requires authentication", () => {
  for (const route of PROTECTED) {
    test(`${route} redirects an anonymous visitor`, async () => {
      const res = await app.inject(route, { redirect: "manual" })
      expect(`${route}: ${res.status}`).toBe(`${route}: 303`)
      expect(res.headers.get("location")).toBe("/login")
    })
  }
})

describe("every state-changing route requires a csrf token", () => {
  for (const route of STATE_CHANGING) {
    test(`${route} rejects a POST with no token`, async () => {
      const res = await app.inject(route, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
        redirect: "manual",
      })
      expect(`${route}: ${res.status}`).toBe(`${route}: 403`)
    })
  }
})

describe("secrets never reach the client", () => {
  test("no rendered page contains a password hash", async () => {
    const users = new UserRepository(db)
    const id = users.create("a@test.co", await hashPassword("correct horse battery staple"))
    users.markEmailVerified(id)
    for (const route of ["/", "/login", "/register", "/markets"]) {
      const html = await (await app.inject(route)).text()
      expect(`${route}`).toBe(`${route}`)
      expect(html).not.toContain("$argon2id$")
    }
  })

  test("the session cookie is http-only and not readable by script", async () => {
    const users = new UserRepository(db)
    const id = users.create("a@test.co", await hashPassword("correct horse battery staple"))
    users.markEmailVerified(id)

    const page = await app.inject("/login")
    const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)![1]!
    const cookie = page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
    const res = await app.inject("/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      body: new URLSearchParams({
        email: "a@test.co",
        password: "correct horse battery staple",
        _csrf: csrf,
      }).toString(),
      redirect: "manual",
    })
    const session = res.headers.getSetCookie().find((c) => c.includes("session"))!
    expect(session.toLowerCase()).toContain("httponly")
  })
})

describe("source-level guarantees", () => {
  function filesUnder(dir: string, ext: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...filesUnder(full, ext))
      else if (entry.name.endsWith(ext)) out.push(full)
    }
    return out
  }

  test("no template renders a totp secret or session id from the user record", () => {
    for (const path of filesUnder("src/views", ".pug")) {
      const text = readFileSync(path, "utf8")
      expect(`${path}`).toBe(`${path}`)
      expect(text).not.toContain("totpSecretEncrypted")
      expect(text).not.toContain("passwordHash")
      expect(text).not.toContain("session.id")
    }
  })

  test("no source file logs a password, token, or secret variable", () => {
    for (const path of filesUnder("src", ".ts")) {
      const text = readFileSync(path, "utf8")
      const logs = text.match(/console\.(log|error|warn)\([^)]*\)/g) ?? []
      for (const line of logs) {
        expect(`${path}: ${line}`).not.toMatch(/\b(password|passwordHash|secret|token)\b/)
      }
    }
  })

  test("domain code imports neither express nor bun:sqlite", () => {
    for (const path of filesUnder("src/domain", ".ts")) {
      const text = readFileSync(path, "utf8")
      expect(`${path}`).toBe(`${path}`)
      expect(text).not.toMatch(/from "express"/)
      expect(text).not.toMatch(/from "bun:sqlite"/)
    }
  })
})
```

Note on the last check: `src/domain/identity/totp.ts` calls `Bun.password`, which is a global, not an import, so it does not violate the rule. If a domain file ever needs a database, that is a design error, not a reason to relax the test.

- [ ] **Step 2: Run it, then implement `/dashboard` until it passes**

Run: `bun test tests/security.test.ts`

Add the dashboard route behind `requireAuth()` and `src/views/app/dashboard.pug`:

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Portfolio
      h1 Your account.
      p Your balances appear here once deposits are enabled. Nothing is live yet, so every balance below is zero.
      p
        a(href="/account/security") Account security

    .section
      h2 Balances
      .table-scroll
        table.table
          thead
            tr
              th Asset
              th Network
              th.n Available
          tbody
            each row in balances
              tr
                td
                  strong= row.name
                  |  
                  span.num-frac= row.displaySymbol
                td= row.networkLabel
                td.n.num= row.available
```

- [ ] **Step 3: Run the whole suite**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors. The accessibility suite from plan 2 must still report zero violations; add the new routes to its route list and fix any violation the new forms introduce, most likely a missing label association.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: dashboard shell and a security regression suite"
```

---

## Plan 3 definition of done

1. `bun test` passes, `bun run typecheck` reports no errors.
2. A user can register, receive a verification link, verify, sign in, enrol TOTP, sign in with a code, view their sessions, revoke other sessions, change their password, and read their own activity log.
3. Registration, login, and password reset reveal nothing about whether an address exists, verified by tests comparing status and body.
4. Every protected route redirects an anonymous visitor; every state-changing route rejects a POST with no CSRF token. Both are asserted route by route.
5. Repeated failed logins lock the account, write an audit row, and survive a process restart.
6. Passwords are Argon2id, TOTP secrets are AES-256-GCM encrypted at rest, email tokens are stored hashed, and recovery codes are Argon2id hashed.
7. No rendered page contains a password hash, session id, or TOTP secret, asserted by test.
8. `src/domain/` imports neither Express nor `bun:sqlite`, asserted by test.
9. The audit log rejects UPDATE and DELETE, and every auth event writes to it.
10. Accessibility remains at zero axe violations across all routes, now including the auth and account pages.

## What this plan does not build

Deferred to plan 4 (KYC and dashboard): the `KycProvider` interface and its sandbox implementation, the five-step verification wizard, KYC tiers and limits, and real balances on the dashboard.

Deferred and explicitly tracked from plan 2: the command palette, the keyboard map, skeleton loading states, toasts, and splitting `formatUsd` so the fractional part can render muted. The dashboard is the first screen that justifies them, so they belong with plan 4.

Not in scope at all yet: a real email vendor. `ConsoleEmailSender` prints the verification link to the log. Selecting a sender and removing the body from the log is a launch blocker, tracked in spec §12.
