import express from "express"
import helmet from "helmet"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import type { Config } from "./config"

export interface App extends express.Express {
  inject(path: string, init?: RequestInit): Promise<Response>
}

export function createApp(config: Config): App {
  const app = express() as App
  app.disable("x-powered-by")

  app.set("view engine", "pug")
  app.set("views", join(import.meta.dir, "views"))

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'none'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "font-src": ["'self'"],
          "connect-src": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'none'"],
          "object-src": ["'none'"],
        },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  )

  app.use(
    "/static",
    express.static(join(import.meta.dir, "..", "public"), {
      maxAge: "1y",
      immutable: true,
      fallthrough: false,
    }),
  )

  app.use(express.urlencoded({ extended: false, limit: "64kb" }))
  app.use(express.json({ limit: "64kb" }))

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

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" })
  })

  app.inject = async (path, init) => {
    const server = app.listen(0)
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve)
        server.once("error", reject)
      })
      const { port } = server.address() as AddressInfo
      return await fetch(`http://127.0.0.1:${port}${path}`, init)
    } finally {
      server.close()
    }
  }

  return app
}
