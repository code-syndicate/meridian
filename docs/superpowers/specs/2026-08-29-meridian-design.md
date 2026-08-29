# Meridian — Design Specification

**Date:** 2026-08-29
**Status:** Draft, pending review
**Scope of this document:** Whole-program decomposition at outline depth, plus Slice 1 (subsystems A, B, C) at implementation depth.

---

## 1. What this is

Meridian is a centralized digital-asset exchange operated by a US-incorporated company serving the Nigerian market. Users hold custodial balances across a set of supported crypto assets, deposit and withdraw on-chain, transfer to other Meridian users instantly and off-ledger, and trade between assets.

Custody is **omnibus**: user funds are pooled in platform-controlled wallets, and per-user entitlement is tracked in an internal double-entry ledger. This is the standard CEX model. It is only defensible when three things are true, and the design assumes all three:

1. Pooled reserves fully back the sum of user balances at all times, verifiable on demand.
2. The operator is licensed for the activity in the jurisdiction it serves.
3. The ledger is append-only and auditable, so entitlement cannot be silently altered.

### 1.1 Regulatory posture

Nigeria's Investment and Securities Act 2025 classifies virtual assets as securities and places VASP registration under SEC Nigeria. The practical path is the Accelerated Regulatory Incubation Programme (ARIP), which grants Approval in Principle to operate under supervision, followed by application for full registration. Indicative requirements: local CAC-incorporated entity, ₦500m baseline paid-up capital, minimum four sponsored individuals including a Managing Director and a Compliance Officer, mandatory initial assessment filing with a legal opinion. ARIP to full registration typically runs 9–18 months.

This is **not legal advice** and the figures above are indicative, drawn from public secondary sources in August 2026. Confirm current requirements with Nigerian counsel before relying on any of it.

**Design consequence:** the product must be buildable, demonstrable, and auditable *before* the licence lands, because ARIP reviewers want to see the system. Slice 1 is deliberately scoped to be exactly that: a real product increment with real accounts, real KYC, and a real ledger, but no value movement. Nothing in Slice 1 constitutes regulated activity.

### 1.2 Vendors

| Function | Vendor | Notes |
|---|---|---|
| Fiat on/offramp (later phase) | Paycrest | Stablecoin ↔ local currency routing API, settles Nigeria via Moniepoint. **Payments rail only.** |
| KYC / AML | Smile ID, Dojah, or Youverify | BVN/NIN verification, document + liveness, sanctions and PEP screening, ongoing monitoring. **Must be a separate vendor from Paycrest.** Selection is an open question. |
| Node / indexer access | Alchemy, QuickNode, or Blockdaemon | Per-chain. Phase D. |
| Market data | To be selected | Phase E. |

Paycrest does not perform KYC, sanctions screening, or transaction monitoring. Any plan that assumed otherwise has a compliance gap.

---

## 2. Non-goals

Explicitly out of scope for the whole program unless separately specified:

- Fiat balances. Naira is deferred entirely. Users fund with crypto from elsewhere. Paycrest integration is a later phase with its own spec.
- Margin, futures, derivatives, lending, staking, or yield products.
- Native mobile applications. The web app is responsive; that is the whole mobile story.
- Proprietary trading against user flow beyond the disclosed spread in the quote model.
- Any user-facing claim of returns, performance, or guaranteed outcomes.
- Referral, affiliate, or multi-level incentive schemes. These are a regulatory liability and a fraud-pattern signal.

Out of scope for Slice 1 specifically: value movement of any kind, on-chain integration, trading, market data, admin back office.

---

## 3. Program decomposition and build order

| # | Subsystem | Depends on | Phase |
|---|---|---|---|
| A | Public marketing site | — | Slice 1 |
| B | Identity: registration, email verification, 2FA, KYC wizard, sessions, audit log | — | Slice 1 |
| C | Ledger core: double-entry journal, balances, holds, invariants | — | Slice 1 |
| D | Custody: HD derivation, deposit detection, confirmations, sweeps, withdrawal signing, hot/cold | C | Slice 2 |
| E | Execution: quote-and-hedge against an LP, then matching engine | C | Slice 3 |

**Note on price data.** Subsystem A needs live prices in Slice 1 for the ticker, the market strip, and the markets table, but subsystem E is Slice 3. These are different things and should not be conflated. Slice 1 includes a **public reference price feed** only: a single server-side poller against a public market data API (CoinGecko or equivalent), cached in memory with a 10s TTL, fanned out to clients over SSE. It is display-only, carries a visible "indicative" label, and no code path may use it to price a transaction. Execution-grade market data, with the latency, integrity, and auditability requirements that implies, arrives with subsystem E and replaces it.
| F | Trading terminal UI | E | Slice 3 |
| G | Admin and compliance back office: approvals, monitoring, reserve reconciliation, reporting | C, D | Slice 4 |

### 3.1 Two decisions that shaped this order

**Execution starts as quote-and-hedge, not an order book.** A new exchange has no order flow, so an internal book opens empty and the first user leaves. Meridian will quote a price from an external liquidity provider plus a disclosed spread, fill instantly, and hedge. The matching engine is a phase-two replacement behind the same ledger interface, added once two-sided flow exists.

Secondary note on the stack: matching is inherently serialized, so an in-memory book journaled to SQLite in WAL mode would handle thousands of orders per second. Throughput is not the objection. The objection is building the system's hardest correctness surface before knowing anyone wants to trade on it.

**Chain integration launches with five chains, not twenty.** Each chain is its own derivation scheme, deposit scanner, confirmation policy, fee estimator, signer, and sweep routine. Launch set, ordered by Nigerian volume:

1. **Tron** — USDT-TRC20 dominates Nigerian stablecoin flow
2. **Ethereum** — USDT, USDC, ETH
3. **Bitcoin**
4. **Solana** — SOL, USDC
5. **BNB Smart Chain** — BNB, USDT

Additional assets are added on demonstrated demand. The asset registry (§7.1) is data-driven so adding an asset on an already-integrated chain is a row, not a release.

**Recorded disagreement:** self-managed HD wallets were chosen over a wallet-as-a-service provider (Fireblocks, BitGo, Cobo, Dfns). WaaS is easier to defend to an ARIP reviewer and removes the single most common cause of exchange failure, which is hot-wallet key compromise. Subsystem D will therefore be built behind a `CustodyProvider` interface so a WaaS provider can be substituted without touching the ledger, the API, or the UI. Revisit before Slice 2 begins.

---

## 4. Brand and design system

### 4.1 Name

Working name **Meridian**, wordmark set in uppercase with tight tracking. Provisional: verify trademark availability in US and Nigeria, and check `.com` and `.ng` availability, before any asset production. Alternates held in reserve: Basis, Harmattan.

### 4.2 Direction

Dark, dense, data-forward. Professional tooling from the first screen. The marketing site and the application share one visual language, so the public site reads as a window onto the product rather than a brochure wrapped around it. Reference energy: Bloomberg Terminal, Falcon, Linear's density with a financial register.

The design rule that follows from this: **the interface is a surface for numbers.** Chrome recedes, numerals are the loudest thing on any screen, and any decoration that does not help someone read a figure faster is removed.

### 4.3 Colour

Semantic tokens, defined once as CSS custom properties on `:root`.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#08090A` | Page ground |
| `--surface` | `#0E1012` | Panels, table headers |
| `--surface-2` | `#16191D` | Raised rows, inputs, hover |
| `--hairline` | `#23272C` | All borders and dividers, 1px |
| `--hairline-strong` | `#31363D` | Focused input borders, active tabs |
| `--text` | `#E6E8EB` | Primary text and numerals |
| `--text-muted` | `#8B949E` | Labels, secondary values |
| `--text-dim` | `#5A626B` | Placeholders, disabled, timestamps |
| `--up` | `#12B76A` | Positive delta |
| `--up-wash` | `#12B76A1A` | Price-flash background, positive |
| `--down` | `#F04438` | Negative delta |
| `--down-wash` | `#F044381A` | Price-flash background, negative |
| `--accent` | `#E8A33D` | Amber. Primary actions, focus rings, active nav. Used sparingly. |
| `--accent-dim` | `#8A6224` | Accent borders, pressed states |
| `--warn` | `#F79009` | Warnings, pending states |
| `--info` | `#53B1FD` | Informational, links in prose |

Amber is a deliberate nod to phosphor terminals and does not collide with the green/red delta pair, which must never be used for anything except direction of price. No gradients. No shadows. Elevation is communicated by surface value and hairlines only.

The palette is dark-committed. There is no light theme.

**Accessibility:** `--text` on `--bg` is approximately 15:1. `--text-muted` on `--bg` is approximately 6.7:1. `--text-dim` is below 4.5:1 and is therefore restricted to non-essential text only, never to a value a user must read. `--up` and `--down` are never the sole carrier of meaning; direction is always also indicated by a ▲/▼ glyph and a signed number.

### 4.4 Typography

| Role | Family | Notes |
|---|---|---|
| UI and prose | Inter (variable) | `font-feature-settings: "cv05","ss03"` for a squarer, more technical cut |
| All numerals and data | JetBrains Mono | Every price, balance, quantity, address, hash, ID, and timestamp |

Both are OFL-licensed and self-hosted as `woff2` with `font-display: swap`. Never loaded from a third-party CDN, because a regulated financial site should not hand a font vendor a request log of its users.

Rules:

- Every table of numbers uses the mono face, `font-variant-numeric: tabular-nums`, right-aligned.
- Prices are rendered with the fractional part in `--text-muted` at the same size, so the significant digits dominate: `67,412`**`.08`**.
- Scale, in `rem` against a 16px root: 0.6875 / 0.75 / 0.8125 / 0.875 / 1 / 1.25 / 1.75 / 2.5 / 3.5.
- Headline weight 600 maximum. Nothing on the site is set in 700 or above.
- Line length in prose capped at 68 characters.

### 4.5 Space, shape, density

- 4px base unit. All spacing is a multiple.
- Border radius: 2px on inputs and buttons, 4px on panels, 0 on table rows. Nothing is pill-shaped.
- Table row height 32px, compact variant 28px.
- **No card layouts for lists.** Collections are flat rows separated by 1px hairlines, full-bleed to their container. Cards are reserved for genuinely standalone objects, and there are almost none.
- Maximum content width 1440px, with data tables permitted to run full-bleed.

### 4.6 Motion

- Durations: 120ms for state changes, 180ms for entrances, 240ms for anything traversing the viewport. Nothing exceeds 240ms.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` throughout. No overshoot, no bounce, no spring.
- **Price flash:** on a value change, wash the cell background with `--up-wash` or `--down-wash` and decay over 400ms. This is the single most important interaction on the site and the only place motion carries information rather than polish.
- Numeric transitions are used only on the primary portfolio figure. Everywhere else, numbers snap.
- `prefers-reduced-motion: reduce` disables the flash decay (the colour still applies, then clears instantly), removes all transitions, and disables the ticker marquee.

### 4.7 Interaction details that carry the premium feel

These are specified rather than left to implementation taste, because they are the difference between the intended result and a dark-mode website.

- **Skeletons, never spinners.** Loading states are hairline-bounded blocks at the exact dimensions of the content that replaces them, with a slow 1.2s shimmer. Layout never shifts on load.
- **Command palette** on `⌘K` / `Ctrl+K`: jump to any asset, page, or account action. Fuzzy match, keyboard-only operable, mono-set results.
- **Keyboard map:** `/` focuses search, `g` then `d`/`m`/`a` navigates to dashboard/markets/account, `?` opens the shortcut sheet, `Esc` closes any overlay.
- **Focus-visible** rings are 2px `--accent` at 2px offset. Never removed. Every interactive element is reachable and operable by keyboard.
- **Optimistic then confirmed:** forms disable and show inline progress on the submitting control itself, never a full-page overlay.
- **Toasts** appear bottom-right, mono-set, dismiss after 6s, and stack to a maximum of 3. Errors do not auto-dismiss.
- **Empty states** state the condition and offer exactly one action. No illustrations.
- **The top rail** carries a live ticker of the launch assets on every page, public and authenticated. It is the spine of the aesthetic and the proof that the site is alive.

Copy voice throughout: plain, direct, written like a person. No marketing inflation, no hyphen-joined constructions, no em dashes.

---

## 5. Technical architecture

### 5.1 Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | Bun | Per repo convention. Runs Express, ships `bun:sqlite`, native Argon2id in `Bun.password`. |
| HTTP | Express 5 | As specified. |
| Templating | Pug | As specified. Server-rendered HTML is the default; this is not an SPA. |
| Interactivity | Alpine.js 3, **CSP build** | See §5.2. |
| Live data | Server-Sent Events | One-way price and status push. Simpler than WebSockets and sufficient until Slice 3 introduces order state. |
| Database | SQLite via `bun:sqlite`, WAL mode | As specified. See §5.3 for the limits this imposes. |
| Migrations | Numbered `.sql` files, custom runner | No ORM. Hand-written SQL throughout. |
| Testing | `bun:test` | Unit and integration. Playwright for the critical E2E flows only. |

### 5.2 Content Security Policy and Alpine

Alpine's default distribution evaluates expression strings with `new Function()`, which requires `script-src 'unsafe-eval'`. That is not acceptable on a site handling identity documents and account credentials.

**Decision:** use `@alpinejs/csp`, the CSP-friendly build. It requires that `x-data` reference a component registered via `Alpine.data('name', () => ({ ... }))` rather than an inline object literal, and forbids arbitrary expressions in directives. This is a real constraint on how components are authored and every developer on the project needs to know it up front.

Target policy:

```
default-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
form-action 'self';
frame-ancestors 'none';
base-uri 'none';
object-src 'none';
```

No `unsafe-inline` anywhere, including styles. Inline `<style>` blocks and `style=` attributes are therefore banned; all CSS lives in stylesheets. Set via Helmet, plus HSTS with a two-year max-age and preload, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a restrictive `Permissions-Policy`.

### 5.3 What SQLite can and cannot carry

SQLite in WAL mode gives one writer and many concurrent readers, with transactions that are genuinely serializable. For a ledger this is a feature: every value-bearing operation is a single serialized write transaction, which eliminates an entire class of concurrency bug that a multi-writer database would force us to reason about explicitly.

The constraints, stated plainly so they are not discovered later:

- **Single process for writes.** The application must not be horizontally scaled across machines while SQLite is the ledger store. Scale vertically. Read replicas via Litestream or LiteFS are possible; write scaling is not.
- **Backups are mandatory and continuous.** Litestream streaming to object storage, plus a nightly `VACUUM INTO` snapshot retained for 90 days. A ledger without point-in-time recovery is not a ledger.
- **Migration to Postgres is a foreseeable event.** All database access goes through a repository layer in `src/db/` with no SQL outside it, so the eventual port is bounded. Do not use SQLite-specific SQL where standard SQL will do.

Pragmas set at open: `journal_mode = WAL`, `synchronous = FULL` (not NORMAL; this is a ledger and a lost transaction is unacceptable), `foreign_keys = ON`, `busy_timeout = 5000`.

### 5.4 Numeric representation

**This is the single most consequential technical decision in the document.**

Floating point is never used for a monetary value anywhere in the system, in any layer, including the template layer.

SQLite's `INTEGER` is 64-bit signed, maximum ≈ 9.22 × 10^18. Ethereum's native precision is 18 decimals, so one ETH is 10^18 wei and a 64-bit integer would overflow at roughly 9.2 ETH. Storing native precision is therefore not viable without moving to text-encoded BigInt, which forfeits `SUM()` and makes ledger invariants unenforceable in SQL.

**Decision:** every asset is represented internally at a **fixed precision of 8 decimal places**, stored as a `INTEGER` count of base units where 1 unit = 10^-8 of the asset. Maximum representable quantity is ≈ 9.2 × 10^10 of any asset, which exceeds the total supply of every asset under consideration.

Consequences that must be handled, not papered over:

- **Deposit truncation.** An inbound ETH transfer carries 18 decimals. Credit is truncated *down* to 8 decimals and the remainder is recorded in a `dust_remainders` table against the user and asset. Dust accumulates and is credited once it exceeds one base unit. It is never silently discarded, because silently discarding user funds is theft regardless of magnitude.
- **Withdrawal expansion.** An 8-decimal internal amount is expanded to native chain precision at broadcast time, in the custody layer, using the asset's `decimals` field.
- **Display.** Assets are displayed at their conventional precision (BTC 8, ETH 6, USDT 2), never at internal precision. Rounding for display is half-even and never mutates the stored value.
- **The boundary is the custody layer.** Native-precision arithmetic exists only in Slice 2's chain adapters. The ledger, the API, and the UI see only base units.

Arithmetic on base units uses `BigInt` in application code even though values fit in a `Number`, because `Number` silently loses precision above 2^53 and the failure mode is a wrong balance rather than an exception.

### 5.5 Project layout

```
meridian/
  src/
    server.ts              app bootstrap, middleware chain, graceful shutdown
    config.ts              env parsing and validation, fails fast on missing vars
    db/
      index.ts             connection, pragmas, migration runner
      migrations/          NNNN-description.sql
      repositories/        all SQL lives here, one file per aggregate
    domain/
      ledger/              posting rules, invariants, holds. No HTTP, no SQL.
      identity/            password policy, TOTP, session rules, KYC state machine
      assets/              asset registry, precision, formatting
    routes/
      marketing.ts
      auth.ts
      onboarding.ts
      app.ts
      api.ts
    views/
      layouts/
      components/
      marketing/
      app/
    public/
      css/                 authored CSS, no framework
      js/                  Alpine components, one file per component
      fonts/
  docs/superpowers/specs/
  tests/
```

`src/domain/` contains no Express and no SQL. It is pure logic over plain objects and is where the majority of unit tests live. This boundary is the reason the eventual Postgres migration and the eventual WaaS substitution are both tractable.

---

## 6. Slice 1, subsystem A — Public marketing site

Server-rendered Pug, no authentication, aggressively cached, live ticker via SSE.

### 6.1 Page inventory

| Route | Page | Purpose |
|---|---|---|
| `/` | Home | Positioning, live market strip, custody and security summary, regulatory status, primary CTA |
| `/markets` | Markets | Full table of supported assets: price, 24h change, 24h volume, sparkline. Live. |
| `/markets/:symbol` | Asset detail | Price chart, asset description, network and confirmation policy, deposit/withdraw minimums and fees |
| `/fees` | Fees | Complete schedule: trading spread, withdrawal fee per asset per network, deposit (free). No asterisks. |
| `/security` | Security | Custody model stated plainly, hot/cold split, key management, incident response, audit history |
| `/regulatory` | Regulatory | Entity details, licensing status and its current stage, KYC/AML policy summary, jurisdictions served and not served |
| `/about` | About | Company, team, contact |
| `/help` | Help centre | Searchable article index |
| `/help/:slug` | Help article | Markdown-sourced |
| `/status` | Status | Per-subsystem uptime, incident history |
| `/legal/terms` | Terms of Service | |
| `/legal/privacy` | Privacy Policy | NDPR-compliant |
| `/legal/risk` | Risk Disclosure | Prominent, plain-language, linked from onboarding consent |
| `/legal/aml` | AML Policy | |
| `/legal/cookies` | Cookie Policy | |

### 6.2 Home page structure

1. **Top rail** — wordmark, nav, live ticker, `Log in` / `Open account`
2. **Hero** — headline, one-sentence subhead, two actions. No illustration. The ticker above it is the visual interest.
3. **Live market strip** — six assets, price, 24h delta, sparkline. Flashes on update.
4. **How custody works** — three plain statements about pooled reserves, cold storage proportion, and reconciliation. This is a trust product; leading with custody rather than features is the differentiator.
5. **Fee transparency** — the actual headline numbers, inline, linking to the full schedule.
6. **Regulatory status** — current stage, stated without inflation.
7. **Footer** — full sitemap, entity details, registration numbers, risk warning.

### 6.3 Content rules

- Every claim on the marketing site must be true at the moment it is published. No aspirational metrics, no placeholder social proof, no invented volume figures, no fabricated testimonials, no logos of companies that are not customers.
- Licensing status is stated at its actual current stage. "Registered" is not written until registration exists.
- A persistent risk warning appears in the footer of every page.
- No claims of returns, performance, or safety of principal anywhere on the site.

### 6.4 Performance budget

Marketing pages: under 120KB of JavaScript, under 40KB of CSS, LCP under 1.5s on a simulated Nigerian 3G connection, CLS under 0.05. Fonts self-hosted and preloaded. Sparklines are inline SVG rendered server-side, hydrated only for live updates.

---

## 7. Slice 1, subsystem C — Ledger core

Specified before subsystem B because B depends on it for account provisioning.

### 7.1 Asset registry

```sql
CREATE TABLE assets (
  symbol                  TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('native','token')),
  chain                   TEXT,
  contract_address        TEXT,
  native_decimals         INTEGER NOT NULL,
  display_decimals        INTEGER NOT NULL,
  confirmations_required  INTEGER NOT NULL,
  is_stablecoin           INTEGER NOT NULL DEFAULT 0,
  deposit_enabled         INTEGER NOT NULL DEFAULT 0,
  withdrawal_enabled      INTEGER NOT NULL DEFAULT 0,
  trading_enabled         INTEGER NOT NULL DEFAULT 0,
  sort_order              INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL
);
```

Internal precision is fixed at 8 for all assets and is therefore not a column. `native_decimals` exists solely for the custody layer's conversion at deposit and withdrawal.

In Slice 1 all three `*_enabled` flags are 0 for every asset. The registry exists so balances and the UI have something to reference.

### 7.2 Accounts

Every balance-bearing position is an account. Users do not have balances; accounts do.

```sql
CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  asset       TEXT NOT NULL REFERENCES assets(symbol),
  type        TEXT NOT NULL CHECK (type IN (
                'user_available', 'user_hold',
                'platform_fee', 'platform_treasury', 'platform_dust',
                'external_deposit', 'external_withdrawal'
              )),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, asset, type)
);
```

`user_id` is null for platform and external accounts. The `external_*` accounts are the counterparty for value entering and leaving the system, which is what makes on-chain movement expressible as a balanced double-entry transaction.

### 7.3 Journal

```sql
CREATE TABLE ledger_transactions (
  id               INTEGER PRIMARY KEY,
  kind             TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL UNIQUE,
  external_ref     TEXT,
  metadata         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);

CREATE TABLE ledger_entries (
  id              INTEGER PRIMARY KEY,
  transaction_id  INTEGER NOT NULL REFERENCES ledger_transactions(id),
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  asset           TEXT NOT NULL REFERENCES assets(symbol),
  amount          INTEGER NOT NULL,   -- signed, base units (1e-8)
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_entries_account ON ledger_entries(account_id, id);
CREATE INDEX idx_entries_tx ON ledger_entries(transaction_id);
```

**Append-only.** There is no `UPDATE` and no `DELETE` on either table, enforced by SQLite triggers that raise on both. A correction is a new, opposing transaction of kind `reversal` referencing the original. Nothing in the ledger's history is ever rewritten.

The `idempotency_key` unique constraint is the mechanism that makes every posting operation safely retryable, which matters enormously once Slice 2 introduces chain callbacks that can fire more than once.

### 7.4 Invariants

Enforced in the domain layer on every post, and independently verifiable in SQL by a reconciliation job:

1. **Balance.** For every transaction, for every asset, the sum of entry amounts is exactly zero.
2. **Single asset per entry pair.** An entry's `asset` matches its account's `asset`.
3. **Non-negative user accounts.** No `user_available` or `user_hold` account may have a negative balance after any transaction. Platform accounts may go negative; user accounts may not.
4. **Conservation.** The sum of all entries for a given asset across all accounts is zero at all times.
5. **Reserve backing** (from Slice 2). The sum of all `user_available` plus `user_hold` balances for an asset never exceeds confirmed on-chain reserves for that asset.

Invariants 1 through 4 are checkable now and a `bun run verify-ledger` command runs all four across the whole journal. It runs in CI against the test fixture and nightly against production.

### 7.5 Materialized balances

Deriving a balance by summing the journal is correct but becomes slow. A cache table is maintained inside the same write transaction as the posting, never outside it:

```sql
CREATE TABLE account_balances (
  account_id       INTEGER PRIMARY KEY REFERENCES accounts(id),
  amount           INTEGER NOT NULL DEFAULT 0,
  last_entry_id    INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT NOT NULL
);
```

The reconciliation job recomputes every balance from the journal and asserts equality with the cache. Divergence is a P1 incident, not a warning.

### 7.6 Holds

A hold moves value from `user_available` to `user_hold` for the same user and asset. It is an ordinary balanced transaction, not a special case. Pending withdrawals and open orders both consume holds. This means a user can never spend the same balance twice, and the mechanism is uniform across every future feature.

The journal records the movement, but a hold also needs an identity so it can be released or consumed later:

```sql
CREATE TABLE holds (
  id                    INTEGER PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id),
  asset                 TEXT NOT NULL REFERENCES assets(symbol),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  status                TEXT NOT NULL
                          CHECK (status IN ('active','released','consumed')),
  reference             TEXT NOT NULL,      -- what the hold is for
  place_transaction_id  INTEGER NOT NULL REFERENCES ledger_transactions(id),
  close_transaction_id  INTEGER REFERENCES ledger_transactions(id),
  created_at            TEXT NOT NULL,
  closed_at             TEXT
);

CREATE INDEX idx_holds_user_active ON holds(user_id, asset) WHERE status = 'active';
```

This table is mutable, unlike the journal, because it is an index over the journal rather than a record of value. It holds no authoritative amount: the authoritative held balance is always the `user_hold` account balance, and the reconciliation job asserts that the sum of active holds for a user and asset equals that account's balance. A hold closes by either `release` (value returns to `user_available`) or consumption by the operation that placed it (value leaves to its destination). Both are ordinary balanced transactions.

### 7.7 Public interface

```ts
interface Ledger {
  post(tx: {
    kind: string
    idempotencyKey: string
    entries: Array<{ accountId: number; asset: string; amount: bigint }>
    externalRef?: string
    metadata?: Record<string, unknown>
  }): Promise<{ transactionId: number }>

  balance(userId: number, asset: string): Promise<{ available: bigint; held: bigint }>
  balances(userId: number): Promise<Map<string, { available: bigint; held: bigint }>>
  history(userId: number, opts: { asset?: string; cursor?: number; limit: number }): Promise<Entry[]>
  hold(userId: number, asset: string, amount: bigint, ref: string): Promise<{ holdId: number }>
  release(holdId: number): Promise<void>
}
```

`post` is the only write path into the ledger. Nothing else in the codebase writes to `ledger_entries`, and that is enforced by keeping the tables accessible only through `src/db/repositories/ledger.ts`.

---

## 8. Slice 1, subsystem B — Identity

### 8.1 Schema

```sql
CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  email_normalized      TEXT NOT NULL UNIQUE,
  password_hash         TEXT NOT NULL,
  email_verified_at     TEXT,
  totp_secret_encrypted TEXT,
  totp_enabled_at       TEXT,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','suspended','closed')),
  kyc_tier              INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE sessions (
  id             TEXT PRIMARY KEY,          -- 256-bit random, base64url
  user_id        INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  ip             TEXT,
  user_agent     TEXT,
  revoked_at     TEXT
);

CREATE TABLE kyc_applications (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL
                      CHECK (status IN ('draft','submitted','in_review','approved','rejected','expired')),
  current_step      TEXT NOT NULL,
  target_tier       INTEGER NOT NULL,
  provider          TEXT,
  provider_ref      TEXT,
  rejection_reason  TEXT,
  submitted_at      TEXT,
  decided_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('user','admin','system')),
  action       TEXT NOT NULL,
  target       TEXT,
  ip           TEXT,
  user_agent   TEXT,
  metadata     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);
```

`audit_log` is append-only under the same trigger discipline as the ledger. Every authentication event, every KYC transition, every security-setting change, and every administrative action writes a row.

**PII storage.** Identity documents, BVN, and NIN are **not** stored in the application database in plaintext. BVN and NIN are sent to the KYC provider, and only the provider's verification reference and a truncated last-four are retained. Document images are stored with the provider, never on the application host. This limits breach blast radius and is materially easier to defend to a regulator than an encrypted local blob store.

### 8.2 Authentication

- **Password hashing:** Argon2id via `Bun.password.hash`, memory cost 19456 KiB, time cost 2, parallelism 1, per OWASP's current guidance. Rehash on login when parameters change.
- **Password policy:** minimum 12 characters, checked against the Have I Been Pwned range API by k-anonymity prefix. No composition rules, no forced rotation, both of which make passwords worse.
- **Sessions:** opaque 256-bit random identifier in a cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix. Server-side session record is the source of truth. Absolute expiry 30 days, idle expiry 7 days. The identifier is rotated on every privilege change (login, 2FA enrolment, password change).
- **2FA:** TOTP, RFC 6238, 30s step, ±1 window tolerance. Secret encrypted at rest with a key from the environment, never the database. Ten single-use recovery codes issued at enrolment, displayed once, stored as Argon2id hashes. **Mandatory before any withdrawal is possible**, which lands in Slice 2 but the enrolment flow ships now.
- **Rate limiting:** per-IP and per-account token buckets. Login 5 per 15 minutes per account and 20 per 15 minutes per IP. Registration 3 per hour per IP. Password reset 3 per hour per account. Breaching the account bucket locks the account for 15 minutes and writes an audit row and a notification email.
- **CSRF:** double-submit token on every state-changing request. `SameSite=Lax` alone is not treated as sufficient.
- **Enumeration:** registration, login, and password reset return identical responses and take constant time whether or not the account exists.

### 8.3 Registration and verification flow

```
/register  →  email + password
              ├─ create user (kyc_tier 0, email_verified_at null)
              ├─ provision accounts: user_available + user_hold per active asset
              ├─ issue single-use verification token, 24h expiry
              └─ send verification email
/verify-email?token=…
              └─ set email_verified_at, create session, redirect → /onboarding
```

Account provisioning at registration rather than lazily on first deposit means the ledger always has a destination and there is no create-on-write race in Slice 2.

### 8.4 KYC wizard

Resumable, one step per screen, state persisted on every step transition so a user can leave and return. Progress is shown as a stepped hairline rail, never a percentage.

| Step | Collects | Notes |
|---|---|---|
| 1. Identity | Legal first/middle/last name, date of birth, Nigerian phone number | Phone verified by OTP |
| 2. Government ID | BVN **or** NIN | Sent to provider for verification. Only the reference and last four are retained. |
| 3. Address | State, LGA, street address, postal code | Structured, with a Nigerian state and LGA reference dataset |
| 4. Document and liveness | ID document capture, selfie liveness | Handled entirely by the provider's SDK. Images never touch our host. |
| 5. Disclosures | Terms, Privacy, Risk Disclosure, AML Policy | Four separate explicit checkboxes, no pre-ticking, no bundling. Consent recorded with document version, timestamp, and IP. |

Terminal states: `approved` sets `kyc_tier`, `rejected` records a reason and permits one resubmission, `in_review` shows a status page with no false ETA.

### 8.5 KYC tiers

| Tier | Requires | Slice 1 effect | Later effect |
|---|---|---|---|
| 0 | Registration only | Dashboard visible, all balances zero | No deposit, no withdrawal, no trading |
| 1 | Email + phone + BVN/NIN verified | Same | Deposit enabled, daily withdrawal cap |
| 2 | Tier 1 + document + liveness + address | Same | Higher caps, all assets |

Caps are placeholders until confirmed against the SEC Nigeria framework and the AML programme. They are configuration, not code.

### 8.6 Authenticated pages in Slice 1

| Route | Page |
|---|---|
| `/dashboard` | Portfolio: total value, per-asset balance rows, all zero, with an honest empty state |
| `/account` | Profile, email, phone |
| `/account/security` | Password change, 2FA enrolment and recovery codes, active session list with individual revoke |
| `/account/verification` | KYC status, tier, limits, resubmission |
| `/account/activity` | The user's own audit log, human-readable |

Deposit, withdraw, and trade appear in the navigation as visibly disabled with an accurate explanation. They are not hidden, because hiding them makes the product look incomplete while disabling them with a reason makes it look deliberate.

---

## 9. Error handling

- **Domain errors** are typed and carry a stable machine-readable code. HTTP handlers map codes to status and to a Pug-rendered message. Internal detail never reaches the client.
- **Ledger errors** fail the entire SQLite transaction. A partial posting is impossible by construction, not by convention.
- **Invariant violation** at post time throws, rolls back, writes a critical audit row, and pages. It is never caught and continued past.
- **Unhandled exceptions** return a generic 500 page carrying a correlation ID that is also written to the structured log. Users get the ID; users never get a stack trace.
- **Provider failures** (KYC, email) surface as a retryable state on the affected step, never as a lost application. The KYC application row survives every provider outage.
- **Validation** happens server-side unconditionally. Client-side validation exists only to shorten the feedback loop and is never trusted.
- **Logging** is structured JSON with a correlation ID per request. Passwords, TOTP secrets, session identifiers, BVN, NIN, and document data are on a redaction list enforced by the logger itself, not by developer discipline.

---

## 10. Testing

| Layer | Approach |
|---|---|
| Domain | `bun:test` unit tests. The ledger's posting rules and invariants get exhaustive coverage including property-based tests asserting that a random sequence of valid postings never violates conservation or non-negativity. |
| Repository | Integration tests against a real in-memory SQLite instance with migrations applied. No mocking the database. |
| Routes | Supertest-style integration over the real app, covering auth, CSRF, rate limiting, and the complete registration and KYC state machine. |
| E2E | Playwright, restricted to: register → verify → complete KYC → land on dashboard; login with 2FA; session revocation. |
| Security | Automated check that every route asserts authentication and CSRF; a test that fails if any response omits the CSP header. |
| Ledger reconciliation | `bun run verify-ledger` in CI on every commit. |
| Accessibility | axe-core over every rendered template, zero violations gating merge. |

The ledger is the component where bugs are unrecoverable, so it is written test-first without exception.

---

## 11. Slice 1 definition of done

1. All marketing pages render, are responsive, meet the performance budget, and pass axe with zero violations.
2. A user can register, verify email, enrol 2FA, complete the KYC wizard end to end against the chosen provider's sandbox, and reach a dashboard.
3. Sessions can be listed and individually revoked. Rate limits demonstrably engage.
4. The ledger posts balanced transactions, rejects unbalanced ones, rejects negative user balances, and is provably idempotent under repeated keys.
5. `verify-ledger` passes over a fixture of at least 10,000 synthetic transactions.
6. CSP is enforced with no `unsafe-inline` and no `unsafe-eval`, verified by test.
7. Litestream replication is running and a restore has been performed successfully at least once.
8. No route permits value movement. There is no code path that credits a balance outside of tests.

---

## 12. Open questions

1. **KYC provider selection.** Smile ID, Dojah, and Youverify differ in BVN/NIN coverage, liveness quality, sanctions screening depth, and pricing. This blocks step 2 of the wizard and needs a decision before subsystem B starts.
2. **Legal entity structure.** A US company serving Nigerian users needs a CAC-incorporated Nigerian entity for SEC registration. The relationship between the two entities determines whose terms apply, where data resides, and which privacy regime governs. Needs counsel.
3. **Data residency.** NDPR expectations for Nigerian personal data may constrain hosting location. Affects the deployment target.
4. **Custody decision revisit.** Self-managed HD wallets versus WaaS, to be settled before Slice 2 begins. See §3.1.
5. **Liquidity provider selection.** Blocks Slice 3. Not urgent.
6. **Brand name clearance.** Trademark and domain availability for Meridian in both jurisdictions, before any asset production.
7. **Hosting and deployment target.** Single-writer SQLite constrains this. Needs to be settled before Slice 1 ships.

---

## 13. Revision log

| Date | Change |
|---|---|
| 2026-08-29 | Initial draft. |
