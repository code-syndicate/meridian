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
