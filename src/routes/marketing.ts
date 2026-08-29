import express from "express"
import type { AssetRepository } from "../db/repositories/assets"
import type { PriceFeed } from "../services/price-feed"
import { usdParts, formatChange, directionOf } from "../domain/prices"
import { CONTENT_PAGES, LEGAL_PAGES } from "../content/pages"
import { HELP_ARTICLES } from "../content/help"

export interface MarketingDeps {
  assets: AssetRepository
  feed: PriceFeed
}

export function createMarketingRoutes(deps: MarketingDeps): express.Router {
  const router = express.Router()

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
          price: usdParts(quote.priceUsd),
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

  router.get("/markets", (req, res) => {
    const quotes = new Map(deps.feed.snapshot().map((q) => [q.symbol, q]))
    const rows = deps.assets.all().map((asset) => {
      const quote = quotes.get(asset.symbol)
      return {
        name: asset.name,
        displaySymbol: asset.displaySymbol,
        networkLabel: asset.networkLabel,
        confirmations: asset.confirmationsRequired,
        price: quote ? usdParts(quote.priceUsd) : null,
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
      price: quote ? usdParts(quote.priceUsd) : null,
      change: quote ? formatChange(quote.change24h) : "",
    })
  })

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

  return router
}
