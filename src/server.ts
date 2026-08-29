import express from "express"
import helmet from "helmet"
import cookieParser from "cookie-parser"
import { join } from "node:path"
import type { AddressInfo } from "node:net"
import type { Database } from "bun:sqlite"
import type { Config } from "./config"
import { openDatabase, migrate } from "./db"
import { AssetRepository } from "./db/repositories/assets"
import { LedgerRepository } from "./db/repositories/ledger"
import { UserRepository } from "./db/repositories/users"
import { SessionRepository } from "./db/repositories/sessions"
import { AuditRepository } from "./db/repositories/audit"
import { RateLimitRepository } from "./db/repositories/rate-limits"
import { PriceFeed, CoinGeckoSource } from "./services/price-feed"
import { createEmailSender, type EmailSender } from "./services/email"
import { HibpBreachCheck, type BreachCheck } from "./services/breach-check"
import { createPriceRoutes } from "./routes/prices"
import { createMarketingRoutes } from "./routes/marketing"
import { createAuthRoutes } from "./routes/auth"
import { createAccountRoutes } from "./routes/account"
import { csrfMiddleware } from "./middleware/csrf"
import { sessionMiddleware } from "./middleware/session"

export interface App extends express.Express {
  inject(path: string, init?: RequestInit): Promise<Response>
}

export interface AppDeps {
  priceFeed?: PriceFeed
  db?: Database
  email?: EmailSender
  breach?: BreachCheck
}

export function createApp(config: Config, deps: AppDeps = {}): App {
  const app = express() as App
  app.disable("x-powered-by")

  app.set("view engine", "pug")
  app.set("views", join(import.meta.dir, "views"))
  app.set("trust proxy", true)

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
  app.use(cookieParser())

  // One connection for the whole application. SQLite in WAL mode is a single
  // writer, so a second connection buys nothing and invites confusion. This
  // consolidates the two connections plan 2 opened.
  const db =
    deps.db ??
    (() => {
      const opened = openDatabase(config.databasePath)
      migrate(opened)
      return opened
    })()

  const assets = new AssetRepository(db)
  const ledger = new LedgerRepository(db)
  const users = new UserRepository(db)
  const sessions = new SessionRepository(db)
  const audit = new AuditRepository(db)
  const limits = new RateLimitRepository(db)

  const priceFeed = deps.priceFeed ?? new PriceFeed(new CoinGeckoSource(), assets.all())
  const email = deps.email ?? createEmailSender(config)
  const breach = deps.breach ?? new HibpBreachCheck()

  app.locals.priceFeed = priceFeed

  const secure = config.env === "production"
  app.use(csrfMiddleware(secure))
  app.use(sessionMiddleware({ sessions, users, secure }))

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", env: config.env })
  })

  app.use(createPriceRoutes(priceFeed))
  app.use(
    createAuthRoutes({
      users,
      sessions,
      audit,
      limits,
      assets,
      ledger,
      email,
      breach,
      config,
      db,
    }),
  )
  app.use(createAccountRoutes({ users, sessions, audit, assets, ledger, config, db }))
  app.use(createMarketingRoutes({ assets, feed: priceFeed }))

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
