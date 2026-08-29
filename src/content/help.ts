import type { Section } from "./pages"

export interface HelpArticle {
  slug: string
  title: string
  summary: string
  category: string
  sections: Section[]
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "choosing-the-right-network",
    title: "Choosing the right network",
    summary: "How to verify the network before sending.",
    category: "Deposits and withdrawals",
    sections: [
      {
        heading: "One ticker, several networks",
        body: [
          "USDT exists on Ethereum, Tron, and BNB Chain. These are separate networks and are not interchangeable. The same applies to USDC.",
          "Each deposit address is issued for one specific network and only accepts transfers on that network.",
        ],
      },
      {
        heading: "What goes wrong",
        body: [
          "Sending USDT over Ethereum to a Tron address results in permanent loss. Neither Meridian nor the network operator can reverse it.",
          "The transfer settles on a network where the destination address does not exist.",
        ],
      },
      {
        heading: "How to check",
        body: [
          "Confirm that the network in your sending wallet matches the network on the deposit screen. Match the network, not the ticker.",
          "Send a small test amount first if you are unsure.",
        ],
      },
    ],
  },
  {
    slug: "how-deposits-are-credited",
    title: "How deposits are credited",
    summary: "Confirmation requirements and crediting times.",
    category: "Deposits and withdrawals",
    sections: [
      {
        heading: "Confirmations",
        body: [
          "Deposits are credited once the network reaches the required confirmation count. Bitcoin requires 2, Ethereum 12, Solana 32.",
          "Requirements are listed on each asset page under Markets.",
        ],
      },
      {
        heading: "Very small amounts",
        body: [
          "Some networks use finer precision than Meridian balances. The remainder is recorded against your account and credited once it reaches a creditable amount.",
        ],
      },
    ],
  },
  {
    slug: "verifying-your-identity",
    title: "Verifying your identity",
    summary: "Required documents and data retention.",
    category: "Accounts",
    sections: [
      {
        heading: "What we ask for",
        body: [
          "Verification requires your legal name, date of birth, Nigerian phone number, address, government identifier, an ID photograph, and a selfie.",
          "This is a legal requirement for regulated financial services.",
        ],
      },
      {
        heading: "What we keep",
        body: [
          "Documents and full government identifiers are held by the licensed verification provider. Meridian retains the provider reference and a truncated identifier.",
          "A breach of Meridian systems does not expose identity documents.",
        ],
      },
    ],
  },
  {
    slug: "keeping-your-account-secure",
    title: "Keeping your account secure",
    summary: "Two-factor authentication, sessions, and phishing protection.",
    category: "Accounts",
    sections: [
      {
        heading: "Two-factor authentication",
        body: [
          "Two-factor authentication is required before any withdrawal. Use an authenticator app rather than SMS. SIM swap fraud is common.",
          "Store recovery codes offline, accessible without your phone.",
        ],
      },
      {
        heading: "What we will never ask",
        body: [
          "Meridian will never request your password, authenticator code, or recovery codes by any channel. Any such request is a phishing attempt.",
          "Meridian will never ask you to send funds to verify or release an account.",
        ],
      },
    ],
  },
]
