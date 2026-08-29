import { createHash, randomUUID } from "node:crypto"

export interface IssuedAddress {
  address: string
  memo: string | null
  providerRef: string
}

export interface ChainDeposit {
  asset: string
  address: string
  txHash: string
  outputIndex: number
  /** Native chain units as a decimal string, e.g. wei for ETH. */
  nativeAmount: string
  confirmations: number
}

export interface WithdrawalSubmission {
  providerRef: string
  txHash: string | null
}

export interface WithdrawalStatus {
  status: "pending" | "broadcast" | "confirmed" | "failed"
  txHash: string | null
  reason?: string
}

/**
 * The custody boundary. Fireblocks, BitGo, Cobo, and Dfns all fit this shape:
 * issue a deposit address, report inbound deposits, submit a withdrawal, and
 * report its status. Nothing above this interface knows which is in use, and
 * no private key ever crosses it.
 */
export interface CustodyProvider {
  readonly name: string
  issueAddress(input: { userId: number; asset: string }): Promise<IssuedAddress>
  pollDeposits(since?: string): Promise<ChainDeposit[]>
  submitWithdrawal(input: {
    asset: string
    destination: string
    memo: string | null
    nativeAmount: string
    idempotencyKey: string
  }): Promise<WithdrawalSubmission>
  getWithdrawal(providerRef: string): Promise<WithdrawalStatus>
}

/**
 * Deterministic stand-in. Addresses are derived from a hash so they are stable
 * per user and asset; deposits and withdrawal outcomes are driven by test
 * hooks. Never selected in production: the config guard refuses to start.
 */
export class SandboxCustodyProvider implements CustodyProvider {
  readonly name = "sandbox"
  private readonly pending: ChainDeposit[] = []
  private readonly withdrawals = new Map<string, WithdrawalStatus>()

  private static prefixFor(asset: string): string {
    if (asset === "BTC") return "bc1q"
    if (asset.endsWith("TRC20") || asset === "TRX") return "T"
    if (asset === "SOL" || asset.endsWith("SPL")) return "So"
    return "0x"
  }

  async issueAddress(input: { userId: number; asset: string }): Promise<IssuedAddress> {
    const digest = createHash("sha256")
      .update(`sandbox:${input.asset}:${input.userId}`)
      .digest("hex")
    const prefix = SandboxCustodyProvider.prefixFor(input.asset)
    const body = prefix === "0x" ? digest.slice(0, 40) : digest.slice(0, 33)
    return {
      address: `${prefix}${body}`,
      memo: null,
      providerRef: `sbxaddr_${digest.slice(0, 16)}`,
    }
  }

  /** Test and development hook. Not part of the interface. */
  seedDeposit(deposit: ChainDeposit): void {
    this.pending.push(deposit)
  }

  async pollDeposits(): Promise<ChainDeposit[]> {
    return [...this.pending]
  }

  async submitWithdrawal(input: {
    asset: string
    destination: string
    memo: string | null
    nativeAmount: string
    idempotencyKey: string
  }): Promise<WithdrawalSubmission> {
    const providerRef = `sbxwd_${randomUUID()}`
    // A destination ending "fail" fails, so the failure path is demonstrable.
    const failing = input.destination.toLowerCase().endsWith("fail")
    this.withdrawals.set(
      providerRef,
      failing
        ? { status: "failed", txHash: null, reason: "The network rejected the transaction." }
        : { status: "broadcast", txHash: `0xsbx${providerRef.slice(-24)}` },
    )
    return { providerRef, txHash: failing ? null : `0xsbx${providerRef.slice(-24)}` }
  }

  /** Test and development hook. */
  settle(providerRef: string, status: WithdrawalStatus): void {
    this.withdrawals.set(providerRef, status)
  }

  async getWithdrawal(providerRef: string): Promise<WithdrawalStatus> {
    // An unknown reference must not read as confirmed. Fail closed.
    return (
      this.withdrawals.get(providerRef) ?? {
        status: "failed",
        txHash: null,
        reason: "Unknown withdrawal reference",
      }
    )
  }
}
