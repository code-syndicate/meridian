# Meridian

Centralized digital-asset exchange. US-incorporated company serving the Nigerian market.

**Read before working here:**
- Spec: `docs/superpowers/specs/2026-08-29-meridian-design.md`
- Current plan: `docs/superpowers/plans/2026-08-29-slice1-foundation-ledger.md`

## Stack

Bun, Express 5, Pug, Alpine.js (CSP build), `bun:sqlite`, `bun:test`.

These were chosen deliberately in the spec. In particular, **use Express, not `Bun.serve()`**, and server-rendered Pug rather than a client framework. Do not "modernize" this to Bun's native APIs.

Use `bun` for everything else: `bun install`, `bun test`, `bun run`, `bunx`. Never npm, yarn, or pnpm. `bun:sqlite`, never `better-sqlite3`.

## Rules that are not negotiable

- **No floating point for money, anywhere.** All amounts are `bigint` in code and `INTEGER` in SQLite, counted in base units where 1 unit = 10^-8 of an asset. Internal precision is fixed at 8 decimals for every asset. No `parseFloat`, no `toFixed` on a money value.
- **The ledger is append-only.** `ledger_transactions` and `ledger_entries` have triggers that reject UPDATE and DELETE. Corrections are new opposing transactions. Never remove those triggers.
- **`post()` in `src/db/repositories/ledger.ts` is the only write path into the journal.**
- **No SQL outside `src/db/repositories/`.**
- **`src/domain/` imports neither Express nor `bun:sqlite`.** Pure logic over plain objects.
- **CSP carries no `unsafe-inline` and no `unsafe-eval`.** So: no inline `<style>`, no `style=` attributes, no inline `<script>`. Alpine components must be registered via `Alpine.data()`, which is what the CSP build requires.
- **Balances round down** (`formatBalance`), **prices round half-even** (`formatPrice`). Using the wrong one is a bug.
- **TDD on anything touching the ledger.** Test first, no exceptions. Ledger bugs are unrecoverable.

## Conventions

- Asset symbols are chain-qualified: `USDT_TRC20`, not `USDT`. `display_symbol` is what users see, `network_label` is the network they must not get wrong.
- Nested `db.transaction()` calls are intentional and use savepoints. Do not flatten them.
- UI copy is plain and direct. No marketing inflation, no em dashes.
- Git identity here is `timileyindev <timmypelumy@gmail.com>`, set locally.

## Compliance context

This is a regulated financial product pursuing SEC Nigeria VASP registration via ARIP. Two consequences for day-to-day work:

- Nothing user-facing may claim returns, performance, or safety of principal. Licensing status is stated at its actual current stage.
- The audit log is append-only and every auth event, KYC transition, and admin action writes to it.
