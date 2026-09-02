# Meridian

Centralized digital-asset exchange. US-incorporated company serving the Nigerian market.

**Read before working here:**
- Spec: `docs/superpowers/specs/2026-08-29-meridian-design.md`
- Current plan: `docs/superpowers/plans/2026-08-29-slice1-foundation-ledger.md`

## Stack

Bun, Express 5, Pug, Alpine.js (CSP build), libSQL via `@libsql/client`, `bun:test`.

These were chosen deliberately in the spec. In particular, **use Express, not `Bun.serve()`**, and server-rendered Pug rather than a client framework. Do not "modernize" this to Bun's native APIs.

Use `bun` for everything else: `bun install`, `bun test`, `bun run`, `bunx`. Never npm, yarn, or pnpm.

Storage moved from `bun:sqlite` to `@libsql/client` so a deployment can use a
remote (Turso) database on hosting with no persistent disk. The whole data
layer is therefore async: every repository method returns a promise.

## Rules that are not negotiable

- **No floating point for money, anywhere.** All amounts are `bigint` in code and `INTEGER` in SQLite, counted in base units where 1 unit = 10^-8 of an asset. Internal precision is fixed at 8 decimals for every asset. No `parseFloat`, no `toFixed` on a money value.
- **The ledger is append-only.** `ledger_transactions` and `ledger_entries` have triggers that reject UPDATE and DELETE. Corrections are new opposing transactions. Never remove those triggers.
- **`post()` in `src/db/repositories/ledger.ts` is the only write path into the journal.**
- **Read every money column through `moneyGet()` / `moneyAll()` in `src/db/index.ts`.** The client runs with `intMode: "bigint"`, so SQLite `INTEGER` arrives as `bigint`; the plain `get()` / `all()` helpers then narrow to `number` for ordinary columns and throw if a value exceeds 2^53. The money helpers skip that narrowing. Using `get()` on a money column is a bug even when the test passes, because small test values do not trip it.
- **No SQL outside `src/db/repositories/`.**
- **`src/domain/` imports neither Express nor the database client.** Pure logic over plain objects.
- **CSP carries no `unsafe-inline` and no `unsafe-eval`.** So: no inline `<style>`, no `style=` attributes, no inline `<script>`. Alpine components must be registered via `Alpine.data()`, which is what the CSP build requires.
- **Balances round down** (`formatBalance`), **prices round half-even** (`formatPrice`). Using the wrong one is a bug.
- **TDD on anything touching the ledger.** Test first, no exceptions. Ledger bugs are unrecoverable.

## Conventions

- Asset symbols are chain-qualified: `USDT_TRC20`, not `USDT`. `display_symbol` is what users see, `network_label` is the network they must not get wrong.
- Nested transactions are intentional. `withTransaction()` opens a real transaction on the client and a `SAVEPOINT` when handed one that is already open, because libSQL has no nested transactions of its own. Do not flatten them: `services/transfers.ts` relies on `ledger.post()` keeping its own rollback boundary.
- A repository method takes an optional executor as its last argument. Pass the transaction down when the call belongs to a caller's transaction; omit it and the method runs on its own.
- Remote libSQL holds a lock for the life of a transaction and times out after five seconds, so keep transaction bodies to as few round trips as the work needs.
- UI copy is plain and direct. No marketing inflation, no em dashes.
- Git identity here is `0xalpha <nulldev0x@proton.me>`, set locally.

## Compliance context

This is a regulated financial product pursuing SEC Nigeria VASP registration via ARIP. Two consequences for day-to-day work:

- Nothing user-facing may claim returns, performance, or safety of principal. Licensing status is stated at its actual current stage.
- The audit log is append-only and every auth event, KYC transition, and admin action writes to it.
