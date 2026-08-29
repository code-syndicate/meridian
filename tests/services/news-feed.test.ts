import { test, expect, describe, beforeEach } from "bun:test"
import { NewsFeed, StaticNewsSource, type NewsSource } from "../../src/services/news-feed"
import type { NewsItem } from "../../src/domain/rss"

function item(title: string, iso: string | null, source = "A"): NewsItem {
  return { title, link: `https://x.test/${title}`, source, publishedAt: iso }
}

class Failing implements NewsSource {
  async fetchAll(): Promise<NewsItem[]> { throw new Error("down") }
}

let feed: NewsFeed

beforeEach(() => {
  feed = new NewsFeed(
    new StaticNewsSource([
      item("old", "2026-08-01T00:00:00Z"),
      item("new", "2026-08-29T00:00:00Z"),
      item("mid", "2026-08-15T00:00:00Z"),
    ]),
  )
})

describe("NewsFeed", () => {
  test("is empty before the first refresh", () => {
    expect(feed.snapshot()).toEqual([])
  })

  test("sorts newest first", async () => {
    await feed.refresh()
    expect(feed.snapshot().map((i) => i.title)).toEqual(["new", "mid", "old"])
  })

  test("caches within the ttl", async () => {
    let calls = 0
    const counting: NewsSource = {
      async fetchAll() { calls++; return [item("a", null)] },
    }
    const cached = new NewsFeed(counting)
    await cached.refresh()
    await cached.refresh()
    expect(calls).toBe(1)
  })

  test("keeps the last good snapshot when the source fails", async () => {
    await feed.refresh()
    const before = feed.snapshot().length
    const flaky = new NewsFeed(new Failing(), 0)
    await flaky.refresh()
    expect(feed.snapshot()).toHaveLength(before)
  })

  test("does not throw when the source fails", async () => {
    expect(new NewsFeed(new Failing()).refresh()).resolves.toBeUndefined()
  })

  test("stays empty if the very first fetch fails", async () => {
    const dead = new NewsFeed(new Failing())
    await dead.refresh()
    expect(dead.snapshot()).toEqual([])
  })

  test("ignores an empty result rather than blanking a good snapshot", async () => {
    await feed.refresh()
    const empty = new NewsFeed(new StaticNewsSource([]), 0)
    await empty.refresh()
    expect(feed.snapshot().length).toBeGreaterThan(0)
  })

  test("respects the limit", async () => {
    const many = Array.from({ length: 40 }, (_, i) => item(`t${i}`, null))
    const capped = new NewsFeed(new StaticNewsSource(many), 60_000, 8)
    await capped.refresh()
    expect(capped.snapshot()).toHaveLength(8)
  })
})
