import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { stubDialogElement } from '../../test/dialog.js'
import { PlanDialog } from './PlanDialog.js'

beforeAll(stubDialogElement)

const PLAN = '# Normalising the locales\n\n## Context\n\nUse `en.ts` as the source.'

type Props = Omit<React.ComponentProps<typeof PlanDialog>, 'text' | 'onText'>

/**
 * The pane's half of the contract: it holds the text the dialog shows and takes
 * back what is typed. The dialog is controlled, and tested the way it is used.
 */
function Held(props: Props): React.JSX.Element {
  const [text, setText] = useState(props.plan)

  return <PlanDialog {...props} text={text} onText={setText} />
}

function renderDialog(overrides: Partial<Props> = {}): {
  onExecute: ReturnType<typeof vi.fn>
  onKeepPlanning: ReturnType<typeof vi.fn>
} {
  const onExecute = vi.fn()
  const onKeepPlanning = vi.fn()

  render(
    <Held
      plan={PLAN}
      accepting
      onExecute={onExecute}
      onKeepPlanning={onKeepPlanning}
      {...overrides}
    />
  )

  return { onExecute, onKeepPlanning }
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
      screen.getByText('Runs in Accept edits — file edits go ahead without asking.')
    ).toBeInTheDocument()
  })

  // A plan the agent offered unasked changes no mode, so there is nothing to
  // warn about — and a warning that is not true is one nobody reads twice.
  it('says nothing about Accept edits when executing changes no mode', () => {
    renderDialog({ accepting: false })

    expect(screen.queryByText(/Runs in Accept edits/)).not.toBeInTheDocument()
  })

  it('executes when that is what was chosen', async () => {
    const user = userEvent.setup()
    const { onExecute, onKeepPlanning } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Execute' }))

    // Nothing was changed, so the agent is not told the plan is different.
    expect(onExecute).toHaveBeenCalledExactlyOnceWith(null)
    expect(onKeepPlanning).not.toHaveBeenCalled()
  })

  describe('rewriting the plan before approving it', () => {
    const editor = (): HTMLElement => screen.getByRole('textbox', { name: 'The plan, as markdown' })

    it('opens the plan as text to edit, and back to the rendered plan', async () => {
      const user = userEvent.setup()
      renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit the plan' }))
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

      await user.click(screen.getByRole('button', { name: 'Edit the plan' }))
      await user.clear(editor())
      await user.type(editor(), '# Only the tests')
      await user.click(screen.getByRole('button', { name: 'Execute' }))

      expect(onExecute).toHaveBeenCalledExactlyOnceWith('# Only the tests')
    })

    // Looking at the rendered plan again must not throw the edits away.
    it('keeps the edits when the editor is closed and the plan is looked at', async () => {
      const user = userEvent.setup()
      const { onExecute } = renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit the plan' }))
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

      await user.click(screen.getByRole('button', { name: 'Edit the plan' }))
      await user.type(editor(), ' ')
      await user.click(screen.getByRole('button', { name: 'Execute' }))

      expect(onExecute).toHaveBeenCalledExactlyOnceWith(null)
    })

    // An emptied editor is not a plan. Approving the original under it would do
    // something the field plainly says it is not doing.
    it('will not approve while the editor is empty', async () => {
      const user = userEvent.setup()
      const { onExecute } = renderDialog()

      await user.click(screen.getByRole('button', { name: 'Edit the plan' }))
      await user.clear(editor())

      expect(screen.getByRole('button', { name: 'Execute' })).toBeDisabled()
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
