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
