import { test, expect, describe, beforeEach } from "bun:test"
import type { Client } from "../../../src/db"
import { LedgerRepository } from "../../../src/db/repositories/ledger"
import { LedgerError } from "../../../src/domain/ledger/types"
import { get, moneyGet } from "../../../src/db"
import { freshDb, createUser } from "../../support/fixtures"

let db: Client
let ledger: LedgerRepository
let userId: number
let userBtc: number
let externalBtc: number

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
  } catch (error) {
    if (error instanceof LedgerError) return error.code
    throw error
  }
  throw new Error("expected post to throw, it did not")
}

// Money is always read as bigint. bun:sqlite returns INTEGER as a lossy JS
// number unless safeIntegers is set on the statement.
async function balanceOf(accountId: number): Promise<bigint> {
  return (await moneyGet<{ amount: bigint }>(db, "SELECT amount FROM account_balances WHERE account_id = ?", [accountId]))!.amount
}

beforeEach(async () => {
  db = await freshDb()
  ledger = new LedgerRepository(db)
  userId = await createUser(db)
  userBtc = await ledger.ensureAccount(userId, "BTC", "user_available")
  externalBtc = await ledger.ensureAccount(null, "BTC", "external_deposit")
})

describe("ensureAccount", () => {
  test("creates an account once and returns the same id thereafter", async () => {
    const first = await ledger.ensureAccount(userId, "ETH", "user_available")
    const second = await ledger.ensureAccount(userId, "ETH", "user_available")
    expect(second).toBe(first)
  })

  test("creates a zeroed balance row alongside the account", async () => {
    expect(await balanceOf(userBtc)).toBe(0n)
  })
})

describe("post", () => {
  test("writes a balanced posting and returns its transaction id", async () => {
    const { transactionId, replayed } = await ledger.post({
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

  test("updates the materialized balance inside the same transaction", async () => {
    await ledger.post({
      kind: "deposit",
      idempotencyKey: "dep-1",
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -100000000n },
        { accountId: userBtc, asset: "BTC", amount: 100000000n },
      ],
    })
    expect(await balanceOf(userBtc)).toBe(100000000n)
  })

  test("accumulates across multiple postings", async () => {
    for (const key of ["a", "b", "c"]) {
      await ledger.post({
        kind: "deposit",
        idempotencyKey: key,
        entries: [
          { accountId: externalBtc, asset: "BTC", amount: -50000000n },
          { accountId: userBtc, asset: "BTC", amount: 50000000n },
        ],
      })
    }
    expect(await balanceOf(userBtc)).toBe(150000000n)
  })

  test("replaying an idempotency key returns the original transaction and writes nothing", async () => {
    const input = {
      kind: "deposit",
      idempotencyKey: "dep-1",
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -100000000n },
        { accountId: userBtc, asset: "BTC", amount: 100000000n },
      ],
    }
    const first = await ledger.post(input)
    const second = await ledger.post(input)

    expect(second.transactionId).toBe(first.transactionId)
    expect(second.replayed).toBe(true)

    const entryCount = (await get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM ledger_entries"))!.n
    expect(entryCount).toBe(2)

    expect(await balanceOf(userBtc)).toBe(100000000n)
  })

  test("rejects an unbalanced posting and writes nothing", async () => {
    expect(
      await codeOf(async () =>
        await ledger.post({
          kind: "deposit",
          idempotencyKey: "bad",
          entries: [
            { accountId: externalBtc, asset: "BTC", amount: -100n },
            { accountId: userBtc, asset: "BTC", amount: 99n },
          ],
        }),
      ),
    ).toBe("unbalanced")

    const txCount = (await get<{ n: number }>(db, "SELECT COUNT(*) AS n FROM ledger_transactions"))!.n
    expect(txCount).toBe(0)
  })

  test("rejects a posting that would drive a user account negative", async () => {
    expect(
      await codeOf(async () =>
        await ledger.post({
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

  test("permits a platform account to go negative", async () => {
    const treasury = await ledger.ensureAccount(null, "BTC", "platform_treasury")
    await ledger.post({
      kind: "adjustment",
      idempotencyKey: "neg",
      entries: [
        { accountId: treasury, asset: "BTC", amount: -100n },
        { accountId: userBtc, asset: "BTC", amount: 100n },
      ],
    })
  })

  test("rejects an entry whose asset does not match its account", async () => {
    expect(
      await codeOf(async () =>
        await ledger.post({
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

  test("rejects an entry referencing an account that does not exist", async () => {
    expect(
      await codeOf(async () =>
        await ledger.post({
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

  test("persists metadata and external reference", async () => {
    const { transactionId } = await ledger.post({
      kind: "deposit",
      idempotencyKey: "meta",
      externalRef: "txhash-abc",
      metadata: { chain: "bitcoin", confirmations: 2 },
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -100n },
        { accountId: userBtc, asset: "BTC", amount: 100n },
      ],
    })
    const row = (await get<{ external_ref: string; metadata: string }>(db, "SELECT external_ref, metadata FROM ledger_transactions WHERE id = ?", [transactionId]))!
    expect(row.external_ref).toBe("txhash-abc")
    expect(JSON.parse(row.metadata)).toEqual({ chain: "bitcoin", confirmations: 2 })
  })

  test("handles a balance beyond 2^53 without precision loss", async () => {
    // bun:sqlite returns INTEGER as a lossy JS number by default. Money reads
    // must use safeIntegers, or this amount comes back rounded.
    const huge = 9007199254740993n // 2^53 + 1
    await ledger.post({
      kind: "deposit",
      idempotencyKey: "huge",
      entries: [
        { accountId: externalBtc, asset: "BTC", amount: -huge },
        { accountId: userBtc, asset: "BTC", amount: huge },
      ],
    })
    expect(await balanceOf(userBtc)).toBe(huge)
  })

  test("still rejects a negative balance when amounts exceed 2^53", async () => {
    const huge = 9007199254740993n
    expect(
      await codeOf(async () =>
        await ledger.post({
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

  test("preserves conservation: all entries for an asset sum to zero", async () => {
    for (let i = 0; i < 50; i++) {
      await ledger.post({
        kind: "deposit",
        idempotencyKey: `k-${i}`,
        entries: [
          { accountId: externalBtc, asset: "BTC", amount: -1000n },
          { accountId: userBtc, asset: "BTC", amount: 1000n },
        ],
      })
    }
    const total = (await get<{ total: number }>(db, "SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE asset = 'BTC'"))!.total
    expect(total).toBe(0)
  })
})
