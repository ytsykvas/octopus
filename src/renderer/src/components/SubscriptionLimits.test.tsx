/*
 * What is left of the account, at the foot of the sidebar.
 *
 * Most of this arrived from `ComposerAttic.test`, where the two windows used to
 * be drawn: the questions a reader asks of them did not change when they moved,
 * only where the answers appear. What is new is the staleness rule — the strip
 * used to drop a reset moment that had passed and say nothing, which left a
 * figure from before the window emptied standing as though it were current.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SubscriptionUsage } from '@core/agent.js'

import { SubscriptionLimits } from './SubscriptionLimits.js'

/*
 * A wall clock has to be read against a clock. Without a fixed "now" a reset two
 * hours away lands on tomorrow whenever the suite runs late in the evening, and
 * the expected string changes with the hour of the run.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-11T16:00:00+00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

const BOTH: SubscriptionUsage = {
  // `.000000` rather than a measured fraction: the microseconds are the shape
  // the CLI sends, and a real fraction pushes `Math.ceil` in the countdown to a
  // minute that reads like a bug beside the visible hour.
  fiveHour: { utilization: 31, resetsAt: '2026-08-11T19:50:00.000000+00:00' },
  sevenDay: { utilization: 84, resetsAt: '2026-08-14T04:00:00.000000+00:00' }
}

describe('the account block', () => {
  it('draws a row for each window the account reported', () => {
    render(<SubscriptionLimits usage={BOTH} />)

    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('5h')).toBeInTheDocument()
    expect(screen.getByText('1w')).toBeInTheDocument()
  })

  // The question a percentage cannot answer: "31%" says how much is gone and
  // nothing about when it comes back.
  it('says what hour the five-hour window resets', () => {
    render(<SubscriptionLimits usage={BOTH} />)

    expect(screen.getByText(/31%/)).toHaveTextContent(/^31% · 22:50$/)
  })

  // Days off, so an hour on its own would not say which day it is the hour of.
  it('dates the weekly reset, which an hour alone would not place', () => {
    render(<SubscriptionLimits usage={BOTH} />)

    expect(screen.getByText(/84%/)).toHaveTextContent(/^84% · 14\.08 07:00$/)
  })

  // The glance says when, the hover says how long. The countdown is the half
  // that cannot go on screen: it is worked out as the block is drawn, and the
  // block is drawn only when a turn ends.
  it('keeps the countdown in the tooltip where the moment is on screen', () => {
    render(<SubscriptionLimits usage={BOTH} />)

    expect(screen.getByTitle('resets in 3h 50m')).toBeInTheDocument()
    // `60h`, not `2d 12h`: the countdown does not roll into days, which is fine
    // where it is — a tooltip is read deliberately, and the row beside it
    // already gives the date.
    expect(screen.getByTitle('resets in 60h 0m')).toBeInTheDocument()
  })

  it('leaves out a window the account did not report', () => {
    render(
      <SubscriptionLimits
        usage={{ fiveHour: null, sevenDay: { utilization: 84, resetsAt: null } }}
      />
    )

    expect(screen.queryByText('5h')).not.toBeInTheDocument()
    expect(screen.getByText('1w')).toBeInTheDocument()
  })

  /*
   * Nothing has ever been read, or the account reported neither window. A
   * heading over two empty bars would be the sidebar claiming to know something
   * it does not — and this is the state of a fresh installation, before any
   * turn has run, which is the one case the block cannot fill.
   */
  it('is not there at all with nothing to report', () => {
    const { container } = render(<SubscriptionLimits usage={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('is not there when the account reports two empty windows either', () => {
    const { container } = render(<SubscriptionLimits usage={{ fiveHour: null, sevenDay: null }} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the share on its own when the account gives no reset', () => {
    render(
      <SubscriptionLimits
        usage={{ fiveHour: { utilization: 31, resetsAt: null }, sevenDay: null }}
      />
    )

    expect(screen.getByText(/31%/)).toHaveTextContent(/^31%$/)
  })

  /*
   * `usageTone` paints what is measured, and an hour of the day is not a
   * measurement. Drawn in `danger` beside a share that is also red, the moment
   * would read as the hour being the problem rather than the share.
   *
   * A class assertion, which this suite otherwise avoids: here the colour *is*
   * the decision.
   */
  it('leaves the moment neutral while the share turns red', () => {
    render(
      <SubscriptionLimits
        usage={{
          fiveHour: { utilization: 92, resetsAt: '2026-08-11T19:50:00.000000+00:00' },
          sevenDay: null
        }}
      />
    )

    expect(screen.getByText(/92%/)).toHaveClass('text-danger')
    expect(screen.getByText(/22:50/)).toHaveClass('text-ink-faint')
  })

  // The bar is the one place a calm reading is coloured at all.
  it('fills the bar green while there is room, and red when there is not', () => {
    render(
      <SubscriptionLimits
        usage={{
          fiveHour: { utilization: 31, resetsAt: null },
          sevenDay: { utilization: 84, resetsAt: null }
        }}
      />
    )

    const [five, week] = screen.getAllByRole('progressbar')
    expect(five?.firstElementChild).toHaveClass('bg-success')
    expect(week?.firstElementChild).toHaveClass('bg-danger')
  })

  it('names each bar for whoever cannot see its length', () => {
    render(<SubscriptionLimits usage={BOTH} />)

    expect(screen.getByLabelText('5h window, 31% used')).toBeInTheDocument()
    expect(screen.getByLabelText('1w window, 84% used')).toBeInTheDocument()
  })

  /*
   * Nobody has spoken to the agent since the window turned over, so this is
   * what the last turn pulled and the share is certainly wrong. The strip this
   * replaced dropped the moment and left the figure standing; a stale 100% in
   * red is the sidebar raising an alarm about something that is over.
   */
  it('fades a reading whose window has already reset, and says why', () => {
    render(
      <SubscriptionLimits
        usage={{
          fiveHour: { utilization: 100, resetsAt: '2026-08-11T15:00:00+00:00' },
          sevenDay: null
        }}
      />
    )

    const row = screen.getByTitle(/out of date/i)
    expect(row).toHaveClass('opacity-40')
    expect(row).toHaveTextContent(/100%$/)
  })
})
