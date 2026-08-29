# Meridian Slice 1, Plan 2: Design System and Marketing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the dark terminal design system and every public marketing page, with a live indicative price feed, on a CSP that permits no inline styles or scripts.

**Architecture:** Server-rendered Pug on the Express app from plan 1. One authored stylesheet of semantic tokens, no CSS framework. Alpine's CSP build supplies the only client interactivity, driven by a single Server-Sent Events stream carrying indicative prices from one server-side poller. Page content lives in typed data modules rather than in templates, so copy is reviewable and testable rather than buried in markup.

**Tech Stack:** Bun, Express 5, Pug, `@alpinejs/csp`, Server-Sent Events, `@fontsource-variable/inter`, `@fontsource/jetbrains-mono`, `bun:test`, axe-core.

**Spec:** `docs/superpowers/specs/2026-08-29-meridian-design.md` (sections 4, 5.2, 6)

## Global Constraints

Every task's requirements implicitly include this section.

- **Package manager and runtime is Bun.** Never npm, yarn, or pnpm.
- **CSP carries no `unsafe-inline` and no `unsafe-eval`.** Therefore: no `<style>` blocks, no `style=` attributes, no inline `<script>`, no `onclick=`. All CSS in stylesheets, all JS in files under `public/js/`. A test asserts this by scanning rendered HTML.
- **Alpine is the CSP build.** `x-data` must name a component registered with `Alpine.data("name", () => ({ ... }))`. Inline object literals and arbitrary expressions in directives will not evaluate. No `x-on:click="count++"`; use `x-on:click="increment"`.
- **No floating point for a monetary value.** Prices arriving from the external feed are converted to base-unit `bigint` at the boundary via `parseAmount(value.toFixed(8))` and are `bigint` everywhere downstream.
- **The price feed is indicative and display-only.** It carries a visible "indicative" label and no code path may use it to price a transaction. Execution-grade data arrives with subsystem E.
- **Fonts are self-hosted.** Never loaded from a third-party CDN. A regulated financial site does not hand a font vendor a request log of its users.
- **Content rules (spec §6.3):** every claim must be true at publication. No invented metrics, volumes, testimonials, customer logos, or partner names. Licensing status is stated at its actual current stage; "registered" is not written until registration exists. No claims of returns, performance, or safety of principal. A persistent risk warning appears in every page footer.
- **Copy voice:** plain and direct, like a person wrote it. No marketing inflation, no em dashes.
- **Colour never carries meaning alone.** `--up` and `--down` are always accompanied by a ▲/▼ glyph and a signed number.
- **`--text-dim` is below 4.5:1 contrast** and is restricted to non-essential text. Never a value a user must read.
- **No card layouts for collections.** Flat rows separated by 1px hairlines, full-bleed to their container.
- **Git identity is `timileyindev <timmypelumy@gmail.com>`.** Already configured.

---

## File structure

| File | Responsibility |
|---|---|
| `src/views/layouts/base.pug` | HTML shell, head, top rail, footer |
| `src/views/components/*.pug` | Reusable mixins: ticker, market row, stat, section heading |
| `src/views/marketing/*.pug` | One template per page |
| `src/content/pages.ts` | Copy for static content pages, as typed data |
| `src/content/legal.ts` | Legal document copy |
| `src/content/help.ts` | Help articles |
| `src/domain/prices.ts` | Price types, conversion, formatting helpers. Pure. |
| `src/services/price-feed.ts` | Poller, cache, subscriber fanout |
| `src/services/price-source.ts` | `PriceSource` interface plus the CoinGecko implementation |
| `src/routes/marketing.ts` | All public page routes |
| `src/routes/prices.ts` | JSON snapshot and SSE stream |
| `public/css/app.css` | The entire stylesheet |
| `public/js/alpine-components.js` | Registered Alpine components |
| `public/fonts/*.woff2` | Self-hosted faces |
| `tests/**` | Mirrors `src/` |

---

## Task 1: View layer, base layout, and the design system stylesheet

**Files:**
- Modify: `src/server.ts`
- Create: `src/views/layouts/base.pug`, `src/views/marketing/home.pug`
- Create: `public/css/app.css`
- Create: `scripts/copy-fonts.ts`
- Modify: `package.json`
- Test: `tests/views/layout.test.ts`

**Interfaces:**
- Consumes: `createApp(config)` from plan 1
- Produces:
  - `createApp` now configures Pug (`views` dir, `view engine`) and serves `public/` at `/static` with immutable caching
  - `res.render("marketing/home", locals)` works
  - Every page receives locals `{ title: string; description: string; path: string }`

- [ ] **Step 1: Install fonts and Alpine**

```bash
cd /home/timileyin/dev/personal/meridian
bun add @fontsource-variable/inter @fontsource/jetbrains-mono @alpinejs/csp
```

- [ ] **Step 2: Write `scripts/copy-fonts.ts`**

Fonts ship as npm packages so the download is pinned and reproducible. This copies the four faces we use into `public/fonts/`.

```ts
import { mkdir, copyFile } from "node:fs/promises"
import { existsSync } from "node:fs"

const FACES: Array<{ from: string; to: string }> = [
  {
    from: "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    to: "public/fonts/inter-variable.woff2",
  },
  {
    from: "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
    to: "public/fonts/jetbrains-mono-400.woff2",
  },
  {
    from: "node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2",
    to: "public/fonts/jetbrains-mono-500.woff2",
  },
]

await mkdir("public/fonts", { recursive: true })
for (const face of FACES) {
  if (!existsSync(face.from)) {
    throw new Error(`Font file missing: ${face.from}. Run bun install first.`)
  }
  await copyFile(face.from, face.to)
  console.log(`copied ${face.to}`)
}
```

Run it: `bun scripts/copy-fonts.ts`

If a filename does not exist, list `node_modules/@fontsource-variable/inter/files/` and pick the latin variable-weight normal face; fontsource occasionally renames. Do not switch to a CDN.

- [ ] **Step 3: Write `public/css/app.css`**

This is the whole design system. Values come from spec §4.

```css
:root {
  --bg: #08090A;
  --surface: #0E1012;
  --surface-2: #16191D;
  --hairline: #23272C;
  --hairline-strong: #31363D;
  --text: #E6E8EB;
  --text-muted: #8B949E;
  --text-dim: #5A626B;
  --up: #12B76A;
  --up-wash: #12B76A1A;
  --down: #F04438;
  --down-wash: #F044381A;
  --accent: #E8A33D;
  --accent-dim: #8A6224;
  --warn: #F79009;
  --info: #53B1FD;

  --sans: "Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;

  --u: 4px;
  --row: 32px;
  --max: 1440px;
  --ease: cubic-bezier(0.2, 0, 0, 1);
}

@font-face {
  font-family: "Inter Variable";
  src: url("/static/fonts/inter-variable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("/static/fonts/jetbrains-mono-400.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("/static/fonts/jetbrains-mono-500.woff2") format("woff2");
  font-weight: 500;
  font-display: swap;
}

*, *::before, *::after { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.55;
  font-feature-settings: "cv05", "ss03";
}

h1, h2, h3, h4 { font-weight: 600; line-height: 1.15; margin: 0; letter-spacing: -0.01em; }
h1 { font-size: 3.5rem; letter-spacing: -0.03em; }
h2 { font-size: 1.75rem; letter-spacing: -0.02em; }
h3 { font-size: 1.25rem; }
p { margin: 0 0 calc(var(--u) * 4); max-width: 68ch; }

a { color: var(--info); text-decoration: none; }
a:hover { text-decoration: underline; }

.num {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.9375rem;
}
.num-frac { color: var(--text-muted); }
.up { color: var(--up); }
.down { color: var(--down); }

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.shell { max-width: var(--max); margin: 0 auto; padding: 0 calc(var(--u) * 6); }

/* Top rail */
.rail {
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 10;
}
.rail-inner {
  display: flex;
  align-items: center;
  gap: calc(var(--u) * 6);
  height: 48px;
}
.wordmark {
  font-family: var(--mono);
  font-weight: 500;
  letter-spacing: 0.18em;
  color: var(--text);
  font-size: 0.8125rem;
}
.nav { display: flex; gap: calc(var(--u) * 5); margin-left: auto; }
.nav a { color: var(--text-muted); font-size: 0.875rem; }
.nav a:hover, .nav a[aria-current="page"] { color: var(--text); text-decoration: none; }

/* Ticker */
.ticker {
  border-bottom: 1px solid var(--hairline);
  background: var(--bg);
  overflow-x: auto;
  scrollbar-width: none;
}
.ticker::-webkit-scrollbar { display: none; }
.ticker-inner { display: flex; gap: calc(var(--u) * 8); height: 32px; align-items: center; }
.ticker-item { display: flex; gap: calc(var(--u) * 2); align-items: baseline; white-space: nowrap; }
.ticker-sym { font-family: var(--mono); font-size: 0.75rem; color: var(--text-muted); }
.ticker-px { font-family: var(--mono); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.ticker-ch { font-family: var(--mono); font-size: 0.75rem; }

.flash-up { animation: washUp 400ms var(--ease); }
.flash-down { animation: washDown 400ms var(--ease); }
@keyframes washUp { from { background: var(--up-wash); } to { background: transparent; } }
@keyframes washDown { from { background: var(--down-wash); } to { background: transparent; } }

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  height: 36px;
  padding: 0 calc(var(--u) * 4);
  border: 1px solid var(--hairline-strong);
  border-radius: 2px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.875rem;
  cursor: pointer;
  transition: border-color 120ms var(--ease), background 120ms var(--ease);
}
.btn:hover { border-color: var(--text-muted); text-decoration: none; }
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #14100A;
  font-weight: 500;
}
.btn-primary:hover { background: #F0B255; border-color: #F0B255; }

/* Tables: flat rows, hairlines, no cards */
.table { width: 100%; border-collapse: collapse; }
.table th {
  text-align: left;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  font-weight: 500;
  padding: calc(var(--u) * 2) calc(var(--u) * 3);
  border-bottom: 1px solid var(--hairline);
  background: var(--surface);
}
.table td {
  height: var(--row);
  padding: 0 calc(var(--u) * 3);
  border-bottom: 1px solid var(--hairline);
  font-size: 0.875rem;
}
.table td.n, .table th.n { text-align: right; }
.table tbody tr:hover { background: var(--surface-2); }
.table-scroll { overflow-x: auto; }

/* Sections */
.section { padding: calc(var(--u) * 16) 0; border-bottom: 1px solid var(--hairline); }
.eyebrow {
  font-family: var(--mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: calc(var(--u) * 3);
}
.hero { padding: calc(var(--u) * 24) 0 calc(var(--u) * 16); }
.hero p { font-size: 1.0625rem; color: var(--text-muted); }
.actions { display: flex; gap: calc(var(--u) * 3); margin-top: calc(var(--u) * 8); }

.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: calc(var(--u) * 10); }

/* Footer */
.footer { padding: calc(var(--u) * 12) 0; color: var(--text-muted); font-size: 0.8125rem; }
.footer-cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: calc(var(--u) * 8); }
.footer h4 {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-dim);
  margin-bottom: calc(var(--u) * 3);
}
.footer ul { list-style: none; margin: 0; padding: 0; }
.footer li { margin-bottom: calc(var(--u) * 2); }
.footer a { color: var(--text-muted); }
.risk {
  margin-top: calc(var(--u) * 10);
  padding-top: calc(var(--u) * 6);
  border-top: 1px solid var(--hairline);
  max-width: 68ch;
}

.skip {
  position: absolute;
  left: -9999px;
}
.skip:focus {
  left: calc(var(--u) * 4);
  top: calc(var(--u) * 4);
  z-index: 100;
  background: var(--surface-2);
  padding: calc(var(--u) * 2) calc(var(--u) * 4);
  border: 1px solid var(--accent);
}

@media (max-width: 800px) {
  h1 { font-size: 2.25rem; }
  .grid-3, .footer-cols { grid-template-columns: 1fr; gap: calc(var(--u) * 6); }
  .shell { padding: 0 calc(var(--u) * 4); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Write `src/views/layouts/base.pug`**

```pug
doctype html
html(lang="en")
  head
    meta(charset="utf-8")
    meta(name="viewport" content="width=device-width, initial-scale=1")
    title= title
    meta(name="description" content=description)
    link(rel="preload" href="/static/fonts/inter-variable.woff2" as="font" type="font/woff2" crossorigin)
    link(rel="preload" href="/static/fonts/jetbrains-mono-400.woff2" as="font" type="font/woff2" crossorigin)
    link(rel="stylesheet" href="/static/css/app.css")
    script(src="/static/js/alpine-components.js" defer)
    script(src="/static/js/alpine.js" defer)
  body
    a.skip(href="#main") Skip to content
    header.rail
      .shell.rail-inner
        a.wordmark(href="/") MERIDIAN
        nav.nav(aria-label="Primary")
          a(href="/markets" aria-current=(path.startsWith("/markets") ? "page" : false)) Markets
          a(href="/fees" aria-current=(path === "/fees" ? "page" : false)) Fees
          a(href="/security" aria-current=(path === "/security" ? "page" : false)) Security
          a(href="/regulatory" aria-current=(path === "/regulatory" ? "page" : false)) Regulatory
          a(href="/help") Help
    include ../components/ticker.pug
    +ticker()
    main#main
      block content
    footer.footer
      .shell
        .footer-cols
          div
            h4 Product
            ul
              li: a(href="/markets") Markets
              li: a(href="/fees") Fees
              li: a(href="/status") Status
          div
            h4 Company
            ul
              li: a(href="/about") About
              li: a(href="/security") Security
              li: a(href="/regulatory") Regulatory
          div
            h4 Support
            ul
              li: a(href="/help") Help centre
          div
            h4 Legal
            ul
              li: a(href="/legal/terms") Terms of Service
              li: a(href="/legal/privacy") Privacy Policy
              li: a(href="/legal/risk") Risk Disclosure
              li: a(href="/legal/aml") AML Policy
              li: a(href="/legal/cookies") Cookie Policy
        .risk
          p
            strong Risk warning.
            |  Digital assets are volatile and you can lose the entire value of what you put in. Nothing on this site is investment advice, and nothing here is a promise of any return. Meridian does not guarantee the value of any asset.
          p Meridian is not yet registered with the Securities and Exchange Commission of Nigeria. We are preparing an application under the Accelerated Regulatory Incubation Programme. We are not accepting deposits or offering trading at this time.
```

The second paragraph is a factual statement of current status per spec §6.3. Update it only when the status actually changes.

- [ ] **Step 5: Write `src/views/components/ticker.pug`**

```pug
mixin ticker()
  .ticker(x-data="ticker")
    .shell.ticker-inner
      template(x-for="row in rows")
        .ticker-item
          span.ticker-sym(x-text="row.symbol")
          span.ticker-px(x-text="row.price" x-bind:class="row.flash")
          span.ticker-ch(x-text="row.change" x-bind:class="row.direction")
      span.ticker-sym(x-show="rows.length === 0") Loading indicative prices
```

- [ ] **Step 6: Write a placeholder `src/views/marketing/home.pug`**

Real content arrives in Task 7. This exists so the layout is testable now.

```pug
extends ../layouts/base.pug

block content
  .shell.hero
    h1 Execution infrastructure for digital assets.
    p Placeholder. Task 7 replaces this.
```

- [ ] **Step 7: Write the failing test**

Create `tests/views/layout.test.ts`:

```ts
import { test, expect, describe, beforeAll } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

let html: string

beforeAll(async () => {
  const res = await createApp(config).inject("/")
  html = await res.text()
})

describe("base layout", () => {
  test("renders a complete HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>")
    expect(html).toContain('lang="en"')
  })

  test("carries the wordmark and primary navigation", () => {
    expect(html).toContain("MERIDIAN")
    expect(html).toContain('href="/markets"')
    expect(html).toContain('href="/regulatory"')
  })

  test("links the stylesheet rather than inlining styles", () => {
    expect(html).toContain('href="/static/css/app.css"')
  })

  test("has no inline style attribute anywhere", () => {
    expect(html).not.toMatch(/\sstyle\s*=/)
  })

  test("has no style block anywhere", () => {
    expect(html).not.toMatch(/<style[\s>]/)
  })

  test("has no inline script body", () => {
    // Every script tag must carry src and have an empty body.
    const scripts = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/g) ?? []
    for (const tag of scripts) {
      expect(tag).toContain("src=")
      expect(tag.replace(/<script\b[^>]*>|<\/script>/g, "").trim()).toBe("")
    }
  })

  test("has no inline event handler attributes", () => {
    expect(html).not.toMatch(/\son(click|load|error|submit|change|input)\s*=/i)
  })

  test("preloads both self-hosted fonts and references no external origin", () => {
    expect(html).toContain('href="/static/fonts/inter-variable.woff2"')
    expect(html).toContain('href="/static/fonts/jetbrains-mono-400.woff2"')
    expect(html).not.toContain("fonts.googleapis.com")
    expect(html).not.toContain("fonts.gstatic.com")
    expect(html).not.toContain("cdn.")
  })

  test("carries the risk warning in the footer", () => {
    expect(html).toContain("Risk warning")
    expect(html).toContain("lose the entire value")
  })

  test("states licensing status without claiming registration", () => {
    expect(html).toContain("not yet registered")
    expect(html).not.toMatch(/\bSEC[- ]registered\b/i)
  })

  test("includes a skip link as the first focusable element", () => {
    expect(html).toContain('href="#main"')
    expect(html).toContain("Skip to content")
  })
})

describe("static assets", () => {
  test("serves the stylesheet", async () => {
    const res = await createApp(config).inject("/static/css/app.css")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/css")
  })

  test("serves fonts with long-lived immutable caching", async () => {
    const res = await createApp(config).inject("/static/fonts/inter-variable.woff2")
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toContain("immutable")
  })

  test("still sets the strict CSP on rendered pages", async () => {
    const res = await createApp(config).inject("/")
    const csp = res.headers.get("content-security-policy") ?? ""
    expect(csp).not.toContain("unsafe-inline")
    expect(csp).not.toContain("unsafe-eval")
  })
})
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `bun test tests/views/layout.test.ts`
Expected: FAIL. `/` returns 404 because no route or view engine exists yet.

- [ ] **Step 9: Wire Pug and static serving into `src/server.ts`**

Add these imports at the top of the file:

```ts
import express from "express"
import helmet from "helmet"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import type { Config } from "./config"
```

Immediately after `app.disable("x-powered-by")`, add:

```ts
  app.set("view engine", "pug")
  app.set("views", join(import.meta.dir, "views"))
```

After the helmet middleware and before the body parsers, add:

```ts
  app.use(
    "/static",
    express.static(join(import.meta.dir, "..", "public"), {
      maxAge: "1y",
      immutable: true,
      fallthrough: false,
    }),
  )
```

Then replace the `/health` route block with:

```ts
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", env: config.env })
  })

  app.get("/", (req, res) => {
    res.render("marketing/home", {
      title: "Meridian",
      description: "Execution infrastructure for digital assets.",
      path: req.path,
    })
  })
```

- [ ] **Step 10: Copy the Alpine CSP build into `public/js/`**

```bash
mkdir -p public/js
cp node_modules/@alpinejs/csp/dist/cdn.min.js public/js/alpine.js
```

If that path does not exist, list `node_modules/@alpinejs/csp/dist/` and copy the minified browser build. Do not load Alpine from a CDN.

- [ ] **Step 11: Create a stub `public/js/alpine-components.js`**

Task 5 fills this in. It must exist now because the layout references it and `fallthrough: false` makes a missing static file a hard 404.

```js
document.addEventListener("alpine:init", () => {
  Alpine.data("ticker", () => ({ rows: [] }))
})
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `bun test tests/views/layout.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 13: Add the font copy step to `package.json` scripts**

```json
{
  "scripts": {
    "assets": "bun scripts/copy-fonts.ts"
  }
}
```

- [ ] **Step 14: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: pug view layer, dark terminal design system, and base layout"
```

---

## Task 2: Price domain module

Pure conversion and formatting for indicative market data. No network, no database.

**Files:**
- Create: `src/domain/prices.ts`
- Test: `tests/domain/prices.test.ts`

**Interfaces:**
- Consumes: `parseAmount`, `formatPrice` from `src/domain/money.ts`
- Produces:
  - `interface Quote { symbol: string; displaySymbol: string; name: string; priceUsd: bigint; change24h: number; updatedAt: string }`
  - `interface TickerRow { symbol: string; price: string; change: string; direction: "up" | "down" | "flat" }`
  - `priceFromFeed(value: number): bigint`
  - `formatUsd(priceUsd: bigint): string`
  - `formatChange(change24h: number): string`
  - `directionOf(change24h: number): "up" | "down" | "flat"`
  - `toTickerRow(quote: Quote): TickerRow`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/prices.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import {
  priceFromFeed,
  formatUsd,
  formatChange,
  directionOf,
  toTickerRow,
  type Quote,
} from "../../src/domain/prices"

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "BTC",
    displaySymbol: "BTC",
    name: "Bitcoin",
    priceUsd: 6741208000000n,
    change24h: 2.41,
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  }
}

describe("priceFromFeed", () => {
  test("converts a float price to base units", () => {
    expect(priceFromFeed(67412.08)).toBe(6741208000000n)
  })

  test("converts a sub-cent price without losing significant digits", () => {
    expect(priceFromFeed(0.00002341)).toBe(2341n)
  })

  test("converts an integer price", () => {
    expect(priceFromFeed(1)).toBe(100000000n)
  })

  test("converts zero", () => {
    expect(priceFromFeed(0)).toBe(0n)
  })

  test("returns bigint, never number", () => {
    expect(typeof priceFromFeed(67412.08)).toBe("bigint")
  })

  test("rejects a negative price", () => {
    expect(() => priceFromFeed(-1)).toThrow()
  })

  test("rejects a non-finite price", () => {
    expect(() => priceFromFeed(Number.NaN)).toThrow()
    expect(() => priceFromFeed(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe("formatUsd", () => {
  test("groups thousands and shows two decimals", () => {
    expect(formatUsd(6741208000000n)).toBe("67,412.08")
  })

  test("does not group below a thousand", () => {
    expect(formatUsd(99999999n)).toBe("1.00")
  })

  test("shows more precision for sub-dollar prices", () => {
    expect(formatUsd(2341n)).toBe("0.00002341")
  })

  test("formats zero", () => {
    expect(formatUsd(0n)).toBe("0.00")
  })

  test("groups millions", () => {
    expect(formatUsd(123456789000000000n)).toBe("1,234,567,890.00")
  })
})

describe("formatChange", () => {
  test("prefixes a positive change with an up glyph and a sign", () => {
    expect(formatChange(2.41)).toBe("▲2.41%")
  })

  test("prefixes a negative change with a down glyph and a sign", () => {
    expect(formatChange(-1.2)).toBe("▼1.20%")
  })

  test("marks a flat change without a direction glyph", () => {
    expect(formatChange(0)).toBe("0.00%")
  })

  test("rounds to two decimals", () => {
    expect(formatChange(2.4567)).toBe("▲2.46%")
  })
})

describe("directionOf", () => {
  test("classifies positive, negative, and flat", () => {
    expect(directionOf(0.1)).toBe("up")
    expect(directionOf(-0.1)).toBe("down")
    expect(directionOf(0)).toBe("flat")
  })
})

describe("toTickerRow", () => {
  test("builds a row carrying both glyph and colour class", () => {
    expect(toTickerRow(quote())).toEqual({
      symbol: "BTC",
      price: "67,412.08",
      change: "▲2.41%",
      direction: "up",
    })
  })

  test("uses the display symbol rather than the qualified symbol", () => {
    const row = toTickerRow(quote({ symbol: "USDT_TRC20", displaySymbol: "USDT" }))
    expect(row.symbol).toBe("USDT")
  })

  test("never conveys direction by colour alone", () => {
    const down = toTickerRow(quote({ change24h: -3 }))
    expect(down.change).toContain("▼")
    expect(down.direction).toBe("down")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/domain/prices.test.ts`
Expected: FAIL, cannot resolve `../../src/domain/prices`.

- [ ] **Step 3: Implement `src/domain/prices.ts`**

```ts
import { parseAmount, formatBalance } from "./money"

export interface Quote {
  symbol: string
  displaySymbol: string
  name: string
  priceUsd: bigint
  change24h: number
  updatedAt: string
}

export interface TickerRow {
  symbol: string
  price: string
  change: string
  direction: "up" | "down" | "flat"
}

/**
 * The external feed hands us JSON numbers. This is the only place a float
 * touches a price, and it converts through the decimal string so no binary
 * rounding survives into the rest of the system. Indicative display data only.
 */
export function priceFromFeed(value: number): bigint {
  if (!Number.isFinite(value)) {
    throw new Error(`Price is not finite: ${value}`)
  }
  if (value < 0) {
    throw new Error(`Price may not be negative: ${value}`)
  }
  return parseAmount(value.toFixed(8))
}

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export function formatUsd(priceUsd: bigint): string {
  // Sub-dollar assets need more than two decimals to say anything at all.
  const decimals = priceUsd > 0n && priceUsd < 100000000n ? 8 : 2
  const plain = formatBalance(priceUsd, decimals)
  const [whole = "0", fraction = ""] = plain.split(".")
  return `${group(whole)}.${fraction}`
}

export function directionOf(change24h: number): "up" | "down" | "flat" {
  if (change24h > 0) return "up"
  if (change24h < 0) return "down"
  return "flat"
}

export function formatChange(change24h: number): string {
  const rounded = Math.abs(change24h).toFixed(2)
  const direction = directionOf(change24h)
  if (direction === "flat") return `${rounded}%`
  return `${direction === "up" ? "▲" : "▼"}${rounded}%`
}

export function toTickerRow(quote: Quote): TickerRow {
  return {
    symbol: quote.displaySymbol,
    price: formatUsd(quote.priceUsd),
    change: formatChange(quote.change24h),
    direction: directionOf(quote.change24h),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/domain/prices.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: price domain module converting feed floats to base units at the boundary"
```

---

## Task 3: Price source and feed service

**Files:**
- Create: `src/services/price-source.ts`
- Create: `src/services/price-feed.ts`
- Test: `tests/services/price-feed.test.ts`

**Interfaces:**
- Consumes: `Quote`, `priceFromFeed` from Task 2; `AssetRepository` from plan 1
- Produces:
  - `interface RawPrice { usd: number; change24h: number }`
  - `interface PriceSource { fetch(ids: string[]): Promise<Map<string, RawPrice>> }`
  - `class CoinGeckoSource implements PriceSource`
  - `const COINGECKO_IDS: Record<string, string>` mapping our symbol to a CoinGecko id
  - `class PriceFeed { constructor(source: PriceSource, assets: Asset[], ttlMs?: number); snapshot(): Quote[]; refresh(): Promise<void>; subscribe(fn: (quotes: Quote[]) => void): () => void; start(): void; stop(): void }`

- [ ] **Step 1: Write the failing test**

Create `tests/services/price-feed.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import { PriceFeed, type PriceSource, type RawPrice } from "../../src/services/price-feed"
import { openDatabase, migrate } from "../../src/db"
import { AssetRepository } from "../../src/db/repositories/assets"

class FakeSource implements PriceSource {
  calls = 0
  failNext = false
  prices = new Map<string, RawPrice>([
    ["bitcoin", { usd: 67412.08, change24h: 2.41 }],
    ["ethereum", { usd: 3120.5, change24h: -1.2 }],
    ["tether", { usd: 1.0, change24h: 0.01 }],
  ])

  async fetch(): Promise<Map<string, RawPrice>> {
    this.calls++
    if (this.failNext) {
      this.failNext = false
      throw new Error("upstream down")
    }
    return this.prices
  }
}

function assets() {
  const db = openDatabase(":memory:")
  migrate(db)
  return new AssetRepository(db).all()
}

let source: FakeSource
let feed: PriceFeed

beforeEach(() => {
  source = new FakeSource()
  feed = new PriceFeed(source, assets())
})

describe("snapshot", () => {
  test("is empty before the first refresh", () => {
    expect(feed.snapshot()).toEqual([])
  })

  test("returns quotes after a refresh", async () => {
    await feed.refresh()
    const btc = feed.snapshot().find((q) => q.symbol === "BTC")
    expect(btc).toBeDefined()
    expect(btc!.priceUsd).toBe(6741208000000n)
    expect(btc!.change24h).toBe(2.41)
  })

  test("carries prices as bigint, never number", async () => {
    await feed.refresh()
    expect(typeof feed.snapshot()[0]!.priceUsd).toBe("bigint")
  })

  test("omits assets the source has no price for", async () => {
    await feed.refresh()
    const symbols = feed.snapshot().map((q) => q.symbol)
    expect(symbols).toContain("BTC")
    expect(symbols).not.toContain("SOL")
  })

  test("prices every chain variant of a stablecoin from one source id", async () => {
    await feed.refresh()
    const symbols = feed.snapshot().map((q) => q.symbol)
    expect(symbols).toContain("USDT_ERC20")
    expect(symbols).toContain("USDT_TRC20")
    expect(symbols).toContain("USDT_BEP20")
  })

  test("orders quotes by the asset registry sort order", async () => {
    await feed.refresh()
    expect(feed.snapshot()[0]!.symbol).toBe("BTC")
  })

  test("stamps each quote with an update time", async () => {
    await feed.refresh()
    expect(feed.snapshot()[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe("caching", () => {
  test("serves a cached snapshot within the ttl", async () => {
    await feed.refresh()
    await feed.refresh()
    expect(source.calls).toBe(1)
  })

  test("refetches once the ttl expires", async () => {
    const shortLived = new PriceFeed(source, assets(), 0)
    await shortLived.refresh()
    await shortLived.refresh()
    expect(source.calls).toBe(2)
  })
})

describe("failure handling", () => {
  test("keeps serving the last good snapshot when the source fails", async () => {
    await feed.refresh()
    const before = feed.snapshot()

    const stale = new PriceFeed(source, assets(), 0)
    await stale.refresh()
    source.failNext = true
    await stale.refresh()

    expect(stale.snapshot()).toHaveLength(before.length)
  })

  test("does not throw when the source fails", async () => {
    source.failNext = true
    expect(feed.refresh()).resolves.toBeUndefined()
  })

  test("returns an empty snapshot if the very first fetch fails", async () => {
    source.failNext = true
    await feed.refresh()
    expect(feed.snapshot()).toEqual([])
  })
})

describe("subscribe", () => {
  test("notifies subscribers on refresh", async () => {
    let received = 0
    feed.subscribe(() => received++)
    await feed.refresh()
    expect(received).toBe(1)
  })

  test("stops notifying after unsubscribe", async () => {
    let received = 0
    const off = feed.subscribe(() => received++)
    off()
    await feed.refresh()
    expect(received).toBe(0)
  })

  test("a throwing subscriber does not break the others", async () => {
    let reached = false
    feed.subscribe(() => {
      throw new Error("subscriber blew up")
    })
    feed.subscribe(() => {
      reached = true
    })
    await feed.refresh()
    expect(reached).toBe(true)
  })

  test("does not notify when the source failed and nothing changed", async () => {
    const stale = new PriceFeed(source, assets(), 0)
    await stale.refresh()
    let received = 0
    stale.subscribe(() => received++)
    source.failNext = true
    await stale.refresh()
    expect(received).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/services/price-feed.test.ts`
Expected: FAIL, cannot resolve `price-feed`.

- [ ] **Step 3: Implement `src/services/price-source.ts`**

```ts
export interface RawPrice {
  usd: number
  change24h: number
}

export interface PriceSource {
  fetch(ids: string[]): Promise<Map<string, RawPrice>>
}

/**
 * Our symbols are chain-qualified; CoinGecko ids are not. Every chain variant
 * of a token maps to the same id, which is correct: USDT is USDT whichever
 * chain it settled on.
 */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT_ERC20: "tether",
  USDC_ERC20: "usd-coin",
  TRX: "tron",
  USDT_TRC20: "tether",
  SOL: "solana",
  USDC_SPL: "usd-coin",
  BNB: "binancecoin",
  USDT_BEP20: "tether",
}

const ENDPOINT = "https://api.coingecko.com/api/v3/simple/price"

export class CoinGeckoSource implements PriceSource {
  constructor(private readonly timeoutMs = 5000) {}

  async fetch(ids: string[]): Promise<Map<string, RawPrice>> {
    const url = `${ENDPOINT}?ids=${encodeURIComponent(
      [...new Set(ids)].join(","),
    )}&vs_currencies=usd&include_24hr_change=true`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: "application/json" },
    })
    if (!response.ok) {
      throw new Error(`Price source returned ${response.status}`)
    }

    const body = (await response.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >

    const result = new Map<string, RawPrice>()
    for (const [id, value] of Object.entries(body)) {
      if (typeof value.usd !== "number") continue
      result.set(id, { usd: value.usd, change24h: value.usd_24h_change ?? 0 })
    }
    return result
  }
}
```

- [ ] **Step 4: Implement `src/services/price-feed.ts`**

```ts
import type { Asset } from "../db/repositories/assets"
import { priceFromFeed, type Quote } from "../domain/prices"
import { COINGECKO_IDS, type PriceSource, type RawPrice } from "./price-source"

export type { PriceSource, RawPrice }
export { CoinGeckoSource, COINGECKO_IDS } from "./price-source"

const DEFAULT_TTL_MS = 10_000

export class PriceFeed {
  private quotes: Quote[] = []
  private fetchedAt = 0
  private subscribers = new Set<(quotes: Quote[]) => void>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly source: PriceSource,
    private readonly assets: Asset[],
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  snapshot(): Quote[] {
    return this.quotes
  }

  async refresh(): Promise<void> {
    if (this.quotes.length > 0 && Date.now() - this.fetchedAt < this.ttlMs) {
      return
    }

    let raw: Map<string, RawPrice>
    try {
      const ids = this.assets
        .map((asset) => COINGECKO_IDS[asset.symbol])
        .filter((id): id is string => Boolean(id))
      raw = await this.source.fetch(ids)
    } catch (error) {
      // Serving a slightly stale indicative price beats serving nothing.
      console.error(
        JSON.stringify({ msg: "price_refresh_failed", error: String(error) }),
      )
      return
    }

    const updatedAt = new Date().toISOString()
    const next: Quote[] = []
    for (const asset of this.assets) {
      const id = COINGECKO_IDS[asset.symbol]
      if (!id) continue
      const price = raw.get(id)
      if (!price) continue
      next.push({
        symbol: asset.symbol,
        displaySymbol: asset.displaySymbol,
        name: asset.name,
        priceUsd: priceFromFeed(price.usd),
        change24h: price.change24h,
        updatedAt,
      })
    }

    this.quotes = next
    this.fetchedAt = Date.now()

    for (const subscriber of this.subscribers) {
      try {
        subscriber(next)
      } catch (error) {
        console.error(
          JSON.stringify({ msg: "price_subscriber_failed", error: String(error) }),
        )
      }
    }
  }

  subscribe(fn: (quotes: Quote[]) => void): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.ttlMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/services/price-feed.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: indicative price feed with ttl cache, stale-on-failure, and fanout"
```

---

## Task 4: Price routes, JSON snapshot and SSE stream

**Files:**
- Create: `src/routes/prices.ts`
- Modify: `src/server.ts`
- Test: `tests/routes/prices.test.ts`

**Interfaces:**
- Consumes: `PriceFeed` from Task 3, `toTickerRow` from Task 2
- Produces:
  - `createPriceRoutes(feed: PriceFeed): express.Router` mounting `GET /api/prices` and `GET /api/prices/stream`
  - `createApp(config, deps?)` gains an optional second parameter `{ priceFeed?: PriceFeed }` so tests inject a fake feed

- [ ] **Step 1: Write the failing test**

Create `tests/routes/prices.test.ts`:

```ts
import { test, expect, describe, beforeEach } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"
import { PriceFeed, type PriceSource, type RawPrice } from "../../src/services/price-feed"
import { openDatabase, migrate } from "../../src/db"
import { AssetRepository } from "../../src/db/repositories/assets"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

class FakeSource implements PriceSource {
  async fetch(): Promise<Map<string, RawPrice>> {
    return new Map([
      ["bitcoin", { usd: 67412.08, change24h: 2.41 }],
      ["ethereum", { usd: 3120.5, change24h: -1.2 }],
    ])
  }
}

function build() {
  const db = openDatabase(":memory:")
  migrate(db)
  const feed = new PriceFeed(new FakeSource(), new AssetRepository(db).all())
  return { feed, app: createApp(config, { priceFeed: feed }) }
}

describe("GET /api/prices", () => {
  test("returns an empty list before the first refresh", async () => {
    const { app } = build()
    const res = await app.inject("/api/prices")
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ indicative: true, quotes: [] })
  })

  test("returns formatted rows after a refresh", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const body = (await (await app.inject("/api/prices")).json()) as {
      quotes: Array<{ symbol: string; price: string; change: string; direction: string }>
    }
    const btc = body.quotes.find((q) => q.symbol === "BTC")!
    expect(btc.price).toBe("67,412.08")
    expect(btc.change).toBe("▲2.41%")
    expect(btc.direction).toBe("up")
  })

  test("serialises prices as formatted strings, never raw numbers", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const body = (await (await app.inject("/api/prices")).json()) as {
      quotes: Array<Record<string, unknown>>
    }
    for (const quote of body.quotes) {
      expect(typeof quote.price).toBe("string")
      expect(quote).not.toHaveProperty("priceUsd")
    }
  })

  test("always flags the data as indicative", async () => {
    const { app, feed } = build()
    await feed.refresh()
    expect(await (await app.inject("/api/prices")).json()).toMatchObject({
      indicative: true,
    })
  })

  test("is not cached by intermediaries", async () => {
    const { app } = build()
    const res = await app.inject("/api/prices")
    expect(res.headers.get("cache-control")).toContain("no-store")
  })
})

describe("GET /api/prices/stream", () => {
  test("responds as an event stream", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const res = await app.inject("/api/prices/stream")
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expect(res.headers.get("cache-control")).toContain("no-store")
    await res.body?.cancel()
  })

  test("sends the current snapshot immediately on connect", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const res = await app.inject("/api/prices/stream")
    const reader = res.body!.getReader()
    const chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk).toContain("data:")
    expect(chunk).toContain("BTC")
    await reader.cancel()
  })

  test("frames messages as valid SSE", async () => {
    const { app, feed } = build()
    await feed.refresh()
    const res = await app.inject("/api/prices/stream")
    const reader = res.body!.getReader()
    const chunk = new TextDecoder().decode((await reader.read()).value)
    expect(chunk).toMatch(/^data: .+\n\n/m)
    const payload = JSON.parse(chunk.replace(/^data: /, "").trim())
    expect(payload.indicative).toBe(true)
    await reader.cancel()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/routes/prices.test.ts`
Expected: FAIL, `createApp` takes one argument and `/api/prices` 404s.

- [ ] **Step 3: Implement `src/routes/prices.ts`**

```ts
import express from "express"
import type { PriceFeed } from "../services/price-feed"
import { toTickerRow } from "../domain/prices"

function payload(feed: PriceFeed): string {
  return JSON.stringify({
    indicative: true,
    updatedAt: feed.snapshot()[0]?.updatedAt ?? null,
    quotes: feed.snapshot().map(toTickerRow),
  })
}

export function createPriceRoutes(feed: PriceFeed): express.Router {
  const router = express.Router()

  router.get("/api/prices", (_req, res) => {
    res.set("cache-control", "no-store")
    res.type("application/json").send(payload(feed))
  })

  router.get("/api/prices/stream", (req, res) => {
    res.set({
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    })
    res.flushHeaders()
    res.write(`data: ${payload(feed)}\n\n`)

    const unsubscribe = feed.subscribe(() => {
      res.write(`data: ${payload(feed)}\n\n`)
    })

    // Keeps intermediaries from closing an idle connection.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 20_000)
    heartbeat.unref?.()

    req.on("close", () => {
      clearInterval(heartbeat)
      unsubscribe()
      res.end()
    })
  })

  return router
}
```

- [ ] **Step 4: Wire it into `src/server.ts`**

Change the signature and add the dependency:

```ts
import { PriceFeed, CoinGeckoSource } from "./services/price-feed"
import { createPriceRoutes } from "./routes/prices"
import { openDatabase, migrate } from "./db"
import { AssetRepository } from "./db/repositories/assets"

export interface AppDeps {
  priceFeed?: PriceFeed
}

export function createApp(config: Config, deps: AppDeps = {}): App {
```

Then, after the body parsers and before the `/` route, add:

```ts
  const priceFeed =
    deps.priceFeed ??
    (() => {
      const db = openDatabase(config.databasePath)
      migrate(db)
      return new PriceFeed(new CoinGeckoSource(), new AssetRepository(db).all())
    })()

  app.locals.priceFeed = priceFeed
  app.use(createPriceRoutes(priceFeed))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/routes/prices.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Start the poller in `src/index.ts`**

Add after `const app = createApp(config)`:

```ts
const priceFeed = app.locals.priceFeed as import("./services/price-feed").PriceFeed
priceFeed.start()
```

And inside the signal handler, before `server.close`:

```ts
    priceFeed.stop()
```

- [ ] **Step 7: Run the full suite**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: indicative price JSON snapshot and SSE stream"
```

---

## Task 5: Alpine ticker component

**Files:**
- Rewrite: `public/js/alpine-components.js`
- Test: `tests/views/alpine-csp.test.ts`

**Interfaces:**
- Consumes: `GET /api/prices/stream` from Task 4
- Produces: Alpine component `ticker` exposing `rows: TickerRow[]`

- [ ] **Step 1: Write the failing test**

This test guards the CSP constraint, which is the easiest thing on the project to break by accident.

Create `tests/views/alpine-csp.test.ts`:

```ts
import { test, expect, describe, beforeAll } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const componentsSource = readFileSync("public/js/alpine-components.js", "utf8")

describe("alpine components file", () => {
  test("registers every component through Alpine.data", () => {
    expect(componentsSource).toContain("Alpine.data(")
    expect(componentsSource).toContain('Alpine.data("ticker"')
  })

  test("registers on the alpine:init event", () => {
    expect(componentsSource).toContain("alpine:init")
  })

  test("uses no eval or Function constructor", () => {
    expect(componentsSource).not.toMatch(/\beval\s*\(/)
    expect(componentsSource).not.toMatch(/new\s+Function\s*\(/)
  })
})

describe("templates obey the CSP build's rules", () => {
  function pugFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...pugFiles(full))
      else if (entry.name.endsWith(".pug")) out.push(full)
    }
    return out
  }

  const sources = pugFiles("src/views").map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }))

  test("finds templates to check", () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  test("x-data never contains an inline object literal", () => {
    for (const { path, text } of sources) {
      const matches = text.match(/x-data\s*=\s*"([^"]*)"/g) ?? []
      for (const match of matches) {
        expect(`${path}: ${match}`).not.toContain("{")
      }
    }
  })

  test("x-on handlers name a method rather than an expression", () => {
    for (const { path, text } of sources) {
      const matches = text.match(/x-on:[a-z]+\s*=\s*"([^"]*)"/g) ?? []
      for (const match of matches) {
        const body = match.split('="')[1]!.slice(0, -1)
        expect(`${path}: ${match}`).toBe(`${path}: ${match}`)
        expect(body).toMatch(/^[A-Za-z_$][\w$]*$/)
      }
    }
  })
})

describe("rendered pages", () => {
  let html: string
  beforeAll(async () => {
    html = await (await createApp(config).inject("/")).text()
  })

  test("load alpine from our own origin", () => {
    expect(html).toContain('src="/static/js/alpine.js"')
    expect(html).not.toContain("unpkg.com")
    expect(html).not.toContain("jsdelivr")
  })

  test("load the component registrations before alpine itself", () => {
    expect(html.indexOf("alpine-components.js")).toBeLessThan(html.indexOf("alpine.js"))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/views/alpine-csp.test.ts`
Expected: FAIL, the stub component file has no SSE logic and the assertions on it are incomplete.

- [ ] **Step 3: Write `public/js/alpine-components.js`**

```js
document.addEventListener("alpine:init", () => {
  Alpine.data("ticker", () => ({
    rows: [],
    previous: {},
    source: null,

    init() {
      this.connect()
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.disconnect()
        else this.connect()
      })
    },

    connect() {
      if (this.source) return
      this.source = new EventSource("/api/prices/stream")
      this.source.onmessage = (event) => this.apply(JSON.parse(event.data))
      this.source.onerror = () => this.disconnect()
    },

    disconnect() {
      if (!this.source) return
      this.source.close()
      this.source = null
    },

    apply(payload) {
      const quotes = payload.quotes || []
      this.rows = quotes.map((quote) => {
        const before = this.previous[quote.symbol]
        let flash = ""
        if (before && before !== quote.price) {
          flash = quote.direction === "down" ? "flash-down" : "flash-up"
        }
        this.previous[quote.symbol] = quote.price
        return {
          symbol: quote.symbol,
          price: quote.price,
          change: quote.change,
          direction: quote.direction,
          flash,
        }
      })
    },

    destroy() {
      this.disconnect()
    },
  }))
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/views/alpine-csp.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: alpine csp ticker component consuming the price stream"
```

---

## Task 6: Markets page and asset detail

**Files:**
- Create: `src/views/marketing/markets.pug`, `src/views/marketing/asset.pug`
- Create: `src/routes/marketing.ts`
- Modify: `src/server.ts`
- Test: `tests/routes/markets.test.ts`

**Interfaces:**
- Consumes: `AssetRepository`, `PriceFeed`, `toTickerRow`
- Produces: `createMarketingRoutes(deps: { assets: AssetRepository; feed: PriceFeed }): express.Router`

- [ ] **Step 1: Write the failing test**

Create `tests/routes/markets.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"
import { PriceFeed, type PriceSource, type RawPrice } from "../../src/services/price-feed"
import { openDatabase, migrate } from "../../src/db"
import { AssetRepository } from "../../src/db/repositories/assets"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

class FakeSource implements PriceSource {
  async fetch(): Promise<Map<string, RawPrice>> {
    return new Map([["bitcoin", { usd: 67412.08, change24h: 2.41 }]])
  }
}

async function build() {
  const db = openDatabase(":memory:")
  migrate(db)
  const feed = new PriceFeed(new FakeSource(), new AssetRepository(db).all())
  await feed.refresh()
  return createApp(config, { priceFeed: feed })
}

describe("GET /markets", () => {
  test("responds 200", async () => {
    expect((await (await build()).inject("/markets")).status).toBe(200)
  })

  test("lists every supported asset", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    for (const name of ["Bitcoin", "Ethereum", "Tether", "USD Coin", "Solana", "BNB"]) {
      expect(html).toContain(name)
    }
  })

  test("distinguishes chain variants by network label", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html).toContain("Tron (TRC20)")
    expect(html).toContain("Ethereum (ERC20)")
    expect(html).toContain("BNB Chain (BEP20)")
  })

  test("shows a price for an asset the feed covers", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html).toContain("67,412.08")
  })

  test("labels the prices as indicative", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html.toLowerCase()).toContain("indicative")
  })

  test("uses a table rather than card markup", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html).toContain('class="table"')
    expect(html).not.toContain('class="card"')
  })

  test("makes clear that trading is not live", async () => {
    const html = await (await (await build()).inject("/markets")).text()
    expect(html.toLowerCase()).toContain("not yet")
  })
})

describe("GET /markets/:symbol", () => {
  test("renders a known asset", async () => {
    const res = await (await build()).inject("/markets/btc")
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain("Bitcoin")
    expect(html).toContain("2 confirmations")
  })

  test("is case insensitive on the symbol", async () => {
    expect((await (await build()).inject("/markets/BTC")).status).toBe(200)
  })

  test("shows the contract address for a token", async () => {
    const html = await (await (await build()).inject("/markets/usdt_trc20")).text()
    expect(html).toContain("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")
  })

  test("shows no contract address for a native asset", async () => {
    const html = await (await (await build()).inject("/markets/btc")).text()
    expect(html).not.toContain("Contract address")
  })

  test("returns 404 for an unknown symbol", async () => {
    expect((await (await build()).inject("/markets/doge")).status).toBe(404)
  })

  test("warns about sending on the wrong network", async () => {
    const html = await (await (await build()).inject("/markets/usdt_trc20")).text()
    expect(html.toLowerCase()).toContain("wrong network")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/routes/markets.test.ts`
Expected: FAIL, `/markets` returns 404.

- [ ] **Step 3: Write `src/views/marketing/markets.pug`**

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Markets
      h2 Supported assets
      p Prices are indicative, sourced from public market data, and refresh every ten seconds. They are for reference only and do not price any transaction. Trading is not yet live.
      .table-scroll
        table.table
          thead
            tr
              th Asset
              th Network
              th.n Price (USD)
              th.n 24h
              th.n Confirmations
          tbody
            each row in rows
              tr
                td
                  strong= row.name
                  |  
                  span.num-frac= row.displaySymbol
                td= row.networkLabel
                td.n.num= row.price
                td.n.num(class=row.direction)= row.change
                td.n.num= row.confirmations
```

- [ ] **Step 4: Write `src/views/marketing/asset.pug`**

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow= asset.networkLabel
      h2 #{asset.name} (#{asset.displaySymbol})
      p Indicative price #{price} #{change}. Reference only.

      table.table
        tbody
          tr
            td Network
            td.n= asset.networkLabel
          tr
            td Confirmations required
            td.n #{asset.confirmationsRequired} confirmations
          tr
            td Deposits
            td.n= asset.depositEnabled ? "Enabled" : "Not yet enabled"
          tr
            td Withdrawals
            td.n= asset.withdrawalEnabled ? "Enabled" : "Not yet enabled"
          tr
            td Trading
            td.n= asset.tradingEnabled ? "Enabled" : "Not yet enabled"
          if asset.contractAddress
            tr
              td Contract address
              td.n.num= asset.contractAddress

      if asset.kind === "token"
        p
          strong Network matters.
          |  #{asset.displaySymbol} exists on more than one network. Sending #{asset.displaySymbol} to a #{asset.networkLabel} address over the wrong network will lose the funds permanently, and nobody can reverse it. Always check the network before you send.
```

- [ ] **Step 5: Implement `src/routes/marketing.ts`**

```ts
import express from "express"
import type { AssetRepository } from "../db/repositories/assets"
import type { PriceFeed } from "../services/price-feed"
import { formatUsd, formatChange, directionOf } from "../domain/prices"

export interface MarketingDeps {
  assets: AssetRepository
  feed: PriceFeed
}

export function createMarketingRoutes(deps: MarketingDeps): express.Router {
  const router = express.Router()

  router.get("/markets", (req, res) => {
    const quotes = new Map(deps.feed.snapshot().map((q) => [q.symbol, q]))
    const rows = deps.assets.all().map((asset) => {
      const quote = quotes.get(asset.symbol)
      return {
        name: asset.name,
        displaySymbol: asset.displaySymbol,
        networkLabel: asset.networkLabel,
        confirmations: asset.confirmationsRequired,
        price: quote ? formatUsd(quote.priceUsd) : "-",
        change: quote ? formatChange(quote.change24h) : "-",
        direction: quote ? directionOf(quote.change24h) : "flat",
      }
    })

    res.render("marketing/markets", {
      title: "Markets | Meridian",
      description: "Supported digital assets, networks, and indicative prices.",
      path: req.path,
      rows,
    })
  })

  router.get("/markets/:symbol", (req, res, next) => {
    const asset = deps.assets.find(String(req.params.symbol).toUpperCase())
    if (!asset) return next()

    const quote = deps.feed.snapshot().find((q) => q.symbol === asset.symbol)
    res.render("marketing/asset", {
      title: `${asset.name} (${asset.displaySymbol}) | Meridian`,
      description: `${asset.name} on ${asset.networkLabel}. Network, confirmations, and indicative price.`,
      path: req.path,
      asset,
      price: quote ? formatUsd(quote.priceUsd) : "unavailable",
      change: quote ? formatChange(quote.change24h) : "",
    })
  })

  return router
}
```

- [ ] **Step 6: Mount it in `src/server.ts`**

Replace the inline `app.get("/", ...)` route with a mount, keeping the price routes above it:

```ts
  const assetRepository = new AssetRepository(
    (() => {
      const db = openDatabase(config.databasePath)
      migrate(db)
      return db
    })(),
  )

  app.use(createMarketingRoutes({ assets: assetRepository, feed: priceFeed }))
```

Note: this opens a second connection to the same database. That is acceptable for read-only asset lookups under WAL. Consolidate the connection into a single shared instance when identity work needs writes in plan 3.

**`/` must not break.** You are deleting the inline `/` handler, and Task 7 is what gives the router a real home page. So add a minimal `/` route to `createMarketingRoutes` now, in the same commit, or the layout and CSP tests from Tasks 1 and 5 will fail. Put this first in the router, before `/markets`:

```ts
  router.get("/", (req, res) => {
    res.render("marketing/home", {
      title: "Meridian",
      description: "Custody and execution for digital assets, built to be examined.",
      path: req.path,
      strip: [],
    })
  })
```

Task 7 replaces the body of this route. Add `each row in strip` handling to the placeholder `home.pug` is not needed, because the placeholder template does not iterate.

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test tests/routes/markets.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: markets table and asset detail pages with wrong-network warning"
```

---

## Task 7: Home page

**Files:**
- Rewrite: `src/views/marketing/home.pug`
- Modify: `src/routes/marketing.ts`
- Test: `tests/routes/home.test.ts`

**Interfaces:**
- Consumes: `createMarketingRoutes` from Task 6
- Produces: `GET /` rendered from `marketing/home` with locals `{ strip: MarketRow[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/routes/home.test.ts`:

```ts
import { test, expect, describe, beforeAll } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"
import { PriceFeed, type PriceSource, type RawPrice } from "../../src/services/price-feed"
import { openDatabase, migrate } from "../../src/db"
import { AssetRepository } from "../../src/db/repositories/assets"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

class FakeSource implements PriceSource {
  async fetch(): Promise<Map<string, RawPrice>> {
    return new Map([["bitcoin", { usd: 67412.08, change24h: 2.41 }]])
  }
}

let html: string

beforeAll(async () => {
  const db = openDatabase(":memory:")
  migrate(db)
  const feed = new PriceFeed(new FakeSource(), new AssetRepository(db).all())
  await feed.refresh()
  html = await (await createApp(config, { priceFeed: feed }).inject("/")).text()
})

describe("home page", () => {
  test("carries the positioning headline", () => {
    expect(html).toContain("Execution infrastructure")
  })

  test("leads with custody rather than features", () => {
    expect(html.toLowerCase()).toContain("custody")
    expect(html.toLowerCase()).toContain("reserves")
  })

  test("shows a market strip of at most six assets", () => {
    const rows = html.match(/data-strip-row/g) ?? []
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(6)
  })

  test("offers exactly one primary action", () => {
    expect((html.match(/btn-primary/g) ?? []).length).toBe(1)
  })

  test("states regulatory status accurately", () => {
    expect(html).toContain("Accelerated Regulatory Incubation")
    expect(html).not.toMatch(/\blicensed\b/i)
  })

  test("makes no claim about returns or performance", () => {
    const lowered = html.toLowerCase()
    for (const banned of [
      "guaranteed",
      "high return",
      "profit",
      "risk-free",
      "safe investment",
      "double your",
    ]) {
      expect(lowered).not.toContain(banned)
    }
  })

  test("cites no invented metrics", () => {
    // Volume, user counts, and custodied totals would all be fabrications today.
    expect(html).not.toMatch(/\$\s?\d+(\.\d+)?\s?(B|M)\b/)
    expect(html.toLowerCase()).not.toContain("customers trust")
    expect(html.toLowerCase()).not.toContain("trusted by")
  })

  test("has no testimonial or partner logo markup", () => {
    const lowered = html.toLowerCase()
    expect(lowered).not.toContain("testimonial")
    expect(lowered).not.toContain("as featured in")
  })

  test("links to the fee schedule", () => {
    expect(html).toContain('href="/fees"')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/routes/home.test.ts`
Expected: FAIL, the placeholder home page has none of this content.

- [ ] **Step 3: Write `src/views/marketing/home.pug`**

```pug
extends ../layouts/base.pug

block content
  .shell
    .hero
      h1 Execution infrastructure for digital assets.
      p A custody and execution platform for Nigerian investors, built to be examined. We publish how we hold assets, what we charge, and where our licensing actually stands.
      .actions
        a.btn.btn-primary(href="/regulatory") Read our regulatory status
        a.btn(href="/markets") View supported assets

    .section
      .eyebrow Indicative prices
      .table-scroll
        table.table
          thead
            tr
              th Asset
              th.n Price (USD)
              th.n 24h
          tbody
            each row in strip
              tr(data-strip-row)
                td
                  strong= row.name
                  |  
                  span.num-frac= row.displaySymbol
                td.n.num= row.price
                td.n.num(class=row.direction)= row.change
      p.num-frac Reference data from public sources, refreshed every ten seconds. Not a quote and not tradable.

    .section
      .eyebrow How custody works
      h2 Your assets are pooled, and the accounting is not.
      .grid-3
        div
          h3 Pooled reserves
          p Client assets are held together in platform-controlled wallets, which is how every centralized exchange operates. What each client is owed is tracked separately in an internal double-entry ledger.
        div
          h3 An append-only ledger
          p Ledger records cannot be edited or deleted. A correction is a new, opposing entry that leaves the original visible. Balances are reconciled against the journal continuously.
        div
          h3 Third-party custody
          p Private keys are held by a licensed custody provider under multi-party controls, not by our own servers. No single person can move client assets.

    .section
      .eyebrow Fees
      h2 Published in full, with no asterisks.
      p Deposits are free. Withdrawals cost the network fee plus a fixed amount per asset. Trading carries a spread that is shown before you confirm anything. Every number is on one page.
      .actions
        a.btn(href="/fees") See the fee schedule

    .section
      .eyebrow Regulatory status
      h2 Where we actually stand.
      p Meridian is not registered with the Securities and Exchange Commission of Nigeria. We are preparing an application under the Accelerated Regulatory Incubation Programme, which is the supervised pathway toward full registration. We are not accepting deposits and not offering trading until that is in place.
      p We would rather tell you this plainly than imply otherwise.
      .actions
        a.btn(href="/regulatory") Read the detail
```

- [ ] **Step 4: Replace the placeholder home route in `src/routes/marketing.ts`**

Task 6 added a minimal `/` route returning `strip: []`. Replace it entirely with this:

```ts
  router.get("/", (req, res) => {
    const quotes = new Map(deps.feed.snapshot().map((q) => [q.symbol, q]))
    const strip = deps.assets
      .all()
      .filter((asset) => quotes.has(asset.symbol))
      .slice(0, 6)
      .map((asset) => {
        const quote = quotes.get(asset.symbol)!
        return {
          name: asset.name,
          displaySymbol: asset.displaySymbol,
          price: formatUsd(quote.priceUsd),
          change: formatChange(quote.change24h),
          direction: directionOf(quote.change24h),
        }
      })

    res.render("marketing/home", {
      title: "Meridian",
      description: "Custody and execution for digital assets, built to be examined.",
      path: req.path,
      strip,
    })
  })
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test tests/routes/home.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: home page leading with custody and honest regulatory status"
```

---

## Task 8: Content pages

**Files:**
- Create: `src/content/pages.ts`
- Create: `src/views/marketing/content.pug`
- Modify: `src/routes/marketing.ts`
- Test: `tests/routes/content.test.ts`

**Interfaces:**
- Consumes: `createMarketingRoutes`
- Produces:
  - `interface Section { heading: string; body: string[] }`
  - `interface ContentPage { slug: string; title: string; description: string; eyebrow: string; heading: string; sections: Section[] }`
  - `const CONTENT_PAGES: ContentPage[]` covering fees, security, regulatory, about, status
  - `const LEGAL_PAGES: ContentPage[]` covering terms, privacy, risk, aml, cookies

- [ ] **Step 1: Write the failing test**

Create `tests/routes/content.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"
import { CONTENT_PAGES, LEGAL_PAGES } from "../../src/content/pages"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const ROUTES = [
  "/fees",
  "/security",
  "/regulatory",
  "/about",
  "/status",
  "/legal/terms",
  "/legal/privacy",
  "/legal/risk",
  "/legal/aml",
  "/legal/cookies",
]

describe("content routes", () => {
  for (const route of ROUTES) {
    test(`${route} responds 200 with a heading`, async () => {
      const res = await createApp(config).inject(route)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain("<h2")
      expect(html).toContain("Risk warning")
    })
  }

  test("an unknown legal page 404s", async () => {
    expect((await createApp(config).inject("/legal/nope")).status).toBe(404)
  })
})

describe("content data", () => {
  const all = [...CONTENT_PAGES, ...LEGAL_PAGES]

  test("every page has a slug, title, heading, and at least one section", () => {
    for (const page of all) {
      expect(page.slug.length).toBeGreaterThan(0)
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.heading.length).toBeGreaterThan(0)
      expect(page.sections.length).toBeGreaterThan(0)
    }
  })

  test("no section is empty", () => {
    for (const page of all) {
      for (const section of page.sections) {
        expect(section.heading.length).toBeGreaterThan(0)
        expect(section.body.length).toBeGreaterThan(0)
        for (const paragraph of section.body) {
          expect(paragraph.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  test("slugs are unique", () => {
    const slugs = all.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  test("copy contains no em dashes", () => {
    for (const page of all) {
      for (const section of page.sections) {
        for (const paragraph of section.body) {
          expect(paragraph).not.toContain("—")
          expect(paragraph).not.toContain("–")
        }
      }
    }
  })

  test("copy contains no placeholder text", () => {
    for (const page of all) {
      for (const section of page.sections) {
        for (const paragraph of section.body) {
          const lowered = paragraph.toLowerCase()
          expect(lowered).not.toContain("lorem ipsum")
          expect(lowered).not.toContain("tbd")
          expect(lowered).not.toContain("coming soon")
          expect(lowered).not.toContain("placeholder")
        }
      }
    }
  })

  test("copy makes no claim of registration or licensing", () => {
    for (const page of all) {
      for (const section of page.sections) {
        for (const paragraph of section.body) {
          expect(paragraph).not.toMatch(/\bwe are (licensed|registered)\b/i)
          expect(paragraph).not.toMatch(/\bSEC[- ]registered\b/i)
        }
      }
    }
  })

  test("copy makes no return or safety promise", () => {
    for (const page of all) {
      for (const section of page.sections) {
        for (const paragraph of section.body) {
          const lowered = paragraph.toLowerCase()
          for (const banned of ["guaranteed return", "risk-free", "your funds are safe"]) {
            expect(lowered).not.toContain(banned)
          }
        }
      }
    }
  })

  test("the risk disclosure states total loss plainly", async () => {
    const html = await (await createApp(config).inject("/legal/risk")).text()
    expect(html.toLowerCase()).toContain("lose")
    expect(html.toLowerCase()).toContain("entire")
  })

  test("the regulatory page names the current stage", async () => {
    const html = await (await createApp(config).inject("/regulatory")).text()
    expect(html).toContain("Accelerated Regulatory Incubation")
    expect(html.toLowerCase()).toContain("not registered")
  })

  test("the security page describes third-party custody", async () => {
    const html = await (await createApp(config).inject("/security")).text()
    expect(html.toLowerCase()).toContain("custody provider")
    expect(html.toLowerCase()).toContain("multi-party")
  })

  test("the fees page states deposits are free", async () => {
    const html = await (await createApp(config).inject("/fees")).text()
    expect(html.toLowerCase()).toContain("deposits are free")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/routes/content.test.ts`
Expected: FAIL, cannot resolve `src/content/pages`.

- [ ] **Step 3: Write `src/content/pages.ts`**

Every statement here must be true today. When any of it changes, change the copy.

```ts
export interface Section {
  heading: string
  body: string[]
}

export interface ContentPage {
  slug: string
  title: string
  description: string
  eyebrow: string
  heading: string
  sections: Section[]
}

export const CONTENT_PAGES: ContentPage[] = [
  {
    slug: "fees",
    title: "Fees | Meridian",
    description: "The complete fee schedule, with no asterisks.",
    eyebrow: "Fees",
    heading: "What we charge, in full.",
    sections: [
      {
        heading: "Deposits",
        body: [
          "Deposits are free. We do not add a fee to an incoming transfer, and we credit the full amount that arrives.",
          "The sending network still charges you its own fee, which we neither collect nor control.",
        ],
      },
      {
        heading: "Withdrawals",
        body: [
          "A withdrawal costs the network fee plus a fixed amount per asset and network. Both numbers are shown before you confirm, and the total is what leaves your balance.",
          "Withdrawal fees differ by network. Moving USDT over Tron does not cost the same as moving it over Ethereum, because the networks do not cost the same.",
        ],
      },
      {
        heading: "Trading",
        body: [
          "Trading carries a spread, which is the difference between the price we quote you and the price we source. The spread is shown on the confirmation screen in both percentage and cash terms before you commit to anything.",
          "There is no separate commission and no monthly fee.",
        ],
      },
      {
        heading: "Current status",
        body: [
          "Deposits, withdrawals, and trading are not yet enabled, so none of these fees are being charged today. This page describes the schedule that will apply when they are.",
        ],
      },
    ],
  },
  {
    slug: "security",
    title: "Security | Meridian",
    description: "How Meridian holds client assets and manages keys.",
    eyebrow: "Security",
    heading: "How we hold what you deposit.",
    sections: [
      {
        heading: "Pooled custody, separate accounting",
        body: [
          "Client assets are held together in platform-controlled wallets rather than in one wallet per client. This is how centralized exchanges work, and it is worth understanding rather than glossing over.",
          "What each client is owed is tracked in an internal double-entry ledger. The pooled reserves back the sum of client balances, and the two are reconciled against each other continuously.",
        ],
      },
      {
        heading: "Keys are held by a custody provider",
        body: [
          "Private keys are held by a third-party custody provider under multi-party controls, not on our own servers. No single person at Meridian can move client assets, and no single point of failure can authorise a material transaction.",
          "We chose this over managing keys ourselves because hot-wallet compromise is the most common way exchanges fail, and because a specialist provider's controls are auditable in a way ours would not yet be.",
        ],
      },
      {
        heading: "The ledger cannot be quietly edited",
        body: [
          "Ledger entries are append-only and enforced as such by the database itself. A correction is a new, opposing entry, and the original stays visible.",
          "A reconciliation job independently recomputes every balance from the journal and checks it against the cached figure. A disagreement is treated as a serious incident, not a warning to be cleared.",
        ],
      },
      {
        heading: "What we have not done yet",
        body: [
          "We have not completed a third-party security audit, and we do not have a published proof-of-reserves attestation. Both are planned before we accept client funds. We will say so here when they exist, and not before.",
        ],
      },
    ],
  },
  {
    slug: "regulatory",
    title: "Regulatory status | Meridian",
    description: "Meridian's licensing position, stated at its actual stage.",
    eyebrow: "Regulatory",
    heading: "Where our licensing actually stands.",
    sections: [
      {
        heading: "Current position",
        body: [
          "Meridian is not registered with the Securities and Exchange Commission of Nigeria. We are preparing an application under the Accelerated Regulatory Incubation Programme, which is the supervised pathway that can lead to full registration.",
          "Until that is in place we are not accepting deposits, not holding client assets, and not offering trading. Nothing on this site is an offer to do any of those things.",
        ],
      },
      {
        heading: "Why this page exists",
        body: [
          "Plenty of platforms imply approval they do not have. We would rather publish the unflattering version and be checkable.",
          "When our status changes, this page changes with it, and the date of the change is recorded.",
        ],
      },
      {
        heading: "Know your customer and anti-money-laundering",
        body: [
          "Every account will require identity verification before it can move value. We verify identity through a licensed verification provider and screen against sanctions and politically exposed person lists.",
          "We keep the provider's verification reference rather than storing your government identifiers in full, which limits what an attacker could obtain from us.",
        ],
      },
      {
        heading: "Who we serve",
        body: [
          "Meridian is being built for residents of Nigeria. We do not serve jurisdictions where we are not permitted to operate, and we will publish the specific exclusions before launch.",
        ],
      },
    ],
  },
  {
    slug: "about",
    title: "About | Meridian",
    description: "What Meridian is and how to reach us.",
    eyebrow: "About",
    heading: "A digital asset platform being built in public view.",
    sections: [
      {
        heading: "What we are building",
        body: [
          "Meridian is a digital asset custody and execution platform for the Nigerian market. It is under active development and is not yet open to clients.",
          "We are publishing our custody model, our fee schedule, and our regulatory position while we build rather than after, because those are the things that should decide whether you trust a platform.",
        ],
      },
      {
        heading: "Contact",
        body: [
          "For questions about this site or the platform, write to hello@meridian.example. Replace this address with the real one before launch.",
        ],
      },
    ],
  },
  {
    slug: "status",
    title: "System status | Meridian",
    description: "Current operational status of Meridian services.",
    eyebrow: "Status",
    heading: "System status.",
    sections: [
      {
        heading: "Current status",
        body: [
          "The public website is operational. The indicative price feed is operational and refreshes every ten seconds from public market data.",
          "Accounts, deposits, withdrawals, and trading are not yet live. There is no incident history to report because there is no production service yet.",
        ],
      },
    ],
  },
]

export const LEGAL_PAGES: ContentPage[] = [
  {
    slug: "risk",
    title: "Risk disclosure | Meridian",
    description: "The risks of holding and trading digital assets.",
    eyebrow: "Legal",
    heading: "Risk disclosure.",
    sections: [
      {
        heading: "You can lose everything",
        body: [
          "Digital assets are volatile. The value of what you hold can fall quickly and without warning, and you can lose the entire amount you put in. Do not commit money you cannot afford to lose completely.",
          "Past price movement tells you nothing reliable about future price movement.",
        ],
      },
      {
        heading: "Nothing here is advice",
        body: [
          "Meridian does not give investment advice and does not assess whether any asset is suitable for you. Any decision you make is your own.",
          "We make no promise about the value of any asset and no promise of any return.",
        ],
      },
      {
        heading: "Transfers are irreversible",
        body: [
          "A transfer sent to the wrong address, or sent over the wrong network, is generally gone permanently. Neither we nor anyone else can reverse it.",
          "Several assets we support exist on more than one network. Check the network as carefully as you check the address.",
        ],
      },
      {
        heading: "Platform and custody risk",
        body: [
          "Holding assets with any custodian means accepting that custodian's operational and security risk. Digital asset holdings are not covered by a deposit protection scheme.",
          "Access to the platform may be interrupted by maintenance, technical failure, or events outside our control.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms of Service | Meridian",
    description: "The terms governing use of the Meridian website.",
    eyebrow: "Legal",
    heading: "Terms of Service.",
    sections: [
      {
        heading: "Scope",
        body: [
          "These terms cover your use of this website. Meridian is not currently offering accounts or any regulated service, so these terms do not yet govern any client relationship.",
          "Separate account terms will apply when the platform opens, and you will be asked to accept them explicitly at that point.",
        ],
      },
      {
        heading: "Information on this site",
        body: [
          "Information here is provided for general reference. Prices shown are indicative, drawn from public market data, and are not quotes or offers to transact.",
          "We aim to keep this site accurate and will correct errors when we find them.",
        ],
      },
      {
        heading: "Governing law",
        body: [
          "These terms are governed by the laws of the Federal Republic of Nigeria. The specific entity and jurisdiction details will be published here before the platform opens.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy | Meridian",
    description: "How Meridian handles personal data.",
    eyebrow: "Legal",
    heading: "Privacy Policy.",
    sections: [
      {
        heading: "What this site collects",
        body: [
          "This website does not use advertising or analytics trackers, and it sets no cookies for visitors who are not signed in. We do not load fonts, scripts, or stylesheets from third-party networks, so browsing here does not hand your request details to anyone else.",
          "Standard server logs record request details including IP address, and are retained for security and diagnostic purposes.",
        ],
      },
      {
        heading: "Identity data",
        body: [
          "When accounts open, identity verification will be carried out by a licensed verification provider. Identity documents and government identifiers are held by that provider. We retain the provider's verification reference and a truncated identifier rather than the full value.",
          "This is deliberate: it limits what could be taken from us in a breach.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "Under the Nigeria Data Protection Act you may request access to the personal data we hold about you, ask for it to be corrected, and object to certain processing. Requests can be sent to the contact address on our About page.",
        ],
      },
    ],
  },
  {
    slug: "aml",
    title: "AML Policy | Meridian",
    description: "Meridian's anti-money-laundering approach.",
    eyebrow: "Legal",
    heading: "Anti-money-laundering policy.",
    sections: [
      {
        heading: "Verification",
        body: [
          "Every account will be verified before it can move value. Verification includes identity confirmation against Nigerian government identifiers and a document and liveness check.",
          "Accounts are screened against sanctions lists and politically exposed person lists at onboarding and on an ongoing basis.",
        ],
      },
      {
        heading: "Monitoring and reporting",
        body: [
          "Transactions will be monitored for patterns associated with money laundering and terrorist financing. Activity meeting reporting thresholds will be reported to the relevant Nigerian authorities.",
          "We may suspend an account while a matter is investigated, and we are not always permitted to explain why.",
        ],
      },
      {
        heading: "Governance",
        body: [
          "A designated Compliance Officer is responsible for this programme. The full programme will be documented as part of our regulatory application.",
        ],
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy | Meridian",
    description: "How Meridian uses cookies.",
    eyebrow: "Legal",
    heading: "Cookie Policy.",
    sections: [
      {
        heading: "What we set",
        body: [
          "This site sets no cookies for visitors who are not signed in. There are no advertising cookies and no analytics cookies.",
          "When accounts open, a single session cookie will be set after sign-in. It is strictly necessary to keep you signed in, and it carries no tracking identifier.",
        ],
      },
      {
        heading: "Third parties",
        body: [
          "We do not embed third-party content that would set cookies from another domain. Fonts, stylesheets, and scripts are all served from our own origin.",
        ],
      },
    ],
  },
]
```

- [ ] **Step 4: Write `src/views/marketing/content.pug`**

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow= page.eyebrow
      h2= page.heading
    each section in page.sections
      .section
        h3= section.heading
        each paragraph in section.body
          p= paragraph
```

- [ ] **Step 5: Add the routes to `src/routes/marketing.ts`**

Add the import at the top:

```ts
import { CONTENT_PAGES, LEGAL_PAGES } from "../content/pages"
```

Then, after the `/markets/:symbol` route, add:

```ts
  for (const page of CONTENT_PAGES) {
    router.get(`/${page.slug}`, (req, res) => {
      res.render("marketing/content", {
        title: page.title,
        description: page.description,
        path: req.path,
        page,
      })
    })
  }

  for (const page of LEGAL_PAGES) {
    router.get(`/legal/${page.slug}`, (req, res) => {
      res.render("marketing/content", {
        title: page.title,
        description: page.description,
        path: req.path,
        page,
      })
    })
  }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/routes/content.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: content and legal pages with copy held as testable data"
```

---

## Task 9: Help centre

**Files:**
- Create: `src/content/help.ts`
- Create: `src/views/marketing/help-index.pug`, `src/views/marketing/help-article.pug`
- Modify: `src/routes/marketing.ts`
- Test: `tests/routes/help.test.ts`

**Interfaces:**
- Consumes: `Section`, `ContentPage` shapes from Task 8
- Produces:
  - `interface HelpArticle { slug: string; title: string; summary: string; category: string; sections: Section[] }`
  - `const HELP_ARTICLES: HelpArticle[]`

- [ ] **Step 1: Write the failing test**

Create `tests/routes/help.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { createApp } from "../../src/server"
import { loadConfig } from "../../src/config"
import { HELP_ARTICLES } from "../../src/content/help"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

describe("GET /help", () => {
  test("responds 200", async () => {
    expect((await createApp(config).inject("/help")).status).toBe(200)
  })

  test("lists every article", async () => {
    const html = await (await createApp(config).inject("/help")).text()
    for (const article of HELP_ARTICLES) {
      expect(html).toContain(article.title)
      expect(html).toContain(`/help/${article.slug}`)
    }
  })

  test("groups articles by category", async () => {
    const html = await (await createApp(config).inject("/help")).text()
    for (const category of new Set(HELP_ARTICLES.map((a) => a.category))) {
      expect(html).toContain(category)
    }
  })
})

describe("GET /help/:slug", () => {
  for (const article of HELP_ARTICLES) {
    test(`${article.slug} renders`, async () => {
      const res = await createApp(config).inject(`/help/${article.slug}`)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain(article.title)
    })
  }

  test("returns 404 for an unknown article", async () => {
    expect((await createApp(config).inject("/help/nope")).status).toBe(404)
  })
})

describe("help content", () => {
  test("slugs are unique", () => {
    const slugs = HELP_ARTICLES.map((a) => a.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  test("every article has a summary and at least one section", () => {
    for (const article of HELP_ARTICLES) {
      expect(article.summary.trim().length).toBeGreaterThan(0)
      expect(article.sections.length).toBeGreaterThan(0)
    }
  })

  test("there is an article explaining networks, which is the costliest mistake", () => {
    const networks = HELP_ARTICLES.find((a) => a.slug === "choosing-the-right-network")
    expect(networks).toBeDefined()
    const text = networks!.sections.flatMap((s) => s.body).join(" ").toLowerCase()
    expect(text).toContain("permanently")
  })

  test("copy contains no em dashes", () => {
    for (const article of HELP_ARTICLES) {
      for (const section of article.sections) {
        for (const paragraph of section.body) {
          expect(paragraph).not.toContain("—")
        }
      }
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/routes/help.test.ts`
Expected: FAIL, cannot resolve `src/content/help`.

- [ ] **Step 3: Write `src/content/help.ts`**

```ts
import type { Section } from "./pages"

export interface HelpArticle {
  slug: string
  title: string
  summary: string
  category: string
  sections: Section[]
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "choosing-the-right-network",
    title: "Choosing the right network",
    summary: "The most expensive mistake in crypto, and how to avoid it.",
    category: "Deposits and withdrawals",
    sections: [
      {
        heading: "One ticker, several networks",
        body: [
          "USDT is not one thing. It exists on Ethereum, on Tron, and on BNB Chain, and those are separate networks that do not talk to each other. The same is true of USDC.",
          "When you deposit, we give you an address for one specific network. That address only works for that network.",
        ],
      },
      {
        heading: "What goes wrong",
        body: [
          "If you send USDT over Ethereum to an address we issued for Tron, the funds do not arrive. In most cases they are lost permanently, and neither we nor the network operator can reverse it.",
          "This is not a policy we could choose to relax. The transfer happened on a network where that address does not exist.",
        ],
      },
      {
        heading: "How to check",
        body: [
          "Before you send, confirm that the network shown in your sending wallet matches the network shown on our deposit screen exactly. Not the ticker, the network.",
          "If you are unsure, send a small amount first and wait for it to arrive.",
        ],
      },
    ],
  },
  {
    slug: "how-deposits-are-credited",
    title: "How deposits are credited",
    summary: "Confirmations, timing, and why the number differs by asset.",
    category: "Deposits and withdrawals",
    sections: [
      {
        heading: "Confirmations",
        body: [
          "A transfer is credited once the network has confirmed it enough times to be considered settled. The number differs by network because the networks differ: Bitcoin needs two, Ethereum needs twelve, Solana needs thirty-two.",
          "Each asset's requirement is shown on its page under Markets.",
        ],
      },
      {
        heading: "Very small amounts",
        body: [
          "Some networks track amounts more finely than our balances do. Where that happens, the remainder is recorded against your account rather than discarded, and it is credited once it adds up to a creditable amount.",
        ],
      },
    ],
  },
  {
    slug: "verifying-your-identity",
    title: "Verifying your identity",
    summary: "What we ask for, why, and what we keep.",
    category: "Accounts",
    sections: [
      {
        heading: "What we ask for",
        body: [
          "Verification asks for your legal name, date of birth, Nigerian phone number, address, and a government identifier, along with a photograph of an identity document and a selfie.",
          "This is a legal requirement for a regulated financial service, not a preference of ours.",
        ],
      },
      {
        heading: "What we keep",
        body: [
          "Your documents and full government identifiers are held by the licensed verification provider that checks them. We keep the provider's reference and a truncated identifier.",
          "That means a breach of our systems does not expose your identity documents.",
        ],
      },
    ],
  },
  {
    slug: "keeping-your-account-secure",
    title: "Keeping your account secure",
    summary: "Two-factor authentication, sessions, and what we will never ask you.",
    category: "Accounts",
    sections: [
      {
        heading: "Two-factor authentication",
        body: [
          "Two-factor authentication will be required before any withdrawal. Use an authenticator app rather than SMS, because SIM swap fraud is common and effective.",
          "Store your recovery codes somewhere you can reach without your phone.",
        ],
      },
      {
        heading: "What we will never ask",
        body: [
          "We will never ask for your password, your authenticator code, or your recovery codes. Not by email, not by phone, not in a chat window. Anyone who asks is attacking you.",
          "We will never ask you to send funds to an address to verify or release your account.",
        ],
      },
    ],
  },
]
```

- [ ] **Step 4: Write `src/views/marketing/help-index.pug`**

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow Help centre
      h2 How Meridian works.
    each group in groups
      .section
        h3= group.category
        .table-scroll
          table.table
            tbody
              each article in group.articles
                tr
                  td
                    a(href="/help/" + article.slug)= article.title
                  td= article.summary
```

- [ ] **Step 5: Write `src/views/marketing/help-article.pug`**

```pug
extends ../layouts/base.pug

block content
  .shell
    .section
      .eyebrow
        a(href="/help") Help centre
      h2= article.title
      p= article.summary
    each section in article.sections
      .section
        h3= section.heading
        each paragraph in section.body
          p= paragraph
```

- [ ] **Step 6: Add the routes to `src/routes/marketing.ts`**

Add the import:

```ts
import { HELP_ARTICLES } from "../content/help"
```

Then add the routes after the legal routes:

```ts
  router.get("/help", (req, res) => {
    const categories = [...new Set(HELP_ARTICLES.map((a) => a.category))]
    res.render("marketing/help-index", {
      title: "Help centre | Meridian",
      description: "Guides to deposits, networks, verification, and account security.",
      path: req.path,
      groups: categories.map((category) => ({
        category,
        articles: HELP_ARTICLES.filter((a) => a.category === category),
      })),
    })
  })

  router.get("/help/:slug", (req, res, next) => {
    const article = HELP_ARTICLES.find((a) => a.slug === req.params.slug)
    if (!article) return next()
    res.render("marketing/help-article", {
      title: `${article.title} | Meridian`,
      description: article.summary,
      path: req.path,
      article,
    })
  })
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `bun test tests/routes/help.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: help centre with wrong-network guidance as the lead article"
```

---

## Task 10: Accessibility and performance verification

**Files:**
- Create: `tests/accessibility.test.ts`
- Create: `tests/performance.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: every route from Tasks 6 to 9
- Produces: no runtime code, only gates

- [ ] **Step 1: Install the accessibility tooling**

```bash
bun add -d jsdom axe-core @types/jsdom
```

- [ ] **Step 2: Write the failing accessibility test**

Create `tests/accessibility.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { JSDOM } from "jsdom"
import { source as axeSource } from "axe-core"
import { createApp } from "../src/server"
import { loadConfig } from "../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const ROUTES = [
  "/",
  "/markets",
  "/markets/btc",
  "/fees",
  "/security",
  "/regulatory",
  "/about",
  "/status",
  "/help",
  "/help/choosing-the-right-network",
  "/legal/terms",
  "/legal/privacy",
  "/legal/risk",
  "/legal/aml",
  "/legal/cookies",
]

interface AxeViolation {
  id: string
  impact: string | null
  nodes: unknown[]
}

async function violationsFor(path: string): Promise<AxeViolation[]> {
  const html = await (await createApp(config).inject(path)).text()
  const dom = new JSDOM(html, { runScripts: "outside-only" })
  dom.window.eval(axeSource)
  const results = (await dom.window.eval(
    "axe.run(document, { resultTypes: ['violations'] })",
  )) as { violations: AxeViolation[] }
  return results.violations
}

describe("accessibility", () => {
  for (const route of ROUTES) {
    test(`${route} has no axe violations`, async () => {
      const violations = await violationsFor(route)
      const summary = violations.map((v) => `${v.id} (${v.nodes.length} nodes)`).join(", ")
      expect(summary).toBe("")
    }, 30_000)
  }
})

describe("document structure", () => {
  test("every page has exactly one h1 or starts its outline at h2 under a titled shell", async () => {
    for (const route of ROUTES) {
      const html = await (await createApp(config).inject(route)).text()
      const h1s = (html.match(/<h1[\s>]/g) ?? []).length
      expect(`${route}: ${h1s}`).toMatch(/: [01]$/)
    }
  })

  test("every page sets a unique, non-empty title", async () => {
    const titles = new Set<string>()
    for (const route of ROUTES) {
      const html = await (await createApp(config).inject(route)).text()
      const title = html.match(/<title>(.*?)<\/title>/)?.[1] ?? ""
      expect(title.length).toBeGreaterThan(0)
      titles.add(title)
    }
    expect(titles.size).toBeGreaterThan(ROUTES.length - 3)
  })

  test("every page sets a meta description", async () => {
    for (const route of ROUTES) {
      const html = await (await createApp(config).inject(route)).text()
      expect(`${route}: ${/name="description"/.test(html)}`).toContain("true")
    }
  })
})
```

- [ ] **Step 3: Run it and fix whatever it finds**

Run: `bun test tests/accessibility.test.ts`

Expect real failures on the first run. Likely causes and their fixes:

- **`color-contrast`** on `--text-dim` used for readable text. Fix by switching that element to `--text-muted`. Do not adjust the token.
- **`region`** where content sits outside a landmark. Fix by ensuring the content is inside `main#main`.
- **`link-name`** on the wordmark if it renders empty. Fix by adding `aria-label="Meridian home"`.
- **`page-has-heading-one`** if a page has no `h1`. The base layout does not emit one, so either add an `h1` per page or accept `h2` and adjust the assertion. Prefer adding a real `h1` to each page.

Fix the templates and the stylesheet, not the test.

- [ ] **Step 4: Write the performance budget test**

Create `tests/performance.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { statSync } from "node:fs"
import { createApp } from "../src/server"
import { loadConfig } from "../src/config"

const config = loadConfig({
  NODE_ENV: "test",
  DATABASE_PATH: ":memory:",
  SESSION_SECRET: "x".repeat(32),
  TOTP_ENCRYPTION_KEY: "y".repeat(32),
})

const KB = 1024

describe("asset budget", () => {
  test("total javascript stays under 120KB", () => {
    const total =
      statSync("public/js/alpine.js").size + statSync("public/js/alpine-components.js").size
    expect(total).toBeLessThan(120 * KB)
  })

  test("stylesheet stays under 40KB", () => {
    expect(statSync("public/css/app.css").size).toBeLessThan(40 * KB)
  })

  test("each font face stays under 200KB", () => {
    for (const font of [
      "public/fonts/inter-variable.woff2",
      "public/fonts/jetbrains-mono-400.woff2",
      "public/fonts/jetbrains-mono-500.woff2",
    ]) {
      expect(statSync(font).size).toBeLessThan(200 * KB)
    }
  })
})

describe("page weight", () => {
  const ROUTES = ["/", "/markets", "/fees", "/legal/risk"]

  for (const route of ROUTES) {
    test(`${route} HTML stays under 60KB`, async () => {
      const html = await (await createApp(config).inject(route)).text()
      expect(Buffer.byteLength(html, "utf8")).toBeLessThan(60 * KB)
    })
  }

  test("no page loads more than three scripts", async () => {
    for (const route of ROUTES) {
      const html = await (await createApp(config).inject(route)).text()
      expect(`${route}: ${(html.match(/<script/g) ?? []).length}`).toMatch(/: [0-3]$/)
    }
  })
})
```

- [ ] **Step 5: Run both gates**

Run: `bun test tests/accessibility.test.ts tests/performance.test.ts`
Expected: PASS.

If the JS budget fails, check that `public/js/alpine.js` is the minified build.

- [ ] **Step 6: Run the whole suite and the typechecker**

Run: `bun test && bun run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: accessibility and performance budget gates over every public page"
```

---

## Plan 2 definition of done

1. `bun test` passes, `bun run typecheck` reports no errors.
2. Every route in the spec §6.1 page inventory responds 200, except `/markets/:symbol` for unknown symbols, which 404s.
3. Zero axe violations across all fifteen public routes.
4. Rendered HTML contains no `style=` attribute, no `<style>` block, no inline script body, and no `on*=` handler, asserted by test.
5. No page references an external origin for fonts, scripts, or stylesheets.
6. JavaScript under 120KB, CSS under 40KB, each page's HTML under 60KB.
7. Content copy contains no em dashes, no placeholder text, no claim of registration or licensing, and no promise of return or safety, all asserted by test.
8. The price feed serves the last good snapshot when its source fails and never throws into a request.
9. Every page footer carries the risk warning and the accurate licensing statement.

## What this plan does not build

Deferred to plan 3 (Identity): registration, email verification, password hashing, TOTP, sessions, the KYC wizard, the audit log, the dashboard, and the account pages. The `KycProvider` interface is defined there, not here.

Deferred to Slice 2 and beyond: sparkline charts on the markets table (spec §6.4 mentions them; they need historical data the current feed does not provide, so they arrive with subsystem E's market data), real per-asset withdrawal fee figures on `/fees`, and a real incident history on `/status`.

**Spec items consciously deferred, so they are not lost:**

| Spec item | Where it goes | Why |
|---|---|---|
| §4.7 command palette (`⌘K`) | Plan 3 | It navigates between authenticated views and assets. On a nine-page marketing site it is decoration. |
| §4.7 keyboard map (`g d`, `g m`, `?`) | Plan 3 | Same reason. The shortcuts target app views that do not exist yet. |
| §4.7 skeleton loading states | Plan 3 | Marketing pages are server-rendered with no loading state to skeleton. The dashboard has one. |
| §4.7 toasts | Plan 3 | Nothing on the marketing site produces a transient message. |
| §4.4 muted price fraction (`67,412`**`.08`**) | Plan 3 | Requires `formatUsd` to return whole and fractional parts separately, which changes its signature. Worth doing once, alongside the dashboard's balance rendering, rather than twice. The `.num-frac` class exists and is ready. |

None of these are dropped. Each is listed in plan 3's scope.
