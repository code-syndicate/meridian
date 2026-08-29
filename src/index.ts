import { createApp } from "./server"
import { loadConfig } from "./config"
import type { PriceFeed } from "./services/price-feed"
import type { NewsFeed } from "./services/news-feed"

const config = loadConfig()
const app = createApp(config)

const priceFeed = app.locals.priceFeed as PriceFeed

// Warm the feed before accepting traffic. Otherwise the first page rendered
// after a restart has no prices and the hero shows an empty portfolio.
await priceFeed.refresh()
priceFeed.start()

const newsFeed = app.locals.newsFeed as NewsFeed
await newsFeed.refresh()
newsFeed.start()

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ msg: "listening", port: config.port, env: config.env }))
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    priceFeed.stop()
    newsFeed.stop()
    server.close(() => process.exit(0))
  })
}
