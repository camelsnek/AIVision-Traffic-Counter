import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { FlowChart } from '../src/components/FlowChart'
import type { CountEvent, Direction } from '../src/types'

function crossing(seq: number, direction: Direction, videoTime: number): CountEvent {
  return {
    seq,
    trackId: seq,
    zoneId: 'zone-1',
    vehicleClass: 'car',
    direction,
    videoTime,
  }
}

describe('FlowChart', () => {
  it('renders horizontal directions as separate series with a shared scale', () => {
    const markup = renderToStaticMarkup(
      <FlowChart
        durationSeconds={10}
        events={[crossing(1, 'down', 1), crossing(2, 'down', 2), crossing(3, 'up', 3)]}
      />,
    )

    expect(markup).toContain('5s buckets · directional peak 2')
    expect(markup).toContain('data-direction="down"')
    expect(markup).toContain('data-direction="up"')
    expect(markup).toContain('2 downward crossings')
    expect(markup).toContain('1 upward crossing')
    expect(markup).toContain('↓ Down')
    expect(markup).toContain('↑ Up')
  })

  it('keeps the opposite direction visible when its count is zero', () => {
    const markup = renderToStaticMarkup(<FlowChart durationSeconds={10} events={[crossing(1, 'down', 1)]} />)

    expect(markup).toContain('↓ Down')
    expect(markup).toContain('↑ Up')
    expect(markup).not.toContain('upward crossing')
  })

  it('shows all four series when horizontal and vertical zones contribute events', () => {
    const markup = renderToStaticMarkup(
      <FlowChart
        durationSeconds={10}
        events={[
          crossing(1, 'down', 1),
          crossing(2, 'up', 2),
          crossing(3, 'left', 3),
          crossing(4, 'right', 4),
        ]}
      />,
    )

    for (const direction of ['down', 'up', 'left', 'right']) {
      expect(markup).toContain(`data-direction="${direction}"`)
    }
    expect(markup).toContain('← Left')
    expect(markup).toContain('→ Right')
  })
})
