import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { Prompt } from '@core/promptSchema.js'

import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import { PlanDialog } from './PlanDialog.js'

beforeAll(stubDialogElement)

const PLAN = '# Normalising the locales\n\n## Context\n\nUse `en.ts` as the source.'

type Props = Omit<
  React.ComponentProps<typeof PlanDialog>,
  'text' | 'onText' | 'feedback' | 'onFeedback'
> & {
  /** What the field holds when the dialog opens: a note left there from before. */
  readonly initialFeedback?: string
}

/**
 * The pane's half of the contract: it holds the text the dialog shows and takes
 * back what is typed. The dialog is controlled, and tested the way it is used.
 */
function Held({ initialFeedback = '', ...props }: Props): React.JSX.Element {
  const [text, setText] = useState(props.plan)
  const [feedback, setFeedback] = useState(initialFeedback)

  return (
    <PlanDialog
      {...props}
      text={text}
      onText={setText}
      feedback={feedback}
      onFeedback={setFeedback}
    />
  )
}

function renderDialog(overrides: Partial<Props> = {}): {
  onExecute: ReturnType<typeof vi.fn>
  onKeepPlanning: ReturnType<typeof vi.fn>
  onMinimize: ReturnType<typeof vi.fn>
  onFork: ReturnType<typeof vi.fn>
} {
  const onExecute = vi.fn()
  const onFork = vi.fn(() => Promise.resolve())
  const onKeepPlanning = vi.fn()
  const onMinimize = vi.fn()

  render(
    <Held
      plan={PLAN}
      projectId="planner"
      goesOnIn="acceptEdits"
      onExecute={onExecute}
      onFork={onFork}
      onKeepPlanning={onKeepPlanning}
      onMinimize={onMinimize}
      {...overrides}
    />
  )

  return { onExecute, onKeepPlanning, onMinimize, onFork }
}

describe('the plan itself', () => {
  // As a strip in the log with Allow and Deny on it, the plan was read past on
  // the way to a button — and what the agent did next was start editing files.
  it('is shown with its structure rather than as a wall of hashes', () => {
    renderDialog()

    expect(screen.getByText('Normalising the locales')).toBeInTheDocument()
    expect(screen.getByText('en.ts').tagName).toBe('CODE')
    expect(screen.queryByText(/^# /)).not.toBeInTheDocument()
  })
})

describe('the two ways out', () => {
  // Executing out of planning widens what the agent may do — it goes on in
  // Accept edits — so the dialog says it before the click, not after.
  it('says executing runs in Accept edits', () => {
    renderDialog()

    expect(
      screen.getByText('Runs with Accept edits on — file changes go ahead without asking.')
    ).toBeInTheDocument()
  })

  // A plan the agent offered unasked changes no mode, so there is nothing to
  // warn about — and a warning that is not true is one nobody reads twice.
  it('says nothing about Accept edits when executing changes no mode', () => {
    renderDialog({ goesOnIn: null })

    expect(screen.queryByText(/Runs with Accept edits on/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Runs in Auto/)).not.toBeInTheDocument()
  })

  // Carried out in Auto, the line says so instead: the steps are decided for
  // the user rather than accepted wholesale, which is a different promise.
  it('says executing runs in Auto when that is where it goes', () => {
    renderDialog({ goesOnIn: 'auto' })

    expect(
      screen.getByText(
        'Runs in Auto — each step is approved or refused for you, and anything unclear is asked.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/Runs with Accept edits on/)).not.toBeInTheDocument()
  })

  // Setting the plan aside to look something up is not an answer: the note in
  // the field must not go to the agent as one.
  it('minimises without sending the plan back', async () => {
    const user = userEvent.setup()
    const { onExecute, onKeepPlanning, onMinimize } = renderDialog()

    await user.type(screen.getByRole('textbox'), 'check the routes first')
    await user.click(screen.getByRole('button', { name: 'Minimise' }))

    expect(onMinimize).toHaveBeenCalledTimes(1)
    expect(onKeepPlanning).not.toHaveBeenCalled()
    expect(onExecute).not.toHaveBeenCalled()
  })

  it('executes when that is what was chosen', async () => {
    const user = userEvent.setup()
    const { onExecute, onKeepPlanning } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Execute' }))

    // Nothing was changed, so the agent is not told the plan is different.
    expect(onExecute).toHaveBeenCalledExactlyOnceWith(null)
    expect(onKeepPlanning).not.toHaveBeenCalled()
  })

  it('forks to carry it out elsewhere when that is what was chosen', async () => {
    const user = userEvent.setup()
    const { onExecute, onFork, onKeepPlanning } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Fork in new chat' }))

    expect(onFork).toHaveBeenCalledExactlyOnceWith(null)
    expect(onExecute).not.toHaveBeenCalled()
    expect(onKeepPlanning).not.toHaveBeenCalled()
  })

  // Beside the long hint, the footer squeezed the fork button until its label
  // broke onto a second line past the button's height. jsdom draws no layout,
  // so what is pinned is the rule that prevents it: the hint gives way, the
  // buttons do not, and executing is the one filled action.
  it('lets the hint wrap rather than the buttons, with executing as the one filled action', () => {
    renderDialog()

    const fork = screen.getByRole('button', { name: 'Fork in new chat' })
    const execute = screen.getByRole('button', { name: 'Execute' })
    for (const button of [fork, execute]) {
      expect(button).toHaveClass('shrink-0', 'whitespace-nowrap')
    }
    expect(screen.getByText(/Runs with Accept edits on/)).toHaveClass('min-w-0', 'flex-1')
    expect(fork).not.toHaveClass('bg-accent')
    expect(execute).toHaveClass('bg-success')
  })

  // A second click while the first fork is out would open a second tab, and
  // approving behind it would start the same work twice.
  it('holds both ways of carrying it out while a fork is on its way', async () => {
    const user = userEvent.setup()
    let settle = (): void => undefined
    const onFork = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve
        })
    )
    renderDialog({ onFork })

    await user.click(screen.getByRole('button', { name: 'Fork in new chat' }))

    expect(screen.getByRole('button', { name: 'Fork in new chat' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled()

    settle()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Fork in new chat' })).toBeEnabled()
    })
    expect(screen.getByRole('button', { name: 'Execute' })).toBeEnabled()
    expect(onFork).toHaveBeenCalledTimes(1)
  })

  describe('rewriting the plan before approving it', () => {
    const editor = (): HTMLElement => screen.getByRole('textbox', { name: 'The plan, as markdown' })

    it('opens the plan as text to edit, and back to the rendered plan', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      expect(editor()).toHaveValue(PLAN)

      await user.click(screen.getByRole('button', { name: 'Back to the plan' }))
      expect(
        screen.queryByRole('textbox', { name: 'The plan, as markdown' })
      ).not.toBeInTheDocument()
      expect(screen.getByText('Normalising the locales')).toBeInTheDocument()
    })

    it('approves with the words the user wrote', async () => {
      const user = userEvent.setup()
      const { onExecute } = renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.clear(editor())
      await user.type(editor(), '# Only the tests')
      await user.click(screen.getByRole('button', { name: 'Execute' }))

      expect(onExecute).toHaveBeenCalledExactlyOnceWith('# Only the tests')
    })

    // The fork's agent only ever saw the original, so it is told the rewrite.
    it('forks with the words the user wrote', async () => {
      const user = userEvent.setup()
      const { onFork } = renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.clear(editor())
      await user.type(editor(), '# Only the tests')
      await user.click(screen.getByRole('button', { name: 'Fork in new chat' }))

      expect(onFork).toHaveBeenCalledExactlyOnceWith('# Only the tests')
    })

    // Looking at the rendered plan again must not throw the edits away.
    it('keeps the edits when the editor is closed and the plan is looked at', async () => {
      const user = userEvent.setup()
      const { onExecute } = renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.clear(editor())
      await user.type(editor(), '# Rewritten')
      await user.click(screen.getByRole('button', { name: 'Back to the plan' }))

      expect(screen.getByText('Rewritten')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Execute' }))
      expect(onExecute).toHaveBeenCalledExactlyOnceWith('# Rewritten')
    })

    // An edit that ends where it began is not an edit.
    it('does not call it an edit when it was put back as it was', async () => {
      const user = userEvent.setup()
      const { onExecute } = renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.type(editor(), ' ')
      await user.click(screen.getByRole('button', { name: 'Execute' }))

      expect(onExecute).toHaveBeenCalledExactlyOnceWith(null)
    })

    // An emptied editor is not a plan. Approving the original under it would do
    // something the field plainly says it is not doing.
    it('will not approve while the editor is empty', async () => {
      const user = userEvent.setup()
      const { onExecute } = renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit' }))
      await user.clear(editor())

      expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Fork in new chat' })).toBeDisabled()
      expect(onExecute).not.toHaveBeenCalled()
    })
  })

  /*
   * The button no longer names a mode.
   *
   * It is chosen in the composer's footer — which is what the session runs
   * under, and is on screen behind the backdrop — so naming it again here was
   * a second place for the same fact to go stale.
   */
  it('says the same thing whatever the chat will run under', () => {
    renderDialog()

    expect(screen.getAllByRole('button', { name: 'Execute' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /asking|without/ })).not.toBeInTheDocument()
  })

  /*
   * Writing in the field is what carrying on planning *is*, so a button saying
   * so was the same decision offered twice. With it gone, the keys are the
   * composer's — one convention rather than two — and this is now the only
   * thing that sends the note at all.
   */
  // The composer's keys, and the composer's IME gap with them: the Enter that
  // confirms a candidate is not the Enter that sends the note.
  it('does not send the note on the enter that confirms an IME candidate', async () => {
    const user = userEvent.setup()
    const { onKeepPlanning } = renderDialog()
    const field = screen.getByRole('textbox')

    await user.type(field, 'もう一度')
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })

    expect(onKeepPlanning).not.toHaveBeenCalled()
  })

  // jsdom has no layout, so the class is what can be pinned: an inline textarea
  // leaves a gap under it and the send button lands below the text's line.
  it('keeps the note field a block so the send button sits on its line', () => {
    renderDialog()

    expect(screen.getByLabelText('Anything to work out first?')).toHaveClass('block')
  })

  it('sends the note on Enter, and lets shift break the line', async () => {
    const user = userEvent.setup()
    const { onKeepPlanning, onExecute } = renderDialog()

    const field = screen.getByLabelText('Anything to work out first?')
    await user.type(field, 'first line{Shift>}{Enter}{/Shift}second line')

    expect(onKeepPlanning).not.toHaveBeenCalled()
    expect(field).toHaveValue('first line\nsecond line')

    await user.type(field, '{Enter}')

    expect(onKeepPlanning).toHaveBeenCalledExactlyOnceWith('first line\nsecond line')
    expect(onExecute).not.toHaveBeenCalled()
  })

  // Enter is not the only way: the field has a button of its own, and it
  // answers even with nothing written.
  it('sends the note from the button beside the field', async () => {
    const user = userEvent.setup()
    const { onKeepPlanning } = renderDialog()
    const send = screen.getByRole('button', { name: 'Send the note and keep planning' })

    await user.type(screen.getByLabelText('Anything to work out first?'), 'a step for tests')
    await user.click(send)
    expect(onKeepPlanning).toHaveBeenLastCalledWith('a step for tests')

    await user.clear(screen.getByLabelText('Anything to work out first?'))
    await user.click(send)
    expect(onKeepPlanning).toHaveBeenLastCalledWith('')
  })

  // The note reaches the agent as the refusal's reason, which is how a
  // correction is answered by a better plan rather than by a stopped
  // conversation.
  it('trims what was written before sending it', async () => {
    const user = userEvent.setup()
    const { onKeepPlanning } = renderDialog()

    await user.type(
      screen.getByLabelText('Anything to work out first?'),
      '  Add a step for the tests  {Enter}'
    )

    expect(onKeepPlanning).toHaveBeenCalledExactlyOnceWith('Add a step for the tests')
  })

  /*
   * Dismissing is the third way anyone leaves a dialog — the corner button here,
   * Escape in the platform — and both arrive as `onClose`.
   *
   * It has to mean "keep planning" rather than nothing, because the agent is
   * blocked on this answer: a dismissal that resolved nothing would leave the
   * conversation waiting on a question no longer on screen, and this dialog
   * would reopen on the next render regardless.
   */
  it('keeps planning when the dialog is dismissed, carrying the note', async () => {
    const user = userEvent.setup()
    const { onKeepPlanning, onExecute } = renderDialog()

    await user.type(screen.getByLabelText('Anything to work out first?'), 'not yet')
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onKeepPlanning).toHaveBeenCalledExactlyOnceWith('not yet')
    expect(onExecute).not.toHaveBeenCalled()
  })

  // Closing with nothing typed still has to answer: the agent is blocked on it.
  it('answers even when dismissed with nothing written', async () => {
    const user = userEvent.setup()
    const { onKeepPlanning } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onKeepPlanning).toHaveBeenCalledExactlyOnceWith('')
  })
})

describe('the saved prompts beside the field for corrections', () => {
  const TIGHTEN: Prompt = {
    id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
    title: 'Tighten the plan',
    text: 'Make the plan smaller.',
    forPlan: true
  }
  const REVIEW: Prompt = {
    ...TIGHTEN,
    id: '8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    title: 'Review',
    forPlan: false
  }

  /** Answered by the store asked about, as the bridge does. */
  const holding = (project: Prompt[], global: Prompt[] = []): void => {
    vi.mocked(octopus().prompts.list).mockImplementation((store) =>
      Promise.resolve({ ok: true, value: store.kind === 'global' ? global : project })
    )
  }

  const feedbackField = (): HTMLTextAreaElement => screen.getByRole('textbox')

  /** The lists are drawn a moment after they are read. */
  const read = async (): Promise<void> => {
    await waitFor(() => {
      expect(octopus().prompts.list).toHaveBeenCalledTimes(2)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('is not there when no prompt is marked for the plan', async () => {
    holding([REVIEW])
    renderDialog()
    await read()

    expect(screen.queryByRole('button', { name: 'Saved prompts' })).not.toBeInTheDocument()
  })

  it('offers the ones marked for the plan, and not the rest, and no way to settings', async () => {
    const user = userEvent.setup()
    holding([REVIEW, TIGHTEN])
    renderDialog()
    await read()

    await user.click(screen.getByRole('button', { name: 'Saved prompts' }))

    expect(screen.getByRole('menuitem', { name: 'Tighten the plan' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Review' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Manage prompts…' })).not.toBeInTheDocument()
  })

  // `showModal()` makes everything outside the dialog inert: a fan drawn into
  // the body would be there and could not be reached.
  it('is drawn inside the dialog, where it can be reached', async () => {
    const user = userEvent.setup()
    holding([TIGHTEN])
    renderDialog()
    await read()

    await user.click(screen.getByRole('button', { name: 'Saved prompts' }))

    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('menu'))
  })

  it('writes the prompt into the note where the caret is', async () => {
    const user = userEvent.setup()
    holding([TIGHTEN])
    renderDialog()
    await read()

    await user.type(feedbackField(), 'ab cd')
    feedbackField().setSelectionRange(2, 2)
    fireEvent.select(feedbackField())
    await user.click(screen.getByRole('button', { name: 'Saved prompts' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Tighten the plan' }))

    expect(feedbackField()).toHaveValue('ab Make the plan smaller. cd')
    // The caret after it and the field ready for the next word.
    expect(feedbackField()).toHaveFocus()
    expect(feedbackField().selectionStart).toBe(25)
  })

  it('writes it at the end of a note that was already there when the dialog opened', async () => {
    const user = userEvent.setup()
    holding([TIGHTEN])
    renderDialog({ initialFeedback: 'first this' })
    await read()

    await user.click(screen.getByRole('button', { name: 'Saved prompts' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Tighten the plan' }))

    expect(feedbackField()).toHaveValue('first this Make the plan smaller. ')
  })

  it('goes back to the agent with the rest of the note when it is sent', async () => {
    const user = userEvent.setup()
    holding([TIGHTEN])
    const { onKeepPlanning } = renderDialog()
    await read()

    await user.type(feedbackField(), 'and')
    await user.click(screen.getByRole('button', { name: 'Saved prompts' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Tighten the plan' }))
    await user.keyboard('{Enter}')

    expect(onKeepPlanning).toHaveBeenCalledWith('and Make the plan smaller.')
  })

  /* The reason the popup claims its Escape: in this dialog Escape is "keep
     planning", which answers the agent. The key that closes the fan must not be
     the one that sends the plan back. */
  it('closes on Escape without the dialog taking the key as its own', async () => {
    const user = userEvent.setup()
    holding([TIGHTEN])
    const { onKeepPlanning } = renderDialog()
    await read()
    await user.click(screen.getByRole('button', { name: 'Saved prompts' }))

    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    act(() => {
      window.dispatchEvent(escape)
    })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(escape.defaultPrevented).toBe(true)
    expect(onKeepPlanning).not.toHaveBeenCalled()
  })
})
