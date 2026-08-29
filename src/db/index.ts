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
