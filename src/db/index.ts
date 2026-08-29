import { Database } from "bun:sqlite"
import type { Statement, SQLQueryBindings } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Prepare a statement that returns INTEGER columns as bigint.
 *
 * bun:sqlite otherwise returns them as JS numbers, which silently round above
 * 2^53. Every read of a money column must go through this. The cast exists
 * because safeIntegers is missing from the current bun type definitions; it is
 * present at runtime.
 *
 * Note that bun caches prepared statements by SQL text, so enabling this for a
 * given query string affects every caller of that same string.
 */
export function moneyQuery<Row, Params extends SQLQueryBindings[]>(
  db: Database,
  sql: string,
): Statement<Row, Params> {
  const statement = db.query(sql) as unknown as Statement<Row, Params> & {
    safeIntegers(enabled: boolean): void
  }
  statement.safeIntegers(true)
  return statement
}

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
