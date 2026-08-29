import { test, expect, describe } from "bun:test"
import { buildSparkline } from "../../src/domain/sparkline"

const rising = Array.from({ length: 168 }, (_, i) => 100 + i)
const falling = Array.from({ length: 168 }, (_, i) => 300 - i)

describe("buildSparkline", () => {
  test("returns null for no data", () => {
    expect(buildSparkline([])).toBeNull()
  })

  test("returns null for a single point, rather than implying a flat week", () => {
    expect(buildSparkline([100])).toBeNull()
  })

  test("draws a path from two points", () => {
    const spark = buildSparkline([100, 200])!
    expect(spark.path).toStartWith("M")
    expect(spark.path).toContain("L")
  })

  test("reports direction from first to last close", () => {
    expect(buildSparkline(rising)!.direction).toBe("up")
    expect(buildSparkline(falling)!.direction).toBe("down")
    expect(buildSparkline([100, 150, 100])!.direction).toBe("flat")
  })

  test("keeps every coordinate inside the box", () => {
    const spark = buildSparkline(rising, 96, 28)!
    const numbers = spark.path.match(/-?\d+(\.\d+)?/g)!.map(Number)
    for (let i = 0; i < numbers.length; i += 2) {
      expect(numbers[i]!).toBeGreaterThanOrEqual(0)
      expect(numbers[i]!).toBeLessThanOrEqual(96)
      expect(numbers[i + 1]!).toBeGreaterThanOrEqual(0)
      expect(numbers[i + 1]!).toBeLessThanOrEqual(28)
    }
  })

  test("puts a flat series on the centre line rather than an edge", () => {
    const spark = buildSparkline([100, 100, 100, 100], 96, 28)!
    const ys = [...spark.path.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))
    for (const y of ys) expect(y).toBeCloseTo(14, 0)
  })

  test("closes the area path back to the baseline", () => {
    const spark = buildSparkline(rising)!
    expect(spark.area).toEndWith("Z")
    expect(spark.area).toContain(`L${spark.width - 2} ${spark.height}`)
  })

  test("downsamples so the path stays small", () => {
    const spark = buildSparkline(rising, 96, 28)!
    expect(spark.path.split("L").length).toBeLessThan(60)
  })

  test("ignores non-finite values", () => {
    const spark = buildSparkline([100, Number.NaN, 200, Number.POSITIVE_INFINITY, 150])
    expect(spark).not.toBeNull()
    expect(spark!.path).not.toContain("NaN")
  })

  test("respects a custom size", () => {
    const spark = buildSparkline(rising, 200, 60)!
    expect(spark.width).toBe(200)
    expect(spark.height).toBe(60)
  })
})
