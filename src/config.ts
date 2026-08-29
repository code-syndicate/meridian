export interface Config {
  env: "development" | "test" | "production"
  port: number
  databasePath: string
  sessionSecret: string
  totpEncryptionKey: string
  smtpHost: string | null
  smtpPort: number
  smtpUser: string | null
  smtpPassword: string | null
  emailFrom: string
  kycProvider: string
  custodyProvider: string
}

const ENVIRONMENTS = ["development", "test", "production"] as const
const REQUIRED = ["DATABASE_PATH", "SESSION_SECRET", "TOTP_ENCRYPTION_KEY"] as const

export function loadConfig(
  source: Record<string, string | undefined> = process.env,
): Config {
  const missing = REQUIRED.filter((key) => !source[key])
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
  }

  const env = source.NODE_ENV ?? "development"
  if (!ENVIRONMENTS.includes(env as (typeof ENVIRONMENTS)[number])) {
    throw new Error(`NODE_ENV must be one of ${ENVIRONMENTS.join(", ")}, got "${env}"`)
  }

  const portRaw = source.PORT ?? "3000"
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${portRaw}"`)
  }

  const sessionSecret = source.SESSION_SECRET as string
  if (sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters")
  }

  const totpEncryptionKey = source.TOTP_ENCRYPTION_KEY as string
  if (totpEncryptionKey.length < 32) {
    throw new Error("TOTP_ENCRYPTION_KEY must be at least 32 characters")
  }

  const smtpPortRaw = source.SMTP_PORT ?? "587"
  const smtpPort = Number(smtpPortRaw)
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    throw new Error(`SMTP_PORT must be an integer between 1 and 65535, got "${smtpPortRaw}"`)
  }

  const smtpHost = source.SMTP_HOST ?? null
  const smtpUser = source.SMTP_USER ?? null
  const smtpPassword = source.SMTP_PASSWORD ?? null

  // Production must not silently fall back to printing verification links.
  if (env === "production" && !(smtpHost && smtpUser && smtpPassword)) {
    throw new Error(
      "SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are all required in production",
    )
  }

  // A sandbox KYC provider in production approves almost every applicant.
  // That is an AML failure, not a bug, so refuse to start rather than warn.
  const kycProvider = source.KYC_PROVIDER ?? (env === "production" ? "" : "sandbox")
  if (env === "production" && (!kycProvider || kycProvider === "sandbox")) {
    throw new Error(
      "KYC_PROVIDER must name a real provider in production. The sandbox approves almost everyone.",
    )
  }

  // A sandbox custody provider in production hands real users addresses that
  // nobody holds keys to. Refuse to start.
  const custodyProvider = source.CUSTODY_PROVIDER ?? (env === "production" ? "" : "sandbox")
  if (env === "production" && (!custodyProvider || custodyProvider === "sandbox")) {
    throw new Error(
      "CUSTODY_PROVIDER must name a real provider in production. The sandbox issues addresses nobody controls.",
    )
  }

  return {
    env: env as Config["env"],
    port,
    databasePath: source.DATABASE_PATH as string,
    sessionSecret,
    totpEncryptionKey,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPassword,
    emailFrom: source.EMAIL_FROM ?? "Meridian <no-reply@meridian.example>",
    kycProvider,
    custodyProvider,
  }
}
