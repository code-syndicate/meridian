import { test, expect, describe, beforeEach } from "bun:test"
import type { Database } from "bun:sqlite"
import { openDatabase, migrate } from "../../../src/db"
import { AssetRepository } from "../../../src/db/repositories/assets"

let db: Database
let repo: AssetRepository

beforeEach(() => {
  db = openDatabase(":memory:")
  migrate(db)
  repo = new AssetRepository(db)
})

describe("AssetRepository", () => {
  test("seeds the ten launch assets", () => {
    expect(repo.all()).toHaveLength(10)
  })

  test("orders by sort order", () => {
    expect(repo.all().map((a) => a.symbol)[0]).toBe("BTC")
  })

  test("finds a native asset with no contract address", () => {
    const btc = repo.find("BTC")
    expect(btc).toMatchObject({
      symbol: "BTC",
      displaySymbol: "BTC",
      kind: "native",
      chain: "bitcoin",
      contractAddress: null,
      nativeDecimals: 8,
      displayDecimals: 8,
      isStablecoin: false,
    })
  })

  test("finds a token and exposes its contract address", () => {
    const usdt = repo.find("USDT_TRC20")
    expect(usdt).toMatchObject({
      displaySymbol: "USDT",
      kind: "token",
      chain: "tron",
      networkLabel: "Tron (TRC20)",
      nativeDecimals: 6,
      isStablecoin: true,
    })
    expect(usdt?.contractAddress).toBe("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
  })

  test("distinguishes the same display symbol on different chains", () => {
    const tickers = repo.all().filter((a) => a.displaySymbol === "USDT")
    expect(tickers.map((a) => a.symbol).sort()).toEqual([
      "USDT_BEP20",
      "USDT_ERC20",
      "USDT_TRC20",
    ])
  })

  test("returns null for an unknown symbol", () => {
    expect(repo.find("DOGE")).toBeNull()
  })

  test("filters by chain", () => {
    expect(repo.byChain("ethereum").map((a) => a.symbol).sort()).toEqual([
      "ETH",
      "USDC_ERC20",
      "USDT_ERC20",
    ])
  })

  test("has deposits and withdrawals enabled, since custody is built", () => {
    for (const asset of repo.all()) {
      expect(asset.depositEnabled).toBe(true)
      expect(asset.withdrawalEnabled).toBe(true)
    }
  })

  test("has trading disabled, because there is no execution subsystem yet", () => {
    for (const asset of repo.all()) {
      expect(asset.tradingEnabled).toBe(false)
    }
  })

  test("rejects a token row with no contract address", () => {
    expect(() =>
      db
        .query(
          `INSERT INTO assets (symbol, display_symbol, name, kind, chain, network_label,
             contract_address, native_decimals, display_decimals, confirmations_required, created_at)
           VALUES ('BAD', 'BAD', 'Bad', 'token', 'ethereum', 'Ethereum', NULL, 18, 6, 12, '2026-01-01')`,
        )
        .run(),
    ).toThrow()
  })
})
