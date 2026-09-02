import { createClient } from "@libsql/client"
import type { Client, InArgs, ResultSet, Row, Transaction } from "@libsql/client"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Anything statements can run against: the connection itself, or an open
 * interactive transaction. Repository methods take one of these so the same
 * method works standalone and inside a caller's transaction.
 */
export type Executor = Pick<Client, "execute">

export type { Client, Transaction }

/** Either a connection or an open transaction: what a method that may itself
 * open a (possibly nested) transaction accepts. */
export type Tx = Client | Transaction

/**
 * The client is opened with intMode "bigint", so SQLite INTEGER columns arrive
 * as bigint and money never rounds above 2^53. Ordinary reads then narrow to
 * number, matching what the rest of the code has always been handed; the money
 * helpers below skip that narrowing and keep the bigint.
 */
function narrow(value: unknown): unknown {
  if (typeof value !== "bigint") return value
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(
      `Integer ${value} exceeds safe range; read this column with a money helper`,
    )
  }
  return Number(value)
}

function toObject(row: Row, keepBigints: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(row)) {
    const value = (row as unknown as Record<string, unknown>)[key]
    out[key] = keepBigints ? value : narrow(value)
  }
  return out
}

export async function all<Row>(ex: Executor, sql: string, args: InArgs = []): Promise<Row[]> {
  const result = await ex.execute({ sql, args })
  return result.rows.map((row) => toObject(row, false)) as Row[]
}

export async function get<Row>(
  ex: Executor,
  sql: string,
  args: InArgs = [],
): Promise<Row | undefined> {
  const rows = await all<Row>(ex, sql, args)
  return rows[0]
}

export async function run(ex: Executor, sql: string, args: InArgs = []): Promise<ResultSet> {
  return ex.execute({ sql, args })
}

/**
 * Money reads. These keep INTEGER columns as bigint; every read of a balance or
 * an amount must go through them.
 */
export async function moneyAll<Row>(
  ex: Executor,
  sql: string,
  args: InArgs = [],
): Promise<Row[]> {
  const result = await ex.execute({ sql, args })
  return result.rows.map((row) => toObject(row, true)) as Row[]
}

export async function moneyGet<Row>(
  ex: Executor,
  sql: string,
  args: InArgs = [],
): Promise<Row | undefined> {
  const rows = await moneyAll<Row>(ex, sql, args)
  return rows[0]
}

/**
 * ":memory:" is translated to a private temporary file. libSQL opens a second
 * connection to run a transaction, and for a bare in-memory URL that connection
 * gets its own empty database: the first transaction appears to erase the
 * schema. A throwaway file is the same thing a caller asking for ":memory:"
 * actually wants, and it survives the second connection.
 */
const REMOTE = /^(libsql|https?|wss?):/

/** A bare filesystem path is a local database; libSQL wants it as a file: URL. */
function resolveUrl(url: string): string {
  if (url === ":memory:" || url === "file::memory:") {
    return `file:${join(mkdtempSync(join(tmpdir(), "meridian-")), "db.sqlite")}`
  }
  if (REMOTE.test(url) || url.startsWith("file:")) return url
  return `file:${url}`
}

export async function openDatabase(url: string, authToken?: string): Promise<Client> {
  const resolved = resolveUrl(url)
  const client = createClient({ url: resolved, authToken, intMode: "bigint" })
  // Only a local file has these to set. A remote database is configured on the
  // server, and libSQL rejects the journal pragmas over the wire.
  if (resolved.startsWith("file:")) {
    await client.execute("PRAGMA journal_mode = WAL")
    await client.execute("PRAGMA synchronous = FULL")
    await client.execute("PRAGMA foreign_keys = ON")
    await client.execute("PRAGMA busy_timeout = 5000")
  }
  return client
}

let savepointCounter = 0

/**
 * Run fn inside a transaction. Given the client this opens a real interactive
 * transaction; given an already-open transaction it opens a SAVEPOINT instead,
 * which keeps the nested rollback boundary the ledger relies on. libSQL has no
 * nested transactions of its own, so the savepoint is issued as plain SQL.
 *
 * Remote libSQL holds a lock for the life of the outermost transaction and
 * times out after five seconds, so keep bodies to as few round trips as the
 * work allows.
 */
export async function withTransaction<T>(
  ex: Tx,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (isTransaction(ex)) {
    const name = `sp_${++savepointCounter}`
    await ex.execute(`SAVEPOINT ${name}`)
    try {
      const result = await fn(ex)
      await ex.execute(`RELEASE ${name}`)
      return result
    } catch (error) {
      await ex.execute(`ROLLBACK TO ${name}`)
      await ex.execute(`RELEASE ${name}`)
      throw error
    }
  }

  const tx = await ex.transaction("write")
  try {
    const result = await fn(tx)
    await tx.commit()
    return result
  } catch (error) {
    await tx.rollback()
    throw error
  }
}

function isTransaction(ex: Tx): ex is Transaction {
  return typeof (ex as Transaction).commit === "function"
}

const DEFAULT_DIR = new URL("./migrations/", import.meta.url).pathname

export async function migrate(
  client: Client,
  dir: string = DEFAULT_DIR,
): Promise<{ applied: string[] }> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const done = new Set(
    (await all<{ filename: string }>(client, "SELECT filename FROM schema_migrations")).map(
      (row) => row.filename,
    ),
  )

  const pending = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => !done.has(name))

  const applied: string[] = []
  for (const name of pending) {
    const sql = readFileSync(join(dir, name), "utf8")
    // executeMultiple, not a transaction handle: migration files contain
    // trigger bodies whose own BEGIN ... END would confuse statement splitting.
    await client.executeMultiple(
      `BEGIN;\n${sql}\nINSERT INTO schema_migrations (filename, applied_at) VALUES ('${name.replace(/'/g, "''")}', '${new Date().toISOString()}');\nCOMMIT;`,
    )
    applied.push(name)
  }

  return { applied }
}
