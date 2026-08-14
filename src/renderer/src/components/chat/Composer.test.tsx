import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentCommand, AgentModel } from '@core/chats.js'

import { Composer } from './Composer.js'

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}): {
  onSend: ReturnType<typeof vi.fn>
  onStop: ReturnType<typeof vi.fn>
  onWorkingMode: ReturnType<typeof vi.fn>
  onPlanMode: ReturnType<typeof vi.fn>
  onEffort: ReturnType<typeof vi.fn>
  onModel: ReturnType<typeof vi.fn>
} {
  const onSend = vi.fn()
  const onStop = vi.fn()
  const onWorkingMode = vi.fn()
  const onEffort = vi.fn()
  const onModel = vi.fn()
  const onPlanMode = vi.fn()

  render(
    <Composer
      busy={false}
      workingMode="default"
      onWorkingMode={onWorkingMode}
      planMode={false}
      onPlanMode={onPlanMode}
      effort="medium"
      onEffort={onEffort}
      model={null}
      onModel={onModel}
      models={[]}
      activeModel={null}
      commands={[]}
      usage={{ context: null, subscription: null }}
      limit={null}
      comments={[]}
      onRemoveComment={vi.fn()}
      onCommentsSent={vi.fn()}
      onSend={onSend}
      onStop={onStop}
      {...overrides}
    />
  )
  return { onSend, onStop, onWorkingMode, onPlanMode, onEffort, onModel }
}

const OPUS: AgentModel = {
  value: 'claude-opus-5',
  resolvedModel: null,
  displayName: 'Opus 5',
  description: 'The capable one',
  supportsEffort: true,
  supportedEffortLevels: ['high', 'max']
}

/**
 * A catalogue shaped like the one the CLI sends, `Default (recommended)` and
 * all — the row whose name the picker exists to replace.
 */
const CATALOGUE: AgentModel[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: '',
    supportsEffort: null,
    supportedEffortLevels: null
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['high', 'max']
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: '',
    supportsEffort: null,
    supportedEffortLevels: null
  }
]

const field = (): HTMLElement => screen.getByRole('textbox')

// Named by the control plus its value, since it has no menu to open and the
// value is the only word on it.
const modeButton = (): HTMLElement => screen.getByRole('button', { name: /^Permissions:/ })

beforeEach(() => {
  // jsdom does no layout and has no scrollIntoView, which the effect keeping
  // the highlighted suggestion visible calls on every move.
  Element.prototype.scrollIntoView = vi.fn()
})

describe('sending', () => {
  /*
   * Reported from a running app: narrowed to the width the layout permits, the
   * footer ran past the rounded border and took the send button off the edge of
   * the block. Enter still worked; the pane's primary control was not on screen.
   *
   * Width itself is styling and the suite does not assert classes. What is
   * asserted is the thing the width broke — every control of the row present
   * and reachable, whatever the row has to do to fit them.
   */
  it('keeps every control of the footer reachable', () => {
    renderComposer({ models: [OPUS], model: OPUS.value })

    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Model' })).toBeInTheDocument()
    expect(modeButton()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Effort' })).toBeInTheDocument()
  })

  it('sends what was typed and clears the field', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'add a test')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith('add a test')
    expect(field()).toHaveValue('')
  })

  it('sends on enter', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'add a test{Enter}')

    expect(onSend).toHaveBeenCalledWith('add a test')
  })

  // A prompt is usually one line, but not always, and shift+enter is what every
  // chat uses for the exception.
  it('breaks the line on shift+enter instead of sending', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'first{Shift>}{Enter}{/Shift}second')

    expect(onSend).not.toHaveBeenCalled()
    expect(field()).toHaveValue('first\nsecond')
  })

  it('leaves other keys alone', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'abc')

    expect(onSend).not.toHaveBeenCalled()
  })

  it('refuses to send nothing but whitespace', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), '   {Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('trims what it sends', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), '  add a test  {Enter}')

    expect(onSend).toHaveBeenCalledWith('add a test')
  })

  // The strip above the field offers `/compact` and `/clear` off the context
  // reading, and they go out the way anything typed here does — which is the
  // whole reason that menu needs no command handling of its own. Asserted from
  // this side because wired to nothing the attic's own tests would still pass.
  it('sends what the attic menu picks through the channel the field uses', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({
      usage: {
        context: { percentage: 48, usedTokens: 48_000, maxTokens: 200_000, model: 'claude-opus-5' },
        subscription: null
      }
    })

    await user.click(screen.getByRole('button', { name: /Context 48%/ }))
    await user.click(screen.getByRole('menuitem', { name: /\/compact/ }))

    expect(onSend).toHaveBeenCalledExactlyOnceWith('/compact')
  })
})

describe('review notes riding with the message', () => {
  const NOTE = {
    path: 'src/core/diff.ts',
    side: 'new' as const,
    line: 42,
    code: 'const b = 2',
    text: 'this should be 3'
  }

  it('names the file and line of each note above the field', () => {
    renderComposer({ comments: [NOTE] })

    expect(screen.getByText('diff.ts:42')).toBeInTheDocument()
    expect(screen.getByText('this should be 3')).toBeInTheDocument()
  })

  it('says nothing when there are no notes', () => {
    renderComposer()

    expect(screen.queryByRole('button', { name: 'Remove this note' })).not.toBeInTheDocument()
  })

  // Nothing implicit reaches the agent (§4): the notes go out as part of the
  // message, where the user can read back exactly what was sent.
  it('writes the notes into the message it sends', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ comments: [NOTE] })

    await user.type(screen.getByRole('textbox'), 'fix these')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('src/core/diff.ts:42'))
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('fix these'))
  })

  // The review can be the whole message.
  it('sends the notes even when nothing was typed', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ comments: [NOTE] })

    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('this should be 3'))
  })

  it('clears them once they have gone out', async () => {
    const user = userEvent.setup()
    const onCommentsSent = vi.fn()
    renderComposer({ comments: [NOTE], onCommentsSent })

    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onCommentsSent).toHaveBeenCalled()
  })

  it('gives a note back before it is sent', async () => {
    const user = userEvent.setup()
    const onRemoveComment = vi.fn()
    renderComposer({ comments: [NOTE], onRemoveComment })

    await user.click(screen.getByRole('button', { name: 'Remove this note' }))

    expect(onRemoveComment).toHaveBeenCalledWith(NOTE)
  })

  // A slash command goes out through the strip's own `onSend`, which composes
  // nothing. A `/compact` carrying a review would be neither one nor the other.
  it('leaves a command from the strip above the field alone', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({
      comments: [NOTE],
      usage: {
        context: { percentage: 48, usedTokens: 9, maxTokens: 20, model: null },
        subscription: null
      }
    })

    await user.click(screen.getByRole('button', { name: /Context 48%/ }))
    await user.click(screen.getByRole('menuitem', { name: /\/compact/ }))

    expect(onSend).toHaveBeenCalledExactlyOnceWith('/compact')
  })
})

describe('while the agent is working', () => {
  // One button in one place: a send that is unavailable and a stop that is
  // would otherwise leave the user hunting for the control that applies.
  it('offers stopping instead of sending', async () => {
    const user = userEvent.setup()
    const { onStop } = renderComposer({ busy: true })

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })

  // Typing the next instruction while the agent works is normal; it goes as
  // soon as the field is submitted.
  it('still accepts typing', async () => {
    const user = userEvent.setup()
    renderComposer({ busy: true })

    await user.type(field(), 'and then deploy')
    expect(field()).toHaveValue('and then deploy')
  })

  /*
   * The strip's menu is not disabled here, and that is a decision rather than
   * an omission: `submit` looks at the draft and nothing else, so typing
   * `/clear` and pressing Enter mid-turn already works. A menu stricter than
   * the field an inch below it would be two answers to one question.
   *
   * It is also the moment the commands matter most — the reading someone is
   * watching climb is the reason they reach for the menu at all.
   */
  it('still offers the commands on the context reading', async () => {
    const user = userEvent.setup()
    renderComposer({
      busy: true,
      usage: {
        context: {
          percentage: 91,
          usedTokens: 182_000,
          maxTokens: 200_000,
          model: 'claude-opus-5'
        },
        subscription: null
      }
    })

    await user.click(screen.getByRole('button', { name: /Context 91%/ }))

    expect(screen.getByRole('menuitem', { name: /\/compact/ })).toBeInTheDocument()
  })
})

describe('the settings the next message runs under', () => {
  it('shows which permission mode is in force', () => {
    renderComposer({ workingMode: 'acceptEdits' })

    expect(modeButton()).toHaveTextContent('Auto mode')
    // The control names itself as well as its value: with no menu to open, the
    // visible word is the setting and would otherwise be all a reader hears.
    expect(modeButton()).toHaveAccessibleName('Permissions: Auto mode')
  })

  /*
   * Switched in place rather than picked from a list. Two modes made the menu
   * three steps — open it, read a list in which one row was already in force,
   * click the other — to say what one click says.
   */
  it('changes the mode on the spot, without a menu', async () => {
    const user = userEvent.setup()
    const { onWorkingMode } = renderComposer({ workingMode: 'default' })

    await user.click(modeButton())

    expect(onWorkingMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')
    expect(screen.queryByRole('menuitemradio', { name: 'Auto mode' })).not.toBeInTheDocument()
  })

  it('switches back the other way', async () => {
    const user = userEvent.setup()
    const { onWorkingMode } = renderComposer({ workingMode: 'acceptEdits' })

    await user.click(modeButton())

    expect(onWorkingMode).toHaveBeenCalledExactlyOnceWith('default')
  })

  // Planning is a state the conversation is in, not a degree of permission —
  // the agent runs no tools at all in it. Listing the three together made them
  // look like peers, which is what this separation is for.
  describe('planning', () => {
    const planButton = (): HTMLElement => screen.getByRole('button', { name: 'Plan' })

    it('is off until it is turned on', async () => {
      const user = userEvent.setup()
      const { onPlanMode } = renderComposer()

      expect(planButton()).toHaveAttribute('aria-pressed', 'false')

      await user.click(planButton())
      expect(onPlanMode).toHaveBeenCalledExactlyOnceWith(true)
    })

    it('shows itself as on while the chat is planning', () => {
      renderComposer({ planMode: true })

      expect(planButton()).toHaveAttribute('aria-pressed', 'true')
    })

    it('turns itself off again', async () => {
      const user = userEvent.setup()
      const { onPlanMode } = renderComposer({ planMode: true })

      await user.click(planButton())
      expect(onPlanMode).toHaveBeenCalledExactlyOnceWith(false)
    })

    /*
     * The two settings are stored apart, so choosing permissions while planning
     * writes through like any other choice — there is no third value crowding
     * the field and nothing to remember locally until planning ends.
     *
     * This used to be component state precisely because there was, and that is
     * why approving a plan had no mode to return to.
     */
    it('stores a permissions choice made while planning', async () => {
      const user = userEvent.setup()
      const { onWorkingMode, onPlanMode } = renderComposer({ planMode: true })

      await user.click(modeButton())

      expect(onWorkingMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')
      // Choosing what happens afterwards is not a decision to stop planning.
      expect(onPlanMode).not.toHaveBeenCalled()
    })

    it('still offers the permissions, for once the plan is approved', () => {
      renderComposer({ planMode: true })

      expect(modeButton()).toBeEnabled()
      expect(modeButton()).toHaveAttribute(
        'title',
        'What the agent may do once the plan is approved.'
      )
    })
  })

  it('offers the models the agent reported, and reports the one chosen', async () => {
    const user = userEvent.setup()
    const { onModel } = renderComposer({ models: [OPUS] })

    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(screen.getByRole('menuitemradio', { name: /Opus 5/ }))

    expect(onModel).toHaveBeenCalledExactlyOnceWith('claude-opus-5')
  })

  /*
   * The row the CLI calls "Default (recommended)" names no model, which is
   * exactly what a picker of models must not do. It says what it resolves to,
   * and the catalogue has a row for that name; the picker wears it.
   */
  it('names the model the default runs, rather than the word default', async () => {
    const user = userEvent.setup()
    renderComposer({ models: CATALOGUE })

    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Opus (1M context)')

    await user.click(screen.getByRole('button', { name: 'Model' }))

    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.map((row) => row.textContent)).toEqual(['Opus (1M context)by default', 'Sonnet'])
    expect(rows[0]).toBeChecked()
  })

  it('turns the default row back into no override at all', async () => {
    const user = userEvent.setup()
    const { onModel } = renderComposer({ model: 'sonnet', models: CATALOGUE })

    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(screen.getByRole('menuitemradio', { name: /Opus \(1M context\)/ }))

    expect(onModel).toHaveBeenCalledExactlyOnceWith(null)
  })

  // A first run: no session has reported a catalogue yet, so there is no model
  // name to wear. The row still has to be there and has to read as words rather
  // than as the raw id the picker would otherwise print.
  it('names the default row in plain language when no catalogue has arrived', async () => {
    const user = userEvent.setup()
    renderComposer({ models: [] })

    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Default model')

    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(1)
  })

  // The list is remembered from the last session, so a chat can name a model it
  // no longer has. Showing the default would claim one that is not in force,
  // and there would be no way back to a real choice.
  it('keeps a model the remembered list has forgotten', async () => {
    const user = userEvent.setup()
    renderComposer({ model: 'claude-retired-3', models: [OPUS] })

    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('claude-retired-3')

    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(screen.getByRole('menuitemradio', { name: 'claude-retired-3' })).toBeChecked()
  })

  it('offers only the effort levels the chosen model takes', async () => {
    const user = userEvent.setup()
    renderComposer({ model: OPUS.value, models: [OPUS] })

    await user.click(screen.getByRole('button', { name: 'Effort' }))

    expect(screen.getByRole('menuitemradio', { name: 'Maximum' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: 'Low' })).not.toBeInTheDocument()
  })

  // Greyed out rather than gone: a control that vanishes as the model changes
  // is harder to make sense of than one that stays and says why.
  it('greys the effort out for a model that does not take one', () => {
    const plain = { ...OPUS, supportsEffort: false, supportedEffortLevels: null }
    renderComposer({ model: plain.value, models: [plain] })

    const picker = screen.getByRole('button', { name: 'Effort' })
    expect(picker).toBeDisabled()
    expect(picker).toHaveAttribute('title', 'This model does not take an effort setting.')
  })

  // Silence is not a refusal. A model that says nothing about effort should get
  // the full list rather than have levels hidden it would in fact accept.
  it('offers every level for a model that said nothing about effort', async () => {
    const user = userEvent.setup()
    const quiet = { ...OPUS, supportsEffort: null, supportedEffortLevels: null }
    renderComposer({ model: quiet.value, models: [quiet] })

    await user.click(screen.getByRole('button', { name: 'Effort' }))

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(5)
  })

  it('reports the effort that was chosen', async () => {
    const user = userEvent.setup()
    const { onEffort } = renderComposer()

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Maximum' }))

    expect(onEffort).toHaveBeenCalledExactlyOnceWith('max')
  })

  /*
   * Neither picker offers to say nothing any more. For the model that row was a
   * second way of naming the default; for effort it was a level the agent was
   * never told about while the button claimed one.
   */
  it('offers no way to leave either setting unsaid', async () => {
    const user = userEvent.setup()
    renderComposer({ effort: 'high', models: CATALOGUE })

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    expect(screen.queryByRole('menuitemradio', { name: 'Agent decides' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(screen.queryByRole('menuitemradio', { name: 'Agent decides' })).not.toBeInTheDocument()
  })

  it('reports the level that was chosen', async () => {
    const user = userEvent.setup()
    const { onEffort } = renderComposer({ effort: 'high' })

    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('High')

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Low' }))

    expect(onEffort).toHaveBeenCalledExactlyOnceWith('low')
  })

  /*
   * A model that lists the levels it takes does not silence the one this chat
   * is already on. That level is what the next message runs with, and a picker
   * whose value has no row of its own prints the raw name instead.
   */
  it('names the level in force even when the model does not offer it', async () => {
    const user = userEvent.setup()
    const picky: AgentModel = {
      ...OPUS,
      supportsEffort: true,
      supportedEffortLevels: ['high', 'max']
    }
    renderComposer({ effort: 'medium', model: picky.value, models: [picky] })

    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('Medium')

    await user.click(screen.getByRole('button', { name: 'Effort' }))
    expect(screen.getByRole('menuitemradio', { name: 'Medium' })).toBeChecked()
  })

  // The whole reason it moved out of the header: there it was disabled until
  // the first message had gone, so the mode that message ran under was the one
  // mode nobody could choose.
  it('can be changed before anything has been sent', async () => {
    const user = userEvent.setup()
    const { onWorkingMode } = renderComposer()

    expect(modeButton()).toBeEnabled()

    await user.click(modeButton())

    expect(onWorkingMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')
  })
})

/*
 * Slash commands go to the agent as ordinary messages — the CLI on the other
 * end is what reads them — so the composer's whole job here is the suggestion
 * list, and the keys it has to borrow from the field to run it.
 */
describe('suggesting a command', () => {
  const CLEAR: AgentCommand = {
    name: 'clear',
    description: 'Start a new session with empty context',
    argumentHint: '[name]',
    aliases: ['reset']
  }

  const COMPACT: AgentCommand = {
    name: 'compact',
    description: 'Summarise the conversation so far',
    argumentHint: '',
    aliases: []
  }

  const options = (): HTMLElement[] => screen.queryAllByRole('option')

  it('offers the commands as soon as a slash is typed', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/')

    expect(options()).toHaveLength(2)
    expect(screen.getByText('/clear')).toBeVisible()
    expect(screen.getByText('Start a new session with empty context')).toBeVisible()
    expect(screen.getByText('[name]')).toBeVisible()
  })

  it('narrows to what has been typed', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/comp')

    expect(options()).toHaveLength(1)
    expect(screen.getByText('/compact')).toBeVisible()
  })

  // A conversation is full of paths and dates. A list that opened on any slash
  // would take Enter away from someone in the middle of a sentence.
  it('stays out of the way of ordinary writing', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), 'look at src/core/')

    expect(options()).toEqual([])
  })

  /*
   * The heart of it: Enter completes rather than sends.
   *
   * Sending on the first Enter would leave no way to type an argument, and
   * would run whichever command the highlight happened to be on — for `/clear`,
   * that is the conversation gone in one keystroke aimed at a list.
   */
  it('completes on enter without sending', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/')
    await user.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
    expect(field()).toHaveValue('/clear ')
    expect(options()).toEqual([])
  })

  it('sends on the second enter', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/')
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledExactlyOnceWith('/clear')
    expect(field()).toHaveValue('')
  })

  it('walks the list with the arrows', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')

    expect(field()).toHaveValue('/compact')
  })

  // Wrapping round is what a list of two makes obvious and a list of twenty
  // makes necessary: from the top, up reaches the bottom.
  it('wraps from the top of the list to the bottom', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/')
    await user.keyboard('{ArrowUp}')
    await user.keyboard('{Enter}')

    expect(field()).toHaveValue('/compact')
  })

  // What a shell does, and without `preventDefault` it would take the focus
  // out of the field instead of completing anything.
  it('completes on tab as well', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/comp')
    await user.keyboard('{Tab}')

    expect(field()).toHaveValue('/compact')
    expect(field()).toHaveFocus()
  })

  // Escape means "stop suggesting", not "undo what I typed".
  it('closes on escape and leaves the draft alone', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/cle')
    await user.keyboard('{Escape}')

    expect(options()).toEqual([])
    expect(field()).toHaveValue('/cle')
  })

  it('comes back when typing continues', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/cle')
    await user.keyboard('{Escape}')
    await user.type(field(), 'a')

    expect(options()).toHaveLength(1)
  })

  /*
   * With no suggestions there is nothing to complete, so Enter has to mean
   * what it always means. Without this the lone slash — or a typo — would
   * swallow the keystroke and leave the field looking broken.
   */
  it('sends a slash that matches nothing', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ commands: [CLEAR] })

    await user.type(field(), '/zzz')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledExactlyOnceWith('/zzz')
  })

  it('suggests nothing at all before the chat has run a session', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ commands: [] })

    await user.type(field(), '/clear')
    await user.keyboard('{Enter}')

    // And the command still goes: the CLI knows it even when we do not.
    expect(onSend).toHaveBeenCalledExactlyOnceWith('/clear')
  })

  it('can be picked with the mouse', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/')
    await user.click(screen.getByRole('option', { name: /compact/ }))

    expect(field()).toHaveValue('/compact')
  })

  // The mouse and the keyboard must not disagree about which row Enter takes.
  it('moves the highlight to whatever the mouse is over', async () => {
    const user = userEvent.setup()
    renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/')
    await user.hover(screen.getByRole('option', { name: /compact/ }))

    expect(screen.getByRole('option', { name: /compact/ })).toHaveAttribute('aria-selected', 'true')
  })
})

/*
 * The footer names the model that is actually running, which is not always the
 * one this chat chose. `/model` moves the session without moving the record —
 * the CLI scopes it to the session — and a picker that kept naming the old one
 * would be the interface lying about the thing it exists to report.
 */
describe('the model the session is running', () => {
  const SONNET: AgentModel = {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['high']
  }

  const modelButton = (): HTMLElement => screen.getByRole('button', { name: 'Model' })

  /*
   * A `/model` command, seen from the footer: the record still chose nothing,
   * so the menu goes on ticking the default, while the button has to name where
   * the session actually went.
   */
  it('names what is running when that is not what the menu ticks', async () => {
    const user = userEvent.setup()
    renderComposer({ models: CATALOGUE, model: null, activeModel: 'claude-sonnet-5' })

    expect(modelButton()).toHaveTextContent('Sonnet')

    await user.click(modelButton())
    expect(screen.getByRole('menuitemradio', { name: /Opus \(1M context\)/ })).toBeChecked()
  })

  // The ordinary case, where the two agree. The button says the name once.
  it('says it once when the session is on what the default runs', () => {
    renderComposer({ models: CATALOGUE, model: null, activeModel: 'claude-opus-5[1m]' })

    expect(modelButton()).toHaveTextContent('Opus (1M context)')
    expect(modelButton()).not.toHaveTextContent('auto')
  })

  it('names the chosen model when one was chosen here', () => {
    renderComposer({ models: [SONNET], model: 'sonnet', activeModel: 'claude-sonnet-5' })

    expect(modelButton()).toHaveTextContent('Sonnet')
  })

  // Before any session has answered there is nothing running to name, and the
  // default is what the next message will go out on.
  it('names the default while no session has reported', () => {
    renderComposer({ models: CATALOGUE, model: null, activeModel: null })

    expect(modelButton()).toHaveTextContent('Opus (1M context)')
  })

  /*
   * The alias bridge, from the picker's side. A session reports itself in full
   * while the catalogue offers the short name, and without matching through
   * `resolvedModel` the footer would show a raw `claude-sonnet-5` — and the
   * effort picker would offer levels this model does not take.
   */
  it('recognises the full name as the row it stands for', () => {
    renderComposer({ models: [SONNET], model: null, activeModel: 'claude-sonnet-5' })

    expect(modelButton()).toHaveTextContent('Sonnet')
    expect(modelButton()).not.toHaveTextContent('claude-sonnet-5')
  })

  it('marks the chosen row when the record holds the full name', async () => {
    const user = userEvent.setup()
    renderComposer({ models: [SONNET], model: 'claude-sonnet-5' })

    await user.click(modelButton())

    expect(screen.getByRole('menuitemradio', { name: 'Sonnet' })).toBeChecked()
    // And no second row invented for a model already in the list.
    expect(screen.queryByRole('menuitemradio', { name: 'claude-sonnet-5' })).not.toBeInTheDocument()
  })

  // A model the catalogue cannot resolve at all still has to be nameable —
  // this is the older behaviour, and it must survive the matching above.
  it('shows a model the list has forgotten as itself', () => {
    renderComposer({ models: [SONNET], model: 'claude-retired-3' })

    expect(modelButton()).toHaveTextContent('claude-retired-3')
  })

  /*
   * The same on the running side, and reachable for an ordinary reason: the
   * catalogue is remembered from the last session, so a session started before
   * it arrived — or on a model added upstream since — names something the list
   * has no row for. The raw name is worth more than silence.
   */
  it('names a running model the list has no row for', () => {
    renderComposer({ models: [], model: null, activeModel: 'claude-brand-new-1' })

    expect(modelButton()).toHaveTextContent('claude-brand-new-1')
  })
})
