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
