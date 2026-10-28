import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { ContextUsage } from '@core/agent.js'
import type { AutoCompactView } from '@core/autoCompact.js'
import type { RateLimit, SessionUsage } from '@core/service.js'
import type { SkillListing } from '@core/skills.js'

import { stubDialogElement } from '../../test/dialog.js'
import { ownSkill } from '../../test/skills.js'
import { ComposerAttic } from './ComposerAttic.js'

// The `/clear` row asks before it sends, and the question is a `Modal`.
beforeAll(stubDialogElement)

const FULL: SessionUsage = {
  context: {
    percentage: 48,
    usedTokens: 48_000,
    maxTokens: 200_000,
    compactsAt: null,
    autoCompactOn: null,
    model: 'claude-opus-5',
    modelWindow: null
  },
  autoCompact: null
}

const NOTHING: SessionUsage = { context: null, autoCompact: null }

function limitWith(status: RateLimit['status']): RateLimit {
  return { type: 'rate_limit', status, window: 'five_hour', utilization: null, resetsAt: null }
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
  onAttach: ReturnType<typeof vi.fn>
  onAutoCompact: ReturnType<typeof vi.fn>
} {
  const onSend = vi.fn()
  const onToggleSkill = vi.fn()
  const onRefreshSkills = vi.fn()
  const onOpenSettings = vi.fn()
  const onAttach = vi.fn()
  const onAutoCompact = vi.fn()

  render(
    <ComposerAttic
      usage={usage}
      limit={limit}
      onSend={onSend}
      skills={skills}
      onToggleSkill={onToggleSkill}
      onRefreshSkills={onRefreshSkills}
      onOpenSettings={onOpenSettings}
      onAttach={onAttach}
      onAutoCompact={onAutoCompact}
    />
  )

  return { onSend, onToggleSkill, onRefreshSkills, onOpenSettings, onAttach, onAutoCompact }
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
      context: {
        percentage: 92,
        usedTokens: 184_000,
        maxTokens: 200_000,
        compactsAt: null,
        autoCompactOn: null,
        model: 'claude-opus-5',
        modelWindow: null
      },
      autoCompact: null
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
    const { onRefreshSkills } = renderAttic(FULL, null, [ownSkill()])

    await user.click(screen.getByRole('button', { name: 'Skills for this conversation' }))

    expect(onRefreshSkills).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Skills for this conversation' })).toBeInTheDocument()
  })

  it('counts what the conversation may reach for, not what it may not', () => {
    renderAttic(FULL, null, [
      ownSkill(),
      ownSkill({ key: 'octopus:ship', name: 'ship', enabled: false })
    ])

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
    const { onToggleSkill } = renderAttic(FULL, null, [ownSkill()])

    await user.click(screen.getByRole('button', { name: 'Skills for this conversation' }))
    await user.click(screen.getByRole('switch', { name: 'review' }))

    expect(onToggleSkill).toHaveBeenCalledExactlyOnceWith('review', false)
  })

  /* The visible one of three ways in: a file is more often dragged onto the
     composer or pasted into it, and neither of those can be seen. */
  it('opens the file dialog from the paperclip', async () => {
    const user = userEvent.setup()
    const { onAttach } = renderAttic()

    await user.click(screen.getByRole('button', { name: 'Attach files' }))

    expect(onAttach).toHaveBeenCalledOnce()
  })
})

/*
 * Where the conversation compacts, chosen in the same menu as the two commands
 * that act on a full window. A choice among six, so the rows are radios — and
 * shown even when they cannot be used, with the reason, because a menu whose
 * rows come and go is harder to learn than one where they are visibly greyed.
 */
describe('where the conversation compacts', () => {
  const view = (overrides: Partial<AutoCompactView> = {}): SessionUsage => ({
    ...FULL,
    autoCompact: {
      chosen: null,
      effective: 1_000_000,
      modelWindow: 1_000_000,
      override: null,
      pending: false,
      settled: false,
      ...overrides
    }
  })

  const open = async (): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: /Context 48%/ }))
  }

  it('offers the agent’s own and five windows, the current one ticked', async () => {
    renderAttic(view())
    await open()

    const radios = screen.getAllByRole('menuitemradio')
    expect(radios.map((radio) => radio.textContent)).toEqual([
      expect.stringMatching(/^Auto/),
      expect.stringMatching(/^300k/),
      expect.stringMatching(/^400k/),
      expect.stringMatching(/^500k/),
      expect.stringMatching(/^600k/),
      expect.stringMatching(/^800k/)
    ])
    expect(screen.getByRole('menuitemradio', { name: /^Auto/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    // What "auto" amounts to right now, which is only known while it is the
    // choice: the window then in force is the agent's own.
    expect(screen.getByText('As Claude Code decides — now 1M')).toBeInTheDocument()
    expect(
      screen.getByText(
        'When this conversation is compacted on its own. A change starts the session again; the conversation is kept.'
      )
    ).toBeInTheDocument()
  })

  it('hands the choice up, and back to the agent', async () => {
    const { onAutoCompact } = renderAttic(view({ chosen: 500_000, effective: 500_000 }))
    await open()
    expect(screen.getByRole('menuitemradio', { name: /^500k/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    // Not knowable once something else is chosen, so it is not claimed.
    expect(screen.getByText('As Claude Code decides')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('menuitemradio', { name: /^300k/ }))
    expect(onAutoCompact).toHaveBeenLastCalledWith(300_000)

    await open()
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^Auto/ }))
    expect(onAutoCompact).toHaveBeenLastCalledWith(null)
  })

  // The agent cuts a window down to what the model holds, so a choice above it
  // would look taken and change nothing.
  it('greys the windows the model cannot hold, and says why', async () => {
    renderAttic(view({ effective: 200_000, modelWindow: 200_000 }))
    await open()

    for (const name of [/^300k/, /^800k/]) {
      expect(screen.getByRole('menuitemradio', { name })).toBeDisabled()
    }
    expect(screen.getAllByText('More than this model holds (200k)')).toHaveLength(5)
    expect(screen.getByRole('menuitemradio', { name: /^Auto/ })).toBeEnabled()
  })

  it('offers every window while what the model holds is not yet known', async () => {
    renderAttic(view({ modelWindow: null }))
    await open()

    expect(screen.getByRole('menuitemradio', { name: /^800k/ })).toBeEnabled()
    expect(screen.queryByText(/More than this model holds/)).not.toBeInTheDocument()
  })

  /*
   * The variable outranks anything a session is told, measured, and nothing
   * here can change that — so the note says which variable, set where, and
   * what to do. The rows stay choosable: the variable is read when a session
   * starts, and a choice is what starts one to notice it has gone.
   */
  it('names the variable that decides instead, and leaves the choice open', async () => {
    const { onAutoCompact } = renderAttic(
      view({
        chosen: 300_000,
        effective: 450_000,
        override: { value: '450000', from: '~/.claude/settings.json' }
      })
    )
    await open()

    expect(
      screen.getByText(
        'CLAUDE_CODE_AUTO_COMPACT_WINDOW=450000 in ~/.claude/settings.json decides instead. Take it out there, then choose here again.'
      )
    ).toHaveClass('text-warning')
    for (const radio of screen.getAllByRole('menuitemradio')) expect(radio).toBeEnabled()

    // The same window again is a real request: it is what looks again.
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^300k/ }))
    expect(onAutoCompact).toHaveBeenCalledWith(300_000)
  })

  it('says so when the variable comes from the environment', async () => {
    renderAttic(view({ effective: 400_000, override: { value: '400000', from: null } }))
    await open()

    expect(
      screen.getByText(
        'CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000 in the environment decides instead. Take it out there, then choose here again.'
      )
    ).toBeInTheDocument()
  })

  // Chosen mid-turn: the session starts again only once nothing is in flight.
  it('says a choice waits for the agent to finish', async () => {
    renderAttic(view({ chosen: 600_000, effective: 1_000_000, pending: true }))
    await open()

    expect(
      screen.getByText('Takes effect with the next message, once the agent has finished.')
    ).not.toHaveClass('text-warning')
  })

  // The tick and the measurement disagreeing is said rather than left silent.
  it('says when the window in force is not the one chosen', async () => {
    renderAttic(view({ chosen: 300_000, effective: 200_000, modelWindow: null }))
    await open()

    expect(
      screen.getByText(
        'In effect: 200k, not the chosen 300k. Choose it again to start the session over.'
      )
    ).toHaveClass('text-warning')
  })

  // A session already started over for this reading read it again: choosing
  // again would only do the same, so the menu does not suggest it.
  it('does not suggest choosing again once a restart could not shed it', async () => {
    renderAttic(view({ chosen: 300_000, effective: 200_000, modelWindow: null, settled: true }))
    await open()

    expect(screen.getByText('In effect: 200k, not the chosen 300k.')).toHaveClass('text-warning')
  })

  // A model that holds less than the choice is not a disagreement: the agent
  // cut it down to the model, which the greyed rows already explain.
  it('takes a window cut to the model as agreeing with the choice', async () => {
    renderAttic(view({ chosen: 300_000, effective: 200_000, modelWindow: 200_000 }))
    await open()

    expect(screen.queryByText(/not the chosen/)).not.toBeInTheDocument()
  })

  /*
   * A 500k window compacts at 487k, not at 500k: the reading counts to the
   * second, and a menu that only named the first left a conversation at 91%
   * looking like one that had stopped compacting.
   */
  describe('where it fires', () => {
    const reading = (): HTMLElement => screen.getByRole('button', { name: /Context 48%/ })

    const compacting = (
      context: Partial<ContextUsage> = {},
      autoCompact: Partial<AutoCompactView> = {}
    ): SessionUsage => ({
      ...view({ chosen: 500_000, effective: 500_000, modelWindow: 1_000_000, ...autoCompact }),
      context: {
        ...FULL.context!,
        maxTokens: 500_000,
        compactsAt: 487_000,
        autoCompactOn: true,
        ...context
      }
    })

    it('names the point on the control, beside the counts', () => {
      renderAttic(compacting())

      expect(reading()).toHaveAttribute('title', 'Context window — 48k of 500k, compacts at 487k')
    })

    it('says in the menu where the window compacts', async () => {
      renderAttic(compacting())
      await open()

      expect(
        screen.getByText(
          'Compacts on its own at 487k, which the figure above counts to. A change starts the session again; the conversation is kept.'
        )
      ).not.toHaveClass('text-warning')
    })

    // A CLI that predates the threshold counts to the window, so there is no
    // point to name and the plain note stands.
    it('keeps the plain note and title when the agent names no point', async () => {
      renderAttic(compacting({ compactsAt: null, autoCompactOn: null }))
      await open()

      expect(reading()).toHaveAttribute('title', 'Context window — 48k of 500k')
      expect(
        screen.getByText(
          'When this conversation is compacted on its own. A change starts the session again; the conversation is kept.'
        )
      ).toBeInTheDocument()
    })

    it('warns that nothing compacts when auto-compact is off', async () => {
      renderAttic(compacting({ compactsAt: null, autoCompactOn: false }))
      await open()

      expect(
        screen.getByText(
          'Auto-compact is off: DISABLE_AUTO_COMPACT / DISABLE_COMPACT or the autoCompactEnabled setting says so. A window chosen here does nothing until it is turned back on.'
        )
      ).toHaveClass('text-warning')
      expect(screen.queryByText(/Compacts on its own at/)).not.toBeInTheDocument()
    })

    // No window is in force when none fires, so which variable outranks the
    // choice is beside the point until compaction is back on.
    it('puts that ahead of a variable that outranks the choice', async () => {
      renderAttic(
        compacting(
          { compactsAt: null, autoCompactOn: false },
          { override: { value: '400000', from: null } }
        )
      )
      await open()

      expect(screen.getByText(/Auto-compact is off:/)).toBeInTheDocument()
      expect(screen.queryByText(/decides instead/)).not.toBeInTheDocument()
    })
  })

  it('offers no windows without a session to say where it compacts', async () => {
    renderAttic(FULL)
    await open()

    expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
    expect(screen.queryByText('Auto-compact')).not.toBeInTheDocument()
  })

  // Wider than the app's other menus, so the variable name and its path take
  // two lines rather than four. Asked for by this menu alone.
  it('opens wider than the other menus', async () => {
    renderAttic(view())
    await open()

    expect(screen.getByRole('menu')).toHaveStyle({ width: '360px' })
  })
})
