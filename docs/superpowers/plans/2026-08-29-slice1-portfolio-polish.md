# Meridian Slice 1, Plan 5: Portfolio and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Value the portfolio at indicative prices, and land the interaction details that separate the terminal aesthetic from a dark-mode website.

**Architecture:** Valuation is a pure function over balances, quotes, and the asset registry, so the arithmetic is tested exhaustively without a database or a network. The interaction work is Alpine CSP components plus CSS; the one place a JavaScript-only pattern was planned (toasts) becomes a server-rendered flash instead, because a confirmation that vanishes when JavaScript fails is worse than one that does not.

**Tech Stack:** Bun, Express 5, Pug, `@alpinejs/csp`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-29-meridian-design.md` (sections 4.4, 4.7, 8.6)

## Global Constraints

Every task's requirements implicitly include this section.

- **Bun only.** Never npm, yarn, or pnpm.
- **No floating point for a monetary value.** Valuation is `bigint` throughout.
- **CSP carries no `unsafe-inline` and no `unsafe-eval`.** Alpine components register via `Alpine.data()`; no inline object literals in `x-data`, no expressions in `x-on`. Existing tests enforce this.
- **JavaScript is an enhancement, never a requirement.** Every page must work with scripts disabled. The command palette and shortcuts add speed; they never become the only route to anything.
- **`--text-dim` stays off anything a user must read.** The muted price fraction uses `--text-muted`, which clears 4.5:1.
- **No SQL outside `src/db/repositories/`.** `src/domain/` imports neither Express nor `bun:sqlite`.
- **Accessibility stays at zero axe violations**, including every new overlay. An overlay must trap focus, close on Escape, and be announced.
- **Copy voice:** plain and direct. No em dashes.

---

## Task 1: Split money formatting so the fraction can be muted

Spec §4.4 requires prices rendered with the fractional part in `--text-muted`, so the significant digits dominate. That needs the parts separately.

**Files:**
- Modify: `src/domain/prices.ts`, `src/domain/money.ts`
- Modify: `src/views/marketing/markets.pug`, `home.pug`, `asset.pug`, `app/dashboard.pug`
- Create: `src/views/components/amount.pug`
- Test: `tests/domain/prices.test.ts`

**Interfaces:**
- Produces:
  - `interface MoneyParts { whole: string; fraction: string }`
  - `usdParts(priceUsd: bigint): MoneyParts`
  - `balanceParts(base: bigint, displayDecimals: number): MoneyParts`
  - Pug mixin `+amount(parts)` rendering `<span class="num">whole<span class="num-frac">.fraction</span></span>`

- [ ] **Step 1: Add the failing tests to `tests/domain/prices.test.ts`**

```ts
describe("usdParts", () => {
  test("splits a grouped price into whole and fraction", () => {
    expect(usdParts(6741208000000n)).toEqual({ whole: "67,412", fraction: "08" })
  })

  test("splits a sub-dollar price at four decimals", () => {
    expect(usdParts(33830400n)).toEqual({ whole: "0", fraction: "3383" })
  })

  test("splits a sub-cent price at eight decimals", () => {
    expect(usdParts(2341n)).toEqual({ whole: "0", fraction: "00002341" })
  })

  test("recombines to exactly what formatUsd returns", () => {
    for (const value of [6741208000000n, 33830400n, 2341n, 0n, 100000000n]) {
      const parts = usdParts(value)
      expect(`${parts.whole}.${parts.fraction}`).toBe(formatUsd(value))
    }
  })
})

describe("balanceParts", () => {
  test("splits a balance at the asset's display precision", () => {
    expect(balanceParts(150000000n, 4)).toEqual({ whole: "1", fraction: "5000" })
  })

  test("groups thousands in the whole part", () => {
    expect(balanceParts(123456700000000n, 2)).toEqual({ whole: "1,234,567", fraction: "00" })
  })

  test("recombines to formatBalance plus grouping", () => {
    const parts = balanceParts(150000000n, 8)
    expect(`${parts.whole}.${parts.fraction}`.replace(/,/g, "")).toBe(
      formatBalance(150000000n, 8),
    )
  })

  test("handles zero decimals with an empty fraction", () => {
    expect(balanceParts(150000000n, 0)).toEqual({ whole: "1", fraction: "" })
  })
})
```

- [ ] **Step 2: Run to verify failure, then implement**

Extract the grouping helper in `src/domain/prices.ts` and export both functions. `formatUsd` becomes a thin wrapper over `usdParts` so the two can never disagree:

```ts
export interface MoneyParts {
  whole: string
  fraction: string
}

function decimalsFor(priceUsd: bigint): number {
  if (priceUsd > 0n && priceUsd < ONE_CENT) return 8
  if (priceUsd > 0n && priceUsd < ONE_DOLLAR) return 4
  return 2
}

export function usdParts(priceUsd: bigint): MoneyParts {
  return balanceParts(priceUsd, decimalsFor(priceUsd))
}

export function balanceParts(base: bigint, displayDecimals: number): MoneyParts {
  const plain = formatBalance(base, displayDecimals)
  const [whole = "0", fraction = ""] = plain.split(".")
  return { whole: group(whole), fraction }
}

export function formatUsd(priceUsd: bigint): string {
  const { whole, fraction } = usdParts(priceUsd)
  return fraction ? `${whole}.${fraction}` : whole
}
```

- [ ] **Step 3: Write `src/views/components/amount.pug`**

```pug
mixin amount(parts)
  span.num
    = parts.whole
    if parts.fraction
      span.num-frac .#{parts.fraction}
```

- [ ] **Step 4: Use it everywhere a figure is rendered**

Markets, home strip, asset detail, and the dashboard balance table each pass parts rather than a string. Route handlers call `usdParts` or `balanceParts` instead of `formatUsd` or `formatBalance`.

Existing tests assert on strings like `67,412.08`. Rendered output becomes `67,412<span class="num-frac">.08</span>`, so those assertions must change to match the new markup. Update them to assert on both parts rather than deleting the check.

- [ ] **Step 5: Run the whole suite, fix the affected assertions, commit**

```bash
git add -A
git commit -m "feat: split money formatting so the fraction renders muted"
```

---

## Task 2: Portfolio valuation

**Files:**
- Create: `src/domain/portfolio.ts`
- Test: `tests/domain/portfolio.test.ts`

**Interfaces:**
- Produces:
  - `interface HoldingRow { symbol: string; displaySymbol: string; name: string; networkLabel: string; available: bigint; held: bigint; priceUsd: bigint | null; valueUsd: bigint }`
  - `interface Portfolio { totalUsd: bigint; rows: HoldingRow[]; priced: boolean }`
  - `valueHolding(amount: bigint, priceUsd: bigint): bigint`
  - `buildPortfolio(input: { assets: Asset[]; balances: Map<string, { available: bigint; held: bigint }>; quotes: Quote[] }): Portfolio`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, describe } from "bun:test"
import { valueHolding, buildPortfolio } from "../../src/domain/portfolio"

describe("valueHolding", () => {
  test("values one unit at the unit price", () => {
    // 1.00000000 BTC at 67,412.08 USD
    expect(valueHolding(100000000n, 6741208000000n)).toBe(6741208000000n)
  })

  test("values a fractional holding", () => {
    // 0.5 BTC
    expect(valueHolding(50000000n, 6741208000000n)).toBe(3370604000000n)
  })

  test("values a zero holding at zero", () => {
    expect(valueHolding(0n, 6741208000000n)).toBe(0n)
  })

  test("values any holding at a zero price as zero", () => {
    expect(valueHolding(100000000n, 0n)).toBe(0n)
  })

  test("truncates rather than rounding up, so value is never overstated", () => {
    // 0.00000001 units at 0.5 USD is 0.000000005, which truncates to 0.
    expect(valueHolding(1n, 50000000n)).toBe(0n)
  })

  test("stays exact far above 2^53", () => {
    const big = 9007199254740993n
    expect(valueHolding(big, 100000000n)).toBe(big)
  })

  test("returns bigint, never number", () => {
    expect(typeof valueHolding(100000000n, 6741208000000n)).toBe("bigint")
  })
})

describe("buildPortfolio", () => {
  // Fixtures build two assets, one priced and one not.
  test("totals the value of every priced holding")
  test("counts held balance in the total, because it is still owned")
  test("returns zero total for an empty portfolio")
  test("includes an unpriced asset with a null price and zero value")
  test("flags priced false when no quote covers any holding")
  test("orders rows by the asset registry sort order")
  test("returns a row for every asset, including zero balances")
})
```

Write those seven `buildPortfolio` cases out in full during implementation, with fixtures. They are listed compactly here only because they share one fixture set.

- [ ] **Step 2: Implement `src/domain/portfolio.ts`**

```ts
import { INTERNAL_SCALE } from "./money"
import type { Quote } from "./prices"
import type { Asset } from "../db/repositories/assets"

/**
 * Both operands are base units at 8 decimal places, so the product carries
 * 16 and must be divided back down. Division truncates, which means a value
 * is never overstated. That is the right direction for a balance.
 */
export function valueHolding(amount: bigint, priceUsd: bigint): bigint {
  return (amount * priceUsd) / INTERNAL_SCALE
}

export function buildPortfolio(input: {
  assets: Asset[]
  balances: Map<string, { available: bigint; held: bigint }>
  quotes: Quote[]
}): Portfolio {
  const prices = new Map(input.quotes.map((q) => [q.symbol, q.priceUsd]))
  let totalUsd = 0n
  let priced = false

  const rows = input.assets.map((asset) => {
    const balance = input.balances.get(asset.symbol) ?? { available: 0n, held: 0n }
    const priceUsd = prices.get(asset.symbol) ?? null
    const owned = balance.available + balance.held
    const valueUsd = priceUsd === null ? 0n : valueHolding(owned, priceUsd)
    if (priceUsd !== null && owned > 0n) priced = true
    totalUsd += valueUsd
    return {
      symbol: asset.symbol,
      displaySymbol: asset.displaySymbol,
      name: asset.name,
      networkLabel: asset.networkLabel,
      available: balance.available,
      held: balance.held,
      priceUsd,
      valueUsd,
    }
  })

  return { totalUsd, rows, priced }
}
```

- [ ] **Step 3: Run to green, commit**

```bash
git add -A
git commit -m "feat: portfolio valuation in base units with truncating arithmetic"
```

---

## Task 3: Dashboard portfolio

**Files:**
- Modify: `src/routes/account.ts`, `src/views/app/dashboard.pug`
- Test: `tests/routes/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("dashboard portfolio", () => {
  test("shows a total value of zero for a new account")
  test("labels the total as indicative")
  test("shows a row for every supported asset")
  test("shows held balance separately from available")
  test("shows an honest empty state rather than a fake chart")
  test("values a seeded balance at the indicative price")
  test("renders the fractional part in a muted span")
  test("says prices are unavailable when the feed is empty rather than showing zero")
})
```

That last one matters. A total of `$0.00` when the price feed is down is a lie: the user may hold assets. When nothing is priced, say so.

- [ ] **Step 2: Implement**

The handler builds the portfolio from `ledger.balances`, `assets.all()`, and `feed.snapshot()`, and passes `usdParts(totalUsd)` plus per-row parts. The template shows the total, then the flat balance table, then the disabled actions from plan 4.

Empty state copy, when every balance is zero:

```
Nothing here yet. Your balances appear once deposits are enabled.
```

Unpriced state, when the feed has no quotes:

```
Prices are unavailable right now, so we cannot value your holdings. Your balances below are still correct.
```

- [ ] **Step 3: Run to green, commit**

---

## Task 4: Command palette and keyboard map

**Files:**
- Modify: `public/js/alpine-components.js`, `src/views/layouts/base.pug`, `public/css/app.css`
- Create: `src/views/components/palette.pug`
- Test: `tests/views/palette.test.ts`

**Interfaces:**
- Produces: Alpine components `palette` and `shortcuts`; a `/api/destinations` JSON route is **not** needed, because the destination list is small and server-rendered into the markup.

- [ ] **Step 1: Write the failing test**

```ts
describe("command palette", () => {
  test("is registered as a CSP-safe Alpine component")
  test("uses no eval or Function constructor")
  test("is present in the rendered layout")
  test("is hidden until opened, using the hidden attribute rather than inline style")
  test("lists public destinations for an anonymous visitor")
  test("lists account destinations for a signed-in user")
  test("does not list account destinations for an anonymous visitor")
  test("has an accessible dialog role and label")
  test("its input has an associated label")
})

describe("keyboard shortcuts", () => {
  test("the shortcut sheet is in the markup")
  test("the sheet documents the palette, navigation, and search keys")
  test("every shortcut target is also reachable by a normal link")
})
```

The last one is the important one: shortcuts are an accelerator, never the only path.

- [ ] **Step 2: Implement the palette component**

Server-render the destination list into `data-` attributes so the component needs no fetch and no inline object:

```pug
mixin palette(destinations)
  .palette(x-data="palette" x-on:keydown.escape.window="close" hidden x-bind:hidden="!open")
    .palette-backdrop(x-on:click="close")
    .palette-panel(role="dialog" aria-modal="true" aria-label="Command palette")
      label.visually-hidden(for="palette-input") Search pages
      input#palette-input(type="text" x-model="query" x-ref="input" placeholder="Go to..." autocomplete="off")
      ul.palette-list
        each destination in destinations
          li
            a(href=destination.href data-label=destination.label x-show="matches($el)")= destination.label
```

`matches($el)` reads `data-label` from the element rather than evaluating an expression over a data structure, which keeps the CSP build happy.

```js
Alpine.data("palette", () => ({
  open: false,
  query: "",
  init() {
    window.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        this.toggle()
      }
    })
  },
  toggle() {
    this.open = !this.open
    if (this.open) queueMicrotask(() => this.$refs.input?.focus())
  },
  close() {
    this.open = false
  },
  matches(el) {
    if (!this.query) return true
    return (el.dataset.label || "").toLowerCase().includes(this.query.toLowerCase())
  },
}))
```

- [ ] **Step 3: Implement the shortcut map**

`g` then `d`/`m`/`a` navigates, `/` focuses the palette, `?` opens the sheet. Ignore every key while focus is in an input, textarea, or select, or the user cannot type the letter g.

- [ ] **Step 4: Run the accessibility suite and fix what it finds**

Expect `aria-hidden-focus` on the hidden panel if `hidden` is not applied correctly. Fix the markup, not the test.

- [ ] **Step 5: Commit**

---

## Task 5: Skeletons and flash messages

**Files:**
- Modify: `public/css/app.css`, `src/views/components/ticker.pug`
- Create: `src/middleware/flash.ts`, `src/views/components/flash.pug`
- Modify: `src/routes/account.ts`, `src/routes/onboarding.ts`
- Test: `tests/middleware/flash.test.ts`

**A deliberate departure from the spec.** Spec §4.7 calls for toasts. This builds a **server-rendered flash message** instead, carried in a short-lived signed cookie and rendered on the next page. Reason: a confirmation that only exists in JavaScript disappears when a script fails to load, and "did my password change save?" is exactly the question a user must never be left holding. The visual treatment stays as specified; only the mechanism changes.

- [ ] **Step 1: Write the failing test**

```ts
describe("flash", () => {
  test("a message set on one request renders on the next")
  test("a message renders only once")
  test("survives a redirect, which is the whole point")
  test("a forged flash cookie is ignored")
  test("renders nothing when there is no message")
  test("escapes message content rather than rendering markup")
})
```

- [ ] **Step 2: Implement**

Sign the cookie with `config.sessionSecret` using the same HMAC helper shape as the pending-2FA cookie, so a user cannot inject arbitrary text into their own page. Clear it on read.

Wire it to: password changed, 2FA turned on, 2FA turned off, other sessions revoked, and KYC submitted.

- [ ] **Step 3: Add skeleton styles and apply to the ticker**

```css
.skeleton {
  background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 37%, var(--surface) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
  border: 1px solid var(--hairline);
  border-radius: 2px;
}
@keyframes shimmer {
  0% { background-position: 100% 50%; }
  100% { background-position: 0 50%; }
}
```

The ticker's loading state becomes fixed-width skeleton blocks at the exact dimensions of a loaded row, so nothing shifts when data arrives. `prefers-reduced-motion` already disables the animation through the existing global rule.

- [ ] **Step 4: Run everything, commit**

---

## Task 6: Final verification of Slice 1

**Files:**
- Modify: `tests/accessibility.test.ts`, `tests/performance.test.ts`
- Create: `docs/SLICE-1.md`

- [ ] **Step 1: Confirm the budgets still hold**

The palette and shortcuts add JavaScript. Re-run `tests/performance.test.ts` and confirm total JS stays under 120KB and CSS under 40KB. If CSS has grown past budget, that is a real finding: report it rather than raising the limit.

- [ ] **Step 2: Confirm progressive enhancement**

Add a test asserting every palette destination is also reachable from a normal link in the layout or footer, so a scripts-disabled browser loses nothing.

- [ ] **Step 3: Write `docs/SLICE-1.md`**

A short readme for the next person: what exists, how to run it, what the environment variables are, what the launch blockers are, and which spec sections map to which plan. Link the five plans and the spec.

- [ ] **Step 4: Run the complete gate**

```bash
bun test && bun run typecheck && bun run verify-ledger
```

- [ ] **Step 5: Commit**

---

## Plan 5 definition of done

1. `bun test` passes, `bun run typecheck` clean, `bun run verify-ledger` exits 0.
2. Every rendered figure shows its fractional part in a muted span, and the recombined string equals what the old formatter returned.
3. Portfolio valuation is `bigint` throughout, truncates rather than rounds up, and is exact above 2^53.
4. A dashboard with no prices says prices are unavailable rather than showing a total of zero.
5. The command palette opens on ⌘K, closes on Escape, traps focus, and every destination in it is also a normal link.
6. Keyboard shortcuts are ignored while focus is in a form field.
7. Flash confirmations survive a redirect and render without JavaScript.
8. Zero axe violations across every route, public and authenticated.
9. JavaScript under 120KB, CSS under 40KB.
10. `docs/SLICE-1.md` describes how to run the thing and what still blocks launch.

## What this plan does not build

Slice 1 ends here. Slice 2 is subsystem D, custody: HD derivation or a wallet-as-a-service adapter behind `CustodyProvider`, deposit detection, confirmations, sweeps, and withdrawal signing, starting with Tron and Ethereum.

The launch blockers carried forward and unchanged: no SMTP vendor or verified sending domain, no real KYC provider adapter, phone OTP stubbed with `phone_verified_at` always null, a placeholder contact address on `/about`, and LGA as free text pending the official dataset.
