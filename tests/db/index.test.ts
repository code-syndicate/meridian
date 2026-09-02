import { test, expect, describe } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { all, get, migrate, openDatabase } from "../../src/db"

function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "meridian-mig-"))
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql)
  }
  return dir
}

describe("openDatabase", () => {
  test("enables foreign keys", async () => {
    const db = await openDatabase(":memory:")
    expect(await get(db, "PRAGMA foreign_keys")).toMatchObject({ foreign_keys: 1 })
  })

  test("sets a busy timeout", async () => {
    const db = await openDatabase(":memory:")
    expect(await get(db, "PRAGMA busy_timeout")).toMatchObject({ timeout: 5000 })
  })
})

describe("migrate", () => {
  test("applies migrations in filename order", async () => {
    const dir = fixtureDir({
      "0002-second.sql": "CREATE TABLE b (id INTEGER PRIMARY KEY);",
      "0001-first.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY);",
    })
    const db = await openDatabase(":memory:")
    const result = await migrate(db, dir)
    expect(result.applied).toEqual(["0001-first.sql", "0002-second.sql"])
  })

  test("is idempotent across repeated runs", async () => {
    const dir = fixtureDir({ "0001-first.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY);" })
    const db = await openDatabase(":memory:")
    await migrate(db, dir)
    const second = await migrate(db, dir)
    expect(second.applied).toEqual([])
  })

  test("rolls back a failing migration entirely", async () => {
    const dir = fixtureDir({
      "0001-bad.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY); THIS IS NOT SQL;",
    })
    const db = await openDatabase(":memory:")
    await expect(migrate(db, dir)).rejects.toThrow()
    const tables = await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'a'")
    expect(tables).toHaveLength(0)
  })

  test("ignores non-sql files", async () => {
    const dir = fixtureDir({
      "0001-first.sql": "CREATE TABLE a (id INTEGER PRIMARY KEY);",
      "README.md": "not a migration",
    })
    const db = await openDatabase(":memory:")
    expect((await migrate(db, dir)).applied).toEqual(["0001-first.sql"])
  })
})
