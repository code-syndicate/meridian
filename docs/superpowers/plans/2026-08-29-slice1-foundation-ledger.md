# Meridian Slice 1, Plan 1: Foundation and Ledger Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server foundation, database layer, and a correct, append-only, double-entry ledger that later subsystems post value movements through.

**Architecture:** An Express 5 application on Bun, serving Pug, with SQLite as the store. All SQL is confined to `src/db/repositories/`. All business logic lives in `src/domain/` as pure functions over plain objects, with no Express and no SQL, which is what makes the ledger exhaustively unit-testable and the eventual Postgres migration tractable. The ledger is a classic double-entry journal: an immutable transaction table, an immutable signed-entry table, and a materialized balance cache maintained inside the same write transaction as the posting.

**Tech Stack:** Bun, Express 5, Pug, `bun:sqlite`, `bun:test`, Helmet.

**Spec:** `docs/superpowers/specs/2026-08-29-meridian-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Package manager and runtime is Bun.** `bun install`, `bun run`, `bunx`. Never npm, yarn, or pnpm.
- **No floating point for any monetary value, in any layer, ever.** No `number` arithmetic on amounts, no `parseFloat`, no `toFixed` on a money value.
- **All money is `bigint` in application code and `INTEGER` in SQLite**, counted in base units where 1 unit = 10^-8 of an asset. Internal precision is fixed at 8 decimal places for every asset.
- **No SQL outside `src/db/repositories/`.** Route handlers and domain modules never see a query.
- **`src/domain/` imports neither Express nor `bun:sqlite`.** Pure logic over plain objects.
- **`ledger_transactions` and `ledger_entries` are append-only**, enforced by SQLite triggers. Corrections are new opposing transactions, never edits.
- **SQLite pragmas on every connection:** `journal_mode = WAL` (skipped for `:memory:`), `synchronous = FULL`, `foreign_keys = ON`, `busy_timeout = 5000`.
- **CSP contains no `unsafe-inline` and no `unsafe-eval`.** No inline `<style>` blocks, no `style=` attributes, no inline `<script>`.
- **TDD without exception in this plan.** The ledger is where bugs are unrecoverable. Test first, always.
- **Git identity in this repo is `timileyindev <timmypelumy@gmail.com>`.** Already configured; do not change it.
- **Copy voice:** plain and direct. No em dashes, no marketing inflation.

## Spec deltas introduced by this plan

Three corrections to the spec, applied in the spec's revision log:

1. `assets.symbol` cannot be the bare ticker, because USDT exists on Ethereum, Tron, and BNB Chain as three distinct assets. The primary key becomes a qualified symbol (`USDT_TRC20`), with new `display_symbol` and `network_label` columns for presentation.
2. Display rounding is split by intent. Balances round **down**, so the interface never shows a user more than they hold. Prices round **half-even**. The spec said half-even for both.
3. `toNative` can lose precision when an asset's native precision is below our internal 8 (USDT is 6). Withdrawal amounts must be validated as exactly representable at native precision before a hold is placed. The conversion function throws rather than truncating silently.
4. The spec's `Ledger` interface (§7.7) returns promises. `bun:sqlite` is synchronous, so the implemented methods are synchronous. The signatures are otherwise unchanged. Callers in later plans must not `await` them.

**Nested transactions.** `hold()` and `closeHold()` call `post()` and `ensureAccount()`, each of which opens its own `db.transaction()`. This is deliberate and correct: `bun:sqlite` implements nested `transaction()` calls with `SAVEPOINT`, so the inner calls join the outer transaction and the whole hold operation commits or rolls back as one unit. Do not "flatten" these into a single transaction, and do not extract non-transactional variants of `post`. If a nested call ever needs to fail independently, that is a design change, not a refactor.

---

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json` | Dependencies, scripts, TS config |
| `src/config.ts` | Environment parsing and validation. Fails fast. |
| `src/server.ts` | App construction, middleware chain, security headers |
| `src/db/index.ts` | Connection, pragmas, migration runner |
| `src/db/migrations/*.sql` | Numbered schema migrations |
| `src/db/repositories/assets.ts` | Asset registry queries |
| `src/db/repositories/ledger.ts` | The only module that writes the journal |
| `src/domain/money.ts` | Base-unit conversion, parsing, formatting. Pure. |
| `src/domain/ledger/validate.ts` | Posting rules and invariants. Pure. |
| `src/domain/ledger/types.ts` | Shared ledger types |
| `scripts/verify-ledger.ts` | Reconciliation command |
| `tests/**` | Mirrors `src/` |

---

## Task 1: Project scaffold, config, and a server with enforced CSP

**Files:**
- Create: `package.json`, `tsconfig.json`, `.env.example`
- Create: `src/config.ts`
- Create: `src/server.ts`
- Create: `src/index.ts`
- Test: `tests/config.test.ts`, `tests/server.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `loadConfig(source?: Record<string, string | undefined>): Config`
  - `interface Config { env: "development" | "test" | "production"; port: number; databasePath: string; sessionSecret: string; totpEncryptionKey: string }`
  - `createApp(config: Config): express.Express`

- [ ] **Step 1: Initialize the project and install dependencies**

```bash
cd /home/timileyin/dev/personal/meridian
bun init -y
bun add express@^5.1.0 pug@^3.0.3 helmet@^8.0.0
bun add -d @types/express@^5.0.0 @types/bun
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 3: Write the failing config test**

Create `tests/config.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { loadConfig } from "../src/config"

const valid = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_PATH: "./data/meridian.db",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
}

describe("loadConfig", () => {
  test("parses a complete environment", () => {
    const config = loadConfig(valid)
    expect(config.env).toBe("test")
    expect(config.port).toBe(3000)
    expect(config.databasePath).toBe("./data/meridian.db")
  })

  test("throws naming every missing variable at once", () => {
    const { SESSION_SECRET, TOTP_ENCRYPTION_KEY, ...rest } = valid
    expect(() => loadConfig(rest)).toThrow(
      /SESSION_SECRET.*TOTP_ENCRYPTION_KEY|TOTP_ENCRYPTION_KEY.*SESSION_SECRET/,
    )
  })

  test("rejects a session secret under 32 characters", () => {
    expect(() => loadConfig({ ...valid, SESSION_SECRET: "short" })).toThrow(
      /at least 32 characters/,
    )
  })

  test("rejects a non-numeric port", () => {
    expect(() => loadConfig({ ...valid, PORT: "not-a-port" })).toThrow(/PORT/)
  })

  test("defaults port to 3000 when absent", () => {
    const { PORT, ...rest } = valid
    expect(loadConfig(rest).port).toBe(3000)
  })

  test("rejects an unknown NODE_ENV", () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: "staging" })).toThrow(/NODE_ENV/)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun test tests/config.test.ts`
Expected: FAIL, cannot resolve `../src/config`.

- [ ] **Step 5: Implement `src/config.ts`**

```ts
export interface Config {
  env: "development" | "test" | "production"
  port: number
  databasePath: string
  sessionSecret: string
  totpEncryptionKey: string
}

const ENVIRONMENTS = ["development", "test", "production"] as const
const REQUIRED = ["DATABASE_PATH", "SESSION_SECRET", "TOTP_ENCRYPTION_KEY"] as const

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): Config {
  const missing = REQUIRED.filter((key) => !source[key])
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
  }

  const env = source.NODE_ENV ?? "development"
  if (!ENVIRONMENTS.includes(env as (typeof ENVIRONMENTS)[number])) {
    throw new Error(`NODE_ENV must be one of ${ENVIRONMENTS.join(", ")}, got "${env}"`)
  }

  const portRaw = source.PORT ?? "3000"
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${portRaw}"`)
  }

  const sessionSecret = source.SESSION_SECRET as string
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters")
  }

  const totpEncryptionKey = source.TOTP_ENCRYPTION_KEY as string
  if (totpEncryptionKey.length < 32) {
    throw new Error("TOTP_ENCRYPTION_KEY must be at least 32 characters")
  }

  return {
    env: env as Config["env"],
    port,
    databasePath: source.DATABASE_PATH as string,
    sessionSecret,
    totpEncryptionKey,
  }
}
```

- [ ] **Step 6: Run the config test to verify it passes**

Run: `bun test tests/config.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Write the failing server test**

Create `tests/server.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { createApp } from "../src/server"
import { loadConfig } from "../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

describe("createApp", () => {
  test("serves a health check", async () => {
    const res = await createApp(config).request("/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: "ok" })
  })

  test("sets a content security policy with no unsafe directives", async () => {
    const res = await createApp(config).request("/health")
    const csp = res.headers.get("content-security-policy") ?? ""
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain("unsafe-inline")
    expect(csp).not.toContain("unsafe-eval")
  })

  test("sets the remaining security headers", async () => {
    const res = await createApp(config).request("/health")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin")
    expect(res.headers.get("x-powered-by")).toBeNull()
  })

  test("returns 404 as JSON for an unknown route", async () => {
    const res = await createApp(config).request("/nope")
    expect(res.status).toBe(404)
  })
})
```

Note: `app.request()` is not built into Express. Add this helper to `src/server.ts` so tests can exercise the app without binding a port.

- [ ] **Step 8: Run the server test to verify it fails**

Run: `bun test tests/server.test.ts`
Expected: FAIL, cannot resolve `../src/server`.

- [ ] **Step 9: Implement `src/server.ts`**

```ts
import express from "express"
import helmet from "helmet"
import type { Config } from "./config"

export interface App extends express.Express {
  request(path: string, init?: RequestInit): Promise<Response>
}

export function createApp(config: Config): App {
  const app = express() as App
  app.disable("x-powered-by")

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'none'"],
          "object-src": ["'none'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  )

  app.use(express.urlencoded({ extended: false, limit: "64kb" }))
  app.use(express.json({ limit: "64kb" }))

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", env: config.env })
  })

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" })
  })

  app.request = (path, init) =>
    // @ts-expect-error Bun accepts an Express handler as a fetch handler
    Promise.resolve(app.fetch(new Request(`http://localhost${path}`, init)))

  return app
}
```

If `app.fetch` is unavailable on the installed Express build, implement `request` by starting a server on port 0 inside the helper, issuing the fetch, and closing it. Do not change the tests to accommodate the implementation.

- [ ] **Step 10: Implement `src/index.ts`**

```ts
import { createApp } from "./server"
import { loadConfig } from "./config"

const config = loadConfig()
const app = createApp(config)

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ msg: "listening", port: config.port, env: config.env }))
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
```

- [ ] **Step 11: Write `.env.example`**

```
NODE_ENV=development
PORT=3000
DATABASE_PATH=./data/meridian.db
SESSION_SECRET=change-me-to-at-least-32-random-characters
TOTP_ENCRYPTION_KEY=change-me-to-at-least-32-random-characters
```

- [ ] **Step 12: Add scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts",
    "test": "bun test",
    "typecheck": "bunx tsc --noEmit"
  }
}
```

- [ ] **Step 13: Run the full suite and the typechecker**

Run: `bun test && bun run typecheck`
Expected: PASS, 10 tests, no type errors.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: project scaffold, validated config, and CSP-enforced server"
```

---

## Task 2: Database connection and migration runner

**Files:**
- Create: `src/db/index.ts`
- Create: `src/db/migrations/.gitkeep`
- Test: `tests/db/index.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `openDatabase(path: string): Database` (from `bun:sqlite`)
  - `migrate(db: Database, dir?: string): { applied: string[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/db/index.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { openDatabase, migrate } from "../../src/db"

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "meridian-mig-"))
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql)
  }
  return dir
}

describe("openDatabase", () => {
  test("enables foreign keys", () => {
    const db = openDatabase(":memory:")
    expect(db.query("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 })
  })

  test("sets a busy timeout", () => {
    const db = openDatabase(":memory:")
    expect(db.query("PRAGMA busy_timeout").get()).toMatchObject({ timeout: 5000 })
  })
})

describe("migrate", () => {
  test("applies migrations in filename order", () => {
    const dir = fixtureDir({
      "0002-second.sql": "CREATE TABLE b (id INTEGER PRIMARY KEY);",
      "0001-first.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY);",
    })
    const db = openDatabase(":memory:")
    const result = migrate(db, dir)
    expect(result.applied).toEqual(["0001-first.sql", "0002-second.sql"])
  })

  test("is idempotent across repeated runs", () => {
    const dir = fixtureDir({ "0001-first.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY);" })
    const db = openDatabase(":memory:")
    migrate(db, dir)
    const second = migrate(db, dir)
    expect(second.applied).toEqual([])
  })

  test("rolls back a failing migration entirely", () => {
    const dir = fixtureDir({
      "0001-bad.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY); THIS IS NOT SQL;",
    })
    const db = openDatabase(":memory:")
    expect(() => migrate(db, dir)).toThrow()
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'a'")
      .all()
    expect(tables).toHaveLength(0)
  })

  test("ignores non-sql files", () => {
    const dir = fixtureDir({
      "0001-first.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY);",
      "README.md": "not a migration",
    })
    const db = openDatabase(":memory:")
    expect(migrate(db, dir).applied).toEqual(["0001-first.sql"])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/db/index.test.ts`
Expected: FAIL, cannot resolve `../../src/db`.

- [ ] **Step 3: Implement `src/db/index.ts`**

```ts
import { Database } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true })
  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL")
  }
  db.exec("PRAGMA synchronous = FULL")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA busy_timeout = 5000")
  return db
}

const DEFAULT_DIR = new URL("./migrations/", import.meta.url).pathname

export function migrate(db: Database, dir: string = DEFAULT_DIR): { applied: string[] } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const done = new Set(
    db
      .query<{ filename: string }, []>("SELECT filename FROM schema_migrations")
      .all()
      .map((row) => row.filename),
  )

  const pending = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => !done.has(name))

  const applied: string[] = []
  for (const name of pending) {
    const sql = readFileSync(join(dir, name), "utf8")
    db.transaction(() => {
      db.exec(sql)
      db.query("INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)").run(
        name,
        new Date().toISOString(),
      )
    })()
    applied.push(name)
  }

  return { applied }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/db/index.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: sqlite connection with ledger pragmas and a transactional migration runner"
```

---

## Task 3: Money module

Pure base-unit arithmetic. No database, no Express. This is the module every other money-handling line of code depends on, so it gets the most exhaustive tests in the plan.

**Files:**
- Create: `src/domain/money.ts`
- Test: `tests/domain/money.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `const INTERNAL_DECIMALS = 8`
  - `parseAmount(input: string): bigint`
  - `formatBalance(base: bigint, displayDecimals: number): string`
  - `formatPrice(base: bigint, displayDecimals: number): string`
  - `fromNative(native: bigint, nativeDecimals: number): { base: bigint; dust: bigint }`
  - `toNative(base: bigint, nativeDecimals: number): bigint`
  - `isRepresentableAtNative(base: bigint, nativeDecimals: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/money.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import {
  INTERNAL_DECIMALS,
  parseAmount,
  formatBalance,
  formatPrice,
  fromNative,
  toNative,
  isRepresentableAtNative,
} from "../../src/domain/money"

describe("INTERNAL_DECIMALS", () => {
  test("is fixed at 8", () => {
    expect(INTERNAL_DECIMALS).toBe(8)
  })
})

describe("parseAmount", () => {
  test("parses a whole number", () => {
    expect(parseAmount("1")).toBe(100000000n)
  })

  test("parses a fractional amount", () => {
    expect(parseAmount("1.5")).toBe(150000000n)
  })

  test("parses full internal precision", () => {
    expect(parseAmount("0.00000001")).toBe(1n)
  })

  test("parses zero", () => {
    expect(parseAmount("0")).toBe(0n)
  })

  test("parses a large amount without precision loss", () => {
    expect(parseAmount("21000000.12345678")).toBe(2100000012345678n)
  })

  test("rejects more than 8 decimal places rather than truncating", () => {
    expect(() => parseAmount("0.000000001")).toThrow(/decimal places/)
  })

  test("rejects a negative amount", () => {
    expect(() => parseAmount("-1")).toThrow(/negative/)
  })

  test("rejects non-numeric input", () => {
    expect(() => parseAmount("abc")).toThrow()
    expect(() => parseAmount("")).toThrow()
    expect(() => parseAmount("1.2.3")).toThrow()
    expect(() => parseAmount("1e10")).toThrow()
  })
})

describe("formatBalance", () => {
  test("rounds down so a balance is never overstated", () => {
    expect(formatBalance(199999999n, 2)).toBe("1.99")
    expect(formatBalance(199999999n, 4)).toBe("1.9999")
  })

  test("pads to the requested precision", () => {
    expect(formatBalance(150000000n, 4)).toBe("1.5000")
  })

  test("formats zero", () => {
    expect(formatBalance(0n, 2)).toBe("0.00")
  })

  test("formats with zero decimals", () => {
    expect(formatBalance(199999999n, 0)).toBe("1")
  })
})

describe("formatPrice", () => {
  test("rounds half to even", () => {
    expect(formatPrice(150n, 6)).toBe("0.000002")
    expect(formatPrice(250n, 6)).toBe("0.000002")
    expect(formatPrice(350n, 6)).toBe("0.000004")
  })

  test("rounds up above the midpoint", () => {
    expect(formatPrice(151n, 6)).toBe("0.000002")
    expect(formatPrice(160n, 6)).toBe("0.000002")
  })
})

describe("fromNative", () => {
  test("converts 18-decimal ETH and captures the dust remainder", () => {
    const { base, dust } = fromNative(1234567890123456789n, 18)
    expect(base).toBe(123456789n)
    expect(dust).toBe(123456789n)
  })

  test("leaves no dust when the value divides exactly", () => {
    const { base, dust } = fromNative(1000000000000000000n, 18)
    expect(base).toBe(100000000n)
    expect(dust).toBe(0n)
  })

  test("scales up from 6-decimal USDT", () => {
    const { base, dust } = fromNative(1500000n, 6)
    expect(base).toBe(150000000n)
    expect(dust).toBe(0n)
  })

  test("is exact for 8-decimal BTC", () => {
    const { base, dust } = fromNative(123456789n, 8)
    expect(base).toBe(123456789n)
    expect(dust).toBe(0n)
  })

  test("never loses value: base scaled back plus dust equals the input", () => {
    const native = 987654321987654321n
    const { base, dust } = fromNative(native, 18)
    expect(base * 10n ** 10n + dust).toBe(native)
  })
})

describe("toNative", () => {
  test("scales up to 18-decimal ETH", () => {
    expect(toNative(100000000n, 18)).toBe(1000000000000000000n)
  })

  test("scales down to 6-decimal USDT when exactly representable", () => {
    expect(toNative(150000000n, 6)).toBe(1500000n)
  })

  test("throws rather than silently truncating an unrepresentable amount", () => {
    expect(() => toNative(150000001n, 6)).toThrow(/not representable/)
  })
})

describe("isRepresentableAtNative", () => {
  test("accepts an amount that fits the native precision", () => {
    expect(isRepresentableAtNative(150000000n, 6)).toBe(true)
  })

  test("rejects an amount with precision below the native precision", () => {
    expect(isRepresentableAtNative(150000001n, 6)).toBe(false)
  })

  test("accepts anything when native precision is at or above internal", () => {
    expect(isRepresentableAtNative(150000001n, 8)).toBe(true)
    expect(isRepresentableAtNative(150000001n, 18)).toBe(true)
  })
})

describe("round trip properties", () => {
  test("parse then format is identity at full precision", () => {
    for (const value of ["0.00000001", "1.00000000", "21000000.12345678", "0.00000000"]) {
      expect(formatBalance(parseAmount(value), 8)).toBe(value)
    }
  })

  test("random base amounts survive fromNative(toNative(x)) at 18 decimals", () => {
    for (let i = 0; i < 500; i++) {
      const base = BigInt(Math.floor(Math.random() * 1_000_000_000_000))
      expect(fromNative(toNative(base, 18), 18).base).toBe(base)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/domain/money.test.ts`
Expected: FAIL, cannot resolve `../../src/domain/money`.

- [ ] **Step 3: Implement `src/domain/money.ts`**

```ts
export const INTERNAL_DECIMALS = 8
export const INTERNAL_SCALE = 10n ** BigInt(INTERNAL_DECIMALS)

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/

export function parseAmount(input: string): bigint {
  const trimmed = input.trim()
  if (trimmed.startsWith("-")) {
    throw new Error(`Amount may not be negative: "${input}"`)
  }
  if (!AMOUNT_PATTERN.test(trimmed)) {
    throw new Error(`Not a valid decimal amount: "${input}"`)
  }

  const [whole = "0", fraction = ""] = trimmed.split(".")
  if (fraction.length > INTERNAL_DECIMALS) {
    throw new Error(
      `Amount has ${fraction.length} decimal places, maximum is ${INTERNAL_DECIMALS}: "${input}"`,
    )
  }

  return BigInt(whole) * INTERNAL_SCALE + BigInt(fraction.padEnd(INTERNAL_DECIMALS, "0") || "0")
}

function split(base: bigint, displayDecimals: number): { whole: bigint; fraction: string } {
  const whole = base / INTERNAL_SCALE
  const fraction = (base % INTERNAL_SCALE).toString().padStart(INTERNAL_DECIMALS, "0")
  return { whole, fraction: fraction.slice(0, displayDecimals) }
}

export function formatBalance(base: bigint, displayDecimals: number): string {
  const { whole, fraction } = split(base, displayDecimals)
  return displayDecimals === 0 ? whole.toString() : `${whole}.${fraction}`
}

export function formatPrice(base: bigint, displayDecimals: number): string {
  const divisor = 10n ** BigInt(INTERNAL_DECIMALS - displayDecimals)
  if (divisor === 1n) return formatBalance(base, displayDecimals)

  const quotient = base / divisor
  const remainder = base % divisor
  const twice = remainder * 2n

  let rounded = quotient
  if (twice > divisor) rounded += 1n
  else if (twice === divisor && quotient % 2n !== 0n) rounded += 1n

  const scale = 10n ** BigInt(displayDecimals)
  const whole = rounded / scale
  const fraction = (rounded % scale).toString().padStart(displayDecimals, "0")
  return displayDecimals === 0 ? whole.toString() : `${whole}.${fraction}`
}

export function fromNative(
  native: bigint,
  nativeDecimals: number,
): { base: bigint; dust: bigint } {
  if (nativeDecimals >= INTERNAL_DECIMALS) {
    const divisor = 10n ** BigInt(nativeDecimals - INTERNAL_DECIMALS)
    return { base: native / divisor, dust: native % divisor }
  }
  const multiplier = 10n ** BigInt(INTERNAL_DECIMALS - nativeDecimals)
  return { base: native * multiplier, dust: 0n }
}

export function isRepresentableAtNative(base: bigint, nativeDecimals: number): boolean {
  if (nativeDecimals >= INTERNAL_DECIMALS) return true
  const divisor = 10n ** BigInt(INTERNAL_DECIMALS - nativeDecimals)
  return base % divisor === 0n
}

export function toNative(base: bigint, nativeDecimals: number): bigint {
  if (nativeDecimals >= INTERNAL_DECIMALS) {
    return base * 10n ** BigInt(nativeDecimals - INTERNAL_DECIMALS)
  }
  if (!isRepresentableAtNative(base, nativeDecimals)) {
    throw new Error(
      `Amount ${base} is not representable at ${nativeDecimals} native decimal places`,
    )
  }
  return base / 10n ** BigInt(INTERNAL_DECIMALS - nativeDecimals)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/domain/money.test.ts`
Expected: PASS, 31 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: base-unit money module with fixed 8-decimal internal precision"
```

---

## Task 4: Asset registry

**Files:**
- Create: `src/db/migrations/0001-assets.sql`
- Create: `src/db/repositories/assets.ts`
- Test: `tests/db/repositories/assets.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `migrate` from Task 2
- Produces:
  - `interface Asset { symbol: string; displaySymbol: string; name: string; kind: "native" | "token"; chain: string; networkLabel: string; contractAddress: string | null; nativeDecimals: number; displayDecimals: number; confirmationsRequired: number; isStablecoin: boolean; depositEnabled: boolean; withdrawalEnabled: boolean; tradingEnabled: boolean; sortOrder: number }`
  - `class AssetRepository { constructor(db: Database); all(): Asset[]; find(symbol: string): Asset | null; byChain(chain: string): Asset[] }`

- [ ] **Step 1: Write `src/db/migrations/0001-assets.sql`**

```sql
CREATE TABLE assets (
  symbol                  TEXT PRIMARY KEY,
  display_symbol          TEXT NOT NULL,
  name                    TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('native', 'token')),
  chain                   TEXT NOT NULL,
  network_label           TEXT NOT NULL,
  contract_address        TEXT,
  native_decimals         INTEGER NOT NULL CHECK (native_decimals >= 0 AND native_decimals <= 36),
  display_decimals        INTEGER NOT NULL CHECK (display_decimals >= 0 AND display_decimals <= 8),
  confirmations_required  INTEGER NOT NULL CHECK (confirmations_required > 0),
  is_stablecoin           INTEGER NOT NULL DEFAULT 0 CHECK (is_stablecoin IN (0, 1)),
  deposit_enabled         INTEGER NOT NULL DEFAULT 0 CHECK (deposit_enabled IN (0, 1)),
  withdrawal_enabled      INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_enabled IN (0, 1)),
  trading_enabled         INTEGER NOT NULL DEFAULT 0 CHECK (trading_enabled IN (0, 1)),
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL,
  CHECK ((kind = 'token') = (contract_address IS NOT NULL))
);

CREATE INDEX idx_assets_chain ON assets(chain);

INSERT INTO assets (
  symbol, display_symbol, name, kind, chain, network_label, contract_address,
  native_decimals, display_decimals, confirmations_required, is_stablecoin,
  sort_order, created_at
) VALUES
  ('BTC',        'BTC',  'Bitcoin',    'native', 'bitcoin',  'Bitcoin',       NULL,
   8,  8, 2,  0, 10, '2026-08-29T00:00:00.000Z'),
  ('ETH',        'ETH',  'Ethereum',   'native', 'ethereum', 'Ethereum (ERC20)', NULL,
   18, 6, 12, 0, 20, '2026-08-29T00:00:00.000Z'),
  ('USDT_ERC20', 'USDT', 'Tether',     'token',  'ethereum', 'Ethereum (ERC20)',
   '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6, 2, 12, 1, 30, '2026-08-29T00:00:00.000Z'),
  ('USDC_ERC20', 'USDC', 'USD Coin',   'token',  'ethereum', 'Ethereum (ERC20)',
   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6, 2, 12, 1, 40, '2026-08-29T00:00:00.000Z'),
  ('TRX',        'TRX',  'Tron',       'native', 'tron',     'Tron (TRC20)',  NULL,
   6,  2, 20, 0, 50, '2026-08-29T00:00:00.000Z'),
  ('USDT_TRC20', 'USDT', 'Tether',     'token',  'tron',     'Tron (TRC20)',
   'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', 6, 2, 20, 1, 60, '2026-08-29T00:00:00.000Z'),
  ('SOL',        'SOL',  'Solana',     'native', 'solana',   'Solana',        NULL,
   9,  4, 32, 0, 70, '2026-08-29T00:00:00.000Z'),
  ('USDC_SPL',   'USDC', 'USD Coin',   'token',  'solana',   'Solana (SPL)',
   'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6, 2, 32, 1, 80, '2026-08-29T00:00:00.000Z'),
  ('BNB',        'BNB',  'BNB',        'native', 'bsc',      'BNB Chain (BEP20)', NULL,
   18, 6, 15, 0, 90, '2026-08-29T00:00:00.000Z'),
  ('USDT_BEP20', 'USDT', 'Tether',     'token',  'bsc',      'BNB Chain (BEP20)',
   '0x55d398326f99059fF775485246999027B3197955', 18, 2, 15, 1, 100, '2026-08-29T00:00:00.000Z');
```

All `*_enabled` flags default to 0 and stay 0 through Slice 1. There is no value movement in this slice.

- [ ] **Step 2: Write the failing test**

Create `tests/db/repositories/assets.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { openDatabase, migrate } from "../../../src/db"
import { AssetRepository } from "../../../src/db/repositories/assets"

let db: Database
let repo: AssetRepository

beforeEach(() => {
  db = openDatabase(":memory:")
  migrate(db)
  repo = new AssetRepository(db)
})

describe("AssetRepository", () => {
  test("seeds the ten launch assets", () => {
    expect(repo.all()).toHaveLength(10)
  })

  test("orders by sort order", () => {
    expect(repo.all().map((a) => a.symbol)[0]).toBe("BTC")
  })

  test("finds a native asset with no contract address", () => {
    const btc = repo.find("BTC")
    expect(btc).toMatchObject({
      symbol: "BTC",
      displaySymbol: "BTC",
      kind: "native",
      chain: "bitcoin",
      contractAddress: null,
      nativeDecimals: 8,
      displayDecimals: 8,
      isStablecoin: false,
    })
  })

  test("finds a token and exposes its contract address", () => {
    const usdt = repo.find("USDT_TRC20")
    expect(usdt).toMatchObject({
      displaySymbol: "USDT",
      kind: "token",
      chain: "tron",
      networkLabel: "Tron (TRC20)",
      nativeDecimals: 6,
      isStablecoin: true,
    })
    expect(usdt?.contractAddress).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
  })

  test("distinguishes the same display symbol on different chains", () => {
    const tickers = repo.all().filter((a) => a.displaySymbol === "USDT")
    expect(tickers.map((a) => a.symbol).sort()).toEqual([
      "USDT_BEP20",
      "USDT_ERC20",
      "USDT_TRC20",
    ])
  })

  test("returns null for an unknown symbol", () => {
    expect(repo.find("DOGE")).toBeNull()
  })

  test("filters by chain", () => {
    expect(repo.byChain("ethereum").map((a) => a.symbol).sort()).toEqual([
      "ETH",
      "USDC_ERC20",
      "USDT_ERC20",
    ])
  })

  test("has every movement flag disabled in slice 1", () => {
    for (const asset of repo.all()) {
      expect(asset.depositEnabled).toBe(false)
      expect(asset.withdrawalEnabled).toBe(false)
      expect(asset.tradingEnabled).toBe(false)
    }
  })

  test("rejects a token row with no contract address", () => {
    expect(() =>
      db
        .query(
          `INSERT INTO assets (symbol, display_symbol, name, kind, chain, network_label,
             contract_address, native_decimals, display_decimals, confirmations_required, created_at)
           VALUES ('BAD', 'BAD', 'Bad', 'token', 'ethereum', 'Ethereum', NULL, 18, 6, 12, '2026-01-01')`,
        )
        .run(),
    ).toThrow()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/db/repositories/assets.test.ts`
Expected: FAIL, cannot resolve `AssetRepository`.

- [ ] **Step 4: Implement `src/db/repositories/assets.ts`**

```ts
import type { Database } from "bun:sqlite"

export interface Asset {
  symbol: string
  displaySymbol: string
  name: string
  kind: "native" | "token"
  chain: string
  networkLabel: string
  contractAddress: string | null
  nativeDecimals: number
  displayDecimals: number
  confirmationsRequired: number
  isStablecoin: boolean
  depositEnabled: boolean
  withdrawalEnabled: boolean
  tradingEnabled: boolean
  sortOrder: number
}

interface AssetRow {
  symbol: string
  display_symbol: string
  name: string
  kind: "native" | "token"
  chain: string
  network_label: string
  contract_address: string | null
  native_decimals: number
  display_decimals: number
  confirmations_required: number
  is_stablecoin: number
  deposit_enabled: number
  withdrawal_enabled: number
  trading_enabled: number
  sort_order: number
}

function toAsset(row: AssetRow): Asset {
  return {
    symbol: row.symbol,
    displaySymbol: row.display_symbol,
    name: row.name,
    kind: row.kind,
    chain: row.chain,
    networkLabel: row.network_label,
    contractAddress: row.contract_address,
    nativeDecimals: row.native_decimals,
    displayDecimals: row.display_decimals,
    confirmationsRequired: row.confirmations_required,
    isStablecoin: row.is_stablecoin === 1,
    depositEnabled: row.deposit_enabled === 1,
    withdrawalEnabled: row.withdrawal_enabled === 1,
    tradingEnabled: row.trading_enabled === 1,
    sortOrder: row.sort_order,
  }
}

const COLUMNS = `symbol, display_symbol, name, kind, chain, network_label, contract_address,
  native_decimals, display_decimals, confirmations_required, is_stablecoin,
  deposit_enabled, withdrawal_enabled, trading_enabled, sort_order`

export class AssetRepository {
  constructor(private readonly db: Database) {}

  all(): Asset[] {
    return this.db
      .query<AssetRow, []>(`SELECT ${COLUMNS} FROM assets ORDER BY sort_order`)
      .all()
      .map(toAsset)
  }

  find(symbol: string): Asset | null {
    const row = this.db
      .query<AssetRow, [string]>(`SELECT ${COLUMNS} FROM assets WHERE symbol = ?`)
      .get(symbol)
    return row ? toAsset(row) : null
  }

  byChain(chain: string): Asset[] {
    return this.db
      .query<AssetRow, [string]>(
        `SELECT ${COLUMNS} FROM assets WHERE chain = ? ORDER BY sort_order`,
      )
      .all(chain)
      .map(toAsset)
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/db/repositories/assets.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: asset registry with chain-qualified symbols and ten seeded launch assets"
```

---

## Task 5: Ledger schema with append-only enforcement

The `users` table is created here rather than in the identity plan, because `accounts.user_id` references it and SQLite cannot add a foreign key to an existing table. Identity work later adds columns and its own tables; this migration creates only what the ledger needs to reference.

**Files:**
- Create: `src/db/migrations/0002-users.sql`
- Create: `src/db/migrations/0003-ledger.sql`
- Test: `tests/db/ledger-schema.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces: tables `users`, `accounts`, `ledger_transactions`, `ledger_entries`, `account_balances`, `holds`

- [ ] **Step 1: Write the failing test first**

Write `tests/db/ledger-schema.test.ts` exactly as given in Step 4 below, then run it.

Run: `bun test tests/db/ledger-schema.test.ts`
Expected: FAIL, "no such table: users".

Only after seeing that failure, write the two migrations in Steps 2 and 3.

- [ ] **Step 2: Write `src/db/migrations/0002-users.sql`**

```sql
CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  email_normalized      TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  email_verified_at     TEXT,
  totp_secret_encrypted TEXT,
  totp_enabled_at       TEXT,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'suspended', 'closed')),
  kyc_tier              INTEGER NOT NULL DEFAULT 0 CHECK (kyc_tier BETWEEN 0 AND 2),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
```

- [ ] **Step 3: Write `src/db/migrations/0003-ledger.sql`**

```sql
CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  asset       TEXT NOT NULL REFERENCES assets(symbol),
  type        TEXT NOT NULL CHECK (type IN (
                'user_available', 'user_hold',
                'platform_fee', 'platform_treasury', 'platform_dust',
                'external_deposit', 'external_withdrawal'
              )),
  created_at  TEXT NOT NULL,
  CHECK ((user_id IS NOT NULL) = (type IN ('user_available', 'user_hold')))
);

CREATE UNIQUE INDEX idx_accounts_user ON accounts(user_id, asset, type)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_accounts_platform ON accounts(asset, type)
  WHERE user_id IS NULL;

CREATE TABLE ledger_transactions (
  id               INTEGER PRIMARY KEY,
  kind             TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,
  external_ref     TEXT,
  metadata         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);

CREATE TABLE ledger_entries (
  id              INTEGER PRIMARY KEY,
  transaction_id  INTEGER NOT NULL REFERENCES ledger_transactions(id),
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  asset           TEXT NOT NULL REFERENCES assets(symbol),
  amount          INTEGER NOT NULL CHECK (amount <> 0),
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_entries_account ON ledger_entries(account_id, id);
CREATE INDEX idx_entries_tx ON ledger_entries(transaction_id);

CREATE TABLE account_balances (
  account_id     INTEGER PRIMARY KEY REFERENCES accounts(id),
  amount         INTEGER NOT NULL DEFAULT 0,
  last_entry_id  INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL
);

CREATE TABLE holds (
  id                    INTEGER PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  asset                 TEXT NOT NULL REFERENCES assets(symbol),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  status                TEXT NOT NULL CHECK (status IN ('active', 'released', 'consumed')),
  reference             TEXT NOT NULL,
  place_transaction_id  INTEGER NOT NULL REFERENCES ledger_transactions(id),
  close_transaction_id  INTEGER REFERENCES ledger_transactions(id),
  created_at            TEXT NOT NULL,
  closed_at             TEXT,
  CHECK ((status = 'active') = (close_transaction_id IS NULL))
);

CREATE INDEX idx_holds_user_active ON holds(user_id, asset) WHERE status = 'active';

CREATE TRIGGER ledger_transactions_no_update BEFORE UPDATE ON ledger_transactions
BEGIN SELECT RAISE(ABORT, 'ledger_transactions is append-only'); END;

CREATE TRIGGER ledger_transactions_no_delete BEFORE DELETE ON ledger_transactions
BEGIN SELECT RAISE(ABORT, 'ledger_transactions is append-only'); END;

CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;

CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries
BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
```

- [ ] **Step 4: The failing test, written in Step 1**

For reference, this is the file Step 1 asked you to write. Create `tests/db/ledger-schema.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { openDatabase, migrate } from "../../src/db"

let db: Database

function seedUser(): number {
  db.query(
    `INSERT INTO users (email, email_normalized, password_hash, created_at, updated_at)
     VALUES ('a@b.co', 'a@b.co', 'hash', '2026-01-01', '2026-01-01')`,
  ).run()
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}

function seedTransaction(): number {
  db.query(
    `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
     VALUES ('test', 'key-' || abs(random()), '2026-01-01')`,
  ).run()
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}

function seedAccount(userId: number | null, type: string): number {
  db.query(
    `INSERT INTO accounts (user_id, asset, type, created_at) VALUES (?, 'BTC', ?, '2026-01-01')`,
  ).run(userId, type)
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}

beforeEach(() => {
  db = openDatabase(":memory:")
  migrate(db)
})

describe("append-only enforcement", () => {
  test("rejects updating a ledger transaction", () => {
    const id = seedTransaction()
    expect(() =>
      db.query("UPDATE ledger_transactions SET kind = 'changed' WHERE id = ?").run(id),
    ).toThrow(/append-only/)
  })

  test("rejects deleting a ledger transaction", () => {
    const id = seedTransaction()
    expect(() => db.query("DELETE FROM ledger_transactions WHERE id = ?").run(id)).toThrow(
      /append-only/,
    )
  })

  test("rejects updating a ledger entry", () => {
    const txId = seedTransaction()
    const accountId = seedAccount(seedUser(), "user_available")
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 100, '2026-01-01')`,
    ).run(txId, accountId)
    expect(() => db.query("UPDATE ledger_entries SET amount = 999").run()).toThrow(
      /append-only/,
    )
  })

  test("rejects deleting a ledger entry", () => {
    const txId = seedTransaction()
    const accountId = seedAccount(seedUser(), "user_available")
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 100, '2026-01-01')`,
    ).run(txId, accountId)
    expect(() => db.query("DELETE FROM ledger_entries").run()).toThrow(/append-only/)
  })
})

describe("schema constraints", () => {
  test("rejects a duplicate idempotency key", () => {
    db.query(
      `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
       VALUES ('test', 'dup', '2026-01-01')`,
    ).run()
    expect(() =>
      db
        .query(
          `INSERT INTO ledger_transactions (kind, idempotency_key, created_at)
           VALUES ('test', 'dup', '2026-01-01')`,
        )
        .run(),
    ).toThrow()
  })

  test("rejects a zero-amount entry", () => {
    const txId = seedTransaction()
    const accountId = seedAccount(seedUser(), "user_available")
    expect(() =>
      db
        .query(
          `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
           VALUES (?, ?, 'BTC', 0, '2026-01-01')`,
        )
        .run(txId, accountId),
    ).toThrow()
  })

  test("rejects a user account with no user id", () => {
    expect(() => seedAccount(null, "user_available")).toThrow()
  })

  test("rejects a platform account carrying a user id", () => {
    expect(() => seedAccount(seedUser(), "platform_fee")).toThrow()
  })

  test("rejects a duplicate user account for the same asset and type", () => {
    const userId = seedUser()
    seedAccount(userId, "user_available")
    expect(() => seedAccount(userId, "user_available")).toThrow()
  })

  test("rejects a duplicate platform account for the same asset and type", () => {
    seedAccount(null, "platform_fee")
    expect(() => seedAccount(null, "platform_fee")).toThrow()
  })

  test("rejects an entry referencing an unknown asset", () => {
    const txId = seedTransaction()
    const accountId = seedAccount(seedUser(), "user_available")
    expect(() =>
      db
        .query(
          `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
           VALUES (?, ?, 'NOPE', 100, '2026-01-01')`,
        )
        .run(txId, accountId),
    ).toThrow()
  })

  test("rejects an active hold that carries a close transaction", () => {
    const userId = seedUser()
    const txId = seedTransaction()
    expect(() =>
      db
        .query(
          `INSERT INTO holds (user_id, asset, amount, status, reference,
             place_transaction_id, close_transaction_id, created_at)
           VALUES (?, 'BTC', 100, 'active', 'ref', ?, ?, '2026-01-01')`,
        )
        .run(userId, txId, txId),
    ).toThrow()
  })
})
```

- [ ] **Step 5: Run the test to verify it now passes**

Run: `bun test tests/db/ledger-schema.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Run the whole suite to confirm nothing regressed**

Run: `bun test`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: append-only double-entry ledger schema with holds and balance cache"
```

---

## Task 6: Ledger posting rules

Pure validation, no database. Every rule that makes a posting legal lives here and is unit-tested exhaustively.

**Files:**
- Create: `src/domain/ledger/types.ts`
- Create: `src/domain/ledger/validate.ts`
- Test: `tests/domain/ledger/validate.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface EntryInput { accountId: number; asset: string; amount: bigint }`
  - `interface PostingInput { kind: string; idempotencyKey: string; entries: EntryInput[]; externalRef?: string; metadata?: Record<string, unknown> }`
  - `class LedgerError extends Error { readonly code: string }`
  - `validatePosting(input: PostingInput): void` — throws `LedgerError` on any violation

- [ ] **Step 1: Write `src/domain/ledger/types.ts`**

```ts
export interface EntryInput {
  accountId: number
  asset: string
  amount: bigint
}

export interface PostingInput {
  kind: string
  idempotencyKey: string
  entries: EntryInput[]
  externalRef?: string
  metadata?: Record<string, unknown>
}

export type LedgerErrorCode =
  | "unbalanced"
  | "empty_posting"
  | "zero_amount"
  | "duplicate_account"
  | "missing_idempotency_key"
  | "missing_kind"
  | "insufficient_balance"
  | "account_not_found"
  | "asset_mismatch"
  | "hold_not_active"

export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "LedgerError"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/domain/ledger/validate.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { validatePosting } from "../../../src/domain/ledger/validate"
import { LedgerError, type PostingInput } from "../../../src/domain/ledger/types"

function posting(overrides: Partial<PostingInput> = {}): PostingInput {
  return {
    kind: "deposit",
    idempotencyKey: "key-1",
    entries: [
      { accountId: 1, asset: "BTC", amount: -100n },
      { accountId: 2, asset: "BTC", amount: 100n },
    ],
    ...overrides,
  }
}

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof LedgerError) return error.code
    throw error
  }
  throw new Error("expected validatePosting to throw, it did not")
}

describe("validatePosting", () => {
  test("accepts a balanced two-entry posting", () => {
    expect(() => validatePosting(posting())).not.toThrow()
  })

  test("accepts a balanced multi-asset posting", () => {
    expect(() =>
      validatePosting(
        posting({
          entries: [
            { accountId: 1, asset: "BTC", amount: -100n },
            { accountId: 2, asset: "BTC", amount: 100n },
            { accountId: 3, asset: "USDT_TRC20", amount: -500n },
            { accountId: 4, asset: "USDT_TRC20", amount: 500n },
          ],
        }),
      ),
    ).not.toThrow()
  })

  test("accepts a balanced posting that splits across three accounts", () => {
    expect(() =>
      validatePosting(
        posting({
          entries: [
            { accountId: 1, asset: "BTC", amount: -100n },
            { accountId: 2, asset: "BTC", amount: 90n },
            { accountId: 3, asset: "BTC", amount: 10n },
          ],
        }),
      ),
    ).not.toThrow()
  })

  test("rejects a posting that does not sum to zero", () => {
    expect(
      codeOf(() =>
        validatePosting(
          posting({
            entries: [
              { accountId: 1, asset: "BTC", amount: -100n },
              { accountId: 2, asset: "BTC", amount: 99n },
            ],
          }),
        ),
      ),
    ).toBe("unbalanced")
  })

  test("rejects a posting balanced overall but unbalanced per asset", () => {
    expect(
      codeOf(() =>
        validatePosting(
          posting({
            entries: [
              { accountId: 1, asset: "BTC", amount: -100n },
              { accountId: 2, asset: "USDT_TRC20", amount: 100n },
            ],
          }),
        ),
      ),
    ).toBe("unbalanced")
  })

  test("rejects an empty posting", () => {
    expect(codeOf(() => validatePosting(posting({ entries: [] })))).toBe("empty_posting")
  })

  test("rejects a zero-amount entry", () => {
    expect(
      codeOf(() =>
        validatePosting(
          posting({
            entries: [
              { accountId: 1, asset: "BTC", amount: 0n },
              { accountId: 2, asset: "BTC", amount: 0n },
            ],
          }),
        ),
      ),
    ).toBe("zero_amount")
  })

  test("rejects the same account appearing twice for one asset", () => {
    expect(
      codeOf(() =>
        validatePosting(
          posting({
            entries: [
              { accountId: 1, asset: "BTC", amount: -100n },
              { accountId: 1, asset: "BTC", amount: 100n },
            ],
          }),
        ),
      ),
    ).toBe("duplicate_account")
  })

  test("rejects a missing idempotency key", () => {
    expect(codeOf(() => validatePosting(posting({ idempotencyKey: "" })))).toBe(
      "missing_idempotency_key",
    )
  })

  test("rejects a missing kind", () => {
    expect(codeOf(() => validatePosting(posting({ kind: "" })))).toBe("missing_kind")
  })

  test("handles amounts far beyond Number.MAX_SAFE_INTEGER", () => {
    const huge = 9_000_000_000_000_000_000n
    expect(() =>
      validatePosting(
        posting({
          entries: [
            { accountId: 1, asset: "BTC", amount: -huge },
            { accountId: 2, asset: "BTC", amount: huge },
          ],
        }),
      ),
    ).not.toThrow()
  })
})

describe("balance property", () => {
  test("any set of entries whose complement closes the balance validates", () => {
    for (let i = 0; i < 300; i++) {
      const amounts = Array.from(
        { length: 2 + Math.floor(Math.random() * 4) },
        () => BigInt(1 + Math.floor(Math.random() * 1_000_000)),
      )
      const total = amounts.reduce((sum, a) => sum + a, 0n)
      const entries = amounts.map((amount, index) => ({
        accountId: index + 1,
        asset: "BTC",
        amount,
      }))
      entries.push({ accountId: 999, asset: "BTC", amount: -total })
      expect(() => validatePosting(posting({ entries }))).not.toThrow()
    }
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/domain/ledger/validate.test.ts`
Expected: FAIL, cannot resolve `validate`.

- [ ] **Step 4: Implement `src/domain/ledger/validate.ts`**

```ts
import { LedgerError, type PostingInput } from "./types"

export function validatePosting(input: PostingInput): void {
  if (!input.kind) {
    throw new LedgerError("missing_kind", "Posting kind is required")
  }
  if (!input.idempotencyKey) {
    throw new LedgerError("missing_idempotency_key", "Idempotency key is required")
  }
  if (input.entries.length === 0) {
    throw new LedgerError("empty_posting", "A posting must contain at least one entry")
  }

  const totals = new Map<string, bigint>()
  const seen = new Set<string>()

  for (const entry of input.entries) {
    if (entry.amount === 0n) {
      throw new LedgerError(
        "zero_amount",
        `Entry for account ${entry.accountId} has a zero amount`,
      )
    }

    const key = `${entry.accountId}:${entry.asset}`
    if (seen.has(key)) {
      throw new LedgerError(
        "duplicate_account",
        `Account ${entry.accountId} appears more than once for asset ${entry.asset}`,
      )
    }
    seen.add(key)

    totals.set(entry.asset, (totals.get(entry.asset) ?? 0n) + entry.amount)
  }

  for (const [asset, total] of totals) {
    if (total !== 0n) {
      throw new LedgerError(
        "unbalanced",
        `Entries for asset ${asset} sum to ${total}, expected 0`,
      )
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/domain/ledger/validate.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: pure ledger posting validation with per-asset balance invariant"
```

---

## Task 7: Ledger posting

The only write path into the journal. Everything here happens inside one SQLite transaction.

**Files:**
- Create: `src/db/repositories/ledger.ts`
- Test: `tests/db/repositories/ledger-post.test.ts`
- Test: `tests/support/fixtures.ts`

**Interfaces:**
- Consumes: `validatePosting`, `LedgerError`, `PostingInput` from Task 6
- Produces:
  - `class LedgerRepository { constructor(db: Database); post(input: PostingInput): { transactionId: number; replayed: boolean }; ensureAccount(userId: number | null, asset: string, type: AccountType): number }`
  - `type AccountType = "user_available" | "user_hold" | "platform_fee" | "platform_treasury" | "platform_dust" | "external_deposit" | "external_withdrawal"`

- [ ] **Step 1: Write the shared test fixture**

Create `tests/support/fixtures.ts`:

```ts
import type { Database } from "bun:sqlite"
import { openDatabase, migrate } from "../../src/db"

export function freshDb(): Database {
  const db = openDatabase(":memory:")
  migrate(db)
  return db
}

export function createUser(db: Database, email = `u${Math.random()}@test.co`): number {
  db.query(
    `INSERT INTO users (email, email_normalized, password_hash, created_at, updated_at)
     VALUES (?, ?, 'hash', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run(email, email.toLowerCase())
  return Number(db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id)
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/db/repositories/ledger-post.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { LedgerRepository } from "../../../src/db/repositories/ledger"
import { LedgerError } from "../../../src/domain/ledger/types"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let ledger: LedgerRepository
let userId: number
let userBtc: number
let externalBtc: number

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof LedgerError) return error.code
    throw error
  }
  throw new Error("expected post to throw, it did not")
}

beforeEach(() => {
  db = freshDb()
  ledger = new LedgerRepository(db)
  userId = createUser(db)
  userBtc = ledger.ensureAccount(userId, "BTC", "user_available")
  externalBtc = ledger.ensureAccount(null, "BTC", "external_deposit")
})

describe("ensureAccount", () => {
  test("creates an account once and returns the same id thereafter", () => {
    const first = ledger.ensureAccount(userId, "ETH", "user_available")
    const second = ledger.ensureAccount(userId, "ETH", "user_available")
    expect(second).toBe(first)
  })

  test("creates a zeroed balance row alongside the account", () => {
    const row = db
      .query<{ amount: number }, [number]>(
        "SELECT amount FROM account_balances WHERE account_id = ?",
      )
      .get(userBtc)
    expect(row?.amount).toBe(0)
  })
})

describe("post", () => {
  test("writes a balanced posting and returns its transaction id", () => {
    const { transactionId, replayed } = ledger.post({
      kind: "deposit",
      idempotencyKey: "dep-1",
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -100000000n },
        { accountId: userBtc, asset: "BTC", amount: 100000000n },
      ],
    })
    expect(transactionId).toBeGreaterThan(0)
    expect(replayed).toBe(false)
  })

  test("updates the materialized balance inside the same transaction", () => {
    ledger.post({
      kind: "deposit",
      idempotencyKey: "dep-1",
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -100000000n },
        { accountId: userBtc, asset: "BTC", amount: 100000000n },
      ],
    })
    const row = db
      .query<{ amount: number }, [number]>(
        "SELECT amount FROM account_balances WHERE account_id = ?",
      )
      .get(userBtc)
    expect(row?.amount).toBe(100000000)
  })

  test("accumulates across multiple postings", () => {
    for (const key of ["a", "b", "c"]) {
      ledger.post({
        kind: "deposit",
        idempotencyKey: key,
        entries: [
          { accountId: externalBtc, asset: "BTC", amount: -50000000n },
          { accountId: userBtc, asset: "BTC", amount: 50000000n },
        ],
      })
    }
    const row = db
      .query<{ amount: number }, [number]>(
        "SELECT amount FROM account_balances WHERE account_id = ?",
      )
      .get(userBtc)
    expect(row?.amount).toBe(150000000)
  })

  test("replaying an idempotency key returns the original transaction and writes nothing", () => {
    const input = {
      kind: "deposit",
      idempotencyKey: "dep-1",
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -100000000n },
        { accountId: userBtc, asset: "BTC", amount: 100000000n },
      ],
    }
    const first = ledger.post(input)
    const second = ledger.post(input)

    expect(second.transactionId).toBe(first.transactionId)
    expect(second.replayed).toBe(true)

    const entryCount = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM ledger_entries")
      .get()!.n
    expect(entryCount).toBe(2)

    const row = db
      .query<{ amount: number }, [number]>(
        "SELECT amount FROM account_balances WHERE account_id = ?",
      )
      .get(userBtc)
    expect(row?.amount).toBe(100000000)
  })

  test("rejects an unbalanced posting and writes nothing", () => {
    expect(
      codeOf(() =>
        ledger.post({
          kind: "deposit",
          idempotencyKey: "bad",
          entries: [
            { accountId: externalBtc, asset: "BTC", amount: -100n },
            { accountId: userBtc, asset: "BTC", amount: 99n },
          ],
        }),
      ),
    ).toBe("unbalanced")

    const txCount = db
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM ledger_transactions")
      .get()!.n
    expect(txCount).toBe(0)
  })

  test("rejects a posting that would drive a user account negative", () => {
    expect(
      codeOf(() =>
        ledger.post({
          kind: "withdrawal",
          idempotencyKey: "over",
          entries: [
            { accountId: userBtc, asset: "BTC", amount: -1n },
            { accountId: externalBtc, asset: "BTC", amount: 1n },
          ],
        }),
      ),
    ).toBe("insufficient_balance")
  })

  test("permits a platform account to go negative", () => {
    const treasury = ledger.ensureAccount(null, "BTC", "platform_treasury")
    expect(() =>
      ledger.post({
        kind: "adjustment",
        idempotencyKey: "neg",
        entries: [
          { accountId: treasury, asset: "BTC", amount: -100n },
          { accountId: userBtc, asset: "BTC", amount: 100n },
        ],
      }),
    ).not.toThrow()
  })

  test("rejects an entry whose asset does not match its account", () => {
    expect(
      codeOf(() =>
        ledger.post({
          kind: "deposit",
          idempotencyKey: "mismatch",
          entries: [
            { accountId: externalBtc, asset: "ETH", amount: -100n },
            { accountId: userBtc, asset: "ETH", amount: 100n },
          ],
        }),
      ),
    ).toBe("asset_mismatch")
  })

  test("rejects an entry referencing an account that does not exist", () => {
    expect(
      codeOf(() =>
        ledger.post({
          kind: "deposit",
          idempotencyKey: "ghost",
          entries: [
            { accountId: 99999, asset: "BTC", amount: -100n },
            { accountId: userBtc, asset: "BTC", amount: 100n },
          ],
        }),
      ),
    ).toBe("account_not_found")
  })

  test("persists metadata and external reference", () => {
    const { transactionId } = ledger.post({
      kind: "deposit",
      idempotencyKey: "meta",
      externalRef: "txhash-abc",
      metadata: { chain: "bitcoin", confirmations: 2 },
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -100n },
        { accountId: userBtc, asset: "BTC", amount: 100n },
      ],
    })
    const row = db
      .query<{ external_ref: string; metadata: string }, [number]>(
        "SELECT external_ref, metadata FROM ledger_transactions WHERE id = ?",
      )
      .get(transactionId)!
    expect(row.external_ref).toBe("txhash-abc")
    expect(JSON.parse(row.metadata)).toEqual({ chain: "bitcoin", confirmations: 2 })
  })

  test("preserves conservation: all entries for an asset sum to zero", () => {
    for (let i = 0; i < 50; i++) {
      ledger.post({
        kind: "deposit",
        idempotencyKey: `k-${i}`,
        entries: [
          { accountId: externalBtc, asset: "BTC", amount: -1000n },
          { accountId: userBtc, asset: "BTC", amount: 1000n },
        ],
      })
    }
    const total = db
      .query<{ total: number }, []>(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE asset = 'BTC'",
      )
      .get()!.total
    expect(total).toBe(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/db/repositories/ledger-post.test.ts`
Expected: FAIL, cannot resolve `LedgerRepository`.

- [ ] **Step 4: Implement `src/db/repositories/ledger.ts`**

```ts
import type { Database } from "bun:sqlite"
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
          const balance = this.db
            .query<{ amount: number }, [number]>(
              "SELECT amount FROM account_balances WHERE account_id = ?",
            )
            .get(entry.accountId)!
          if (BigInt(balance.amount) < 0n) {
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
}
```

Note on `WHERE user_id IS ?`: SQLite's `IS` operator handles null comparison correctly where `=` does not. This matters because platform accounts carry a null `user_id`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/db/repositories/ledger-post.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Run the whole suite**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: transactional ledger posting with idempotency and negative-balance rejection"
```

---

## Task 8: Balance and history queries

**Files:**
- Modify: `src/db/repositories/ledger.ts`
- Test: `tests/db/repositories/ledger-queries.test.ts`

**Interfaces:**
- Consumes: `LedgerRepository` from Task 7
- Produces, added to `LedgerRepository`:
  - `balance(userId: number, asset: string): { available: bigint; held: bigint }`
  - `balances(userId: number): Map<string, { available: bigint; held: bigint }>`
  - `history(userId: number, opts: { asset?: string; cursor?: number; limit: number }): { entries: LedgerEntry[]; nextCursor: number | null }`
  - `interface LedgerEntry { id: number; transactionId: number; kind: string; asset: string; amount: bigint; externalRef: string | null; createdAt: string }`

- [ ] **Step 1: Write the failing test**

Create `tests/db/repositories/ledger-queries.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { LedgerRepository } from "../../../src/db/repositories/ledger"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let ledger: LedgerRepository
let userId: number
let otherId: number

function credit(user: number, asset: string, amount: bigint, key: string): void {
  const external = ledger.ensureAccount(null, asset, "external_deposit")
  const available = ledger.ensureAccount(user, asset, "user_available")
  ledger.post({
    kind: "deposit",
    idempotencyKey: key,
    entries: [
      { accountId: external, asset, amount: -amount },
      { accountId: available, asset, amount },
    ],
  })
}

beforeEach(() => {
  db = freshDb()
  ledger = new LedgerRepository(db)
  userId = createUser(db, "a@test.co")
  otherId = createUser(db, "b@test.co")
})

describe("balance", () => {
  test("returns zero for an asset the user has never held", () => {
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 0n, held: 0n })
  })

  test("reflects a credit", () => {
    credit(userId, "BTC", 100000000n, "k1")
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 100000000n, held: 0n })
  })

  test("returns bigint, not number", () => {
    credit(userId, "BTC", 100000000n, "k1")
    expect(typeof ledger.balance(userId, "BTC").available).toBe("bigint")
  })

  test("does not leak another user's balance", () => {
    credit(otherId, "BTC", 100000000n, "k1")
    expect(ledger.balance(userId, "BTC").available).toBe(0n)
  })
})

describe("balances", () => {
  test("returns every asset the user holds", () => {
    credit(userId, "BTC", 100000000n, "k1")
    credit(userId, "ETH", 200000000n, "k2")
    const all = ledger.balances(userId)
    expect(all.get("BTC")?.available).toBe(100000000n)
    expect(all.get("ETH")?.available).toBe(200000000n)
  })

  test("returns an empty map for a user with no accounts", () => {
    expect(ledger.balances(userId).size).toBe(0)
  })
})

describe("history", () => {
  beforeEach(() => {
    for (let i = 0; i < 25; i++) {
      credit(userId, "BTC", 1000n, `h-${i}`)
    }
  })

  test("returns the most recent entries first", () => {
    const { entries } = ledger.history(userId, { limit: 5 })
    expect(entries).toHaveLength(5)
    expect(entries[0]!.id).toBeGreaterThan(entries[4]!.id)
  })

  test("includes the transaction kind", () => {
    const { entries } = ledger.history(userId, { limit: 1 })
    expect(entries[0]!.kind).toBe("deposit")
  })

  test("returns amounts as bigint", () => {
    const { entries } = ledger.history(userId, { limit: 1 })
    expect(entries[0]!.amount).toBe(1000n)
  })

  test("pages with a cursor without repeating or skipping", () => {
    const first = ledger.history(userId, { limit: 10 })
    const second = ledger.history(userId, { limit: 10, cursor: first.nextCursor! })
    const ids = new Set([...first.entries, ...second.entries].map((e) => e.id))
    expect(ids.size).toBe(20)
  })

  test("returns a null cursor on the final page", () => {
    const { nextCursor } = ledger.history(userId, { limit: 100 })
    expect(nextCursor).toBeNull()
  })

  test("filters by asset", () => {
    credit(userId, "ETH", 5000n, "eth-1")
    const { entries } = ledger.history(userId, { asset: "ETH", limit: 100 })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.asset).toBe("ETH")
  })

  test("excludes other users' entries", () => {
    credit(otherId, "BTC", 9999n, "other-1")
    const { entries } = ledger.history(userId, { limit: 100 })
    expect(entries.every((e) => e.amount === 1000n)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/db/repositories/ledger-queries.test.ts`
Expected: FAIL, `ledger.balance is not a function`.

- [ ] **Step 3: Add the query methods to `src/db/repositories/ledger.ts`**

Add this interface near the top of the file, after the existing `AccountRow` interface:

```ts
export interface LedgerEntry {
  id: number
  transactionId: number
  kind: string
  asset: string
  amount: bigint
  externalRef: string | null
  createdAt: string
}
```

Add these methods inside the `LedgerRepository` class, after `post`:

```ts
  balance(userId: number, asset: string): { available: bigint; held: bigint } {
    const rows = this.db
      .query<{ type: string; amount: number }, [number, string]>(
        `SELECT a.type, COALESCE(b.amount, 0) AS amount
         FROM accounts a
         LEFT JOIN account_balances b ON b.account_id = a.id
         WHERE a.user_id = ? AND a.asset = ?`,
      )
      .all(userId, asset)

    let available = 0n
    let held = 0n
    for (const row of rows) {
      if (row.type === "user_available") available = BigInt(row.amount)
      if (row.type === "user_hold") held = BigInt(row.amount)
    }
    return { available, held }
  }

  balances(userId: number): Map<string, { available: bigint; held: bigint }> {
    const rows = this.db
      .query<{ asset: string; type: string; amount: number }, [number]>(
        `SELECT a.asset, a.type, COALESCE(b.amount, 0) AS amount
         FROM accounts a
         LEFT JOIN account_balances b ON b.account_id = a.id
         WHERE a.user_id = ?`,
      )
      .all(userId)

    const result = new Map<string, { available: bigint; held: bigint }>()
    for (const row of rows) {
      const current = result.get(row.asset) ?? { available: 0n, held: 0n }
      if (row.type === "user_available") current.available = BigInt(row.amount)
      if (row.type === "user_hold") current.held = BigInt(row.amount)
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

    const rows = this.db
      .query<
        {
          id: number
          transaction_id: number
          kind: string
          asset: string
          amount: number
          external_ref: string | null
          created_at: string
        },
        (number | string)[]
      >(
        `SELECT e.id, e.transaction_id, t.kind, e.asset, e.amount, t.external_ref, e.created_at
         FROM ledger_entries e
         JOIN accounts a ON a.id = e.account_id
         JOIN ledger_transactions t ON t.id = e.transaction_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY e.id DESC
         LIMIT ?`,
      )
      .all(...params)

    const hasMore = rows.length > opts.limit
    const page = hasMore ? rows.slice(0, opts.limit) : rows

    return {
      entries: page.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id,
        kind: row.kind,
        asset: row.asset,
        amount: BigInt(row.amount),
        externalRef: row.external_ref,
        createdAt: row.created_at,
      })),
      nextCursor: hasMore ? (page[page.length - 1]!.id as number) : null,
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/db/repositories/ledger-queries.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: ledger balance and cursor-paged history queries"
```

---

## Task 9: Holds

**Files:**
- Modify: `src/db/repositories/ledger.ts`
- Test: `tests/db/repositories/ledger-holds.test.ts`

**Interfaces:**
- Consumes: `LedgerRepository` from Tasks 7 and 8
- Produces, added to `LedgerRepository`:
  - `hold(userId: number, asset: string, amount: bigint, reference: string, idempotencyKey: string): { holdId: number }`
  - `release(holdId: number, idempotencyKey: string): void`
  - `consume(holdId: number, destinationAccountId: number, idempotencyKey: string): void`

- [ ] **Step 1: Write the failing test**

Create `tests/db/repositories/ledger-holds.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { LedgerRepository } from "../../../src/db/repositories/ledger"
import { LedgerError } from "../../../src/domain/ledger/types"
import { freshDb, createUser } from "../../support/fixtures"

let db: Database
let ledger: LedgerRepository
let userId: number

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof LedgerError) return error.code
    throw error
  }
  throw new Error("expected the call to throw, it did not")
}

beforeEach(() => {
  db = freshDb()
  ledger = new LedgerRepository(db)
  userId = createUser(db)
  const external = ledger.ensureAccount(null, "BTC", "external_deposit")
  const available = ledger.ensureAccount(userId, "BTC", "user_available")
  ledger.post({
    kind: "deposit",
    idempotencyKey: "seed",
    entries: [
      { accountId: external, asset: "BTC", amount: -100000000n },
      { accountId: available, asset: "BTC", amount: 100000000n },
    ],
  })
})

describe("hold", () => {
  test("moves value from available to held", () => {
    ledger.hold(userId, "BTC", 30000000n, "withdrawal-1", "hold-1")
    expect(ledger.balance(userId, "BTC")).toEqual({
      available: 70000000n,
      held: 30000000n,
    })
  })

  test("records an active hold row", () => {
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "withdrawal-1", "hold-1")
    const row = db
      .query<{ status: string; amount: number; reference: string }, [number]>(
        "SELECT status, amount, reference FROM holds WHERE id = ?",
      )
      .get(holdId)!
    expect(row).toMatchObject({
      status: "active",
      amount: 30000000,
      reference: "withdrawal-1",
    })
  })

  test("rejects a hold exceeding the available balance", () => {
    expect(
      codeOf(() => ledger.hold(userId, "BTC", 200000000n, "too-much", "hold-1")),
    ).toBe("insufficient_balance")
  })

  test("permits holding the entire available balance", () => {
    ledger.hold(userId, "BTC", 100000000n, "all", "hold-1")
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 0n, held: 100000000n })
  })

  test("sums multiple active holds into the held balance", () => {
    ledger.hold(userId, "BTC", 10000000n, "a", "hold-a")
    ledger.hold(userId, "BTC", 20000000n, "b", "hold-b")
    expect(ledger.balance(userId, "BTC").held).toBe(30000000n)
  })
})

describe("release", () => {
  test("returns held value to available", () => {
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.release(holdId, "release-1")
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 100000000n, held: 0n })
  })

  test("marks the hold released and records the closing transaction", () => {
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.release(holdId, "release-1")
    const row = db
      .query<{ status: string; close_transaction_id: number | null }, [number]>(
        "SELECT status, close_transaction_id FROM holds WHERE id = ?",
      )
      .get(holdId)!
    expect(row.status).toBe("released")
    expect(row.close_transaction_id).not.toBeNull()
  })

  test("rejects releasing a hold twice", () => {
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.release(holdId, "release-1")
    expect(codeOf(() => ledger.release(holdId, "release-2"))).toBe("hold_not_active")
  })

  test("rejects releasing an unknown hold", () => {
    expect(codeOf(() => ledger.release(9999, "release-1"))).toBe("hold_not_active")
  })
})

describe("consume", () => {
  test("moves held value to the destination and leaves available untouched", () => {
    const external = ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.consume(holdId, external, "consume-1")
    expect(ledger.balance(userId, "BTC")).toEqual({ available: 70000000n, held: 0n })
  })

  test("marks the hold consumed", () => {
    const external = ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.consume(holdId, external, "consume-1")
    const row = db
      .query<{ status: string }, [number]>("SELECT status FROM holds WHERE id = ?")
      .get(holdId)!
    expect(row.status).toBe("consumed")
  })

  test("rejects consuming an already-released hold", () => {
    const external = ledger.ensureAccount(null, "BTC", "external_withdrawal")
    const { holdId } = ledger.hold(userId, "BTC", 30000000n, "w-1", "hold-1")
    ledger.release(holdId, "release-1")
    expect(codeOf(() => ledger.consume(holdId, external, "consume-1"))).toBe(
      "hold_not_active",
    )
  })
})

describe("hold invariant", () => {
  test("the sum of active holds equals the user_hold account balance", () => {
    ledger.hold(userId, "BTC", 10000000n, "a", "hold-a")
    const { holdId } = ledger.hold(userId, "BTC", 20000000n, "b", "hold-b")
    ledger.hold(userId, "BTC", 5000000n, "c", "hold-c")
    ledger.release(holdId, "release-b")

    const activeSum = db
      .query<{ total: number }, [number]>(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM holds
         WHERE user_id = ? AND asset = 'BTC' AND status = 'active'`,
      )
      .get(userId)!.total

    expect(BigInt(activeSum)).toBe(ledger.balance(userId, "BTC").held)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/db/repositories/ledger-holds.test.ts`
Expected: FAIL, `ledger.hold is not a function`.

- [ ] **Step 3: Add the hold methods to `src/db/repositories/ledger.ts`**

Add these methods inside the `LedgerRepository` class, after `history`:

```ts
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
    const hold = this.db
      .query<
        { id: number; user_id: number; asset: string; amount: number; status: string },
        [number]
      >("SELECT id, user_id, asset, amount, status FROM holds WHERE id = ?")
      .get(holdId)

    if (!hold || hold.status !== "active") {
      throw new LedgerError("hold_not_active", `Hold ${holdId} is not active`)
    }

    const heldAccount = this.ensureAccount(hold.user_id, hold.asset, "user_hold")
    const destination =
      destinationAccountId ?? this.ensureAccount(hold.user_id, hold.asset, "user_available")
    const amount = BigInt(hold.amount)
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/db/repositories/ledger-holds.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the whole suite**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ledger holds with release and consume as balanced transactions"
```

---

## Task 10: Ledger reconciliation command

Independently verifies every invariant against the journal, without trusting any application code that wrote it.

**Files:**
- Create: `scripts/verify-ledger.ts`
- Modify: `package.json`
- Test: `tests/scripts/verify-ledger.test.ts`

**Interfaces:**
- Consumes: `openDatabase` from Task 2, `LedgerRepository` from Tasks 7 to 9
- Produces:
  - `interface Violation { invariant: string; detail: string }`
  - `verifyLedger(db: Database): { ok: boolean; violations: Violation[]; checked: { transactions: number; entries: number; accounts: number } }`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/verify-ledger.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { verifyLedger } from "../../scripts/verify-ledger"
import { freshDb, createUser } from "../support/fixtures"

let db: Database
let ledger: LedgerRepository
let userId: number

beforeEach(() => {
  db = freshDb()
  ledger = new LedgerRepository(db)
  userId = createUser(db)
})

function deposit(amount: bigint, key: string): void {
  const external = ledger.ensureAccount(null, "BTC", "external_deposit")
  const available = ledger.ensureAccount(userId, "BTC", "user_available")
  ledger.post({
    kind: "deposit",
    idempotencyKey: key,
    entries: [
      { accountId: external, asset: "BTC", amount: -amount },
      { accountId: available, asset: "BTC", amount },
    ],
  })
}

describe("verifyLedger", () => {
  test("passes on an empty ledger", () => {
    expect(verifyLedger(db).ok).toBe(true)
  })

  test("passes after well-formed postings", () => {
    for (let i = 0; i < 100; i++) deposit(1000n, `k-${i}`)
    const result = verifyLedger(db)
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
    expect(result.checked.transactions).toBe(100)
    expect(result.checked.entries).toBe(200)
  })

  test("passes after holds and releases", () => {
    deposit(100000000n, "d-1")
    const { holdId } = ledger.hold(userId, "BTC", 40000000n, "w", "h-1")
    ledger.hold(userId, "BTC", 10000000n, "x", "h-2")
    ledger.release(holdId, "r-1")
    expect(verifyLedger(db).ok).toBe(true)
  })

  test("detects a drifted balance cache", () => {
    deposit(100000000n, "d-1")
    const accountId = ledger.ensureAccount(userId, "BTC", "user_available")
    db.query("UPDATE account_balances SET amount = amount + 1 WHERE account_id = ?").run(
      accountId,
    )
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("balance_cache")
  })

  test("detects a non-conserved asset", () => {
    deposit(100000000n, "d-1")
    const accountId = ledger.ensureAccount(userId, "BTC", "user_available")
    const txId = db
      .query<{ id: number }, []>("SELECT id FROM ledger_transactions LIMIT 1")
      .get()!.id
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 500, '2026-01-01')`,
    ).run(txId, accountId)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("conservation")
  })

  test("detects an unbalanced transaction", () => {
    deposit(100000000n, "d-1")
    const external = ledger.ensureAccount(null, "BTC", "external_deposit")
    const txId = db
      .query<{ id: number }, []>("SELECT id FROM ledger_transactions LIMIT 1")
      .get()!.id
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'BTC', 500, '2026-01-01')`,
    ).run(txId, external)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("transaction_balance")
  })

  test("detects a negative user balance", () => {
    deposit(100000000n, "d-1")
    const accountId = ledger.ensureAccount(userId, "BTC", "user_available")
    db.query("UPDATE account_balances SET amount = -1 WHERE account_id = ?").run(accountId)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("non_negative_user")
  })

  test("detects an entry whose asset does not match its account", () => {
    deposit(100000000n, "d-1")
    const accountId = ledger.ensureAccount(userId, "BTC", "user_available")
    const txId = db
      .query<{ id: number }, []>("SELECT id FROM ledger_transactions LIMIT 1")
      .get()!.id
    db.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, asset, amount, created_at)
       VALUES (?, ?, 'ETH', 100, '2026-01-01')`,
    ).run(txId, accountId)
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("entry_asset_match")
  })

  test("detects active holds that disagree with the held balance", () => {
    deposit(100000000n, "d-1")
    ledger.hold(userId, "BTC", 40000000n, "w", "h-1")
    db.query("UPDATE holds SET amount = 999 WHERE status = 'active'").run()
    const result = verifyLedger(db)
    expect(result.ok).toBe(false)
    expect(result.violations.map((v) => v.invariant)).toContain("hold_sum")
  })

  test("passes over a large synthetic journal", () => {
    for (let i = 0; i < 2000; i++) deposit(BigInt(1 + (i % 997)), `bulk-${i}`)
    expect(verifyLedger(db).ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/verify-ledger.test.ts`
Expected: FAIL, cannot resolve `verify-ledger`.

- [ ] **Step 3: Implement `scripts/verify-ledger.ts`**

```ts
import type { Database } from "bun:sqlite"
import { openDatabase } from "../src/db"
import { loadConfig } from "../src/config"

export interface Violation {
  invariant: string
  detail: string
}

export interface VerifyResult {
  ok: boolean
  violations: Violation[]
  checked: { transactions: number; entries: number; accounts: number }
}

export function verifyLedger(db: Database): VerifyResult {
  const violations: Violation[] = []

  const unbalanced = db
    .query<{ transaction_id: number; asset: string; total: number }, []>(
      `SELECT transaction_id, asset, SUM(amount) AS total
       FROM ledger_entries
       GROUP BY transaction_id, asset
       HAVING SUM(amount) <> 0`,
    )
    .all()
  for (const row of unbalanced) {
    violations.push({
      invariant: "transaction_balance",
      detail: `Transaction ${row.transaction_id} for ${row.asset} sums to ${row.total}, expected 0`,
    })
  }

  const mismatched = db
    .query<{ id: number; entry_asset: string; account_asset: string }, []>(
      `SELECT e.id, e.asset AS entry_asset, a.asset AS account_asset
       FROM ledger_entries e
       JOIN accounts a ON a.id = e.account_id
       WHERE e.asset <> a.asset`,
    )
    .all()
  for (const row of mismatched) {
    violations.push({
      invariant: "entry_asset_match",
      detail: `Entry ${row.id} declares ${row.entry_asset} but its account holds ${row.account_asset}`,
    })
  }

  const unconserved = db
    .query<{ asset: string; total: number }, []>(
      `SELECT asset, SUM(amount) AS total
       FROM ledger_entries
       GROUP BY asset
       HAVING SUM(amount) <> 0`,
    )
    .all()
  for (const row of unconserved) {
    violations.push({
      invariant: "conservation",
      detail: `All entries for ${row.asset} sum to ${row.total}, expected 0`,
    })
  }

  const drifted = db
    .query<{ account_id: number; cached: number; actual: number }, []>(
      `SELECT b.account_id, b.amount AS cached,
              COALESCE((SELECT SUM(e.amount) FROM ledger_entries e
                        WHERE e.account_id = b.account_id), 0) AS actual
       FROM account_balances b
       WHERE b.amount <> COALESCE((SELECT SUM(e.amount) FROM ledger_entries e
                                   WHERE e.account_id = b.account_id), 0)`,
    )
    .all()
  for (const row of drifted) {
    violations.push({
      invariant: "balance_cache",
      detail: `Account ${row.account_id} cache reads ${row.cached}, journal sums to ${row.actual}`,
    })
  }

  const negative = db
    .query<{ account_id: number; amount: number; type: string }, []>(
      `SELECT b.account_id, b.amount, a.type
       FROM account_balances b
       JOIN accounts a ON a.id = b.account_id
       WHERE a.type IN ('user_available', 'user_hold') AND b.amount < 0`,
    )
    .all()
  for (const row of negative) {
    violations.push({
      invariant: "non_negative_user",
      detail: `Account ${row.account_id} of type ${row.type} holds ${row.amount}`,
    })
  }

  const holdDrift = db
    .query<{ user_id: number; asset: string; hold_sum: number; account_amount: number }, []>(
      `SELECT a.user_id, a.asset,
              COALESCE((SELECT SUM(h.amount) FROM holds h
                        WHERE h.user_id = a.user_id AND h.asset = a.asset
                          AND h.status = 'active'), 0) AS hold_sum,
              COALESCE(b.amount, 0) AS account_amount
       FROM accounts a
       LEFT JOIN account_balances b ON b.account_id = a.id
       WHERE a.type = 'user_hold'
         AND COALESCE(b.amount, 0) <> COALESCE(
               (SELECT SUM(h.amount) FROM holds h
                WHERE h.user_id = a.user_id AND h.asset = a.asset
                  AND h.status = 'active'), 0)`,
    )
    .all()
  for (const row of holdDrift) {
    violations.push({
      invariant: "hold_sum",
      detail: `User ${row.user_id} ${row.asset}: active holds sum to ${row.hold_sum}, held account reads ${row.account_amount}`,
    })
  }

  const counts = db
    .query<{ transactions: number; entries: number; accounts: number }, []>(
      `SELECT
         (SELECT COUNT(*) FROM ledger_transactions) AS transactions,
         (SELECT COUNT(*) FROM ledger_entries) AS entries,
         (SELECT COUNT(*) FROM accounts) AS accounts`,
    )
    .get()!

  return { ok: violations.length === 0, violations, checked: counts }
}

if (import.meta.main) {
  const config = loadConfig()
  const db = openDatabase(config.databasePath)
  const result = verifyLedger(db)

  console.log(
    JSON.stringify(
      { ok: result.ok, checked: result.checked, violations: result.violations },
      null,
      2,
    ),
  )
  process.exit(result.ok ? 0 : 1)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/verify-ledger.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the script to `package.json`**

```json
{
  "scripts": {
    "verify-ledger": "bun scripts/verify-ledger.ts"
  }
}
```

- [ ] **Step 6: Run the whole suite and the typechecker**

Run: `bun test && bun run typecheck`
Expected: PASS, all tests, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: ledger reconciliation command verifying all six invariants"
```

---

## Plan 1 definition of done

1. `bun test` passes with every task's tests green.
2. `bun run typecheck` reports no errors.
3. `bun run verify-ledger` exits 0 against a fixture of at least 2,000 synthetic transactions.
4. Every response carries a CSP with no `unsafe-inline` and no `unsafe-eval`, verified by test.
5. No SQL exists outside `src/db/`.
6. `src/domain/` imports neither Express nor `bun:sqlite`.
7. No floating-point arithmetic touches a monetary value anywhere in `src/`.
8. Attempting to `UPDATE` or `DELETE` a ledger row raises, verified by test.

## What this plan does not build

Deferred to plan 2 (Identity): sessions, password hashing, TOTP, the KYC wizard, `sessions`, `kyc_applications`, and `audit_log` tables, and account provisioning at registration.

Deferred to plan 3 (Marketing site): Pug layouts, the design system stylesheet, Alpine CSP components, the price feed poller, SSE, and every public page.

Deferred to Slice 2 and beyond: all chain integration, all value movement, the dust crediting job, and Litestream replication.
