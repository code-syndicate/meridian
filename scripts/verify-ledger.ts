import type { Client } from "../src/db"
import { all, get, migrate, moneyAll, openDatabase } from "../src/db"
import { loadConfig } from "../src/config"

export interface Violation {
  invariant: string
  detail: string
}

export interface VerifyResult {
  ok: boolean
  violations: Violation[]
  checked: { transactions: number; entries: number; accounts: number }
}

export async function verifyLedger(db: Client): Promise<VerifyResult> {
  const violations: Violation[] = []

  const unbalanced = await moneyAll<{ transaction_id: bigint; asset: string; total: bigint }>(db, `SELECT transaction_id, asset, SUM(amount) AS total
     FROM ledger_entries
     GROUP BY transaction_id, asset
     HAVING SUM(amount) <> 0`)
  for (const row of unbalanced) {
    violations.push({
      invariant: "transaction_balance",
      detail: `Transaction ${row.transaction_id} for ${row.asset} sums to ${row.total}, expected 0`,
    })
  }

  const mismatched = await all<{ id: number; entry_asset: string; account_asset: string }>(db, `SELECT e.id, e.asset AS entry_asset, a.asset AS account_asset
       FROM ledger_entries e
       JOIN accounts a ON a.id = e.account_id
       WHERE e.asset <> a.asset`)
  for (const row of mismatched) {
    violations.push({
      invariant: "entry_asset_match",
      detail: `Entry ${row.id} declares ${row.entry_asset} but its account holds ${row.account_asset}`,
    })
  }

  const unconserved = await moneyAll<{ asset: string; total: bigint }>(db, `SELECT asset, SUM(amount) AS total
     FROM ledger_entries
     GROUP BY asset
     HAVING SUM(amount) <> 0`)
  for (const row of unconserved) {
    violations.push({
      invariant: "conservation",
      detail: `All entries for ${row.asset} sum to ${row.total}, expected 0`,
    })
  }

  const drifted = await moneyAll<{ account_id: bigint; cached: bigint; actual: bigint }>(db, `SELECT b.account_id, b.amount AS cached, COALESCE((SELECT SUM(e.amount) FROM ledger_entries e
                      WHERE e.account_id = b.account_id), 0) AS actual
     FROM account_balances b
     WHERE b.amount <> COALESCE((SELECT SUM(e.amount) FROM ledger_entries e
                                 WHERE e.account_id = b.account_id), 0)`)
  for (const row of drifted) {
    violations.push({
      invariant: "balance_cache",
      detail: `Account ${row.account_id} cache reads ${row.cached}, journal sums to ${row.actual}`,
    })
  }

  const negative = await moneyAll<{ account_id: bigint; amount: bigint; type: string }>(db, `SELECT b.account_id, b.amount, a.type
     FROM account_balances b
     JOIN accounts a ON a.id = b.account_id
     WHERE a.type IN ('user_available', 'user_hold') AND b.amount < 0`,)
  for (const row of negative) {
    violations.push({
      invariant: "non_negative_user",
      detail: `Account ${row.account_id} of type ${row.type} holds ${row.amount}`,
    })
  }

  const holdDrift = await moneyAll<{ user_id: bigint; asset: string; hold_sum: bigint; account_amount: bigint }>(db, `SELECT a.user_id, a.asset, COALESCE((SELECT SUM(h.amount) FROM holds h
                      WHERE h.user_id = a.user_id AND h.asset = a.asset
                        AND h.status = 'active'), 0) AS hold_sum, COALESCE(b.amount, 0) AS account_amount
     FROM accounts a
     LEFT JOIN account_balances b ON b.account_id = a.id
     WHERE a.type = 'user_hold'
       AND COALESCE(b.amount, 0) <> COALESCE(
             (SELECT SUM(h.amount) FROM holds h
              WHERE h.user_id = a.user_id AND h.asset = a.asset
                AND h.status = 'active'), 0)`)
  for (const row of holdDrift) {
    violations.push({
      invariant: "hold_sum",
      detail: `User ${row.user_id} ${row.asset}: active holds sum to ${row.hold_sum}, held account reads ${row.account_amount}`,
    })
  }

  // Invariant 5: user entitlement never exceeds confirmed on-chain reserves.
  // Only checkable once custody reports reserves, which is subsystem D.
  const underReserved = await moneyAll<{ asset: string; owed: bigint; confirmed: bigint }>(db, `SELECT r.asset, COALESCE((SELECT SUM(b.amount) FROM account_balances b
                      JOIN accounts a ON a.id = b.account_id
                      WHERE a.asset = r.asset
                        AND a.type IN ('user_available', 'user_hold')), 0) AS owed, r.confirmed AS confirmed
     FROM reserves r
     WHERE COALESCE((SELECT SUM(b.amount) FROM account_balances b
                     JOIN accounts a ON a.id = b.account_id
                     WHERE a.asset = r.asset
                       AND a.type IN ('user_available', 'user_hold')), 0) > r.confirmed`,)
  for (const row of underReserved) {
    violations.push({
      invariant: "reserve_backing",
      detail: `Clients are owed ${row.owed} of ${row.asset} but confirmed reserves are ${row.confirmed}`,
    })
  }

  const counts = (await get<{ transactions: number; entries: number; accounts: number }>(db, `SELECT
         (SELECT COUNT(*) FROM ledger_transactions) AS transactions,
         (SELECT COUNT(*) FROM ledger_entries) AS entries,
         (SELECT COUNT(*) FROM accounts) AS accounts`))!

  return { ok: violations.length === 0, violations, checked: counts }
}

if (import.meta.main) {
  const config = loadConfig()
  const db = await openDatabase(config.databasePath, config.databaseAuthToken)
  // Idempotent, and a no-op against an already-migrated database. Without it
  // the tool crashes on a fresh file instead of reporting a clean ledger.
  await migrate(db)
  const result = await verifyLedger(db)

  console.log(
    JSON.stringify(
      { ok: result.ok, checked: result.checked, violations: result.violations },
      null,
      2,
    ),
  )
  process.exit(result.ok ? 0 : 1)
}
