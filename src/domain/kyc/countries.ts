export interface Country {
  code: string
  name: string
  dial: string
}

/**
 * Countries served at launch, ISO 3166-1 alpha-2 with E.164 dial codes.
 * Restricted jurisdictions are excluded from this list rather than filtered
 * later, so an unsupported country cannot be selected at all.
 */
export const COUNTRIES: readonly Country[] = [
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "AR", name: "Argentina", dial: "+54" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "CH", name: "Switzerland", dial: "+41" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "EG", name: "Egypt", dial: "+20" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "GH", name: "Ghana", dial: "+233" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "IE", name: "Ireland", dial: "+353" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KE", name: "Kenya", dial: "+254" },
  { code: "MX", name: "Mexico", dial: "+52" },
  { code: "MY", name: "Malaysia", dial: "+60" },
  { code: "NG", name: "Nigeria", dial: "+234" },
  { code: "NL", name: "Netherlands", dial: "+31" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
  { code: "PH", name: "Philippines", dial: "+63" },
  { code: "PL", name: "Poland", dial: "+48" },
  { code: "PT", name: "Portugal", dial: "+351" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "SE", name: "Sweden", dial: "+46" },
  { code: "SG", name: "Singapore", dial: "+65" },
  { code: "TR", name: "Turkey", dial: "+90" },
  { code: "ZA", name: "South Africa", dial: "+27" },
] as const

export function findCountry(code: string): Country | null {
  return COUNTRIES.find((c) => c.code === code) ?? null
}
