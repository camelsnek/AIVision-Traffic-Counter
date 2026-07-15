export interface CompletionRateSample {
  intervalMs: number
  ratePerSecond: number
}

/** Fixed-memory rolling rate calculated from monotonic completion timestamps. */
export class RollingCompletionRate {
  private readonly timestamps: Float64Array
  private count = 0
  private nextIndex = 0
  private lastTimestamp: number | null = null

  constructor(windowSize = 16) {
    if (!Number.isInteger(windowSize) || windowSize < 2) {
      throw new Error('Completion-rate window size must be an integer of at least 2.')
    }
    this.timestamps = new Float64Array(windowSize)
  }

  record(timestampMs: number): CompletionRateSample {
    if (!Number.isFinite(timestampMs)) {
      throw new Error('Completion timestamp must be finite.')
    }
    if (this.lastTimestamp !== null && timestampMs <= this.lastTimestamp) {
      throw new Error('Completion timestamps must be strictly increasing.')
    }

    const intervalMs = this.lastTimestamp === null ? 0 : timestampMs - this.lastTimestamp
    this.lastTimestamp = timestampMs

    this.timestamps[this.nextIndex] = timestampMs
    this.nextIndex = (this.nextIndex + 1) % this.timestamps.length
    this.count = Math.min(this.count + 1, this.timestamps.length)

    if (this.count < 2) {
      return { intervalMs, ratePerSecond: 0 }
    }

    const oldestIndex = this.count < this.timestamps.length ? 0 : this.nextIndex
    const elapsedMs = timestampMs - this.timestamps[oldestIndex]
    return {
      intervalMs,
      ratePerSecond: ((this.count - 1) * 1000) / elapsedMs,
    }
  }
}
