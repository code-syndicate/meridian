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
