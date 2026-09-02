import { createApp } from "./server"
import { loadConfig } from "./config"
import type { PriceFeed } from "./services/price-feed"
import type { NewsFeed } from "./services/news-feed"
import type { DepositPoller } from "./services/deposit-poller"

const config = loadConfig()
const app = await createApp(config)

const priceFeed = app.locals.priceFeed as PriceFeed

// Last good prices first, so a restart renders immediately and does not spend
// an upstream call to draw its first page.
await priceFeed.loadCache()
await priceFeed.refresh()
priceFeed.start()

const newsFeed = app.locals.newsFeed as NewsFeed
await newsFeed.refresh()
newsFeed.start()

// Deposits confirm whether or not anyone is watching, so crediting them
// cannot depend on a page being opened.
const depositPoller = app.locals.depositPoller as DepositPoller
depositPoller.start()

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ msg: "listening", port: config.port, env: config.env }))
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    priceFeed.stop()
    newsFeed.stop()
    depositPoller.stop()
    server.close(() => process.exit(0))
  })
}
