import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PROJECT_ICONS } from '@core/icons.js'

import { ProjectGlyph } from './ProjectGlyph.js'

/**
 * Which drawing came out, read from the class lucide stamps on its svg.
 *
 * The exception to "never query by class": an svg has no role, no name and no
 * text, so the class is the only handle on which picture was rendered — it is
 * identity here rather than styling.
 */
function drawing(container: HTMLElement): string {
  const svg = container.querySelector('svg')
  if (!svg) throw new Error('Nothing was drawn')

  return svg.getAttribute('class') ?? ''
}

describe('ProjectGlyph', () => {
  // The map is typed, so a missing id fails the type check. What the types
  // cannot see is the same component pasted under two ids — which would put
  // the same picture twice in the picker and make one of them a dead choice.
  it('draws a different picture for every icon', () => {
    const seen = new Map<string, string>()

    for (const icon of PROJECT_ICONS) {
      const { container, unmount } = render(<ProjectGlyph name={icon} size={16} />)
      const drawn = drawing(container)
      unmount()

      const twin = seen.get(drawn)
      expect(twin, `${icon} draws the same picture as ${twin ?? ''}`).toBeUndefined()
      seen.set(drawn, icon)
    }

    expect(seen.size).toBe(PROJECT_ICONS.length)
  })

  it('draws at the size it is asked for', () => {
    const { container } = render(<ProjectGlyph name="rocket" size={24} />)

    expect(container.querySelector('svg')).toHaveAttribute('width', '24')
  })

  // Every place it appears is already named — the tab by its project, the
  // picker cell by the icon it offers — so a second name would be read twice.
  it('stays out of the accessibility tree', () => {
    const { container } = render(<ProjectGlyph name="rocket" size={16} />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
