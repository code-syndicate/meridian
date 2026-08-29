export interface Section {
  heading: string
  body: string[]
}

export interface ContentPage {
  slug: string
  title: string
  description: string
  eyebrow: string
  heading: string
  sections: Section[]
}

export const CONTENT_PAGES: ContentPage[] = [
  {
    slug: "fees",
    title: "Fees | Meridian",
    description: "The complete fee schedule, with no asterisks.",
    eyebrow: "Fees",
    heading: "What we charge, in full.",
    sections: [
      {
        heading: "Deposits",
        body: [
          "Deposits are free. We do not add a fee to an incoming transfer, and we credit the full amount that arrives.",
          "The sending network still charges you its own fee, which we neither collect nor control.",
        ],
      },
      {
        heading: "Withdrawals",
        body: [
          "A withdrawal costs the network fee plus a fixed amount per asset and network. Both numbers are shown before you confirm, and the total is what leaves your balance.",
          "Withdrawal fees differ by network. Moving USDT over Tron does not cost the same as moving it over Ethereum, because the networks do not cost the same.",
        ],
      },
      {
        heading: "Trading",
        body: [
          "Trading carries a spread, which is the difference between the price we quote you and the price we source. The spread is shown on the confirmation screen in both percentage and cash terms before you commit to anything.",
          "There is no separate commission and no monthly fee.",
        ],
      },
      {
        heading: "Current status",
        body: [
          "Deposits, withdrawals, and trading are not yet enabled, so none of these fees are being charged today. This page describes the schedule that will apply when they are.",
        ],
      },
    ],
  },
  {
    slug: "security",
    title: "Security | Meridian",
    description: "How Meridian holds client assets and manages keys.",
    eyebrow: "Security",
    heading: "How we hold what you deposit.",
    sections: [
      {
        heading: "Pooled custody, separate accounting",
        body: [
          "Client assets are held together in platform-controlled wallets rather than in one wallet per client. This is how centralized exchanges work, and it is worth understanding rather than glossing over.",
          "What each client is owed is tracked in an internal double-entry ledger. The pooled reserves back the sum of client balances, and the two are reconciled against each other continuously.",
        ],
      },
      {
        heading: "Keys are held by a custody provider",
        body: [
          "Private keys are held by a third-party custody provider under multi-party controls, not on our own servers. No single person at Meridian can move client assets, and no single point of failure can authorise a material transaction.",
          "We chose this over managing keys ourselves because hot-wallet compromise is the most common way exchanges fail, and because a specialist provider's controls are auditable in a way ours would not yet be.",
        ],
      },
      {
        heading: "The ledger cannot be quietly edited",
        body: [
          "Ledger entries are append-only and enforced as such by the database itself. A correction is a new, opposing entry, and the original stays visible.",
          "A reconciliation job independently recomputes every balance from the journal and checks it against the cached figure. A disagreement is treated as a serious incident, not a warning to be cleared.",
        ],
      },
      {
        heading: "What we have not done yet",
        body: [
          "We have not completed a third-party security audit, and we do not have a published proof-of-reserves attestation. Both are planned before we accept client funds. We will say so here when they exist, and not before.",
        ],
      },
    ],
  },
  {
    slug: "regulatory",
    title: "Regulatory status | Meridian",
    description: "Meridian's licensing position, stated at its actual stage.",
    eyebrow: "Regulatory",
    heading: "Where our licensing actually stands.",
    sections: [
      {
        heading: "Current position",
        body: [
          "Meridian is not registered with the Securities and Exchange Commission of Nigeria. We are preparing an application under the Accelerated Regulatory Incubation Programme, which is the supervised pathway that can lead to full registration.",
          "Until that is in place we are not accepting deposits, not holding client assets, and not offering trading. Nothing on this site is an offer to do any of those things.",
        ],
      },
      {
        heading: "Why this page exists",
        body: [
          "Plenty of platforms imply approval they do not have. We would rather publish the unflattering version and be checkable.",
          "When our status changes, this page changes with it, and the date of the change is recorded.",
        ],
      },
      {
        heading: "Know your customer and anti-money-laundering",
        body: [
          "Every account will require identity verification before it can move value. We verify identity through a licensed verification provider and screen against sanctions and politically exposed person lists.",
          "We keep the provider's verification reference rather than storing your government identifiers in full, which limits what an attacker could obtain from us.",
        ],
      },
      {
        heading: "Who we serve",
        body: [
          "Meridian is being built for residents of Nigeria. We do not serve jurisdictions where we are not permitted to operate, and we will publish the specific exclusions before launch.",
        ],
      },
    ],
  },
  {
    slug: "about",
    title: "About | Meridian",
    description: "What Meridian is and how to reach us.",
    eyebrow: "About",
    heading: "A digital asset platform being built in public view.",
    sections: [
      {
        heading: "What we are building",
        body: [
          "Meridian is a digital asset custody and execution platform for the Nigerian market. It is under active development and is not yet open to clients.",
          "We are publishing our custody model, our fee schedule, and our regulatory position while we build rather than after, because those are the things that should decide whether you trust a platform.",
        ],
      },
      {
        heading: "Contact",
        body: [
          "For questions about this site or the platform, write to hello@meridian.example. This address is not yet live and will be replaced before launch.",
        ],
      },
    ],
  },
  {
    slug: "status",
    title: "System status | Meridian",
    description: "Current operational status of Meridian services.",
    eyebrow: "Status",
    heading: "System status.",
    sections: [
      {
        heading: "Current status",
        body: [
          "The public website is operational. The indicative price feed is operational and refreshes every ten seconds from public market data.",
          "Accounts, deposits, withdrawals, and trading are not yet live. There is no incident history to report because there is no production service yet.",
        ],
      },
    ],
  },
]

export const LEGAL_PAGES: ContentPage[] = [
  {
    slug: "risk",
    title: "Risk disclosure | Meridian",
    description: "The risks of holding and trading digital assets.",
    eyebrow: "Legal",
    heading: "Risk disclosure.",
    sections: [
      {
        heading: "You can lose everything",
        body: [
          "Digital assets are volatile. The value of what you hold can fall quickly and without warning, and you can lose the entire amount you put in. Do not commit money you cannot afford to lose completely.",
          "Past price movement tells you nothing reliable about future price movement.",
        ],
      },
      {
        heading: "Nothing here is advice",
        body: [
          "Meridian does not give investment advice and does not assess whether any asset is suitable for you. Any decision you make is your own.",
          "We make no promise about the value of any asset and no promise of any return.",
        ],
      },
      {
        heading: "Transfers are irreversible",
        body: [
          "A transfer sent to the wrong address, or sent over the wrong network, is generally gone permanently. Neither we nor anyone else can reverse it.",
          "Several assets we support exist on more than one network. Check the network as carefully as you check the address.",
        ],
      },
      {
        heading: "Platform and custody risk",
        body: [
          "Holding assets with any custodian means accepting that custodian's operational and security risk. Digital asset holdings are not covered by a deposit protection scheme.",
          "Access to the platform may be interrupted by maintenance, technical failure, or events outside our control.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms of Service | Meridian",
    description: "The terms governing use of the Meridian website.",
    eyebrow: "Legal",
    heading: "Terms of Service.",
    sections: [
      {
        heading: "Scope",
        body: [
          "These terms cover your use of this website. Meridian is not currently offering accounts or any regulated service, so these terms do not yet govern any client relationship.",
          "Separate account terms will apply when the platform opens, and you will be asked to accept them explicitly at that point.",
        ],
      },
      {
        heading: "Information on this site",
        body: [
          "Information here is provided for general reference. Prices shown are indicative, drawn from public market data, and are not quotes or offers to transact.",
          "We aim to keep this site accurate and will correct errors when we find them.",
        ],
      },
      {
        heading: "Governing law",
        body: [
          "These terms are governed by the laws of the Federal Republic of Nigeria. The specific entity and jurisdiction details will be published here before the platform opens.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy | Meridian",
    description: "How Meridian handles personal data.",
    eyebrow: "Legal",
    heading: "Privacy Policy.",
    sections: [
      {
        heading: "What this site collects",
        body: [
          "This website does not use advertising or analytics trackers, and it sets no cookies for visitors who are not signed in. We do not load fonts, scripts, or stylesheets from third-party networks, so browsing here does not hand your request details to anyone else.",
          "Standard server logs record request details including IP address, and are retained for security and diagnostic purposes.",
        ],
      },
      {
        heading: "Identity data",
        body: [
          "When accounts open, identity verification will be carried out by a licensed verification provider. Identity documents and government identifiers are held by that provider. We retain the provider's verification reference and a truncated identifier rather than the full value.",
          "This is deliberate: it limits what could be taken from us in a breach.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "Under the Nigeria Data Protection Act you may request access to the personal data we hold about you, ask for it to be corrected, and object to certain processing. Requests can be sent to the contact address on our About page.",
        ],
      },
    ],
  },
  {
    slug: "aml",
    title: "AML Policy | Meridian",
    description: "Meridian's anti-money-laundering approach.",
    eyebrow: "Legal",
    heading: "Anti-money-laundering policy.",
    sections: [
      {
        heading: "Verification",
        body: [
          "Every account will be verified before it can move value. Verification includes identity confirmation against Nigerian government identifiers and a document and liveness check.",
          "Accounts are screened against sanctions lists and politically exposed person lists at onboarding and on an ongoing basis.",
        ],
      },
      {
        heading: "Monitoring and reporting",
        body: [
          "Transactions will be monitored for patterns associated with money laundering and terrorist financing. Activity meeting reporting thresholds will be reported to the relevant Nigerian authorities.",
          "We may suspend an account while a matter is investigated, and we are not always permitted to explain why.",
        ],
      },
      {
        heading: "Governance",
        body: [
          "A designated Compliance Officer is responsible for this programme. The full programme will be documented as part of our regulatory application.",
        ],
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy | Meridian",
    description: "How Meridian uses cookies.",
    eyebrow: "Legal",
    heading: "Cookie Policy.",
    sections: [
      {
        heading: "What we set",
        body: [
          "This site sets no cookies for visitors who are not signed in. There are no advertising cookies and no analytics cookies.",
          "When accounts open, a single session cookie will be set after sign-in. It is strictly necessary to keep you signed in, and it carries no tracking identifier.",
        ],
      },
      {
        heading: "Third parties",
        body: [
          "We do not embed third-party content that would set cookies from another domain. Fonts, stylesheets, and scripts are all served from our own origin.",
        ],
      },
    ],
  },
]
