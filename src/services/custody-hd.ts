import { randomUUID } from "node:crypto"
import { deriveAddress, derivationPath, seedFromMnemonic } from "../domain/custody/derive"
import type {
  ChainDeposit,
  CustodyProvider,
  IssuedAddress,
  WithdrawalStatus,
  WithdrawalSubmission,
} from "./custody-provider"

/** Which chain an asset settles on, since a symbol alone does not say. */
const CHAIN_OF: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT_ERC20: "ethereum",
  USDC_ERC20: "ethereum",
  BNB: "bsc",
  USDT_BEP20: "bsc",
  TRX: "tron",
  USDT_TRC20: "tron",
  SOL: "solana",
  USDC_SPL: "solana",
}

/**
 * Derives real, verifiable addresses from a BIP39 phrase we hold. Restoring
 * the phrase in any standard wallet reproduces the same addresses, so anything
 * sent to one is genuinely recoverable.
 *
 * What it does not do is move value. Signing and broadcasting across five
 * chains is a separate build, so withdrawals and deposit detection are
 * simulated exactly as the sandbox does. The addresses are real; the movement
 * is not. Config refuses to select this provider in production.
 */
export class HdCustodyProvider implements CustodyProvider {
  readonly name = "hd"
  private readonly seed: Uint8Array
  private readonly pending: ChainDeposit[] = []
  private readonly withdrawals = new Map<string, WithdrawalStatus>()

  constructor(mnemonic: string) {
    this.seed = seedFromMnemonic(mnemonic)
  }

  static chainFor(asset: string): string {
    const chain = CHAIN_OF[asset]
    if (!chain) throw new Error(`No chain mapping for asset "${asset}"`)
    return chain
  }

  async issueAddress(input: { userId: number; asset: string }): Promise<IssuedAddress> {
    const chain = HdCustodyProvider.chainFor(input.asset)
    // The user id is the derivation index, so one address per user per chain
    // and every one of them reproducible from the phrase alone.
    const address = deriveAddress(this.seed, chain, input.userId)
    return {
      address,
      memo: null,
      providerRef: derivationPath(chain, input.userId),
    }
  }

  /** Operator hook for demonstrating an arrival. Not part of the interface. */
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
    const providerRef = `hdwd_${randomUUID()}`
    const failing = input.destination.toLowerCase().endsWith("fail")
    const txHash = `0xhd${providerRef.slice(-24)}`
    this.withdrawals.set(
      providerRef,
      failing
        ? { status: "failed", txHash: null, reason: "The network rejected the transaction." }
        : { status: "broadcast", txHash },
    )
    return { providerRef, txHash: failing ? null : txHash }
  }

  /** Operator hook for settling a demonstrated withdrawal. */
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
