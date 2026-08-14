import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RateLimit, SessionUsage } from '@core/service.js'

import { stubDialogElement } from '../../test/dialog.js'
import { ComposerAttic } from './ComposerAttic.js'

// The `/clear` row asks before it sends, and the question is a `Modal`.
beforeAll(stubDialogElement)

const FULL: SessionUsage = {
  context: { percentage: 48, usedTokens: 48_000, maxTokens: 200_000, model: 'claude-opus-5' },
  subscription: {
    fiveHour: { utilization: 31, resetsAt: null },
    sevenDay: { utilization: 84, resetsAt: null }
  }
}

const NOTHING: SessionUsage = { context: null, subscription: null }

function limitWith(status: RateLimit['status']): RateLimit {
  return { type: 'rate_limit', status, window: 'five_hour', utilization: null, resetsAt: null }
}

function renderAttic(
  usage: SessionUsage = FULL,
  limit: RateLimit | null = null
): { onSend: ReturnType<typeof vi.fn> } {
  const onSend = vi.fn()
  render(<ComposerAttic usage={usage} limit={limit} onSend={onSend} />)

  return { onSend }
}

describe('what the next message is up against', () => {
  it('shows the context share and both windows', () => {
    renderAttic()

    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
    expect(screen.getByText(/5h 31%/)).toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
  })

  // A workspace nobody has spoken to, an API-key session with no plan windows,
  // and a CLI too old to answer all land here. An empty rule above the field
  // would be chrome asserting a measurement exists.
  it('is not there at all when there is nothing to say', () => {
    const { container } = render(<ComposerAttic usage={NOTHING} limit={null} onSend={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('drops the context share on its own without taking the windows with it', () => {
    renderAttic({ ...FULL, context: null })

    expect(screen.queryByText(/Context/)).not.toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
  })

  it('keeps the window that has a share when the other has none', () => {
    renderAttic({
      ...FULL,
      subscription: { fiveHour: null, sevenDay: { utilization: 84, resetsAt: null } }
    })

    expect(screen.queryByText(/5h/)).not.toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
  })

  it('shows the context alone when the account reports no windows', () => {
    renderAttic({ ...FULL, subscription: null })

    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
    expect(screen.queryByText(/Week/)).not.toBeInTheDocument()
  })

  // A refusal says something no percentage can — that the next turn will not
  // run — so it is worth a word. Beside the figures, not over them: covering
  // them was the first attempt and it hid the very numbers the strip is for.
  it('names a refusal without covering the figures', () => {
    renderAttic(FULL, limitWith('rejected'))

    expect(screen.getByText('limit reached')).toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
  })

  // "Close to the limit" is vaguer than "Week 84%", and the colour already says
  // it. A word here would only take the reader's attention off the number.
  it('leaves being close to the limit to the colour', () => {
    renderAttic(FULL, limitWith('allowed_warning'))

    expect(screen.queryByText('close to the limit')).not.toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
  })

  // The percentages come from a pull that an older CLI cannot answer; the
  // refusal comes from an event that every session sends.
  it('names a refusal even when there are no figures at all', () => {
    renderAttic(NOTHING, limitWith('rejected'))

    expect(screen.getByText('limit reached')).toBeInTheDocument()
  })

  it('says nothing extra while everything is fine', () => {
    renderAttic(FULL, limitWith('allowed'))

    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
    expect(screen.queryByText('limit reached')).not.toBeInTheDocument()
  })

  // The raw counts are the one thing the percentage cannot carry, and nobody
  // reads them at a glance — so they wait for a hover.
  it('puts the token counts where they can be read on demand', () => {
    renderAttic()

    expect(screen.getByText(/Context 48%/)).toHaveAttribute('title', 'Context window — 48k of 200k')
  })
})

describe('the way out of a full context window', () => {
  const reading = (): HTMLElement => screen.getByRole('button', { name: /Context 48%/ })

  const open = async (): Promise<void> => {
    await userEvent.click(reading())
  }

  it('offers the two commands that change the reading', async () => {
    renderAttic()
    await open()

    expect(screen.getByRole('menuitem', { name: /\/compact/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /\/clear/ })).toBeInTheDocument()
  })

  /*
   * The names are the CLI's, not ours, and they say what the command is called
   * rather than what it does — "compact" and "clear" are near enough synonyms
   * to anyone who has not met them. The second line is the difference between
   * the two, so it is the part of the row worth asserting.
   */
  it('says what each of them does to the conversation', async () => {
    renderAttic()
    await open()

    expect(
      screen.getByText('The agent keeps a summary of the conversation and carries on.')
    ).toBeInTheDocument()
    expect(
      screen.getByText('The agent forgets this conversation, and the log goes with it.')
    ).toBeInTheDocument()
  })

  // The one that keeps the conversation comes first. A menu whose destructive
  // row is what the eye lands on invites the click it should be slowing down.
  it('puts the command that loses nothing first', async () => {
    renderAttic()
    await open()

    const rows = screen.getAllByRole('menuitem').map((row) => row.textContent)

    expect(rows.findIndex((text) => text.startsWith('/compact'))).toBeLessThan(
      rows.findIndex((text) => text.startsWith('/clear'))
    )
  })

  /*
   * Nothing in this app dispatches a slash command: it goes out as the text of
   * an ordinary message and the CLI on the other end is what reads it. Which is
   * why neither row needs wiring of its own — the service already watches the
   * outgoing text for `/clear`, and the transcript deletion follows from the
   * same path a typed command takes.
   */
  it('sends /compact as the text of an ordinary message', async () => {
    const { onSend } = renderAttic()
    await open()

    await userEvent.click(screen.getByRole('menuitem', { name: /\/compact/ }))

    expect(onSend).toHaveBeenCalledExactlyOnceWith('/compact')
  })

  // The one row of the two that loses something: the log is deleted from disk,
  // not just cleared from the screen. Typing the command asks nothing and still
  // will — the question is here because a menu is reached by a stray click in a
  // way a typed command is not.
  it('asks before it throws the conversation away', async () => {
    const { onSend } = renderAttic()
    await open()

    await userEvent.click(screen.getByRole('menuitem', { name: /\/clear/ }))

    expect(screen.getByText('Clear this conversation?')).toBeInTheDocument()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends nothing when the question is answered no', async () => {
    const { onSend } = renderAttic()
    await open()
    await userEvent.click(screen.getByRole('menuitem', { name: /\/clear/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends /clear once the question is answered yes', async () => {
    const { onSend } = renderAttic()
    await open()
    await userEvent.click(screen.getByRole('menuitem', { name: /\/clear/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onSend).toHaveBeenCalledExactlyOnceWith('/clear')
  })

  // No session has answered yet, so the strip stands on the account's windows
  // alone — and then there is no conversation to clear and no figure to hang
  // the menu off.
  it('offers nothing to click when there is no context reading', () => {
    renderAttic({ ...FULL, context: null })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  // The colour is the measurement, not the control's state. A window at 92% has
  // to stay red while it is pointed at, or using the strip repaints the one
  // thing it exists to say.
  it('keeps the figure’s own tone on the control', async () => {
    renderAttic({
      context: { percentage: 92, usedTokens: 184_000, maxTokens: 200_000, model: 'claude-opus-5' },
      subscription: null
    })

    const control = screen.getByRole('button', { name: /Context 92%/ })
    expect(control).toHaveClass('text-danger')

    // Not repainted by the menu being open either, which is where the pickers
    // below reach for `text-ink` and this one must not.
    await userEvent.click(control)
    expect(control).toHaveClass('text-danger')
  })

  // It stopped being a span. The counts have to survive the change, this
  // tooltip being the only place the raw numbers appear.
  it('still carries the token counts now that it is a button', () => {
    renderAttic()

    expect(reading()).toHaveAttribute('title', 'Context window — 48k of 200k')
  })
})

describe('when the windows come back', () => {
  /*
   * A wall clock has to be read against a clock. Without a fixed "now" a reset
   * two hours away lands on tomorrow whenever the suite runs late in the
   * evening, and the expected string changes with the hour of the run.
   *
   * `Date` alone is faked: the menu tests in this file drive `userEvent`, which
   * needs real timers and hangs rather than failing without them.
   */
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-11T16:00:00+00:00'))
  })

  // `restoreAllMocks` in the shared setup does not put the clock back.
  afterEach(() => {
    vi.useRealTimers()
  })

  const RESETTING: SessionUsage = {
    ...FULL,
    subscription: {
      // `.000000` rather than the measured `.149775`: the microseconds are the
      // shape the CLI sends, but a real fraction pushes `Math.ceil` in the
      // countdown to `3h 51m` beside a visible `22:50` — true, and reading like
      // a bug. The measured sample proves the parse in `format.test.ts`.
      fiveHour: { utilization: 31, resetsAt: '2026-08-11T19:50:00.000000+00:00' },
      sevenDay: { utilization: 84, resetsAt: '2026-08-14T04:00:00.000000+00:00' }
    }
  }

  // The question the strip could not answer: "5h 31%" says how much is gone and
  // nothing about when it comes back.
  it('says what hour the five-hour window resets', () => {
    renderAttic(RESETTING)

    expect(screen.getByText(/5h 31%/)).toHaveTextContent(/^5h 31% · 22:50$/)
  })

  // Days off, so an hour on its own would not say which day it is the hour of.
  it('dates the weekly reset, which an hour alone would not place', () => {
    renderAttic(RESETTING)

    expect(screen.getByText(/Week 84%/)).toHaveTextContent(/^Week 84% · 14\.08 07:00$/)
  })

  // The glance says when, the hover says how long. The countdown is the half
  // that cannot go on the strip: it is worked out as the strip is drawn, and the
  // strip is drawn only when the agent says something.
  it('keeps the countdown in the tooltip where the moment is on the strip', () => {
    renderAttic(RESETTING)

    expect(screen.getByText(/5h 31%/)).toHaveAttribute(
      'title',
      'Five-hour window — resets in 3h 50m'
    )
  })

  // An older CLI answers with a share and no reset at all, and a separator with
  // nothing after it is worse than no separator.
  it('shows the share on its own when the account gives no reset', () => {
    renderAttic(FULL)

    expect(screen.getByText(/5h 31%/)).toHaveTextContent(/^5h 31%$/)
    expect(screen.getByText(/5h 31%/)).toHaveAttribute('title', 'Five-hour window')
  })

  // Nobody has spoken to the agent since the window turned over, so the strip is
  // still showing what the last turn pulled.
  it('drops a moment that has already passed', () => {
    renderAttic({
      ...FULL,
      subscription: {
        fiveHour: { utilization: 100, resetsAt: '2026-08-11T15:00:00+00:00' },
        sevenDay: null
      }
    })

    expect(screen.getByText(/5h 100%/)).toHaveTextContent(/^5h 100%$/)
  })
})
