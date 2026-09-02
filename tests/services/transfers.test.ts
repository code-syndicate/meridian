import { get, run } from "../../src/db"
import { test, expect, describe, beforeEach } from "bun:test"
import { testLimits } from "../support/limits"
import type { Client } from "../../src/db"
import { TransferService, TransferError, maskEmail } from "../../src/services/transfers"
import { TransferRepository } from "../../src/db/repositories/transfers"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { UserRepository } from "../../src/db/repositories/users"
import { AuditRepository } from "../../src/db/repositories/audit"
import { AssetRepository } from "../../src/db/repositories/assets"
import { LedgerError } from "../../src/domain/ledger/types"
import { hashPassword } from "../../src/domain/identity/password"
import { freshDb } from "../support/fixtures"

let db: Client
let svc: TransferService
let ledger: LedgerRepository
let users: UserRepository
let assets: AssetRepository
let alice: number
let bob: number

const BTC = "BTC"

async function makeUser(email: string): Promise<number> {
  return await users.create(email, await hashPassword("correct horse battery staple 7"))
}

async function fund(userId: number, amount: bigint, key: string): Promise<void> {
  const external = await ledger.ensureAccount(null, BTC, "external_deposit")
  const available = await ledger.ensureAccount(userId, BTC, "user_available")
  await ledger.post({
    kind: "deposit", idempotencyKey: key,
    entries: [
      { accountId: external, asset: BTC, amount: -amount },
      { accountId: available, asset: BTC, amount },
    ],
  })
}

async function send(amount: bigint, key = "t1", to = "bob@test.co") {
  return svc.send({
    senderId: alice, recipientRef: to, asset: (await assets.find(BTC))!,
    tier: 2,
    amount, note: null, idempotencyKey: key, ip: null,
  })
}

beforeEach(async () => {
  db = await freshDb()
  ledger = new LedgerRepository(db)
  users = new UserRepository(db)
  assets = new AssetRepository(db)
  svc = new TransferService({
    db, ledger, users, audit: new AuditRepository(db),
    transfers: new TransferRepository(db), limits: testLimits(db),
  })
  alice = await makeUser("alice@test.co")
  bob = await makeUser("bob@test.co")
})

describe("maskEmail", () => {
  test("shows enough to recognise, not enough to harvest", async () => {
    const masked = maskEmail("chidinma@meridian.test")
    expect(masked).toStartWith("c")
    expect(masked).toContain("@")
    expect(masked).not.toContain("chidinma")
  })

  test("handles a very short local part", async () => {
    expect(() => maskEmail("a@b.co")).not.toThrow()
  })
})

describe("resolve", () => {
  test("finds a recipient by email", async () => {
    expect((await svc.resolve(alice, "bob@test.co")).id).toBe(bob)
  })

  test("is case insensitive", async () => {
    expect((await svc.resolve(alice, "BOB@TEST.CO")).id).toBe(bob)
  })

  test("refuses an unknown address", async () => {
    expect(() => svc.resolve(alice, "nobody@test.co")).toThrow(TransferError)
  })

  test("refuses sending to yourself", async () => {
    expect(() => svc.resolve(alice, "alice@test.co")).toThrow(TransferError)
  })

  test("refuses a suspended recipient", async () => {
    await run(db, "UPDATE users SET status = 'suspended' WHERE id = ?", [bob])
    expect(() => svc.resolve(alice, "bob@test.co")).toThrow(TransferError)
  })

  test("returns the address masked, never in full", async () => {
    expect((await svc.resolve(alice, "bob@test.co")).masked).not.toContain("bob@test.co")
  })
})

describe("send", () => {
  test("moves value between two accounts", async () => {
    await fund(alice, 100000000n, "f1")
    await send(40000000n)
    expect((await ledger.balance(alice, BTC)).available).toBe(60000000n)
    expect((await ledger.balance(bob, BTC)).available).toBe(40000000n)
  })

  test("charges no fee, because nothing touches a chain", async () => {
    await fund(alice, 100000000n, "f1")
    await send(40000000n)
    const total = (await ledger.balance(alice, BTC)).available + (await ledger.balance(bob, BTC)).available
    expect(total).toBe(100000000n)
  })

  test("refuses more than the sender holds", async () => {
    await fund(alice, 10000000n, "f1")
    await expect(send(90000000n)).rejects.toThrow(LedgerError)
  })

  test("a refused transfer moves nothing", async () => {
    await fund(alice, 10000000n, "f1")
    try { await send(90000000n) } catch {}
    expect((await ledger.balance(alice, BTC)).available).toBe(10000000n)
    expect((await ledger.balance(bob, BTC)).available).toBe(0n)
  })

  test("refuses a zero or negative amount", async () => {
    await fund(alice, 100000000n, "f1")
    await expect(send(0n)).rejects.toThrow(TransferError)
    await expect(send(-1n)).rejects.toThrow(TransferError)
  })

  test("refuses an unknown recipient without moving value", async () => {
    await fund(alice, 100000000n, "f1")
    await expect(send(1000n, "t1", "nobody@test.co")).rejects.toThrow(TransferError)
    expect((await ledger.balance(alice, BTC)).available).toBe(100000000n)
  })

  test("replaying an idempotency key does not send twice", async () => {
    await fund(alice, 100000000n, "f1")
    await send(40000000n, "same")
    await send(40000000n, "same")
    expect((await ledger.balance(bob, BTC)).available).toBe(40000000n)
  })

  test("writes one balanced ledger transaction", async () => {
    await fund(alice, 100000000n, "f1")
    await send(40000000n)
    const total = (await get<{ t: number }>(db, "SELECT COALESCE(SUM(amount),0) AS t FROM ledger_entries WHERE asset = 'BTC'"))!.t
    expect(total).toBe(0)
  })

  test("audits both sides", async () => {
    await fund(alice, 100000000n, "f1")
    await send(40000000n)
    const audit = new AuditRepository(db)
    expect((await audit.forUser(alice, 20)).map((e) => e.action)).toContain("transfer.sent")
    expect((await audit.forUser(bob, 20)).map((e) => e.action)).toContain("transfer.received")
  })

  test("returns the recipient masked", async () => {
    await fund(alice, 100000000n, "f1")
    expect((await send(1000n)).masked).not.toContain("bob@(await test).co")
  })
})

describe("history", () => {
  test("shows the transfer to both parties, with direction", async () => {
    await fund(alice, 100000000n, "f1")
    await send(40000000n)
    expect((await svc.historyFor(alice, 10))[0]!.direction).toBe("sent")
    expect((await svc.historyFor(bob, 10))[0]!.direction).toBe("received")
  })

  test("masks the counterparty", async () => {
    await fund(alice, 100000000n, "f1")
    await send(40000000n)
    expect((await svc.historyFor(bob, 10))[0]!.counterparty).not.toContain("alice@test.co")
  })

  test("excludes transfers a user is not party to", async () => {
    const carol = await users.create("carol@test.co", "hash")
    await fund(alice, 100000000n, "f1")
    await send(40000000n)
    expect(await svc.historyFor(carol, 10)).toHaveLength(0)
  })

  test("is empty for a user with no transfers", async () => {
    expect(await svc.historyFor(bob, 10)).toEqual([])
  })
})
