import { test, expect, describe } from "bun:test"
import { parseRss, relativeTime } from "../../src/domain/rss"

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Bitcoin holds above $77,000]]></title>
<link>https://example.test/a</link><pubDate>Fri, 29 Aug 2026 10:00:00 GMT</pubDate></item>
<item><title>Tether &amp; the naira</title><link>https://example.test/b</link>
<pubDate>Fri, 29 Aug 2026 08:00:00 GMT</pubDate></item>
</channel></rss>`

const ATOM = `<feed><entry><title>Atom headline</title>
<link rel="alternate" href="https://example.test/c"/>
<published>2026-08-29T09:00:00Z</published></entry></feed>`

describe("parseRss", () => {
  test("reads title, link, and date from RSS items", () => {
    const items = parseRss(RSS, "Test")
    expect(items).toHaveLength(2)
    expect(items[0]!.title).toBe("Bitcoin holds above $77,000")
    expect(items[0]!.link).toBe("https://example.test/a")
    expect(items[0]!.publishedAt).toStartWith("2026-08-29T10:00")
    expect(items[0]!.source).toBe("Test")
  })

  test("unwraps CDATA and decodes entities", () => {
    expect(parseRss(RSS, "Test")[1]!.title).toBe("Tether & the naira")
  })

  test("reads Atom entries with the link in an attribute", () => {
    const items = parseRss(ATOM, "Test")
    expect(items).toHaveLength(1)
    expect(items[0]!.link).toBe("https://example.test/c")
  })

  test("skips items with no usable link", () => {
    expect(parseRss(`<rss><item><title>No link</title></item></rss>`, "T")).toHaveLength(0)
  })

  test("rejects a non-http link, so javascript: cannot reach an href", () => {
    const hostile = `<rss><item><title>Bad</title><link>javascript:alert(1)</link></item></rss>`
    expect(parseRss(hostile, "T")).toHaveLength(0)
  })

  test("strips embedded markup from a title", () => {
    const withTags = `<rss><item><title>A &lt;b&gt;bold&lt;/b&gt; claim</title><link>https://x.test/1</link></item></rss>`
    expect(parseRss(withTags, "T")[0]!.title).toBe("A bold claim")
  })

  test("returns nothing for garbage rather than throwing", () => {
    expect(parseRss("not xml at all", "T")).toEqual([])
    expect(parseRss("", "T")).toEqual([])
  })

  test("respects the limit", () => {
    const many = `<rss>${"<item><title>t</title><link>https://x.test/1</link></item>".repeat(50)}</rss>`
    expect(parseRss(many, "T", 5)).toHaveLength(5)
  })

  test("tolerates a missing date", () => {
    const noDate = `<rss><item><title>t</title><link>https://x.test/1</link></item></rss>`
    expect(parseRss(noDate, "T")[0]!.publishedAt).toBeNull()
  })
})

describe("relativeTime", () => {
  const now = new Date("2026-08-29T12:00:00Z")
  test("formats minutes, hours, and days", () => {
    expect(relativeTime("2026-08-29T11:58:00Z", now)).toBe("2m ago")
    expect(relativeTime("2026-08-29T09:00:00Z", now)).toBe("3h ago")
    expect(relativeTime("2026-08-27T12:00:00Z", now)).toBe("2d ago")
  })
  test("says just now for the last minute", () => {
    expect(relativeTime("2026-08-29T11:59:40Z", now)).toBe("just now")
  })
  test("falls back to a date beyond a month", () => {
    expect(relativeTime("2026-01-02T12:00:00Z", now)).toBe("2026-01-02")
  })
  test("returns empty for null or unparseable input", () => {
    expect(relativeTime(null, now)).toBe("")
    expect(relativeTime("nonsense", now)).toBe("")
  })
})
