import express from "express"
import { LimitService } from "./services/limits"
import { DepositPoller } from "./services/deposit-poller"
import { UsageRepository } from "./db/repositories/usage"
import { ACCOUNT_PAGES, ADMIN_PAGES, PRELAUNCH_NOTICE } from "./content/site"
import helmet from "helmet"
import cookieParser from "cookie-parser"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import type { AddressInfo } from "node:net"
import type { Config } from "./config"
import { openDatabase, migrate } from "./db"
import type { Client } from "./db"
import { AssetRepository } from "./db/repositories/assets"
import { LedgerRepository } from "./db/repositories/ledger"
import { UserRepository } from "./db/repositories/users"
import { SessionRepository } from "./db/repositories/sessions"
import { AuditRepository } from "./db/repositories/audit"
import { RateLimitRepository } from "./db/repositories/rate-limits"
import { EmailTokenRepository } from "./db/repositories/email-tokens"
import { RecoveryCodeRepository } from "./db/repositories/recovery-codes"
import { KycRepository } from "./db/repositories/kyc"
import { PriceFeed, CoinGeckoSource } from "./services/price-feed"
import { createEmailSender, type EmailSender } from "./services/email"
import { createPriceRoutes } from "./routes/prices"
import { createMarketingRoutes } from "./routes/marketing"
import { createAdminRoutes } from "./routes/admin"
import { AdminRepository } from "./db/repositories/admin"
import { createAuthRoutes } from "./routes/auth"
import { createAccountRoutes } from "./routes/account"
import { createOnboardingRoutes } from "./routes/onboarding"
import { NewsFeed, RssNewsSource } from "./services/news-feed"
import { CustodyRepository } from "./db/repositories/custody"
import { CustodyService } from "./services/custody"
import { HdCustodyProvider } from "./services/custody-hd"
import { SandboxCustodyProvider, type CustodyProvider } from "./services/custody-provider"
import { createWalletRoutes } from "./routes/wallet"
import { TransferService } from "./services/transfers"
import { TransferRepository } from "./db/repositories/transfers"
import { SandboxKycProvider, type KycProvider } from "./services/kyc-provider"
import { csrfMiddleware } from "./middleware/csrf"
import { sessionMiddleware } from "./middleware/session"
import { flashMiddleware } from "./middleware/flash"

export interface App extends express.Express {
  inject(path: string, init?: RequestInit): Promise<Response>
}

export interface AppDeps {
  priceFeed?: PriceFeed
  db?: Client
  email?: EmailSender
  kycProvider?: KycProvider
  newsFeed?: NewsFeed
  custodyProvider?: CustodyProvider
}

/**
 * Content hash of the static assets, appended to their URLs. Without this the
 * immutable cache header below means a returning browser never re-requests a
 * changed stylesheet, so CSS edits are simply invisible.
 */
function assetVersion(root: string): string {
  const hash = createHash("sha256")
  for (const rel of ["css/app.css", "js/alpine-components.js", "js/alpine.js"]) {
    try {
      hash.update(readFileSync(join(root, rel)))
    } catch {
      // A missing asset is caught by the static handler, not here.
    }
  }
  return hash.digest("hex").slice(0, 10)
}

export async function createApp(config: Config, deps: AppDeps = {}): Promise<App> {
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

  const publicRoot = join(import.meta.dir, "..", "public")
  const version = assetVersion(publicRoot)
  app.locals.assetVersion = version
  app.locals.accountPages = ACCOUNT_PAGES
  app.locals.adminPages = ADMIN_PAGES

  app.use(
    "/static",
    express.static(publicRoot, {
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
    (await (async () => {
      const opened = await openDatabase(config.databasePath, config.databaseAuthToken)
      await migrate(opened)
      return opened
    })())

  const assets = new AssetRepository(db)
  const ledger = new LedgerRepository(db)
  const users = new UserRepository(db)
  const sessions = new SessionRepository(db)
  const audit = new AuditRepository(db)
  const rateLimits = new RateLimitRepository(db)
  const emailTokens = new EmailTokenRepository(db)
  const recoveryCodes = new RecoveryCodeRepository(db)
  const kyc = new KycRepository(db)
  const custody = new CustodyRepository(db)

  const priceFeed = deps.priceFeed ?? new PriceFeed(new CoinGeckoSource(config.coingeckoApiKey), await assets.all())
  const email = deps.email ?? createEmailSender(config)
  const kycProvider = deps.kycProvider ?? new SandboxKycProvider()
  const newsFeed = deps.newsFeed ?? new NewsFeed(new RssNewsSource())
  const custodyProvider =
    deps.custodyProvider ??
    (config.custodyProvider === "hd" && config.custodyMnemonic
      ? new HdCustodyProvider(config.custodyMnemonic)
      : new SandboxCustodyProvider())
  const limitService = new LimitService({
    usage: new UsageRepository(db),
    prices: priceFeed,
    config,
  })
  const transferService = new TransferService({
    db, ledger, users, audit, transfers: new TransferRepository(db), limits: limitService,
  })
  const custodyService = new CustodyService({
    assets, ledger, custody, audit, provider: custodyProvider, limits: limitService,
  })

  app.locals.depositPoller = new DepositPoller(custodyService)
  app.locals.priceFeed = priceFeed
  app.locals.newsFeed = newsFeed

  const secure = config.env === "production"
  app.use(csrfMiddleware(secure))
  app.use(sessionMiddleware({ sessions, users, secure }))
  app.use(flashMiddleware(config.sessionSecret, secure))

  // Server-rendered so the palette needs no fetch and no inline object,
  // which the Alpine CSP build would refuse anyway.
  const PUBLIC_DESTINATIONS = [
    { href: "/", label: "Home" },
    { href: "/markets", label: "Markets" },
    { href: "/get-started", label: "Get started" },
    { href: "/resources", label: "Resources" },
    { href: "/fees", label: "Fees" },
    { href: "/security", label: "Security" },
    { href: "/regulatory", label: "Regulatory status" },
    { href: "/help", label: "Help centre" },
    { href: "/status", label: "System status" },
    { href: "/about", label: "About" },
    { href: "/legal/risk", label: "Risk disclosure" },
    { href: "/legal/terms", label: "Terms of Service" },
    { href: "/legal/privacy", label: "Privacy Policy" },
    { href: "/legal/aml", label: "AML Policy" },
    { href: "/legal/cookies", label: "Cookie Policy" },
  ]
  const ACCOUNT_DESTINATIONS = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/wallet/deposit", label: "Deposit" },
    { href: "/wallet/withdraw", label: "Withdraw" },
    { href: "/wallet/send", label: "Send to a Meridian account" },
    { href: "/wallet/transactions", label: "Transactions" },
    { href: "/account", label: "Account details" },
    { href: "/account/security", label: "Security settings" },
    { href: "/account/verification", label: "Verification" },
    { href: "/account/activity", label: "Activity" },
  ]

  app.use((req, res, next) => {
    res.locals.newsTicker = newsFeed.snapshot().slice(0, 12)
    res.locals.prelaunchNotice = PRELAUNCH_NOTICE
    res.locals.destinations = req.user
      ? [...ACCOUNT_DESTINATIONS, ...PUBLIC_DESTINATIONS]
      : PUBLIC_DESTINATIONS
    next()
  })

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", env: config.env })
  })

  app.use(createPriceRoutes(priceFeed))
  app.use(
    createAuthRoutes({
      users,
      sessions,
      audit,
      limits: rateLimits,
      emailTokens,
      assets,
      ledger,
      email,
      config,
      db,
    }),
  )
  app.use(createAccountRoutes({ limits: limitService, users, sessions, audit, assets, ledger, feed: priceFeed, recoveryCodes, kyc, config }))
  app.use(
    createWalletRoutes({ assets, ledger, custody, kyc, service: custodyService, transfers: transferService, limits: limitService, users, config }),
  )
  app.use(
    createAdminRoutes({
      db, assets, users, ledger, custody, kyc, audit,
      admin: new AdminRepository(db),
      service: custodyService,
      limits: limitService,
      rateLimits,
      keys: custodyProvider instanceof HdCustodyProvider ? custodyProvider : null,
    }),
  )
  app.use(createOnboardingRoutes({ kyc, audit, provider: kycProvider, config }))
  app.use(createMarketingRoutes({ assets, feed: priceFeed, news: newsFeed, ledger }))

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
