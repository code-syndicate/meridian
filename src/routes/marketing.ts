import express from "express"
import type { AssetRepository } from "../db/repositories/assets"
import type { PriceFeed } from "../services/price-feed"
import { formatUsd, formatChange, directionOf } from "../domain/prices"
import { CONTENT_PAGES, LEGAL_PAGES } from "../content/pages"

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

  return router
}
