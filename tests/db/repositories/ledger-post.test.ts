import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { LedgerRepository } from "../../../src/db/repositories/ledger"
import { LedgerError } from "../../../src/domain/ledger/types"
import { moneyQuery } from "../../../src/db"
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

// Money is always read as bigint. bun:sqlite returns INTEGER as a lossy JS
// number unless safeIntegers is set on the statement.
function balanceOf(accountId: number): bigint {
  return moneyQuery<{ amount: bigint }, [number]>(
    db,
    "SELECT amount FROM account_balances WHERE account_id = ?",
  ).get(accountId)!.amount
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
    expect(balanceOf(userBtc)).toBe(0n)
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
    expect(balanceOf(userBtc)).toBe(100000000n)
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
    expect(balanceOf(userBtc)).toBe(150000000n)
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

    expect(balanceOf(userBtc)).toBe(100000000n)
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

  test("handles a balance beyond 2^53 without precision loss", () => {
    // bun:sqlite returns INTEGER as a lossy JS number by default. Money reads
    // must use safeIntegers, or this amount comes back rounded.
    const huge = 9007199254740993n // 2^53 + 1
    ledger.post({
      kind: "deposit",
      idempotencyKey: "huge",
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -huge },
        { accountId: userBtc, asset: "BTC", amount: huge },
      ],
    })
    expect(balanceOf(userBtc)).toBe(huge)
  })

  test("still rejects a negative balance when amounts exceed 2^53", () => {
    const huge = 9007199254740993n
    expect(
      codeOf(() =>
        ledger.post({
          kind: "withdrawal",
          idempotencyKey: "huge-over",
          entries: [
            { accountId: userBtc, asset: "BTC", amount: -huge },
            { accountId: externalBtc, asset: "BTC", amount: huge },
          ],
        }),
      ),
    ).toBe("insufficient_balance")
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
