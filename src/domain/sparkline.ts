export interface Sparkline {
  /** SVG path `d` for the line. */
  path: string
  /** SVG path `d` for the filled area beneath it. */
  area: string
  width: number
  height: number
  direction: "up" | "down" | "flat"
}

const DEFAULT_WIDTH = 96
const DEFAULT_HEIGHT = 28
const PADDING = 2

/**
 * Server-rendered inline SVG, per spec 6.4. No charting library, no client
 * work, and no layout shift: the element occupies its final size in the
 * first paint.
 *
 * Returns null when there is not enough data to draw an honest line. Drawing
 * a flat line from one point would imply a week of stability we cannot see.
 */
export function buildSparkline(
  prices: number[],
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
): Sparkline | null {
  const clean = prices.filter((n) => Number.isFinite(n))
  if (clean.length < 2) return null

  // Downsample so the path stays small. Roughly one point per two pixels is
  // more than the eye resolves at this size.
  const target = Math.min(clean.length, Math.floor(width / 2))
  const step = clean.length / target
  const points: number[] = []
  for (let i = 0; i < target; i++) {
    points.push(clean[Math.min(clean.length - 1, Math.floor(i * step))]!)
  }
  points.push(clean[clean.length - 1]!)

  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min
  const innerWidth = width - PADDING * 2
  const innerHeight = height - PADDING * 2

  const coords = points.map((value, index) => {
    const x = PADDING + (index / (points.length - 1)) * innerWidth
    // A flat series sits on the centre line rather than collapsing to an edge.
    const ratio = span === 0 ? 0.5 : (value - min) / span
    const y = PADDING + (1 - ratio) * innerHeight
    return [round(x), round(y)] as const
  })

  const path = coords
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x} ${y}`)
    .join(" ")

  const first = coords[0]!
  const last = coords[coords.length - 1]!
  const area = `${path} L${last[0]} ${round(height)} L${first[0]} ${round(height)} Z`

  const opening = points[0]!
  const closing = points[points.length - 1]!
  const direction = closing > opening ? "up" : closing < opening ? "down" : "flat"

  return { path, area, width, height, direction }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
