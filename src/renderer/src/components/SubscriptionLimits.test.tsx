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
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UsageLimit, UsageWindows } from '@core/usage.js'

import type { SubscriptionController } from '../hooks/useSubscriptionUsage.js'
import { SubscriptionLimits } from './SubscriptionLimits.js'

/** The controller as `Sidebar` hands it over, holding whatever a test says. */
function controller(overrides: Partial<SubscriptionController> = {}): SubscriptionController {
  return { usage: null, busy: false, outcome: 'unread', refresh: vi.fn(), ...overrides }
}

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

/** One window, as the account reports it. */
function window(
  key: UsageLimit['key'],
  utilization: number,
  resetsAt: string | null = null,
  label: string | null = null
): UsageLimit {
  return { key, label, utilization, resetsAt }
}

/** A reading of exactly these windows. */
function reading(limits: UsageLimit[]): UsageWindows {
  return { limits, limitsApply: true, readAt: '2026-08-11T16:00:00.000Z' }
}

// `.000000` rather than a measured fraction: the microseconds are the shape the
// CLI sends, and a real fraction pushes `Math.ceil` in the countdown to a
// minute that reads like a bug beside the visible hour.
const BOTH = reading([
  window('five_hour', 31, '2026-08-11T19:50:00.000000+00:00'),
  window('seven_day', 84, '2026-08-14T04:00:00.000000+00:00')
])

describe('the account block', () => {
  it('draws a row for each window the account reported', () => {
    render(<SubscriptionLimits subscription={controller({ usage: BOTH })} />)

    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('5h')).toBeInTheDocument()
    expect(screen.getByText('1w')).toBeInTheDocument()
  })

  /*
   * Every window the answer carried, not two of them. The block used to keep
   * `five_hour` and `seven_day` and drop the rest, so an account with a weekly
   * window per model had it named by the `/usage` card and missing here — out
   * of one and the same reading.
   */
  it('draws the windows beyond the two it used to', () => {
    render(
      <SubscriptionLimits
        subscription={controller({
          usage: reading([
            window('five_hour', 31),
            window('seven_day_opus', 12),
            window('model_scoped', 15, null, 'Fable')
          ])
        })}
      />
    )

    expect(screen.getByText('5h')).toBeInTheDocument()
    expect(screen.getByText('1w Opus')).toBeInTheDocument()
    // The server names this one itself, and the row says which week it is about.
    expect(screen.getByText('1w Fable')).toBeInTheDocument()
  })

  // The server sends the key without a name on an account it has none for.
  it('falls back to a name of ours when the server sent none', () => {
    render(
      <SubscriptionLimits
        subscription={controller({ usage: reading([window('model_scoped', 15)]) })}
      />
    )

    expect(screen.getByText('1w per model')).toBeInTheDocument()
  })

  // The question a percentage cannot answer: "31%" says how much is gone and
  // nothing about when it comes back.
  it('says what hour the five-hour window resets', () => {
    render(<SubscriptionLimits subscription={controller({ usage: BOTH })} />)

    expect(screen.getByText(/31%/)).toHaveTextContent(/^31% · 22:50$/)
  })

  // Days off, so an hour on its own would not say which day it is the hour of.
  it('dates the weekly reset, which an hour alone would not place', () => {
    render(<SubscriptionLimits subscription={controller({ usage: BOTH })} />)

    expect(screen.getByText(/84%/)).toHaveTextContent(/^84% · 14\.08 07:00$/)
  })

  // The glance says when, the hover says how long. The countdown is the half
  // that cannot go on screen: it is worked out as the block is drawn, and the
  // block is drawn only when a turn ends.
  it('keeps the countdown in the tooltip where the moment is on screen', () => {
    render(<SubscriptionLimits subscription={controller({ usage: BOTH })} />)

    expect(screen.getByTitle('resets in 3h 50m')).toBeInTheDocument()
    // `60h`, not `2d 12h`: the countdown does not roll into days, which is fine
    // where it is — a tooltip is read deliberately, and the row beside it
    // already gives the date.
    expect(screen.getByTitle('resets in 60h 0m')).toBeInTheDocument()
  })

  it('leaves out a window the account did not report', () => {
    render(
      <SubscriptionLimits
        subscription={controller({
          usage: reading([window('seven_day', 84)])
        })}
      />
    )

    expect(screen.queryByText('5h')).not.toBeInTheDocument()
    expect(screen.getByText('1w')).toBeInTheDocument()
  })

  /*
   * Nothing has ever been read. Two empty bars would be the sidebar claiming to
   * know something it does not, and nothing at all would leave no way to ask —
   * so it says what it is and offers the press that fills it. This is the state
   * of a fresh installation, before any turn has run.
   */
  it('asks to be pressed while it has nothing to draw', () => {
    render(<SubscriptionLimits subscription={controller({ usage: null })} />)

    expect(screen.getByText(/press to ask/i)).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says the same when the account reports two empty windows', () => {
    render(<SubscriptionLimits subscription={controller({ usage: reading([]) })} />)

    expect(screen.getByText(/press to ask/i)).toBeInTheDocument()
  })

  /*
   * Nothing fills this on its own: answering costs a session, and the service
   * refuses to spawn one for a gauge nobody requested. The press is the request
   * — which is the whole reason there is a control here rather than a timer.
   */
  it('asks the account when the control is pressed', async () => {
    const refresh = vi.fn(() => Promise.resolve())
    render(<SubscriptionLimits subscription={controller({ refresh })} />)

    await userEvent.click(screen.getByRole('button', { name: /read the limits/i }))

    expect(refresh).toHaveBeenCalled()
  })

  // Starting a session takes a moment, and a second press would start a second.
  it('will not be pressed twice while it is reading', () => {
    render(<SubscriptionLimits subscription={controller({ busy: true })} />)

    expect(screen.getByRole('button', { name: /read the limits/i })).toBeDisabled()
  })

  /*
   * A press that found no conversation to ask through. A session runs in a
   * worktree, so an installation with no workspace has nowhere to start one —
   * and no amount of waiting fixes it, which is why it says something different
   * from "not read yet".
   */
  it('says when there was nowhere to ask', () => {
    render(<SubscriptionLimits subscription={controller({ outcome: 'nowhereToAsk' })} />)

    expect(screen.getByText(/open a workspace first/i)).toBeInTheDocument()
    expect(screen.queryByText(/press to ask/i)).not.toBeInTheDocument()
  })

  /*
   * The three the block used to get wrong, each said in its own words. A read
   * that failed looked like a fresh reading, and an account with no plan was
   * told to open a workspace.
   */
  it.each([
    { outcome: 'noPlan' as const, says: /no plan windows/i },
    { outcome: 'failed' as const, says: /did not answer/i },
    { outcome: 'read' as const, says: /reported no windows/i }
  ])('says why it has nothing when the answer was $outcome', ({ outcome, says }) => {
    render(<SubscriptionLimits subscription={controller({ outcome })} />)

    expect(screen.getByText(says)).toBeInTheDocument()
  })

  it('shows the share on its own when the account gives no reset', () => {
    render(
      <SubscriptionLimits
        subscription={controller({
          usage: reading([window('five_hour', 31)])
        })}
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
        subscription={controller({
          usage: reading([window('five_hour', 92, '2026-08-11T19:50:00.000000+00:00')])
        })}
      />
    )

    expect(screen.getByText(/92%/)).toHaveClass('text-danger')
    expect(screen.getByText(/22:50/)).toHaveClass('text-ink-faint')
  })

  // The bar is the one place a calm reading is coloured at all.
  it('fills the bar green while there is room, and red when there is not', () => {
    render(
      <SubscriptionLimits
        subscription={controller({
          usage: reading([window('five_hour', 31), window('seven_day', 84)])
        })}
      />
    )

    const [five, week] = screen.getAllByRole('progressbar')
    expect(five?.firstElementChild).toHaveClass('bg-success')
    expect(week?.firstElementChild).toHaveClass('bg-danger')
  })

  it('names each bar for whoever cannot see its length', () => {
    render(<SubscriptionLimits subscription={controller({ usage: BOTH })} />)

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
        subscription={controller({
          usage: reading([window('five_hour', 100, '2026-08-11T15:00:00+00:00')])
        })}
      />
    )

    const row = screen.getByTitle(/out of date/i)
    expect(row).toHaveClass('opacity-40')
    expect(row).toHaveTextContent(/100%$/)
  })
})
