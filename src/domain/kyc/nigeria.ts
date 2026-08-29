/**
 * The 36 states plus the Federal Capital Territory, sorted.
 *
 * LGAs are deliberately not modelled here. Nigeria has 774 of them and an
 * inaccurate list in a KYC form is worse than a free text field, because a
 * wrong option silently produces a wrong address. Capture LGA as text until
 * the official dataset is loaded from a verifiable source.
 */
export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "Federal Capital Territory", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano",
  "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun",
  "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe",
  "Zamfara",
] as const
