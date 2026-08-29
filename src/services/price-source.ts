export interface RawPrice {
  usd: number
  change24h: number
  /** Hourly closes over the last week, oldest first. Empty when unavailable. */
  sparkline: number[]
  marketCap: number
  volume24h: number
}

export interface PriceSource {
  fetch(ids: string[]): Promise<Map<string, RawPrice>>
}

/**
 * Our symbols are chain-qualified; CoinGecko ids are not. Every chain variant
 * of a token maps to the same id, which is correct: USDT is USDT whichever
 * chain it settled on.
 */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT_ERC20: "tether",
  USDC_ERC20: "usd-coin",
  TRX: "tron",
  USDT_TRC20: "tether",
  SOL: "solana",
  USDC_SPL: "usd-coin",
  BNB: "binancecoin",
  USDT_BEP20: "tether",
}

// The markets endpoint returns price, 24h change, and a week of hourly closes
// in one call, which is what makes a sparkline affordable.
const ENDPOINT = "https://api.coingecko.com/api/v3/coins/markets"

export class CoinGeckoSource implements PriceSource {
  constructor(private readonly timeoutMs = 5000) {}

  async fetch(ids: string[]): Promise<Map<string, RawPrice>> {
    const url =
      `${ENDPOINT}?vs_currency=usd&sparkline=true&price_change_percentage=24h` +
      `&ids=${encodeURIComponent([...new Set(ids)].join(","))}`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: "application/json" },
    })
    if (!response.ok) {
      throw new Error(`Price source returned ${response.status}`)
    }

    const body = (await response.json()) as Array<{
      id?: string
      current_price?: number
      price_change_percentage_24h?: number
      market_cap?: number
      total_volume?: number
      sparkline_in_7d?: { price?: number[] }
    }>

    const result = new Map<string, RawPrice>()
    for (const row of Array.isArray(body) ? body : []) {
      if (!row.id || typeof row.current_price !== "number") continue
      result.set(row.id, {
        usd: row.current_price,
        change24h: row.price_change_percentage_24h ?? 0,
        sparkline: (row.sparkline_in_7d?.price ?? []).filter(
          (n): n is number => typeof n === "number" && Number.isFinite(n),
        ),
        marketCap: typeof row.market_cap === "number" ? row.market_cap : 0,
        volume24h: typeof row.total_volume === "number" ? row.total_volume : 0,
      })
    }
    return result
  }
}
