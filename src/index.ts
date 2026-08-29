import { createApp } from "./server"
import { loadConfig } from "./config"

const config = loadConfig()
const app = createApp(config)

const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ msg: "listening", port: config.port, env: config.env }))
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
