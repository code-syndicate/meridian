import { createApp } from "./server"
import { loadConfig } from "./config"
import type { PriceFeed } from "./services/price-feed"

const config = loadConfig()
const app = createApp(config)

const priceFeed = app.locals.priceFeed as PriceFeed
priceFeed.start()

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ msg: "listening", port: config.port, env: config.env }))
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    priceFeed.stop()
    server.close(() => process.exit(0))
  })
}
