import { test, expect, describe, afterEach } from "bun:test"
import { CoinGeckoSource, PriceSourceError } from "../../src/services/price-source"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function capture(status = 200, body: unknown = []) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> })
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as never
  return calls
}

describe("CoinGeckoSource", () => {
  test("sends the demo key header when a key is configured", async () => {
    const calls = capture()
    await new CoinGeckoSource("cg-demo-123").fetch(["bitcoin"])
    expect(calls[0]!.headers["x-cg-demo-api-key"]).toBe("cg-demo-123")
  })

  test("sends no key header when none is configured", async () => {
    const calls = capture()
    await new CoinGeckoSource().fetch(["bitcoin"])
    expect(calls[0]!.headers["x-cg-demo-api-key"]).toBeUndefined()
    expect(calls[0]!.headers.accept).toBe("application/json")
  })

  test("reports the status when the source rate limits", async () => {
    capture(429)
    await expect(new CoinGeckoSource("k").fetch(["bitcoin"])).rejects.toBeInstanceOf(
      PriceSourceError,
    )
  })
})
