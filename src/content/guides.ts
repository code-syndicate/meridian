export interface GuideStep {
  title: string
  body: string
}

export interface Resource {
  kicker: string
  title: string
  body: string
  href: string
}

export const GET_STARTED_STEPS: GuideStep[] = [
  {
    title: "Open an account",
    body: "Email address and a password of at least 12 characters. Passwords are checked against known breach databases and reused passwords are rejected.",
  },
  {
    title: "Confirm your email",
    body: "A single-use link, valid for 24 hours. Confirming it signs you in and creates your account ledger.",
  },
  {
    title: "Turn on two-factor authentication",
    body: "Use an authenticator app, not SMS. SIM swap fraud is common in Nigeria. Store your recovery codes offline.",
  },
  {
    title: "Verify your identity",
    body: "Five steps: legal name and date of birth, BVN or NIN, address, ID photo with selfie, and disclosures. Takes a few minutes and can be resumed.",
  },
  {
    title: "Fund your account",
    body: "You get a deposit address per asset per network. Verify the network before sending. Transfers over the wrong network cannot be recovered.",
  },
]

export const RESOURCES: Resource[] = [
  {
    kicker: "Start here",
    title: "Choosing the right network",
    body: "USDT exists on Ethereum, Tron, and BNB Chain. These networks are not interchangeable.",
    href: "/help/choosing-the-right-network",
  },
  {
    kicker: "Deposits",
    title: "How deposits are credited",
    body: "Confirmation requirements and crediting times by network.",
    href: "/help/how-deposits-are-credited",
  },
  {
    kicker: "Accounts",
    title: "Verifying your identity",
    body: "Required documents, screening checks, and what is retained.",
    href: "/help/verifying-your-identity",
  },
  {
    kicker: "Security",
    title: "Keeping your account secure",
    body: "Two-factor authentication, session management, and phishing protection.",
    href: "/help/keeping-your-account-secure",
  },
  {
    kicker: "Custody",
    title: "How we hold your assets",
    body: "Pooled reserves, append-only ledger, and third-party key custody.",
    href: "/security",
  },
  {
    kicker: "Costs",
    title: "The full fee schedule",
    body: "Deposit, withdrawal, and trading fees in full.",
    href: "/fees",
  },
  {
    kicker: "Compliance",
    title: "Where our licensing stands",
    body: "Current registration status with the SEC of Nigeria.",
    href: "/regulatory",
  },
  {
    kicker: "Risk",
    title: "What can go wrong",
    body: "Volatility, irreversible transfers, and custody risk.",
    href: "/legal/risk",
  },
]
