export const INTERNAL_DECIMALS = 8
export const INTERNAL_SCALE = 10n ** BigInt(INTERNAL_DECIMALS)

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/

export function parseAmount(input: string): bigint {
  const trimmed = input.trim()
  if (trimmed.startsWith("-")) {
    throw new Error(`Amount may not be negative: "${input}"`)
  }
  if (!AMOUNT_PATTERN.test(trimmed)) {
    throw new Error(`Not a valid decimal amount: "${input}"`)
  }

  const [whole = "0", fraction = ""] = trimmed.split(".")
  if (fraction.length > INTERNAL_DECIMALS) {
    throw new Error(
      `Amount has ${fraction.length} decimal places, maximum is ${INTERNAL_DECIMALS}: "${input}"`,
    )
  }

  return BigInt(whole) * INTERNAL_SCALE + BigInt(fraction.padEnd(INTERNAL_DECIMALS, "0") || "0")
}

function split(base: bigint, displayDecimals: number): { whole: bigint; fraction: string } {
  const whole = base / INTERNAL_SCALE
  const fraction = (base % INTERNAL_SCALE).toString().padStart(INTERNAL_DECIMALS, "0")
  return { whole, fraction: fraction.slice(0, displayDecimals) }
}

export function formatBalance(base: bigint, displayDecimals: number): string {
  const { whole, fraction } = split(base, displayDecimals)
  return displayDecimals === 0 ? whole.toString() : `${whole}.${fraction}`
}

export function formatPrice(base: bigint, displayDecimals: number): string {
  const divisor = 10n ** BigInt(INTERNAL_DECIMALS - displayDecimals)
  if (divisor === 1n) return formatBalance(base, displayDecimals)

  const quotient = base / divisor
  const remainder = base % divisor
  const twice = remainder * 2n

  let rounded = quotient
  if (twice > divisor) rounded += 1n
  else if (twice === divisor && quotient % 2n !== 0n) rounded += 1n

  const scale = 10n ** BigInt(displayDecimals)
  const whole = rounded / scale
  const fraction = (rounded % scale).toString().padStart(displayDecimals, "0")
  return displayDecimals === 0 ? whole.toString() : `${whole}.${fraction}`
}

export function fromNative(
  native: bigint,
  nativeDecimals: number,
): { base: bigint; dust: bigint } {
  if (nativeDecimals >= INTERNAL_DECIMALS) {
    const divisor = 10n ** BigInt(nativeDecimals - INTERNAL_DECIMALS)
    return { base: native / divisor, dust: native % divisor }
  }
  const multiplier = 10n ** BigInt(INTERNAL_DECIMALS - nativeDecimals)
  return { base: native * multiplier, dust: 0n }
}

export function isRepresentableAtNative(base: bigint, nativeDecimals: number): boolean {
  if (nativeDecimals >= INTERNAL_DECIMALS) return true
  const divisor = 10n ** BigInt(INTERNAL_DECIMALS - nativeDecimals)
  return base % divisor === 0n
}

export function toNative(base: bigint, nativeDecimals: number): bigint {
  if (nativeDecimals >= INTERNAL_DECIMALS) {
    return base * 10n ** BigInt(nativeDecimals - INTERNAL_DECIMALS)
  }
  if (!isRepresentableAtNative(base, nativeDecimals)) {
    throw new Error(
      `Amount ${base} is not representable at ${nativeDecimals} native decimal places`,
    )
  }
  return base / 10n ** BigInt(INTERNAL_DECIMALS - nativeDecimals)
}
