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

  router.get("/api/prices/stream", async (req, res) => {
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
