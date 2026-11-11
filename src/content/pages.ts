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
    title: "Fees | Meridian Exchanger",
    description: "Deposit, withdrawal, and trading fees in full.",
    eyebrow: "Fees",
    heading: "Fee schedule",
    sections: [
      {
        heading: "Deposits",
        body: [
          "Deposits are free. The full amount that arrives is credited to your account.",
          "The sending network charges its own fee. Meridian does not collect it.",
        ],
      },
      {
        heading: "Withdrawals",
        body: [
          "Withdrawals cost the network fee plus a fixed amount per asset. Both are shown before you confirm.",
          "Fees vary by network. USDT on Tron costs less than USDT on Ethereum.",
        ],
      },
      {
        heading: "Trading",
        body: [
          "Trading carries a spread, shown in percentage and cash terms on the confirmation screen.",
          "No commission. No monthly fee. No inactivity fee.",
        ],
      },
    ],
  },
  {
    slug: "security",
    title: "Security | Meridian Exchanger",
    description: "How Meridian holds client assets and manages keys.",
    eyebrow: "Security",
    heading: "Security and custody",
    sections: [
      {
        heading: "Pooled custody, separate accounting",
        body: [
          "Client assets are held in pooled wallets rather than one wallet per client. This is standard practice for centralized exchanges.",
          "Each client balance is tracked in an internal double-entry ledger. Pooled reserves back the sum of all client balances and are reconciled continuously.",
        ],
      },
      {
        heading: "Keys are held by a custody provider",
        body: [
          "Private keys are held by a third-party custody provider under multi-party controls. No single employee can move client assets.",
          "Key management is outsourced to a specialist. Hot-wallet compromise is the leading cause of exchange failure.",
        ],
      },
      {
        heading: "The ledger cannot be quietly edited",
        body: [
          "Ledger entries are append-only, enforced at the database level. Corrections are posted as new entries.",
          "A reconciliation job recomputes every balance from the journal and compares it against reserves. Any discrepancy is treated as a P1 incident.",
        ],
      },
      {
        heading: "Account security",
        body: [
          "Passwords are hashed with Argon2id. Sessions are bound to a rotating identifier and expire on password change.",
          "Two-factor authentication is optional and strongly recommended. When it is enabled, every withdrawal requires a fresh code, so a hijacked session cannot move funds on its own.",
        ],
      },
    ],
  },
  {
    slug: "regulatory",
    title: "Regulatory status | Meridian Exchanger",
    description: "Meridian's licensing position, stated at its actual stage.",
    eyebrow: "Regulatory",
    heading: "Regulatory status and compliance",
    sections: [
      {
        heading: "Current position",
        body: [
          "Meridian operates a compliance programme covering customer due diligence, sanctions and politically exposed person screening, transaction monitoring, and record keeping.",
          "Services are offered only in jurisdictions where Meridian holds the required registration. Availability is determined at account opening.",
        ],
      },
      {
        heading: "Know your customer and anti-money-laundering",
        body: [
          "Identity verification is required before an account can move value. Verification runs through a licensed provider with sanctions and PEP screening.",
          "Government identifiers are not stored in full. Meridian retains the provider reference and the last four characters.",
        ],
      },
      {
        heading: "Who we serve",
        body: [
          "Supported and restricted jurisdictions are listed in the account terms and are checked at account opening and on an ongoing basis.",
        ],
      },
    ],
  },
  {
    slug: "about",
    title: "About | Meridian Exchanger",
    description: "What Meridian is and how to reach us.",
    eyebrow: "About",
    heading: "About Meridian Exchanger",
    sections: [
      {
        heading: "What we are building",
        body: [
          "Meridian is a digital asset custody and execution platform. Clients buy, hold, and transfer digital assets across five networks.",
          "The custody model, fee schedule, and compliance programme are published in full.",
        ],
      },
      {
        heading: "Contact",
        body: [
          "Support: support@meridianexchanger.com. We reply within one business day.",
        ],
      },
    ],
  },
  {
    slug: "status",
    title: "System status | Meridian Exchanger",
    description: "Current operational status of Meridian services.",
    eyebrow: "Status",
    heading: "System status",
    sections: [
      {
        heading: "Current status",
        body: [
          "Website: operational. Price feed: operational, refreshing every 10 seconds. Deposits, withdrawals, and transfers: operational.",
          "Incidents affecting client funds or account access are posted here and updated until resolved.",
        ],
      },
    ],
  },
]

export const LEGAL_PAGES: ContentPage[] = [
  {
    slug: "risk",
    title: "Risk disclosure | Meridian Exchanger",
    description: "The risks of holding and trading digital assets.",
    eyebrow: "Legal",
    heading: "Risk disclosure",
    sections: [
      {
        heading: "You can lose everything",
        body: [
          "Digital assets are volatile. You can lose the entire amount you invest. Do not invest more than you can afford to lose.",
          "Past performance does not indicate future results.",
        ],
      },
      {
        heading: "Nothing here is advice",
        body: [
          "Meridian does not provide investment advice and does not assess suitability. All decisions are your own.",
          "No representation is made about the value of any asset or any return.",
        ],
      },
      {
        heading: "Transfers are irreversible",
        body: [
          "Transfers sent to the wrong address or over the wrong network cannot be recovered or reversed.",
          "Several supported assets exist on multiple networks. Verify the network before sending.",
        ],
      },
      {
        heading: "Platform and custody risk",
        body: [
          "Custodied assets carry the operational and security risk of the custodian. Digital assets are not covered by a deposit protection scheme.",
          "Platform access may be interrupted by maintenance, technical failure, or events outside our control.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms of Service | Meridian Exchanger",
    description: "The terms governing use of the Meridian website.",
    eyebrow: "Legal",
    heading: "Terms of Service",
    sections: [
      {
        heading: "Scope",
        body: [
          "These terms cover use of this website. Meridian does not currently offer regulated services, so they do not govern a client relationship.",
          "Separate account terms apply at launch and require explicit acceptance.",
        ],
      },
      {
        heading: "Information on this site",
        body: [
          "Information is provided for general reference. Prices are indicative, drawn from public market data, and are not quotes or offers to transact.",
          "Errors are corrected when identified.",
        ],
      },
      {
        heading: "Governing law",
        body: [
          "These terms are governed by the laws of the State of Delaware, United States, without regard to conflict of law provisions.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy | Meridian Exchanger",
    description: "How Meridian handles personal data.",
    eyebrow: "Legal",
    heading: "Privacy Policy",
    sections: [
      {
        heading: "What this site collects",
        body: [
          "No advertising or analytics trackers. No cookies for signed-out visitors. Fonts, scripts, and stylesheets are served from our own origin.",
          "Server logs record request details including IP address, retained for security and diagnostic purposes.",
        ],
      },
      {
        heading: "Identity data",
        body: [
          "Identity verification is carried out by a licensed provider. Documents and government identifiers are held by that provider. Meridian retains the verification reference and a truncated identifier.",
          "This limits exposure in the event of a breach.",
        ],
      },
      {
        heading: "Your rights",
        body: [
          "Subject to applicable data protection law, you may request access to your personal data, request correction, and object to certain processing. Send requests to the address on the About page.",
        ],
      },
    ],
  },
  {
    slug: "aml",
    title: "AML Policy | Meridian Exchanger",
    description: "Meridian's anti-money-laundering approach.",
    eyebrow: "Legal",
    heading: "Anti-money-laundering policy",
    sections: [
      {
        heading: "Verification",
        body: [
          "Accounts are verified before they can move value. Verification includes government identity document checks plus document and liveness verification.",
          "Accounts are screened against sanctions and politically exposed person lists at onboarding and on an ongoing basis.",
        ],
      },
      {
        heading: "Monitoring and reporting",
        body: [
          "Transactions are monitored for patterns associated with money laundering and terrorist financing. Activity meeting reporting thresholds is reported to the relevant authorities in each jurisdiction.",
          "Accounts may be suspended during an investigation. Meridian is not always permitted to disclose the reason.",
        ],
      },
      {
        heading: "Governance",
        body: [
          "A designated Compliance Officer is responsible for this programme, documented in full as part of the regulatory application.",
        ],
      },
    ],
  },
  {
    slug: "cookies",
    title: "Cookie Policy | Meridian Exchanger",
    description: "How Meridian uses cookies.",
    eyebrow: "Legal",
    heading: "Cookie Policy",
    sections: [
      {
        heading: "What we set",
        body: [
          "No cookies are set for signed-out visitors. No advertising cookies. No analytics cookies.",
          "A single session cookie is set after sign-in. It is strictly necessary and carries no tracking identifier.",
        ],
      },
      {
        heading: "Third parties",
        body: [
          "No third-party content is embedded. Fonts, stylesheets, and scripts are served from our own origin.",
        ],
      },
    ],
  },
]
