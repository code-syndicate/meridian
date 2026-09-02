import { test, expect, describe } from "bun:test"
import { DepositPoller } from "../../src/services/deposit-poller"

function fakeCustody(behaviour: () => Promise<{ credited: number; confirming: number }>) {
  let calls = 0
  return {
    service: { pollAndCredit: async () => { calls++; return behaviour() } },
    get calls() { return calls },
  }
}

describe("deposit poller", () => {
  test("credits on a tick without anyone opening a page", async () => {
    const fake = fakeCustody(async () => ({ credited: 2, confirming: 1 }))
    await new DepositPoller(fake.service as never).tick()
    expect(fake.calls).toBe(1)
  })

  test("a provider outage does not stop the next tick", async () => {
    let first = true
    const fake = fakeCustody(async () => {
      if (first) { first = false; throw new Error("provider down") }
      return { credited: 1, confirming: 0 }
    })
    const poller = new DepositPoller(fake.service as never)
    await poller.tick()
    await poller.tick()
    expect(fake.calls).toBe(2)
  })

  test("a slow pass does not overlap the next one", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fake = fakeCustody(async () => { await gate; return { credited: 0, confirming: 0 } })
    const poller = new DepositPoller(fake.service as never)
    const inflight = poller.tick()
    await poller.tick()
    expect(fake.calls).toBe(1)
    release()
    await inflight
  })

  test("stop is safe before start", async () => {
    expect(() => new DepositPoller({} as never).stop()).not.toThrow()
  })
})
