import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { stubDialogElement } from '../../test/dialog.js'
import { PlanDialog } from './PlanDialog.js'

beforeAll(stubDialogElement)

const PLAN = '# Normalising the locales\n\n## Context\n\nUse `en.ts` as the source.'

function renderDialog(overrides: Partial<React.ComponentProps<typeof PlanDialog>> = {}): {
  onExecute: ReturnType<typeof vi.fn>
  onKeepPlanning: ReturnType<typeof vi.fn>
} {
  const onExecute = vi.fn()
  const onKeepPlanning = vi.fn()

  render(
    <PlanDialog plan={PLAN} onExecute={onExecute} onKeepPlanning={onKeepPlanning} {...overrides} />
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
  it('executes when that is what was chosen', async () => {
    const user = userEvent.setup()
    const { onExecute, onKeepPlanning } = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Execute' }))

    expect(onExecute).toHaveBeenCalledOnce()
    expect(onKeepPlanning).not.toHaveBeenCalled()
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
