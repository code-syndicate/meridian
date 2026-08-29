export interface RawPrice {
  usd: number
  change24h: number
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

const ENDPOINT = "https://api.coingecko.com/api/v3/simple/price"

export class CoinGeckoSource implements PriceSource {
  constructor(private readonly timeoutMs = 5000) {}

  async fetch(ids: string[]): Promise<Map<string, RawPrice>> {
    const url = `${ENDPOINT}?ids=${encodeURIComponent(
      [...new Set(ids)].join(","),
    )}&vs_currencies=usd&include_24hr_change=true`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { accept: "application/json" },
    })
    if (!response.ok) {
      throw new Error(`Price source returned ${response.status}`)
    }

    const body = (await response.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number }
    >

    const result = new Map<string, RawPrice>()
    for (const [id, value] of Object.entries(body)) {
      if (typeof value.usd !== "number") continue
      result.set(id, { usd: value.usd, change24h: value.usd_24h_change ?? 0 })
    }
    return result
  }
}
