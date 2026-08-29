# Meridian, Slice 1

A centralized digital-asset exchange for the Nigerian market, operated by a US-incorporated company. This document describes what exists today, how to run it, and what still blocks launch.

**Nothing in Slice 1 moves value.** There is no chain integration, no deposit, no withdrawal, and no trading. Every asset has its movement flags set to zero. This is deliberate: the product is buildable and demonstrable before licensing lands, which is what the SEC Nigeria ARIP process expects to see.

## Running it

```bash
bun install
bun run assets          # copies self-hosted fonts into public/fonts
cp .env.example .env    # then fill in the secrets
bun run dev
```

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_PATH` | yes | e.g. `./data/meridian.db` |
| `SESSION_SECRET` | yes | 32 characters minimum |
| `TOTP_ENCRYPTION_KEY` | yes | 32 characters minimum, encrypts TOTP secrets at rest |
| `NODE_ENV` | no | `development` by default |
| `PORT` | no | 3000 by default |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | in production | Without all three, email prints to the log. Production refuses to start. |
| `SMTP_PORT`, `EMAIL_FROM` | no | 587 and a placeholder sender |
| `KYC_PROVIDER` | in production | `sandbox` outside production. Production refuses to start with `sandbox`. |

## Commands

| Command | Purpose |
|---|---|
| `bun test` | The whole suite |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run verify-ledger` | Reconciles every ledger invariant, exits 1 on any violation |
| `bun run assets` | Copies fonts from `node_modules` into `public/fonts` |

## What exists

| Subsystem | Plan | What it does |
|---|---|---|
| C, Ledger core | 1 | Append-only double-entry journal, holds, materialized balances, reconciliation command |
| A, Marketing site | 2 | Design system, 15 public routes, indicative price feed over SSE |
| B, Identity | 3 | Argon2id passwords, TOTP, opaque server-side sessions, CSRF, rate limiting, audit log |
| KYC | 4 | Five-step resumable wizard behind `KycProvider`, tiers, consent records |
| Portfolio and polish | 5 | Valuation, command palette, keyboard map, skeletons, flash confirmations |

Plans live in `docs/superpowers/plans/`. The spec they all argue from is `docs/superpowers/specs/2026-08-29-meridian-design.md`.

## Rules that are not negotiable

These are enforced by tests, not by convention. Breaking one fails the suite.

- **No floating point for money, anywhere.** All amounts are `bigint` in code and `INTEGER` in SQLite, at a fixed 8 decimal places. Read money columns through `moneyQuery()`: a plain `db.query()` silently rounds above 2^53.
- **The ledger and audit log are append-only.** SQLite triggers reject UPDATE and DELETE. A correction is a new opposing entry.
- **No SQL outside `src/db/repositories/`.** `src/domain/` imports neither Express nor `bun:sqlite`.
- **CSP carries no `unsafe-inline` and no `unsafe-eval`.** No inline styles, scripts, or event handlers. Alpine components register through `Alpine.data()`.
- **A full BVN or NIN is never stored.** The schema has no column that could hold one. A test dumps every table and fails if it finds one.
- **Zero axe violations** across every route, public and authenticated.
- **JavaScript is an enhancement.** Every page works with scripts disabled.

## What blocks launch

None of these are code problems. All are tracked in spec §12.

1. **No email vendor.** SMTP works when configured; no provider or verified sending domain has been chosen. Production refuses to start without it rather than silently logging verification links.
2. **No real KYC provider.** The interface and a deterministic sandbox exist. Writing the Smile ID, Dojah, or Youverify adapter is one file with no changes above it. Production refuses to start with the sandbox.
3. **Phone OTP is stubbed.** `phone_verified_at` is always null. Needs an SMS vendor, a separate decision from email.
4. **Placeholder contact address** on `/about`.
5. **LGA is a free text field.** Nigeria has 774 local government areas and an inaccurate dropdown silently produces wrong addresses. Load the official dataset from a verifiable source before launch.
6. **Legal and entity details are unfilled** on `/regulatory` and `/legal/terms`.
7. **Capital requirement unconfirmed.** Secondary sources give ₦500m with a proposed ₦2bn for exchanges and custodians. Confirm with Nigerian counsel; it is the largest number in the project.
8. **No security audit and no proof-of-reserves attestation.** `/security` says so plainly and must keep saying so until they exist.

## What is next

Slice 2 is subsystem D, custody: a `CustodyProvider` implementation, deposit detection, confirmations, sweeps, and withdrawal signing, starting with Tron and Ethereum. Custody is outsourced to a wallet-as-a-service provider rather than self-managed; the reasoning is in spec §3.1, and it is primarily regulatory.

Then subsystem E, execution, as quote-and-hedge against a liquidity provider rather than an order book, because a new exchange's order book opens empty.
