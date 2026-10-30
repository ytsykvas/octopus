import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentCommand, AgentModel } from '@core/chats.js'

import { Composer } from './Composer.js'

type ComposerProps = React.ComponentProps<typeof Composer>

/** The panel's two halves, which hold the same names and so need telling apart. */
const codeColumn = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Writing code' })
const planColumn = (): HTMLElement => screen.getByRole('radiogroup', { name: 'Plan and research' })

function renderComposer(overrides: Partial<ComposerProps> = {}): {
  onSend: ReturnType<typeof vi.fn>
  onSideQuestion: ReturnType<typeof vi.fn>
  onStop: ReturnType<typeof vi.fn>
  onMode: ReturnType<typeof vi.fn>
  onModels: ReturnType<typeof vi.fn>
  onFilesTaken: ReturnType<typeof vi.fn>
  onDropFiles: ReturnType<typeof vi.fn>
  onPasteImage: ReturnType<typeof vi.fn>
  rerender: (next: Partial<ComposerProps>) => void
} {
  // Answers that the message went, which is what the composer clears on. A
  // mock that answered nothing would model a send that failed, and every test
  // about clearing would be asserting the failure path by accident.
  const onSend = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true)
  const onSideQuestion = vi.fn()
  const onStop = vi.fn()
  const onMode = vi.fn()
  const onModels = vi.fn()
  const onFilesTaken = vi.fn()
  const onDropFiles = vi.fn()
  const onPasteImage = vi.fn()

  const composer = (props: Partial<ComposerProps>): React.JSX.Element => (
    <Composer
      initialDraft=""
      onDraftLeave={vi.fn()}
      busy={false}
      workingMode="default"
      planMode={false}
      onMode={onMode}
      effort="medium"
      planEffort={null}
      onEfforts={vi.fn()}
      onAutoCompact={vi.fn()}
      files={[]}
      onFilesTaken={onFilesTaken}
      onAttachFiles={vi.fn()}
      onDropFiles={onDropFiles}
      onPasteImage={onPasteImage}
      model={null}
      planModel={null}
      onModels={onModels}
      models={[]}
      activeModel={null}
      commands={[]}
      agents={[]}
      usage={{ context: null, autoCompact: null }}
      limit={null}
      skills={[]}
      onToggleSkill={vi.fn()}
      onRefreshSkills={vi.fn()}
      onOpenSettings={vi.fn()}
      notes={[]}
      onRemoveNote={vi.fn()}
      onNotesSent={vi.fn()}
      onSend={onSend}
      onSideQuestion={onSideQuestion}
      onStop={onStop}
      {...props}
    />
  )

  const view = render(composer(overrides))

  return {
    onSend,
    onSideQuestion,
    onStop,
    onMode,
    onModels,
    onFilesTaken,
    onDropFiles,
    onPasteImage,
    // For the settings that have to be watched *changing* — the chip follows
    // the mode, and a second `render` would mount a second composer instead.
    rerender: (next) => {
      view.rerender(composer(next))
    }
  }
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

/** A `dragleave` that says where the pointer went, which `fireEvent` cannot. */
function leaving(from: HTMLElement, to: Node): Event {
  const event = createEvent.dragLeave(from)
  Object.defineProperty(event, 'relatedTarget', { value: to })
  return event
}

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

  /*
   * For anyone typing through an IME, Enter is how a candidate is confirmed —
   * the Japanese, Chinese and Korean input methods among others — and the same
   * key used to send. Every committed word fired a message, and it looked like
   * the app sending on its own.
   *
   * `fireEvent` rather than `user.type`: user-event 14 dispatches no
   * composition events at all, and jsdom's `KeyboardEventInit` does carry
   * `isComposing`.
   */
  it('does not send on the enter that confirms an IME candidate', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer()

    await user.type(field(), 'にほんご')
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true })

    expect(onSend).not.toHaveBeenCalled()
    expect(field()).toHaveValue('にほんご')
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
        context: {
          percentage: 48,
          usedTokens: 48_000,
          maxTokens: 200_000,
          compactsAt: null,
          autoCompactOn: null,
          model: 'claude-opus-5',
          modelWindow: null,
          breakdown: null
        },
        autoCompact: null
      }
    })

    await user.click(screen.getByRole('button', { name: /Context 48%/ }))
    await user.click(screen.getByRole('menuitem', { name: /\/compact/ }))

    expect(onSend).toHaveBeenCalledExactlyOnceWith('/compact')
  })
})

describe('review notes riding with the message', () => {
  const NOTE = {
    kind: 'diff' as const,
    path: 'src/core/diff.ts',
    side: 'new' as const,
    line: 42,
    endLine: 42,
    code: 'const b = 2',
    text: 'this should be 3'
  }

  /** A remark carried in from a review on GitHub, which rides the same strip. */
  const QUOTE = {
    kind: 'pullRequest' as const,
    key: 'inline:PRRC_1',
    reference: '#812',
    author: 'olena',
    place: 'src/core/git.ts:42',
    quote: '@@ -1 +1 @@\n-const a = 1',
    body: 'Why the second case?'
  }

  it('names the file and line of each note above the field', () => {
    renderComposer({ notes: [NOTE] })

    expect(screen.getByText('diff.ts:42')).toBeInTheDocument()
    expect(screen.getByText('this should be 3')).toBeInTheDocument()
  })

  // A note over a passage says how far it reaches, or the chip claims a remark
  // about one line that the message will turn out to be about nine.
  it('names both ends of a note that covers a passage', () => {
    renderComposer({ notes: [{ ...NOTE, line: 42, endLine: 50 }] })

    expect(screen.getByText('diff.ts:42-50')).toBeInTheDocument()
  })

  /*
   * The last moment the omission is still correctable. Two notes at the same
   * number on opposite sides are different notes, and without this they were
   * identical chips — so somebody about to send could not tell which of the two
   * they were about to take back.
   */
  it('says on the chip when a note is about the file as it was', () => {
    renderComposer({ notes: [{ ...NOTE, side: 'old' as const }] })

    expect(screen.getByText('diff.ts:42 (as it was)')).toBeInTheDocument()
  })

  it('leaves a chip about the file as it is unmarked', () => {
    renderComposer({ notes: [{ ...NOTE, side: 'new' as const }] })

    expect(screen.getByText('diff.ts:42')).toBeInTheDocument()
  })

  /* A remark on the request as a whole has no file, so its chip is the request
     and the author and nothing more. */
  it('names a remark that is not about any file', () => {
    renderComposer({ notes: [{ ...QUOTE, place: null }] })

    expect(screen.getByText('#812 @olena')).toBeInTheDocument()
  })

  // GitHub models a deleted account as no author at all, and the remark is
  // still worth carrying.
  it('names a remark whose author has deleted their account', () => {
    renderComposer({ notes: [{ ...QUOTE, author: null }] })

    expect(screen.getByText('#812 git.ts:42')).toBeInTheDocument()
  })

  it('says nothing when there are no notes', () => {
    renderComposer()

    expect(screen.queryByRole('button', { name: 'Remove this note' })).not.toBeInTheDocument()
  })

  // Nothing implicit reaches the agent (§4): the notes go out as part of the
  // message, where the user can read back exactly what was sent.
  it('writes the notes into the message it sends', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ notes: [NOTE] })

    await user.type(screen.getByRole('textbox'), 'fix these')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('src/core/diff.ts:42'))
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('fix these'))
  })

  it('takes a /btw aside and leaves the notes for the next message', async () => {
    const user = userEvent.setup()
    const onNotesSent = vi.fn()
    const { onSend, onSideQuestion } = renderComposer({ notes: [NOTE], onNotesSent })

    await user.type(screen.getByRole('textbox'), '/btw why is this here?{Enter}')

    expect(onSideQuestion).toHaveBeenCalledWith('why is this here?')
    expect(onSend).not.toHaveBeenCalled()
    expect(onNotesSent).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  // The review can be the whole message.
  it('sends the notes even when nothing was typed', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ notes: [NOTE] })

    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalledWith(expect.stringContaining('this should be 3'))
  })

  it('clears them once they have gone out', async () => {
    const user = userEvent.setup()
    const onNotesSent = vi.fn()
    renderComposer({ notes: [NOTE], onNotesSent })

    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onNotesSent).toHaveBeenCalled()
  })

  /*
   * A review is minutes of reading, and nothing writes it to disk.
   *
   * The send is fire-and-forget from here — no session, the agent busy, the IPC
   * call refused — and the notes used to be cleared on the line after it, which
   * left a failed send with nowhere at all to get the review back from.
   */
  it('keeps them when the message did not go', async () => {
    const user = userEvent.setup()
    const onNotesSent = vi.fn()
    const { onSend } = renderComposer({ notes: [NOTE], onNotesSent })
    onSend.mockResolvedValue(false)

    await user.type(screen.getByRole('textbox'), 'fix these')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(onSend).toHaveBeenCalled()
    expect(onNotesSent).not.toHaveBeenCalled()
    // The typed message is the same bargain and is kept for the same reason.
    expect(screen.getByRole('textbox')).toHaveValue('fix these')
  })

  it('gives a note back before it is sent', async () => {
    const user = userEvent.setup()
    const onRemoveNote = vi.fn()
    renderComposer({ notes: [NOTE], onRemoveNote })

    await user.click(screen.getByRole('button', { name: 'Remove this note' }))

    expect(onRemoveNote).toHaveBeenCalledWith(NOTE)
  })

  /*
   * A remark from GitHub rides the same strip as a note on the diff, and both
   * end up in one message. They are two stores in `App` for the diff pane's
   * sake, not two things to the person typing.
   */
  it('carries a remark from the review beside a note on the diff', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ notes: [NOTE, QUOTE] })

    expect(screen.getByText('#812 @olena git.ts:42')).toBeInTheDocument()
    expect(screen.getByText('Why the second case?')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), 'both please')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    const sent = onSend.mock.calls[0]?.[0] as string
    expect(sent).toContain('src/core/diff.ts:42')
    expect(sent).toContain('#812 — @olena — src/core/git.ts:42')
    expect(sent).toContain('Why the second case?')
    expect(sent).toContain('both please')
  })

  it('removes the remark it was asked to remove, not the note beside it', async () => {
    const user = userEvent.setup()
    const onRemoveNote = vi.fn()
    renderComposer({ notes: [NOTE, QUOTE], onRemoveNote })

    const [, second] = screen.getAllByRole('button', { name: 'Remove this note' })
    await user.click(second!)

    expect(onRemoveNote).toHaveBeenCalledExactlyOnceWith(QUOTE)
  })

  // A slash command goes out through the strip's own `onSend`, which composes
  // nothing. A `/compact` carrying a review would be neither one nor the other.
  it('leaves a command from the strip above the field alone', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({
      notes: [NOTE],
      usage: {
        context: {
          percentage: 48,
          usedTokens: 9,
          maxTokens: 20,
          compactsAt: null,
          autoCompactOn: null,
          model: null,
          modelWindow: null,
          breakdown: null
        },
        autoCompact: null
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
          compactsAt: null,
          autoCompactOn: null,
          model: 'claude-opus-5',
          modelWindow: null,
          breakdown: null
        },
        autoCompact: null
      }
    })

    await user.click(screen.getByRole('button', { name: /Context 91%/ }))

    expect(screen.getByRole('menuitem', { name: /\/compact/ })).toBeInTheDocument()
  })
})

describe('the settings the next message runs under', () => {
  it('shows which permission mode is in force', () => {
    renderComposer({ workingMode: 'acceptEdits' })

    expect(modeButton()).toHaveTextContent('Accept edits')
    // The control names itself as well as its value: with no menu to open, the
    // visible word is the setting and would otherwise be all a reader hears.
    expect(modeButton()).toHaveAccessibleName('Permissions: Accept edits')
  })

  // Planning is stored apart from the working mode, and wins over it here: the
  // agent runs no tools at all while planning, so what it would do afterwards
  // is not what the control should be saying.
  it('shows planning over whatever the working mode holds', () => {
    renderComposer({ workingMode: 'acceptEdits', planMode: true })

    expect(modeButton()).toHaveTextContent('Plan')
    expect(modeButton()).toHaveAccessibleName('Permissions: Plan')
  })

  // One control rather than two: the left-hand permissions chip and the plan
  // toggle beside send said half each of what this says.
  it('is the only mode control in the row', () => {
    renderComposer()

    expect(screen.getAllByRole('button', { name: /^Permissions:/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Plan' })).not.toBeInTheDocument()
  })

  /*
   * Switched in place rather than picked from a list, through the ring Claude
   * Code's own shift+tab goes round: manual, accept edits, plan, auto, and back.
   */
  it.each([
    ['default', false, 'acceptEdits'],
    ['acceptEdits', false, 'plan'],
    ['acceptEdits', true, 'auto'],
    ['default', true, 'auto'],
    ['auto', true, 'auto'],
    ['auto', false, 'default']
  ] as const)('goes on from %s (planning: %s) to %s', async (workingMode, planMode, next) => {
    const user = userEvent.setup()
    const { onMode } = renderComposer({ workingMode, planMode })

    await user.click(modeButton())

    expect(onMode).toHaveBeenCalledExactlyOnceWith(next)
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  })

  it('says how to switch it from the keyboard', () => {
    renderComposer()

    expect(modeButton()).toHaveAttribute(
      'title',
      'Switch mode — Manual, Accept edits, Plan, Auto (Shift+Tab)'
    )
  })

  // Auto mode has its own look — a bolt, in green — because it is the one
  // where a classifier decides, and the one most worth telling apart.
  it('draws auto mode as a green bolt, apart from the blue of planning', () => {
    renderComposer({ workingMode: 'auto' })

    expect(modeButton()).toHaveAccessibleName('Permissions: Auto')
    expect(modeButton()).toHaveClass('text-success')
    expect(modeButton()).not.toHaveClass('text-accent')
    expect(modeButton().querySelector('.lucide-zap')).not.toBeNull()
  })

  it('keeps planning blue', () => {
    renderComposer({ workingMode: 'auto', planMode: true })

    expect(modeButton()).toHaveClass('text-accent')
    expect(modeButton()).not.toHaveClass('text-success')
    expect(modeButton().querySelector('.lucide-map')).not.toBeNull()
  })

  // Accept edits in the amber the app uses for "goes ahead, take note", apart
  // from planning's blue and auto's green.
  it('draws Accept edits in amber', () => {
    renderComposer({ workingMode: 'acceptEdits' })

    expect(modeButton()).toHaveClass('text-warning')
    expect(modeButton()).not.toHaveClass('text-accent')
  })

  // Manual is the one mode left untinted: nothing happens there unasked.
  it('leaves Manual untinted', () => {
    renderComposer({ workingMode: 'default' })

    expect(modeButton()).toHaveTextContent('Manual')
    expect(modeButton()).not.toHaveClass('text-accent')
    expect(modeButton()).not.toHaveClass('text-success')
  })

  describe('shift+tab in the field', () => {
    it('moves to the next mode and keeps the focus in the field', async () => {
      const user = userEvent.setup()
      const { onMode } = renderComposer({ workingMode: 'acceptEdits' })

      await user.click(field())
      await user.keyboard('{Shift>}{Tab}{/Shift}')

      expect(onMode).toHaveBeenCalledExactlyOnceWith('plan')
      expect(field()).toHaveFocus()
    })

    it('leaves plain tab to the field', async () => {
      const user = userEvent.setup()
      const { onMode } = renderComposer()

      await user.click(field())
      await user.keyboard('{Tab}')

      expect(onMode).not.toHaveBeenCalled()
    })

    // The same rule as Enter: a key that confirms an IME candidate is not one
    // meant for the application.
    it('does nothing while a character is being composed', () => {
      const { onMode } = renderComposer()

      fireEvent.keyDown(field(), { key: 'Tab', shiftKey: true, isComposing: true })

      expect(onMode).not.toHaveBeenCalled()
    })
  })

  it('offers the models the agent reported, and reports the one chosen', async () => {
    const user = userEvent.setup()
    const { onModels } = renderComposer({ models: [OPUS] })

    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(within(planColumn()).getByRole('radio', { name: /Opus 5/ }))

    expect(onModels).toHaveBeenCalledExactlyOnceWith({ model: 'claude-opus-5', planModel: null })
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

    const rows = within(planColumn()).getAllByRole('radio')
    expect(rows.map((row) => row.textContent)).toEqual(['Opus (1M context)by default', 'Sonnet'])
    expect(rows[0]).toBeChecked()
  })

  it('turns the default row back into no override at all', async () => {
    const user = userEvent.setup()
    const { onModels } = renderComposer({ model: 'sonnet', models: CATALOGUE })

    await user.click(screen.getByRole('button', { name: 'Model' }))
    await user.click(within(planColumn()).getByRole('radio', { name: /Opus \(1M context\)/ }))

    expect(onModels).toHaveBeenCalledExactlyOnceWith({ model: null, planModel: null })
  })

  // A first run: no session has reported a catalogue yet, so there is no model
  // name to wear. The row still has to be there and has to read as words rather
  // than as the raw id the picker would otherwise print.
  it('names the default row in plain language when no catalogue has arrived', async () => {
    const user = userEvent.setup()
    renderComposer({ models: [] })

    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Default model')

    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(within(planColumn()).getAllByRole('radio')).toHaveLength(1)
  })

  // The list is remembered from the last session, so a chat can name a model it
  // no longer has. Showing the default would claim one that is not in force,
  // and there would be no way back to a real choice.
  it('keeps a model the remembered list has forgotten', async () => {
    const user = userEvent.setup()
    renderComposer({ model: 'claude-retired-3', models: [OPUS] })

    expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('claude-retired-3')

    await user.click(screen.getByRole('button', { name: 'Model' }))
    expect(within(planColumn()).getByRole('radio', { name: 'claude-retired-3' })).toBeChecked()
  })

  describe('the two models a conversation runs on', () => {
    // The chip names what the next message will actually go out on, which is
    // the whole reason the two are worth telling apart on screen.
    it('names the plan model while planning a conversation that has one', () => {
      renderComposer({ models: CATALOGUE, model: 'sonnet', planModel: 'default', planMode: true })

      expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Opus (1M context)')
    })

    // With no split there is one model, and the toggle does not move it. This
    // is what keeps a conversation nobody has opened the panel in unchanged.
    it('names the same model in both modes when the two jobs share one', () => {
      const both = { models: CATALOGUE, model: 'sonnet', planModel: null }
      const { rerender } = renderComposer(both)

      expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Sonnet')

      rerender({ ...both, planMode: true })
      expect(screen.getByRole('button', { name: 'Model' })).toHaveTextContent('Sonnet')
    })

    // The effort control answers about the model in force, so a plan model that
    // takes no effort greys it out for as long as planning lasts.
    it('greys the effort out from the plan model while planning', () => {
      const plain = { ...OPUS, value: 'plain', supportsEffort: false, supportedEffortLevels: null }
      renderComposer({
        models: [plain, OPUS],
        model: OPUS.value,
        planModel: 'plain',
        planMode: true
      })

      expect(screen.getByRole('button', { name: 'Effort' })).toBeDisabled()
    })

    // The plan keeps what it was on — the agent's default, said with the word.
    it('reports a model of its own for writing as a split', async () => {
      const user = userEvent.setup()
      const { onModels } = renderComposer({ models: [OPUS] })

      await user.click(screen.getByRole('button', { name: 'Model' }))
      await user.click(within(codeColumn()).getByRole('radio', { name: /Opus 5/ }))

      expect(onModels).toHaveBeenCalledExactlyOnceWith({
        model: 'claude-opus-5',
        planModel: 'default'
      })
    })
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

  // The model half of what used to be one test about both settings. Neither
  // picker offers to say nothing any more; the effort half is the scale's own,
  // and lives beside it.
  it('offers no way to leave the model unsaid', async () => {
    const user = userEvent.setup()
    renderComposer({ effort: 'high', models: CATALOGUE })

    await user.click(screen.getByRole('button', { name: 'Model' }))

    expect(screen.queryByRole('radio', { name: 'Agent decides' })).not.toBeInTheDocument()
  })

  it('names the effort in force on the chip', () => {
    renderComposer({ effort: 'high' })

    expect(screen.getByRole('button', { name: 'Effort' })).toHaveTextContent('High')
  })

  // The whole reason it moved out of the header: there it was disabled until
  // the first message had gone, so the mode that message ran under was the one
  // mode nobody could choose.
  it('can be changed before anything has been sent', async () => {
    const user = userEvent.setup()
    const { onMode } = renderComposer()

    expect(modeButton()).toBeEnabled()

    await user.click(modeButton())

    expect(onMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')
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
    aliases: ['reset'],
    skill: false
  }

  const COMPACT: AgentCommand = {
    name: 'compact',
    description: 'Summarise the conversation so far',
    argumentHint: '',
    aliases: [],
    skill: false
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

  // Shift+tab is the mode, as in Claude Code, even with the list open.
  it('switches the mode on shift+tab rather than completing', async () => {
    const user = userEvent.setup()
    const { onMode } = renderComposer({ commands: [CLEAR, COMPACT] })

    await user.type(field(), '/comp')
    await user.keyboard('{Shift>}{Tab}{/Shift}')

    expect(onMode).toHaveBeenCalledExactlyOnceWith('acceptEdits')
    expect(field()).toHaveValue('/comp')
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

  describe('in the middle of a sentence', () => {
    const REVIEW: AgentCommand = {
      name: 'review',
      description: 'Review the change',
      argumentHint: '',
      aliases: [],
      skill: true
    }

    /*
     * A skill named after plain text is permission for Claude to run it, which
     * is worth offering. A built-in there does nothing at all — `/clear` in a
     * sentence clears nothing — so offering it would be offering a mistake.
     */
    it('offers only the skills', async () => {
      const user = userEvent.setup()
      renderComposer({ commands: [CLEAR, COMPACT, REVIEW] })

      await user.type(field(), 'please use /')

      expect(options()).toHaveLength(1)
      expect(screen.getByText('/review')).toBeVisible()
    })

    it('still offers every command at the start', async () => {
      const user = userEvent.setup()
      renderComposer({ commands: [CLEAR, COMPACT, REVIEW] })

      await user.type(field(), '/')

      expect(options()).toHaveLength(3)
    })

    // The sentence carries on after the name, so it gets its space, and nothing
    // around it is touched.
    it('puts the pick where the word was, and keeps the rest of the sentence', async () => {
      const user = userEvent.setup()
      const { onSend } = renderComposer({ commands: [CLEAR, REVIEW] })

      await user.type(field(), 'please /re')
      await user.keyboard('{Enter}')
      await user.type(field(), 'this change')
      await user.keyboard('{Enter}')

      expect(onSend).toHaveBeenCalledExactlyOnceWith('please /review this change')
    })

    // Read at the caret: a word typed in front of text that is already there.
    it('completes a word typed before existing text', async () => {
      const user = userEvent.setup()
      renderComposer({ commands: [REVIEW], initialDraft: 'use  on this' })

      await user.click(field())
      await user.keyboard('{Home}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}/re')
      await user.keyboard('{Enter}')

      expect(field()).toHaveValue('use /review  on this')
    })

    /*
     * Escape sends away the list for the word it was open on, not for every
     * word after it: moving to another `/` is asking again, and finding the
     * list gone there would read as the feature having stopped working.
     */
    it('closes when a click lands outside', async () => {
      const user = userEvent.setup()
      renderComposer({ commands: [REVIEW] })

      await user.type(field(), 'use /')
      await user.click(document.body)

      expect(options()).toEqual([])
    })

    it('dismisses for one word only', async () => {
      const user = userEvent.setup()
      renderComposer({ commands: [REVIEW], initialDraft: '/re and /re' })

      await user.click(field())
      await user.keyboard('{End}{Escape}')
      expect(options()).toEqual([])

      await user.keyboard('{Home}{ArrowRight}{ArrowRight}{ArrowRight}')
      expect(options()).toHaveLength(1)
    })
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
    expect(within(planColumn()).getByRole('radio', { name: /Opus \(1M context\)/ })).toBeChecked()
    // And the panel says why its tick and the chip disagree.
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'This session is running Sonnet: /model chose it for this session only.'
    )
  })

  // The ordinary case, where the two agree. The button says the name once.
  it('says it once when the session is on what the default runs', () => {
    renderComposer({ models: CATALOGUE, model: null, activeModel: 'claude-opus-5[1m]' })

    expect(modelButton()).toHaveTextContent('Opus (1M context)')
    expect(modelButton()).not.toHaveTextContent('auto')
  })

  it('says nothing of /model while the session runs what the panel ticks', async () => {
    const user = userEvent.setup()
    renderComposer({ models: CATALOGUE, model: null, activeModel: 'claude-opus-5[1m]' })

    await user.click(modelButton())

    expect(screen.getByRole('dialog')).not.toHaveTextContent('/model')
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

    expect(within(planColumn()).getByRole('radio', { name: 'Sonnet' })).toBeChecked()
    // And no second row invented for a model already in the list.
    expect(
      within(planColumn()).queryByRole('radio', { name: 'claude-sonnet-5' })
    ).not.toBeInTheDocument()
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

  // With no catalogue the default row has no model behind it, so any running
  // model would read as moved there by a `/model` nobody typed.
  it('blames no /model while there is no catalogue to compare against', async () => {
    const user = userEvent.setup()
    renderComposer({ models: [], model: null, activeModel: 'claude-brand-new-1' })

    await user.click(modelButton())

    expect(screen.getByRole('dialog')).not.toHaveTextContent('/model')
  })
  /*
   * Three ways in, and the paperclip is the only visible one. A file is more
   * often dragged onto the composer or pasted into it, and neither of those can
   * be seen — the paperclip is there to say the guess would be right.
   */
  /* Without `preventDefault` on the dragover the drop never fires at all, and
     without `dropEffect` the cursor says "no" over a target that would take it. */
  it('says a drop would land while something is over it', () => {
    renderComposer()
    const box = field().closest('div') as HTMLElement
    const transfer = { files: [], types: ['Files'], dropEffect: 'none' }

    fireEvent.dragOver(box, { dataTransfer: transfer })

    expect(transfer.dropEffect).toBe('copy')
    expect(box.className).toContain('border-accent')
    // The plain accent is the whole signal: the colour ring steps aside.
    expect(box.className).not.toContain('composer-ring')
  })

  /* Dragging over a child fires `dragleave` for the parent, so the naive
     version flickers as the cursor crosses the attic. */
  it('keeps saying so while the pointer crosses a child', () => {
    renderComposer()
    const box = field().closest('div') as HTMLElement

    fireEvent.dragOver(box, { dataTransfer: { files: [], types: ['Files'] } })

    // `relatedTarget` is a read-only accessor on the event, so it is defined
    // onto one built by hand rather than passed to `fireEvent`.
    fireEvent(box, leaving(box, field()))
    expect(box.className).toContain('border-accent')

    fireEvent(box, leaving(box, document.body))
    expect(box.className).not.toContain('border-accent')
    expect(box.className).toContain('composer-ring')
  })

  it('wears the ring frame at rest', () => {
    renderComposer()
    const box = field().closest('div') as HTMLElement

    expect(box.className).toContain('composer-ring')
    expect(box.className).not.toContain('border-accent')
  })

  // The ring's line is its own element, so that turning it repaints an edge
  // rather than the whole frame — and it is decoration, so nothing reads it.
  it('draws the ring line as a hidden layer of its own, and none while dragging', () => {
    renderComposer()
    const box = field().closest('div') as HTMLElement
    const line = box.querySelector('.composer-ring-line')

    expect(line).not.toBeNull()
    expect(line).toHaveAttribute('aria-hidden')
    expect(box.firstElementChild).toBe(line)

    fireEvent.dragOver(box, { dataTransfer: { files: [], types: ['Files'] } })

    expect(box.querySelector('.composer-ring-line')).toBeNull()
  })

  // The field is written in the fixed-width face, the rest of the window in
  // the sans.
  it('sets what is typed in the prompt face', () => {
    renderComposer()

    expect(field()).toHaveClass('font-prompt')
  })

  it('takes a file dropped anywhere on the composer', () => {
    const { onDropFiles } = renderComposer()
    const file = new File(['x'], 'shot.png', { type: 'image/png' })

    fireEvent.drop(field().closest('div') as HTMLElement, {
      dataTransfer: { files: [file], types: ['Files'] }
    })

    expect(onDropFiles).toHaveBeenCalledWith([file])
  })

  /* A clipboard carries a picture rather than a file, so this is the one
     attachment that has no path until octopus makes one. */
  it('takes an image pasted into the field', () => {
    const { onPasteImage } = renderComposer()
    const image = new File(['x'], 'shot.png', { type: 'image/png' })

    fireEvent.paste(field(), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        getData: () => ''
      }
    })

    expect(onPasteImage).toHaveBeenCalledWith(image)
  })

  /* Copying a cell out of a spreadsheet puts a picture on the clipboard beside
     the text, and the text is what was meant. */
  it('leaves a paste that carries text alone', () => {
    const { onPasteImage } = renderComposer()

    fireEvent.paste(field(), {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File(['x'], 'cell.png') }],
        getData: () => '1\t2'
      }
    })

    expect(onPasteImage).not.toHaveBeenCalled()
  })

  it('leaves an ordinary text paste alone', () => {
    const { onPasteImage } = renderComposer()

    fireEvent.paste(field(), { clipboardData: { items: [], getData: () => 'hello' } })

    expect(onPasteImage).not.toHaveBeenCalled()
  })

  /* A file pointed at is written into the text where the caret is, as a path
     typed there would be — not on a chip, and not under a heading of its own.
     What goes out is where the file is, not a copy: §4's rule that nothing
     implicit reaches the agent, in the plainest form it takes. */
  it('writes a file pointed at into the text, where the caret is', async () => {
    const user = userEvent.setup()
    const { onFilesTaken, onSend, rerender } = renderComposer()

    await user.type(field(), 'compare with')
    const textarea = field() as HTMLTextAreaElement
    textarea.setSelectionRange(7, 7)
    fireEvent.select(textarea)

    rerender({ files: ['/a/shot.png'] })

    expect(textarea).toHaveValue('compare /a/shot.png with')
    // Taken, so the same path is not written a second time.
    expect(onFilesTaken).toHaveBeenCalledOnce()
    // The caret after it, and the field ready for the next word.
    expect(textarea).toHaveFocus()
    expect(textarea.selectionStart).toBe(19)

    await user.click(screen.getByRole('button', { name: 'Send' }))
    // Nothing added in front of it: the message is what the field said.
    expect(onSend).toHaveBeenCalledWith('compare /a/shot.png with')
  })

  it('writes nothing while no file is waiting', () => {
    const { onFilesTaken } = renderComposer({ initialDraft: 'as it was' })

    expect(field()).toHaveValue('as it was')
    expect(onFilesTaken).not.toHaveBeenCalled()
  })
})

/*
 * `@` names a subagent. The pick goes into the text as `@agent-<name>`, which
 * is how Claude Code is told to hand the work to that agent rather than leave
 * the choice to Claude — so the message the user reads back says it.
 */
describe('mentioning a subagent', () => {
  const EXPLORE = { name: 'Explore', description: 'Searches the code' }
  const PLAN = { name: 'Plan', description: 'Designs the change' }
  const REVIEW = { name: 'my-plugin:review', description: 'Reviews a change' }

  const options = (): HTMLElement[] => screen.queryAllByRole('option')

  beforeEach(() => {
    // jsdom has no layout, so the list's scroll-into-view is not there to call.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('offers the agents as soon as an @ is typed', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [EXPLORE, PLAN] })

    await user.type(field(), '@')

    expect(options()).toHaveLength(2)
    expect(screen.getByText('@Explore')).toBeVisible()
    expect(screen.getByText('Searches the code')).toBeVisible()
  })

  it('narrows to what has been typed, plugin names included', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [EXPLORE, PLAN, REVIEW] })

    await user.type(field(), 'ask @my-plugin:r')

    expect(options()).toHaveLength(1)
    expect(screen.getByText('@my-plugin:review')).toBeVisible()
  })

  // The docs spell it `@agent-Explore`, and somebody who types that has
  // asked for the same thing.
  it('answers to the written form as well', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [EXPLORE, PLAN] })

    await user.type(field(), '@agent-Exp')

    expect(options()).toHaveLength(1)
    expect(screen.getByText('@Explore')).toBeVisible()
  })

  it('writes the pick into the sentence and keeps the rest of it', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ agents: [EXPLORE, PLAN] })

    await user.type(field(), 'ask @Ex')
    await user.keyboard('{Enter}')
    await user.type(field(), 'where auth lives')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledExactlyOnceWith('ask @agent-Explore where auth lives')
  })

  it('walks the list with the arrows and takes a pick on tab', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [EXPLORE, PLAN] })

    await user.type(field(), '@')
    await user.keyboard('{ArrowDown}{Tab}')

    expect(field()).toHaveValue('@agent-Plan ')
  })

  it('can be picked with the mouse', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [EXPLORE, PLAN] })

    await user.type(field(), '@')
    await user.click(screen.getByRole('option', { name: /Plan/ }))

    expect(field()).toHaveValue('@agent-Plan ')
  })

  // An email address is not a mention, and a list opening inside one would
  // take Enter away from the person typing it.
  it('stays shut when the @ does not start a word', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [EXPLORE] })

    await user.type(field(), 'mail me@Ex')

    expect(options()).toEqual([])
  })

  it('closes on escape and comes back when typing continues', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [EXPLORE, PLAN] })

    await user.type(field(), '@')
    await user.keyboard('{Escape}')
    expect(options()).toEqual([])

    await user.type(field(), 'E')
    expect(options()).toHaveLength(1)
  })

  it('closes when a click lands outside', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [EXPLORE] })

    await user.type(field(), '@')
    await user.click(document.body)

    expect(options()).toEqual([])
  })

  // Nothing matching is nothing to complete, so Enter sends as it always does.
  it('sends an @ that matches nothing', async () => {
    const user = userEvent.setup()
    const { onSend } = renderComposer({ agents: [EXPLORE] })

    await user.type(field(), 'cc @zzz')
    await user.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledExactlyOnceWith('cc @zzz')
  })

  // Files are attached with the paperclip, a drop or a paste; `@` is only
  // for what the agent can hand work to.
  it('offers no files', async () => {
    const user = userEvent.setup()
    renderComposer({ agents: [] })

    await user.type(field(), '@READ')

    expect(options()).toEqual([])
  })
})

describe('stopping with Escape', () => {
  const COMMANDS: AgentCommand[] = [
    { name: 'clear', description: '', argumentHint: '', aliases: [], skill: false },
    { name: 'compact', description: '', argumentHint: '', aliases: [], skill: false }
  ]

  it('stops a turn that is running', async () => {
    const user = userEvent.setup()
    const { onStop } = renderComposer({ busy: true })

    await user.click(field())
    await user.keyboard('{Escape}')

    expect(onStop).toHaveBeenCalledOnce()
  })

  // Idle, Escape means nothing — it is not a way to clear the field.
  it('does nothing when no turn is running', async () => {
    const user = userEvent.setup()
    const { onStop } = renderComposer({ busy: false })

    await user.type(field(), 'half a thought{Escape}')

    expect(onStop).not.toHaveBeenCalled()
    expect(field()).toHaveValue('half a thought')
  })

  // The same key closes the list, and must not also interrupt the agent.
  it('closes a suggestion list rather than stopping the turn', async () => {
    const user = userEvent.setup()
    const { onStop } = renderComposer({ busy: true, commands: COMMANDS })

    await user.type(field(), '/')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onStop).not.toHaveBeenCalled()
  })

  // There Escape cancels the candidate, and is not meant for the application.
  it('leaves an Escape that cancels an IME candidate alone', () => {
    const { onStop } = renderComposer({ busy: true })

    fireEvent.keyDown(field(), { key: 'Escape', isComposing: true })

    expect(onStop).not.toHaveBeenCalled()
  })

  it('names the key on the stop button', () => {
    renderComposer({ busy: true })

    expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('title', 'Stop (Esc)')
  })
})

describe('a message handed back', () => {
  // A rewound message comes back to be edited and sent again: it replaces what
  // was there, as Claude Code's own rewind does, and the next key continues it.
  it('takes the place of the draft, with the caret at its end and the focus in the field', () => {
    const { rerender } = renderComposer({ initialDraft: 'half a thought' })

    rerender({ seed: { text: 'rename it', id: 1 } })

    const field = screen.getByRole('textbox')
    expect(field).toHaveValue('rename it')
    expect(field).toHaveFocus()
    expect((field as HTMLTextAreaElement).selectionStart).toBe('rename it'.length)
  })

  // A render that passes the same seed again is not a second instruction.
  it('is applied once per hand-back, and again for the next one', async () => {
    const user = userEvent.setup()
    const { rerender } = renderComposer()
    rerender({ seed: { text: 'rename it', id: 1 } })
    await user.type(screen.getByRole('textbox'), ' carefully')

    rerender({ seed: { text: 'rename it', id: 1 } })
    expect(screen.getByRole('textbox')).toHaveValue('rename it carefully')

    rerender({ seed: { text: 'rename it', id: 2 } })
    expect(screen.getByRole('textbox')).toHaveValue('rename it')
  })

  // "Add to chat" is added to a message, not one — so a half-written message is
  // kept and the text goes after it, on a line of its own.
  it('goes after the draft on a line of its own when it is to be appended', () => {
    const { rerender } = renderComposer({ initialDraft: 'half a thought  ' })

    rerender({ seed: { text: 'the heads-up', id: 1, append: true } })

    const field = screen.getByRole('textbox')
    expect(field).toHaveValue('half a thought\n\nthe heads-up')
    expect(field).toHaveFocus()
    expect((field as HTMLTextAreaElement).selectionStart).toBe(
      'half a thought\n\nthe heads-up'.length
    )
  })

  // With nothing written there is nothing to separate it from.
  it('stands alone when appended to an empty field', () => {
    const { rerender } = renderComposer({ initialDraft: '   ' })

    rerender({ seed: { text: 'the heads-up', id: 1, append: true } })

    expect(screen.getByRole('textbox')).toHaveValue('the heads-up')
  })

  // Remounted per workspace: a seed already applied must not come back.
  it('takes one present when it mounts as already applied', () => {
    renderComposer({ initialDraft: 'my own words', seed: { text: 'rename it', id: 3 } })

    expect(screen.getByRole('textbox')).toHaveValue('my own words')
  })
})
