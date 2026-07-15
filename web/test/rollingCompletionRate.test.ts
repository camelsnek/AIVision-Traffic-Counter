import { describe, expect, it } from 'vitest'

import { RollingCompletionRate } from '../src/lib/rollingCompletionRate'

describe('RollingCompletionRate', () => {
  it('reports no interval or rate for the first completion', () => {
    const rate = new RollingCompletionRate()

    expect(rate.record(250)).toEqual({ intervalMs: 0, ratePerSecond: 0 })
  })

  it('averages completed samples over monotonic timestamps', () => {
    const rate = new RollingCompletionRate(4)

    rate.record(100)
    expect(rate.record(200)).toEqual({ intervalMs: 100, ratePerSecond: 10 })
    expect(rate.record(350)).toEqual({ intervalMs: 150, ratePerSecond: 8 })
    expect(rate.record(400)).toEqual({ intervalMs: 50, ratePerSecond: 10 })
  })

  it('evicts old completions without changing the fixed window', () => {
    const rate = new RollingCompletionRate(3)

    rate.record(0)
    rate.record(100)
    rate.record(200)
    expect(rate.record(500)).toEqual({ intervalMs: 300, ratePerSecond: 5 })
    expect(rate.record(600)).toEqual({ intervalMs: 100, ratePerSecond: 5 })
  })

  it('rejects invalid windows and non-monotonic timestamps', () => {
    expect(() => new RollingCompletionRate(1)).toThrow('at least 2')

    const rate = new RollingCompletionRate()
    expect(() => rate.record(Number.NaN)).toThrow('finite')
    rate.record(100)
    expect(() => rate.record(100)).toThrow('strictly increasing')
    expect(() => rate.record(99)).toThrow('strictly increasing')
  })
})
