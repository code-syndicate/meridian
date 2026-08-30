import { test, expect, describe, beforeEach } from "bun:test"
import { testLimits } from "../support/limits"
import type { Database } from "bun:sqlite"
import { CustodyService } from "../../src/services/custody"
import { SandboxCustodyProvider } from "../../src/services/custody-provider"
import { CustodyRepository } from "../../src/db/repositories/custody"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { AssetRepository } from "../../src/db/repositories/assets"
import { AuditRepository } from "../../src/db/repositories/audit"
import { LedgerError } from "../../src/domain/ledger/types"
import { freshDb, createUser } from "../support/fixtures"

let db: Database
let svc: CustodyService
let custody: CustodyRepository
let ledger: LedgerRepository
let assets: AssetRepository
let provider: SandboxCustodyProvider
let userId: number

const BTC = "BTC"
const ETH = "ETH"

beforeEach(() => {
  db = freshDb()
  custody = new CustodyRepository(db)
  ledger = new LedgerRepository(db)
  assets = new AssetRepository(db)
  provider = new SandboxCustodyProvider()
  svc = new CustodyService({ assets, ledger, custody, audit: new AuditRepository(db), provider, limits: testLimits(db) })
  userId = createUser(db)
})

async function addressFor(symbol: string): Promise<string> {
  return (await svc.addressFor(userId, assets.find(symbol)!)).address
}

function deposit(symbol: string, address: string, native: string, confirmations: number, tx = "0xtx1") {
  return { asset: symbol, address, txHash: tx, outputIndex: 0, nativeAmount: native, confirmations }
}

describe("deposit addresses", () => {
  test("issues an address for a user and asset", async () => {
    expect(await addressFor(BTC)).toStartWith("bc1q")
  })

  test("returns the same address on a second call", async () => {
    expect(await addressFor(BTC)).toBe(await addressFor(BTC))
  })

  test("issues a different address per asset", async () => {
    expect(await addressFor(BTC)).not.toBe(await addressFor(ETH))
  })

  test("issues a different address per user", async () => {
    const mine = await addressFor(BTC)
    const other = createUser(db, "b@test.co")
    const theirs = (await svc.addressFor(other, assets.find(BTC)!)).address
    expect(theirs).not.toBe(mine)
  })

  test("uses a chain-appropriate prefix", async () => {
    expect(await addressFor("USDT_TRC20")).toStartWith("T")
    expect(await addressFor("USDT_ERC20")).toStartWith("0x")
  })
})

describe("crediting deposits", () => {
  test("ignores a deposit to an unknown address", () => {
    expect(svc.creditDeposit(deposit(BTC, "bc1qnobody", "100000000", 6)).status).toBe("ignored")
  })

  test("ignores a deposit for an unknown asset", async () => {
    const addr = await addressFor(BTC)
    expect(svc.creditDeposit(deposit("DOGE", addr, "1", 6)).status).toBe("ignored")
  })

  test("holds a deposit below the confirmation threshold", async () => {
    const addr = await addressFor(BTC)
    // BTC requires 2 confirmations.
    expect(svc.creditDeposit(deposit(BTC, addr, "100000000", 1)).status).toBe("confirming")
    expect(ledger.balance(userId, BTC).available).toBe(0n)
  })

  test("credits once the threshold is reached", async () => {
    const addr = await addressFor(BTC)
    const result = svc.creditDeposit(deposit(BTC, addr, "100000000", 2))
    expect(result.status).toBe("credited")
    expect(ledger.balance(userId, BTC).available).toBe(100000000n)
  })

  test("a confirming deposit later credits without double counting", async () => {
    const addr = await addressFor(BTC)
    svc.creditDeposit(deposit(BTC, addr, "100000000", 1))
    svc.creditDeposit(deposit(BTC, addr, "100000000", 2))
    expect(ledger.balance(userId, BTC).available).toBe(100000000n)
  })

  test("replaying a credited deposit changes nothing", async () => {
    const addr = await addressFor(BTC)
    svc.creditDeposit(deposit(BTC, addr, "100000000", 2))
    expect(svc.creditDeposit(deposit(BTC, addr, "100000000", 2)).status).toBe("replayed")
    expect(ledger.balance(userId, BTC).available).toBe(100000000n)
  })

  test("two different outputs both credit", async () => {
    const addr = await addressFor(BTC)
    svc.creditDeposit(deposit(BTC, addr, "100000000", 2, "0xaaa"))
    svc.creditDeposit(deposit(BTC, addr, "50000000", 2, "0xbbb"))
    expect(ledger.balance(userId, BTC).available).toBe(150000000n)
  })

  test("credits the right user when two users share an asset", async () => {
    const mine = await addressFor(BTC)
    const other = createUser(db, "b@test.co")
    await svc.addressFor(other, assets.find(BTC)!)
    svc.creditDeposit(deposit(BTC, mine, "100000000", 2))
    expect(ledger.balance(userId, BTC).available).toBe(100000000n)
    expect(ledger.balance(other, BTC).available).toBe(0n)
  })
})

describe("dust", () => {
  test("truncates an 18-decimal deposit and banks the remainder", async () => {
    const addr = await addressFor(ETH)
    // 1.234567890123456789 ETH. Internal precision keeps 8 decimals.
    const result = svc.creditDeposit(deposit(ETH, addr, "1234567890123456789", 12))
    expect(result.status).toBe("credited")
    expect(ledger.balance(userId, ETH).available).toBe(123456789n)
    expect(custody.dustFor(userId, ETH)).toBe(123456789n)
  })

  test("a deposit smaller than one base unit credits nothing and banks it all", async () => {
    const addr = await addressFor(ETH)
    const result = svc.creditDeposit(deposit(ETH, addr, "5000000000", 12))
    expect(result.status).toBe("confirming")
    expect(ledger.balance(userId, ETH).available).toBe(0n)
    expect(custody.dustFor(userId, ETH)).toBe(5000000000n)
  })

  test("accumulated dust is credited once it exceeds one base unit", async () => {
    const addr = await addressFor(ETH)
    // Two sub-threshold deposits that together cross 1e10 wei.
    svc.creditDeposit(deposit(ETH, addr, "6000000000", 12, "0xd1"))
    expect(ledger.balance(userId, ETH).available).toBe(0n)
    svc.creditDeposit(deposit(ETH, addr, "6000000000", 12, "0xd2"))
    expect(ledger.balance(userId, ETH).available).toBe(1n)
    expect(custody.dustFor(userId, ETH)).toBe(2000000000n)
  })

  test("no value is ever lost: credited plus dust equals what arrived", async () => {
    const addr = await addressFor(ETH)
    const native = 987654321987654321n
    svc.creditDeposit(deposit(ETH, addr, native.toString(), 12))
    const credited = ledger.balance(userId, ETH).available
    const dust = custody.dustFor(userId, ETH)
    expect(credited * 10n ** 10n + dust).toBe(native)
  })
})

describe("withdrawals", () => {
  async function fund(symbol: string, amount: bigint): Promise<void> {
    const addr = await addressFor(symbol)
    const asset = assets.find(symbol)!
    const native = (
      asset.nativeDecimals >= 8
        ? amount * 10n ** BigInt(asset.nativeDecimals - 8)
        : amount / 10n ** BigInt(8 - asset.nativeDecimals)
    ).toString()
    svc.creditDeposit(deposit(symbol, addr, native, asset.confirmationsRequired, `0xfund-${symbol}`))
  }

  test("places a hold covering amount plus fee", async () => {
    await fund(BTC, 100000000n)
    await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 1000n, idempotencyKey: "w1",
    })
    const balance = ledger.balance(userId, BTC)
    expect(balance.held).toBe(50001000n)
    expect(balance.available).toBe(49999000n)
  })

  test("refuses a withdrawal beyond the available balance", async () => {
    await fund(BTC, 10000000n)
    expect(
      svc.requestWithdrawal({
        userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
        amount: 90000000n, fee: 0n, idempotencyKey: "w2",
      }),
    ).rejects.toBeInstanceOf(LedgerError)
  })

  test("refuses an amount finer than the chain can represent", async () => {
    await fund("USDT_TRC20", 100000000n)
    // USDT has 6 native decimals; 8-decimal precision cannot be sent.
    expect(
      svc.requestWithdrawal({
        userId, tier: 2, asset: assets.find("USDT_TRC20")!, destination: "Tdest", memo: null,
        amount: 10000001n, fee: 0n, idempotencyKey: "w3",
      }),
    ).rejects.toBeInstanceOf(LedgerError)
  })

  test("confirming consumes the hold and removes the value", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "w4",
    })
    svc.confirmWithdrawal(withdrawalId, "0xdone")
    const balance = ledger.balance(userId, BTC)
    expect(balance.held).toBe(0n)
    expect(balance.available).toBe(50000000n)
  })

  test("failing releases the hold and returns the balance", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "w5",
    })
    svc.failWithdrawal(withdrawalId, "network rejected")
    const balance = ledger.balance(userId, BTC)
    expect(balance.held).toBe(0n)
    expect(balance.available).toBe(100000000n)
  })

  test("a settled withdrawal cannot be settled again", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "w6",
    })
    svc.confirmWithdrawal(withdrawalId, "0xdone")
    svc.confirmWithdrawal(withdrawalId, "0xdone")
    svc.failWithdrawal(withdrawalId, "late failure")
    expect(ledger.balance(userId, BTC).available).toBe(50000000n)
  })

  test("a provider failure releases the hold rather than stranding it", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qshouldfail", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "w7",
    })
    await svc.approveWithdrawal(withdrawalId, userId, null)
    await svc.settleWithdrawals(userId)
    expect(custody.findWithdrawal(withdrawalId)!.status).toBe("failed")
    expect(ledger.balance(userId, BTC).available).toBe(100000000n)
  })

  test("a request waits for approval instead of going straight to the chain", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "wq1",
    })
    const record = custody.findWithdrawal(withdrawalId)!
    expect(record.status).toBe("requested")
    expect(record.providerRef).toBeNull()
    // The value is held meanwhile, so it cannot be spent twice while queued.
    expect(ledger.balance(userId, BTC).held).toBe(50000000n)
  })

  test("rejecting gives the balance back", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "wq2",
    })
    expect(svc.rejectWithdrawal(withdrawalId, userId, "Destination not recognised").ok).toBe(true)
    expect(custody.findWithdrawal(withdrawalId)!.status).toBe("cancelled")
    expect(ledger.balance(userId, BTC).available).toBe(100000000n)
    expect(ledger.balance(userId, BTC).held).toBe(0n)
  })

  test("a withdrawal cannot be approved twice", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "wq3",
    })
    expect((await svc.approveWithdrawal(withdrawalId, userId, null)).ok).toBe(true)
    expect((await svc.approveWithdrawal(withdrawalId, userId, null)).ok).toBe(false)
  })

  test("an already approved withdrawal cannot then be rejected", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "wq4",
    })
    await svc.approveWithdrawal(withdrawalId, userId, null)
    expect(svc.rejectWithdrawal(withdrawalId, userId, "too late").ok).toBe(false)
  })

  test("settling a broadcast withdrawal confirms it", async () => {
    await fund(BTC, 100000000n)
    const { withdrawalId } = await svc.requestWithdrawal({
      userId, tier: 2, asset: assets.find(BTC)!, destination: "bc1qdest", memo: null,
      amount: 50000000n, fee: 0n, idempotencyKey: "w8",
    })
    await svc.approveWithdrawal(withdrawalId, userId, null)
    const ref = custody.findWithdrawal(withdrawalId)!.providerRef!
    provider.settle(ref, { status: "confirmed", txHash: "0xfinal" })
    await svc.settleWithdrawals(userId)
    expect(custody.findWithdrawal(withdrawalId)!.status).toBe("confirmed")
    expect(ledger.balance(userId, BTC).held).toBe(0n)
  })
})

describe("polling", () => {
  test("credits everything the provider reports", async () => {
    const addr = await addressFor(BTC)
    provider.seedDeposit(deposit(BTC, addr, "100000000", 6, "0xp1"))
    provider.seedDeposit(deposit(BTC, addr, "50000000", 6, "0xp2"))
    const result = await svc.pollAndCredit()
    expect(result.credited).toBe(2)
    expect(ledger.balance(userId, BTC).available).toBe(150000000n)
  })

  test("polling twice does not double credit", async () => {
    const addr = await addressFor(BTC)
    provider.seedDeposit(deposit(BTC, addr, "100000000", 6, "0xp1"))
    await svc.pollAndCredit()
    await svc.pollAndCredit()
    expect(ledger.balance(userId, BTC).available).toBe(100000000n)
  })

  test("a provider failure does not throw", async () => {
    const broken = new CustodyService({
      assets, ledger, custody, audit: new AuditRepository(db), limits: testLimits(db),
      provider: { ...provider, async pollDeposits() { throw new Error("down") } } as never,
    })
    expect(broken.pollAndCredit()).resolves.toEqual({ credited: 0, confirming: 0 })
  })
})
