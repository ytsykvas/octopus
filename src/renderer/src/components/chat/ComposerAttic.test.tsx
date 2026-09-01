import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { RateLimit, SessionUsage } from '@core/service.js'
import type { SkillListing } from '@core/skills.js'

import { stubDialogElement } from '../../test/dialog.js'
import { ComposerAttic } from './ComposerAttic.js'

// The `/clear` row asks before it sends, and the question is a `Modal`.
beforeAll(stubDialogElement)

const FULL: SessionUsage = {
  context: { percentage: 48, usedTokens: 48_000, maxTokens: 200_000, model: 'claude-opus-5' }
}

const NOTHING: SessionUsage = { context: null }

function limitWith(status: RateLimit['status']): RateLimit {
  return { type: 'rate_limit', status, window: 'five_hour', utilization: null, resetsAt: null }
}

function skill(overrides: Partial<SkillListing> = {}): SkillListing {
  return {
    key: 'octopus:review',
    name: 'review',
    description: 'When reviewing.',
    path: '/skills/review',
    scope: 'global',
    enabled: true,
    ...overrides
  }
}

function renderAttic(
  usage: SessionUsage = FULL,
  limit: RateLimit | null = null,
  skills: readonly SkillListing[] = []
): {
  onSend: ReturnType<typeof vi.fn>
  onToggleSkill: ReturnType<typeof vi.fn>
  onRefreshSkills: ReturnType<typeof vi.fn>
  onOpenSettings: ReturnType<typeof vi.fn>
} {
  const onSend = vi.fn()
  const onToggleSkill = vi.fn()
  const onRefreshSkills = vi.fn()
  const onOpenSettings = vi.fn()

  render(
    <ComposerAttic
      usage={usage}
      limit={limit}
      onSend={onSend}
      skills={skills}
      onToggleSkill={onToggleSkill}
      onRefreshSkills={onRefreshSkills}
      onOpenSettings={onOpenSettings}
    />
  )

  return { onSend, onToggleSkill, onRefreshSkills, onOpenSettings }
}

describe('what the next message is up against', () => {
  /*
   * The context share and nothing else about the account. The two subscription
   * windows moved to the foot of the sidebar — they say nothing about this
   * conversation, and `SubscriptionLimits.test` is where they are now.
   */
  it('shows the context share, and no longer the account windows', () => {
    renderAttic()

    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
    expect(screen.queryByText(/5h/)).not.toBeInTheDocument()
    expect(screen.queryByText(/84%/)).not.toBeInTheDocument()
  })

  /*
   * The strip used to disappear entirely here, and that was right while
   * everything on it was a measurement. It carries controls now, and a control
   * that comes and goes with an unrelated reading is worse than a strip that is
   * sometimes half empty — so the reading goes and the strip stays.
   */
  it('keeps its controls when there is no measurement to show', () => {
    renderAttic(NOTHING)

    expect(screen.queryByText(/Context/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skills for this conversation' })).toBeInTheDocument()
  })

  // A refusal says something no percentage can — that the next turn will not
  // run — so it is worth a word. Beside the figures, not over them: covering
  // them was the first attempt and it hid the very numbers the strip is for.
  it('names a refusal without covering the figure', () => {
    renderAttic(FULL, limitWith('rejected'))

    expect(screen.getByText('limit reached')).toBeInTheDocument()
    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
  })

  // "Close to the limit" is vaguer than "Week 84%", and the colour already says
  // it. A word here would only take the reader's attention off the number.
  it('leaves being close to the limit to the colour', () => {
    renderAttic(FULL, limitWith('allowed_warning'))

    expect(screen.queryByText('close to the limit')).not.toBeInTheDocument()
    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
  })

  // The percentages come from a pull that an older CLI cannot answer; the
  // refusal comes from an event that every session sends.
  it('names a refusal even when there are no figures at all', () => {
    renderAttic(NOTHING, limitWith('rejected'))

    expect(screen.getByText('limit reached')).toBeInTheDocument()
  })

  it('says nothing extra while everything is fine', () => {
    renderAttic(FULL, limitWith('allowed'))

    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
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

  // No session has answered yet, so there is no conversation to clear and no
  // figure to hang the menu off. The strip's own controls stay: they are about
  // the next message rather than about a reading that has not arrived.
  it('offers no menu when there is no context reading', () => {
    renderAttic({ ...FULL, context: null })

    expect(screen.queryByRole('button', { name: /Context/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/Context/)).not.toBeInTheDocument()
  })

  // The colour is the measurement, not the control's state. A window at 92% has
  // to stay red while it is pointed at, or using the strip repaints the one
  // thing it exists to say.
  it('keeps the figure’s own tone on the control', async () => {
    renderAttic({
      context: { percentage: 92, usedTokens: 184_000, maxTokens: 200_000, model: 'claude-opus-5' }
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

describe('the controls on the right', () => {
  it('opens the skills panel and asks for a fresh list on the way in', async () => {
    const user = userEvent.setup()
    const { onRefreshSkills } = renderAttic(FULL, null, [skill()])

    await user.click(screen.getByRole('button', { name: 'Skills for this conversation' }))

    expect(onRefreshSkills).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Skills for this conversation' })).toBeInTheDocument()
  })

  it('counts what the conversation may reach for, not what it may not', () => {
    renderAttic(FULL, null, [skill(), skill({ key: 'octopus:ship', name: 'ship', enabled: false })])

    expect(screen.getByRole('button', { name: 'Skills for this conversation' })).toHaveTextContent(
      'Skills1'
    )
  })

  it('says nothing about a count when there are no skills anywhere', () => {
    renderAttic(FULL, null, [])

    expect(screen.getByRole('button', { name: 'Skills for this conversation' })).toHaveTextContent(
      /^Skills$/
    )
  })

  it('switches one, by the key the agent knows it under', async () => {
    const user = userEvent.setup()
    const { onToggleSkill } = renderAttic(FULL, null, [skill()])

    await user.click(screen.getByRole('button', { name: 'Skills for this conversation' }))
    await user.click(screen.getByRole('switch', { name: 'review' }))

    expect(onToggleSkill).toHaveBeenCalledExactlyOnceWith('octopus:review', false)
  })

  /*
   * A control that looks live and does nothing is read as a bug in the app.
   * One that is plainly not ready is read as a plan, so it says so and refuses
   * the click rather than swallowing it.
   */
  it('shows the paperclip as something not wired up yet', () => {
    renderAttic()

    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled()
  })
})
