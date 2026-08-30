import type { CustodyService } from "./custody"

const DEFAULT_INTERVAL_MS = 30_000

/**
 * Deposits confirm on their own schedule, so nothing user-facing can be the
 * trigger for crediting them. This runs regardless of whether anyone is
 * looking at the page.
 */
export class DepositPoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(
    private readonly custody: CustodyService,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  async tick(): Promise<void> {
    // A slow pass must not overlap the next one and credit twice. The ledger
    // is idempotent, but doubling provider load for nothing is still wrong.
    if (this.running) return
    this.running = true
    try {
      const { credited, confirming } = await this.custody.pollAndCredit()
      if (credited > 0 || confirming > 0) {
        console.log(JSON.stringify({ msg: "deposit_poll", credited, confirming }))
      }
    } catch (error) {
      console.error(JSON.stringify({ msg: "deposit_poll_failed", error: String(error) }))
    } finally {
      this.running = false
    }
  }

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
