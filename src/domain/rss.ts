export interface NewsItem {
  title: string
  link: string
  source: string
  publishedAt: string | null
}

function decodeEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#8217;/g, "’")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"))
  return match ? decodeEntities(match[1]!) : null
}

/**
 * Minimal RSS 2.0 and Atom reader. A dependency for this would be a whole
 * XML parser to pull three fields out of a document we do not control, so it
 * is written defensively instead: anything malformed is skipped, never thrown.
 */
export function parseRss(xml: string, source: string, limit = 12): NewsItem[] {
  const items: NewsItem[] = []
  const blocks = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/gi) ?? []

  for (const block of blocks) {
    const title = tag(block, "title")
    let link = tag(block, "link")
    // Atom puts the URL in an attribute rather than in the element body.
    if (!link || !/^https?:/i.test(link)) {
      link = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] ?? null
    }
    if (!title || !link || !/^https?:\/\//i.test(link)) continue

    const raw = tag(block, "pubDate") ?? tag(block, "published") ?? tag(block, "updated")
    const parsed = raw ? new Date(raw) : null
    const publishedAt =
      parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null

    items.push({ title, link, source, publishedAt })
    if (items.length >= limit) break
  }
  return items
}

/** "3h ago". Absolute timestamps are noise in a headline list. */
export function relativeTime(iso: string | null, now = new Date()): string {
  if (!iso) return ""
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ""
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : then.toISOString().slice(0, 10)
}
