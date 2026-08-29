import { parseRss, type NewsItem } from "../domain/rss"

export interface NewsSource {
  fetchAll(): Promise<NewsItem[]>
}

const FEEDS: Array<{ url: string; source: string }> = [
  { url: "https://cointelegraph.com/rss", source: "Cointelegraph" },
  { url: "https://decrypt.co/feed", source: "Decrypt" },
]

export class RssNewsSource implements NewsSource {
  constructor(private readonly timeoutMs = 6000) {}

  async fetchAll(): Promise<NewsItem[]> {
    const results = await Promise.allSettled(
      FEEDS.map(async ({ url, source }) => {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { accept: "application/rss+xml, application/xml, text/xml" },
        })
        if (!response.ok) throw new Error(`${source} returned ${response.status}`)
        return parseRss(await response.text(), source)
      }),
    )
    // One dead feed must not take the strip down.
    return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
  }
}

export class StaticNewsSource implements NewsSource {
  constructor(private readonly items: NewsItem[]) {}
  async fetchAll(): Promise<NewsItem[]> {
    return this.items
  }
}

const DEFAULT_TTL_MS = 5 * 60_000

export class NewsFeed {
  private items: NewsItem[] = []
  private fetchedAt = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly source: NewsSource,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly limit = 20,
  ) {}

  snapshot(): NewsItem[] {
    return this.items
  }

  async refresh(): Promise<void> {
    if (this.items.length > 0 && Date.now() - this.fetchedAt < this.ttlMs) return

    let fetched: NewsItem[]
    try {
      fetched = await this.source.fetchAll()
    } catch (error) {
      console.error(JSON.stringify({ msg: "news_refresh_failed", error: String(error) }))
      return
    }
    if (fetched.length === 0) return

    // Newest first, undated last, interleaved across sources by time.
    this.items = fetched
      .slice()
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .slice(0, this.limit)
    this.fetchedAt = Date.now()
  }

  start(): void {
    if (this.timer) return
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), this.ttlMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
