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
    summary: "The most expensive mistake in crypto, and how to avoid it.",
    category: "Deposits and withdrawals",
    sections: [
      {
        heading: "One ticker, several networks",
        body: [
          "USDT is not one thing. It exists on Ethereum, on Tron, and on BNB Chain, and those are separate networks that do not talk to each other. The same is true of USDC.",
          "When you deposit, we give you an address for one specific network. That address only works for that network.",
        ],
      },
      {
        heading: "What goes wrong",
        body: [
          "If you send USDT over Ethereum to an address we issued for Tron, the funds do not arrive. In most cases they are lost permanently, and neither we nor the network operator can reverse it.",
          "This is not a policy we could choose to relax. The transfer happened on a network where that address does not exist.",
        ],
      },
      {
        heading: "How to check",
        body: [
          "Before you send, confirm that the network shown in your sending wallet matches the network shown on our deposit screen exactly. Not the ticker, the network.",
          "If you are unsure, send a small amount first and wait for it to arrive.",
        ],
      },
    ],
  },
  {
    slug: "how-deposits-are-credited",
    title: "How deposits are credited",
    summary: "Confirmations, timing, and why the number differs by asset.",
    category: "Deposits and withdrawals",
    sections: [
      {
        heading: "Confirmations",
        body: [
          "A transfer is credited once the network has confirmed it enough times to be considered settled. The number differs by network because the networks differ: Bitcoin needs two, Ethereum needs twelve, Solana needs thirty-two.",
          "Each asset's requirement is shown on its page under Markets.",
        ],
      },
      {
        heading: "Very small amounts",
        body: [
          "Some networks track amounts more finely than our balances do. Where that happens, the remainder is recorded against your account rather than discarded, and it is credited once it adds up to a creditable amount.",
        ],
      },
    ],
  },
  {
    slug: "verifying-your-identity",
    title: "Verifying your identity",
    summary: "What we ask for, why, and what we keep.",
    category: "Accounts",
    sections: [
      {
        heading: "What we ask for",
        body: [
          "Verification asks for your legal name, date of birth, Nigerian phone number, address, and a government identifier, along with a photograph of an identity document and a selfie.",
          "This is a legal requirement for a regulated financial service, not a preference of ours.",
        ],
      },
      {
        heading: "What we keep",
        body: [
          "Your documents and full government identifiers are held by the licensed verification provider that checks them. We keep the provider's reference and a truncated identifier.",
          "That means a breach of our systems does not expose your identity documents.",
        ],
      },
    ],
  },
  {
    slug: "keeping-your-account-secure",
    title: "Keeping your account secure",
    summary: "Two-factor authentication, sessions, and what we will never ask you.",
    category: "Accounts",
    sections: [
      {
        heading: "Two-factor authentication",
        body: [
          "Two-factor authentication will be required before any withdrawal. Use an authenticator app rather than SMS, because SIM swap fraud is common and effective.",
          "Store your recovery codes somewhere you can reach without your phone.",
        ],
      },
      {
        heading: "What we will never ask",
        body: [
          "We will never ask for your password, your authenticator code, or your recovery codes. Not by email, not by phone, not in a chat window. Anyone who asks is attacking you.",
          "We will never ask you to send funds to an address to verify or release your account.",
        ],
      },
    ],
  },
]
