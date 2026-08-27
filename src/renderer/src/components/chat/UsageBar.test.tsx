import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { usageFill } from './format.js'
import { UsageBar } from './UsageBar.js'

/**
 * jsdom lays nothing out, so the width can only be read off the style it was
 * given. That is the right thing to assert anyway: the number is what the
 * component decides, and how wide it lands is the browser's business.
 */
function fill(): HTMLElement {
  const bar = screen.getByRole('progressbar')
  const inner = bar.firstElementChild
  if (!(inner instanceof HTMLElement)) throw new Error('the bar drew no fill')
  return inner
}

describe('the bar a share is drawn as', () => {
  it('says in words what it draws in colour and length', () => {
    render(<UsageBar kind="limit" label="Current week — 18% used" percentage={18} />)

    // The two things the bar communicates both reach a screen reader through
    // this and through nothing else.
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAccessibleName('Current week — 18% used')
    expect(bar).toHaveAttribute('aria-valuenow', '18')
    expect(fill()).toHaveStyle({ width: '18%' })
  })

  /*
   * The only two assertions here that read a class, and they are about wiring
   * rather than about a look: `usageFill` is what the whole app reads its
   * thresholds through, so what matters is that the bar asks it rather than
   * deciding for itself. Compared against the function, not against a literal —
   * the palette is free to change without this going red over nothing.
   */
  it('takes the colour every other gauge reads as a limit fills', () => {
    render(<UsageBar kind="limit" label="pressing" percentage={94} />)

    expect(fill().className).toContain(usageFill(94))
    expect(usageFill(94)).not.toBe(usageFill(10))
  })

  // A skill accounting for most of a week's usage is a fact, not an alarm, so
  // this one must not follow the thresholds however high the share goes.
  it('stays neutral for a share of something that is not running out', () => {
    render(<UsageBar kind="share" label="core-module — 91%" percentage={91} />)

    expect(fill().className).not.toContain(usageFill(91))
  })

  it('draws nothing past either end of the track', () => {
    const { unmount } = render(<UsageBar kind="limit" label="over" percentage={140} />)
    expect(fill()).toHaveStyle({ width: '100%' })
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    unmount()

    render(<UsageBar kind="limit" label="under" percentage={-3} />)
    expect(fill()).toHaveStyle({ width: '0%' })
  })
})
