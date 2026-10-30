/**
 * Anything that changes the day licensing completes lives here, so switching
 * the site to live is one edit rather than a sweep through the views.
 */
export const PRELAUNCH_NOTICE: string | null = null

export interface SectionPage {
  key: string
  href: string
  label: string
}

/** The signed-in sections, in tab order. The tabs and the mobile menu share it. */
export const ACCOUNT_PAGES: SectionPage[] = [
  { key: "overview", href: "/dashboard", label: "Overview" },
  { key: "deposit", href: "/wallet/deposit", label: "Deposit" },
  { key: "withdraw", href: "/wallet/withdraw", label: "Withdraw" },
  { key: "send", href: "/wallet/send", label: "Send" },
  { key: "transactions", href: "/wallet/transactions", label: "Transactions" },
  { key: "account", href: "/account", label: "Account" },
  { key: "verification", href: "/account/verification", label: "Verification" },
  { key: "security", href: "/account/security", label: "Security" },
]

/** The back office sections. Only rendered inside the admin router. */
export const ADMIN_PAGES: SectionPage[] = [
  { key: "overview", href: "/admin", label: "Overview" },
  { key: "users", href: "/admin/users", label: "Users" },
  { key: "withdrawals", href: "/admin/withdrawals", label: "Withdrawals" },
  { key: "deposits", href: "/admin/deposits", label: "Deposits" },
  { key: "kyc", href: "/admin/kyc", label: "Verification" },
  { key: "adjustments", href: "/admin/adjustments", label: "Adjustments" },
]
