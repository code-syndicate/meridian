import express from "express"
import type { AssetRepository } from "../db/repositories/assets"
import type { PriceFeed } from "../services/price-feed"
import type { LedgerRepository } from "../db/repositories/ledger"
import { buildPortfolio } from "../domain/portfolio"
import { formatBalance } from "../domain/money"
import { usdParts, formatChange, directionOf, formatUsd, formatCompactUsd } from "../domain/prices"
import { buildSparkline } from "../domain/sparkline"
import { CONTENT_PAGES, LEGAL_PAGES } from "../content/pages"
import { HELP_ARTICLES } from "../content/help"
import { GET_STARTED_STEPS, RESOURCES } from "../content/guides"
import { relativeTime } from "../domain/rss"
import type { NewsFeed } from "../services/news-feed"

export interface MarketingDeps {
  assets: AssetRepository
  feed: PriceFeed
  news: NewsFeed
  ledger: LedgerRepository
}

export function createMarketingRoutes(deps: MarketingDeps): express.Router {
  const router = express.Router()

  async function newsRows(limit: number) {
    return (await deps.news.snapshot()).slice(0, limit).map((item) => ({
      ...item,
      ago: relativeTime(item.publishedAt),
    }))
  }

  router.get("/", async (req, res) => {
    const quotes = new Map((await deps.feed.snapshot()).map((q) => [q.symbol, q]))
    const strip = (await deps.assets.all())
      .filter((asset) => quotes.has(asset.symbol))
      .slice(0, 6)
      .map((asset) => {
        const quote = quotes.get(asset.symbol)!
        return {
          name: asset.name,
          displaySymbol: asset.displaySymbol,
          networkLabel: asset.networkLabel,
          price: usdParts(quote.priceUsd),
          change: formatChange(quote.change24h),
          direction: directionOf(quote.change24h),
          spark: buildSparkline(quote.sparkline),
        }
      })

    // Gainers and losers, deduplicated by display symbol so the same token
    // on three networks does not fill both lists.
    const seen = new Set<string>()
    const ranked = deps.feed
      .snapshot()
      .filter((q) => {
        if (seen.has(q.displaySymbol)) return false
        seen.add(q.displaySymbol)
        return true
      })
      .map((q) => ({
        symbol: q.symbol,
        displaySymbol: q.displaySymbol,
        name: q.name,
        price: formatUsd(q.priceUsd),
        change: formatChange(q.change24h),
        raw: q.change24h,
      }))
    const gainers = [...ranked].sort((a, b) => b.raw - a.raw).slice(0, 4)
    const losers = [...ranked].sort((a, b) => a.raw - b.raw).slice(0, 4)

    // The hero carries one asset at size. Bitcoin is the one people look for.
    const leadQuote = quotes.get("BTC") ?? await deps.feed.snapshot()[0]
    const lead = leadQuote
      ? {
          name: leadQuote.name,
          displaySymbol: leadQuote.displaySymbol,
          price: usdParts(leadQuote.priceUsd),
          change: formatChange(leadQuote.change24h),
          direction: directionOf(leadQuote.change24h),
          spark: buildSparkline(leadQuote.sparkline, 260, 72),
        }
      : null

    const NOTIONAL: Record<string, number> = { BTC: 0.164, ETH: 2.41, SOL: 18.5 }
    // Used only when the feed is unavailable, so the hero never renders empty.
    const FALLBACK_USD: Record<string, bigint> = {
      BTC: 7800000000000n,
      ETH: 244000000000n,
      SOL: 10400000000n,
    }
    const previewRows = (await deps.assets.all())
      .filter((a) => NOTIONAL[a.symbol] !== undefined)
      .map((asset) => {
        const units = NOTIONAL[asset.symbol]!
        const price = quotes.get(asset.symbol)?.priceUsd ?? FALLBACK_USD[asset.symbol]!
        const base = BigInt(Math.round(units * 1e8))
        return {
          name: asset.name,
          symbol: asset.displaySymbol,
          amount: units.toString(),
          valueUsd: (base * price) / 100000000n,
        }
      })

    const previewLead = quotes.get("BTC") ?? await deps.feed.snapshot()[0]
    const previewSpark = previewLead ? buildSparkline(previewLead.sparkline, 300, 84) : null

    // Signed in, the card shows what the viewer actually holds. Showing a
    // notional portfolio to someone with a real one is the wrong card.
    const own = req.user
      ? buildPortfolio({
          assets: await deps.assets.all(),
          balances: await deps.ledger.balances(req.user.id),
          quotes: await deps.feed.snapshot(),
        })
      : null

    const preview = own
      ? {
          mine: true,
          empty: own.empty,
          total: usdParts(own.totalUsd),
          change: previewLead ? formatChange(previewLead.change24h) : "0.00%",
          direction: previewLead ? directionOf(previewLead.change24h) : "flat",
          spark: own.empty ? null : previewSpark,
          rows: own.rows
            .filter((row) => row.available + row.held > 0n)
            .sort((a, b) => (b.valueUsd > a.valueUsd ? 1 : b.valueUsd < a.valueUsd ? -1 : 0))
            .slice(0, 3)
            .map((row) => {
              const parts = usdParts(row.valueUsd)
              return {
                name: row.name,
                symbol: row.displaySymbol,
                amount: formatBalance(row.available + row.held, row.displayDecimals),
                value: `${parts.whole}.${parts.fraction}`,
              }
            }),
        }
      : {
          mine: false,
          empty: false,
          total: usdParts(previewRows.reduce((sum, r) => sum + r.valueUsd, 0n)),
          change: previewLead ? formatChange(previewLead.change24h) : "0.00%",
          direction: previewLead ? directionOf(previewLead.change24h) : "flat",
          spark: previewSpark,
          rows: previewRows.map((r) => {
            const parts = usdParts(r.valueUsd)
            return { name: r.name, symbol: r.symbol, amount: r.amount, value: `${parts.whole}.${parts.fraction}` }
          }),
        }

    res.render("marketing/home", {
      title: "Meridian Exchanger",
      description: "Buy, sell, and store digital assets. Ten assets across five networks.",
      path: req.path,
      strip,
      lead,
      preview,
      news: await newsRows(6),
      gainers,
      losers,
    })
  })

  router.get("/get-started", async (req, res) => {
    res.render("marketing/guide", {
      title: "Get started | Meridian Exchanger",
      description: "From opening an account to verified, in five steps.",
      path: req.path,
      steps: GET_STARTED_STEPS,
    })
  })

  router.get("/resources", async (req, res) => {
    res.render("marketing/resources", {
      title: "Resources | Meridian Exchanger",
      description: "Guides, policies, and market news.",
      path: req.path,
      resources: RESOURCES,
      news: await newsRows(10),
    })
  })

  router.get("/markets", async (req, res) => {
    const quotes = new Map((await deps.feed.snapshot()).map((q) => [q.symbol, q]))
    const rows = (await deps.assets.all()).map((asset) => {
      const quote = quotes.get(asset.symbol)
      return {
        name: asset.name,
        displaySymbol: asset.displaySymbol,
        networkLabel: asset.networkLabel,
        confirmations: asset.confirmationsRequired,
        price: quote ? usdParts(quote.priceUsd) : null,
        change: quote ? formatChange(quote.change24h) : "-",
        direction: quote ? directionOf(quote.change24h) : "flat",
        spark: quote ? buildSparkline(quote.sparkline) : null,
        marketCap: quote ? formatCompactUsd(quote.marketCap) : "\u2014",
        volume24h: quote ? formatCompactUsd(quote.volume24h) : "\u2014",
      }
    })

    res.render("marketing/markets", {
      title: "Markets | Meridian Exchanger",
      description: "Supported digital assets, networks, and indicative prices.",
      path: req.path,
      rows,
    })
  })

  router.get("/markets/:symbol", async (req, res, next) => {
    const asset = await deps.assets.find(String(req.params.symbol).toUpperCase())
    if (!asset) return next()

    const quote = (await deps.feed.snapshot()).find((q) => q.symbol === asset.symbol)
    res.render("marketing/asset", {
      title: `${asset.name} (${asset.displaySymbol}) | Meridian Exchanger`,
      description: `${asset.name} on ${asset.networkLabel}. Network, confirmations, and indicative price.`,
      path: req.path,
      asset,
      price: quote ? usdParts(quote.priceUsd) : null,
      change: quote ? formatChange(quote.change24h) : "",
    })
  })

  for (const page of CONTENT_PAGES) {
    router.get(`/${page.slug}`, async (req, res) => {
      res.render("marketing/content", {
        title: page.title,
        description: page.description,
        path: req.path,
        page,
      })
    })
  }

  for (const page of LEGAL_PAGES) {
    router.get(`/legal/${page.slug}`, async (req, res) => {
      res.render("marketing/content", {
        title: page.title,
        description: page.description,
        path: req.path,
        page,
      })
    })
  }

  router.get("/help", async (req, res) => {
    const categories = [...new Set(HELP_ARTICLES.map((a) => a.category))]
    res.render("marketing/help-index", {
      title: "Help centre | Meridian Exchanger",
      description: "Guides to deposits, networks, verification, and account security.",
      path: req.path,
      groups: categories.map((category) => ({
        category,
        articles: HELP_ARTICLES.filter((a) => a.category === category),
      })),
    })
  })

  router.get("/help/:slug", async (req, res, next) => {
    const article = HELP_ARTICLES.find((a) => a.slug === req.params.slug)
    if (!article) return next()
    res.render("marketing/help-article", {
      title: `${article.title} | Meridian Exchanger`,
      description: article.summary,
      path: req.path,
      article,
    })
  })

  return router
}
