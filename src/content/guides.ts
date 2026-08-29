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
    body: "An email address and a password of at least twelve characters. We check that password against known breach corpora, so a password you have used elsewhere will be refused. That is deliberate.",
  },
  {
    title: "Confirm your email",
    body: "We send a link that works once and expires in 24 hours. Confirming it signs you in and creates your account ledger, with an entry for every asset we support.",
  },
  {
    title: "Turn on two-factor authentication",
    body: "Use an authenticator app rather than SMS, because SIM swap fraud is common and effective in Nigeria. Save your recovery codes somewhere you can reach without your phone.",
  },
  {
    title: "Verify your identity",
    body: "Five steps: your legal name and date of birth, your BVN or NIN, your address, a photo of your ID with a selfie, and the disclosures. It takes a few minutes and you can leave and come back.",
  },
  {
    title: "Fund your account",
    body: "Once deposits open you will get an address per asset per network. Check the network as carefully as you check the address, because a transfer sent over the wrong one is gone permanently.",
  },
]

export const RESOURCES: Resource[] = [
  {
    kicker: "Start here",
    title: "Choosing the right network",
    body: "USDT exists on Ethereum, Tron, and BNB Chain. They do not talk to each other. This is the mistake that costs people the most money.",
    href: "/help/choosing-the-right-network",
  },
  {
    kicker: "Deposits",
    title: "How deposits are credited",
    body: "Confirmations, timing, and why Bitcoin needs two while Solana needs thirty-two.",
    href: "/help/how-deposits-are-credited",
  },
  {
    kicker: "Accounts",
    title: "Verifying your identity",
    body: "What we ask for, why we ask, and exactly what we keep after the check is done.",
    href: "/help/verifying-your-identity",
  },
  {
    kicker: "Security",
    title: "Keeping your account secure",
    body: "Two-factor authentication, session control, and the things we will never ask you for.",
    href: "/help/keeping-your-account-secure",
  },
  {
    kicker: "Custody",
    title: "How we hold your assets",
    body: "Pooled reserves, an append-only ledger, and keys held by a third-party custodian under multi-party control.",
    href: "/security",
  },
  {
    kicker: "Costs",
    title: "The full fee schedule",
    body: "Deposits, withdrawals, and the trading spread. Every number on one page with no asterisks.",
    href: "/fees",
  },
  {
    kicker: "Compliance",
    title: "Where our licensing stands",
    body: "Our actual status with the SEC of Nigeria, stated at its real stage rather than implied.",
    href: "/regulatory",
  },
  {
    kicker: "Risk",
    title: "What can go wrong",
    body: "Volatility, irreversible transfers, and custody risk, in plain language.",
    href: "/legal/risk",
  },
]
