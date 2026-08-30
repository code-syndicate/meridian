import { test, expect, describe, beforeEach } from "bun:test"
import { testLimits } from "../support/limits"
import type { Database } from "bun:sqlite"
import { TransferService, TransferError, maskEmail } from "../../src/services/transfers"
import { TransferRepository } from "../../src/db/repositories/transfers"
import { LedgerRepository } from "../../src/db/repositories/ledger"
import { UserRepository } from "../../src/db/repositories/users"
import { AuditRepository } from "../../src/db/repositories/audit"
import { AssetRepository } from "../../src/db/repositories/assets"
import { LedgerError } from "../../src/domain/ledger/types"
import { hashPassword } from "../../src/domain/identity/password"
import { freshDb } from "../support/fixtures"

let db: Database
let svc: TransferService
let ledger: LedgerRepository
let users: UserRepository
let assets: AssetRepository
let alice: number
let bob: number

const BTC = "BTC"

async function makeUser(email: string): Promise<number> {
  return users.create(email, await hashPassword("correct horse battery staple 7"))
}

function fund(userId: number, amount: bigint, key: string): void {
  const external = ledger.ensureAccount(null, BTC, "external_deposit")
  const available = ledger.ensureAccount(userId, BTC, "user_available")
  ledger.post({
    kind: "deposit", idempotencyKey: key,
    entries: [
      { accountId: external, asset: BTC, amount: -amount },
      { accountId: available, asset: BTC, amount },
    ],
  })
}

function send(amount: bigint, key = "t1", to = "bob@test.co") {
  return svc.send({
    senderId: alice, recipientEmail: to, asset: assets.find(BTC)!,
    tier: 2,
    amount, note: null, idempotencyKey: key, ip: null,
  })
}

beforeEach(async () => {
  db = freshDb()
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
  test("shows enough to recognise, not enough to harvest", () => {
    const masked = maskEmail("chidinma@meridian.test")
    expect(masked).toStartWith("c")
    expect(masked).toContain("@")
    expect(masked).not.toContain("chidinma")
  })

  test("handles a very short local part", () => {
    expect(() => maskEmail("a@b.co")).not.toThrow()
  })
})

describe("resolve", () => {
  test("finds a recipient by email", () => {
    expect(svc.resolve(alice, "bob@test.co").id).toBe(bob)
  })

  test("is case insensitive", () => {
    expect(svc.resolve(alice, "BOB@TEST.CO").id).toBe(bob)
  })

  test("refuses an unknown address", () => {
    expect(() => svc.resolve(alice, "nobody@test.co")).toThrow(TransferError)
  })

  test("refuses sending to yourself", () => {
    expect(() => svc.resolve(alice, "alice@test.co")).toThrow(TransferError)
  })

  test("refuses a suspended recipient", () => {
    db.query("UPDATE users SET status = 'suspended' WHERE id = ?").run(bob)
    expect(() => svc.resolve(alice, "bob@test.co")).toThrow(TransferError)
  })

  test("returns the address masked, never in full", () => {
    expect(svc.resolve(alice, "bob@test.co").masked).not.toContain("bob@test.co")
  })
})

describe("send", () => {
  test("moves value between two accounts", () => {
    fund(alice, 100000000n, "f1")
    send(40000000n)
    expect(ledger.balance(alice, BTC).available).toBe(60000000n)
    expect(ledger.balance(bob, BTC).available).toBe(40000000n)
  })

  test("charges no fee, because nothing touches a chain", () => {
    fund(alice, 100000000n, "f1")
    send(40000000n)
    const total = ledger.balance(alice, BTC).available + ledger.balance(bob, BTC).available
    expect(total).toBe(100000000n)
  })

  test("refuses more than the sender holds", () => {
    fund(alice, 10000000n, "f1")
    expect(() => send(90000000n)).toThrow(LedgerError)
  })

  test("a refused transfer moves nothing", () => {
    fund(alice, 10000000n, "f1")
    try { send(90000000n) } catch {}
    expect(ledger.balance(alice, BTC).available).toBe(10000000n)
    expect(ledger.balance(bob, BTC).available).toBe(0n)
  })

  test("refuses a zero or negative amount", () => {
    fund(alice, 100000000n, "f1")
    expect(() => send(0n)).toThrow(TransferError)
    expect(() => send(-1n)).toThrow(TransferError)
  })

  test("refuses an unknown recipient without moving value", () => {
    fund(alice, 100000000n, "f1")
    expect(() => send(1000n, "t1", "nobody@test.co")).toThrow(TransferError)
    expect(ledger.balance(alice, BTC).available).toBe(100000000n)
  })

  test("replaying an idempotency key does not send twice", () => {
    fund(alice, 100000000n, "f1")
    send(40000000n, "same")
    send(40000000n, "same")
    expect(ledger.balance(bob, BTC).available).toBe(40000000n)
  })

  test("writes one balanced ledger transaction", () => {
    fund(alice, 100000000n, "f1")
    send(40000000n)
    const total = db
      .query<{ t: number }, []>(
        "SELECT COALESCE(SUM(amount),0) AS t FROM ledger_entries WHERE asset = 'BTC'",
      )
      .get()!.t
    expect(total).toBe(0)
  })

  test("audits both sides", () => {
    fund(alice, 100000000n, "f1")
    send(40000000n)
    const audit = new AuditRepository(db)
    expect(audit.forUser(alice, 20).map((e) => e.action)).toContain("transfer.sent")
    expect(audit.forUser(bob, 20).map((e) => e.action)).toContain("transfer.received")
  })

  test("returns the recipient masked", () => {
    fund(alice, 100000000n, "f1")
    expect(send(1000n).masked).not.toContain("bob@test.co")
  })
})

describe("history", () => {
  test("shows the transfer to both parties, with direction", () => {
    fund(alice, 100000000n, "f1")
    send(40000000n)
    expect(svc.historyFor(alice, 10)[0]!.direction).toBe("sent")
    expect(svc.historyFor(bob, 10)[0]!.direction).toBe("received")
  })

  test("masks the counterparty", () => {
    fund(alice, 100000000n, "f1")
    send(40000000n)
    expect(svc.historyFor(bob, 10)[0]!.counterparty).not.toContain("alice@test.co")
  })

  test("excludes transfers a user is not party to", () => {
    const carol = users.create("carol@test.co", "hash")
    fund(alice, 100000000n, "f1")
    send(40000000n)
    expect(svc.historyFor(carol, 10)).toHaveLength(0)
  })

  test("is empty for a user with no transfers", () => {
    expect(svc.historyFor(bob, 10)).toEqual([])
  })
})
