import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { useConfirm, type ConfirmRequest, type ConfirmResult } from './useConfirm.js'

/**
 * jsdom ships `<dialog>` without its behaviour, and `Modal` opens itself with
 * `showModal()`. Only the part the dialog observes is reproduced here: the
 * element becomes visible, and Escape turns into the `cancel` event the browser
 * sends for a close request. Everything else — focus trapping, the backdrop —
 * is the platform's job and not what these tests are about.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.open = false
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    document.querySelector('dialog[open]')?.dispatchEvent(new Event('cancel', { cancelable: true }))
  })
})

const QUESTION: ConfirmRequest = {
  title: 'Delete workspace',
  message: 'The worktree and its branch will be removed.',
  confirmLabel: 'Delete',
  cancelLabel: 'Keep it'
}

/**
 * Stands in for a screen that asks something.
 *
 * The hook only hands back a dialog element and a promise, so a component has
 * to render the one and wait for the other before there is anything to assert.
 */
function Asker({
  request,
  onAnswer
}: {
  readonly request: ConfirmRequest
  readonly onAnswer: (result: ConfirmResult) => void
}): React.JSX.Element {
  const { confirm, dialog } = useConfirm()

  return (
    <>
      <button
        type="button"
        onClick={() => {
          void confirm(request).then(onAnswer)
        }}
      >
        Ask
      </button>
      {dialog}
    </>
  )
}

async function ask(request: ConfirmRequest = QUESTION): Promise<{
  readonly answer: ReturnType<typeof vi.fn<(result: ConfirmResult) => void>>
  readonly user: ReturnType<typeof userEvent.setup>
  /** Asks the same thing again, or something else, from the same hook. */
  readonly askAgain: (next?: ConfirmRequest) => Promise<void>
}> {
  const answer = vi.fn<(result: ConfirmResult) => void>()
  const user = userEvent.setup()

  const { rerender } = render(<Asker request={request} onAnswer={answer} />)
  const trigger = screen.getByRole('button', { name: 'Ask' })
  await user.click(trigger)

  return {
    answer,
    user,
    askAgain: async (next = request) => {
      // Same element in the same place, so the hook keeps the state it built
      // up answering the first question — which is the point of asking twice.
      rerender(<Asker request={next} onAnswer={answer} />)
      await user.click(trigger)
    }
  }
}

describe('useConfirm', () => {
  it('asks nothing until it is called', () => {
    render(
      <Asker
        request={QUESTION}
        onAnswer={() => {
          /* nothing is answered in this test */
        }}
      />
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('shows the title, the message and the detail it was given', async () => {
    await ask({ ...QUESTION, detail: 'Uncommitted changes will be lost.' })

    expect(screen.getByRole('dialog', { name: 'Delete workspace' })).toBeInTheDocument()
    expect(screen.getByText('The worktree and its branch will be removed.')).toBeInTheDocument()
    expect(screen.getByText('Uncommitted changes will be lost.')).toBeInTheDocument()
  })

  // Asking twice rather than once: a detail that is simply never supplied is
  // absent whatever the dialog does with it, so the line has to be on screen
  // first for its absence to mean anything.
  it('leaves out the detail line when the next question has none', async () => {
    const { user, askAgain } = await ask({
      ...QUESTION,
      detail: 'Uncommitted changes will be lost.'
    })
    expect(screen.getByText('Uncommitted changes will be lost.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await askAgain(QUESTION)

    expect(screen.getByRole('dialog', { name: 'Delete workspace' })).toBeInTheDocument()
    expect(screen.queryByText('Uncommitted changes will be lost.')).not.toBeInTheDocument()
  })

  it('labels both buttons with the words the caller chose', async () => {
    await ask()

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument()
  })

  it('answers yes when the confirm button is pressed', async () => {
    const { answer, user } = await ask()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(answer).toHaveBeenCalledWith({ confirmed: true, checked: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('answers no when the cancel button is pressed', async () => {
    const { answer, user } = await ask()

    await user.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(answer).toHaveBeenCalledWith({ confirmed: false, checked: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  // Walking away from the question is a no, not a hang: whoever awaited the
  // promise is still waiting for an answer.
  it('answers no when the dialog is closed instead', async () => {
    const { answer, user } = await ask()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(answer).toHaveBeenCalledWith({ confirmed: false, checked: false })
  })

  it('answers no when Escape is pressed', async () => {
    const { answer, user } = await ask()

    await user.keyboard('{Escape}')

    expect(answer).toHaveBeenCalledWith({ confirmed: false, checked: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers no checkbox unless one was asked for', async () => {
    await ask()

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('offers the checkbox unticked and brings its state back with a yes', async () => {
    const { answer, user } = await ask({
      ...QUESTION,
      checkbox: { label: 'Also delete the branch' }
    })

    const checkbox = screen.getByRole('checkbox', { name: 'Also delete the branch' })
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(answer).toHaveBeenCalledWith({ confirmed: true, checked: true })
  })

  it('reports the checkbox as untouched when it was left alone', async () => {
    const { answer, user } = await ask({
      ...QUESTION,
      checkbox: { label: 'Also delete the branch' }
    })

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(answer).toHaveBeenCalledWith({ confirmed: true, checked: false })
  })

  // The extra choice belongs to the action being confirmed, so saying no to the
  // action says no to it too — nothing was ticked for a caller to act on.
  it('drops the ticked checkbox when the answer is no', async () => {
    const { answer, user } = await ask({
      ...QUESTION,
      checkbox: { label: 'Also delete the branch' }
    })

    await user.click(screen.getByRole('checkbox', { name: 'Also delete the branch' }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(answer).toHaveBeenCalledWith({ confirmed: false, checked: false })
  })

  // A tick left over from the previous question would arm an extra action
  // nobody chose this time round.
  it('starts the next question with the checkbox cleared', async () => {
    const { user, askAgain } = await ask({
      ...QUESTION,
      checkbox: { label: 'Also delete the branch' }
    })

    await user.click(screen.getByRole('checkbox', { name: 'Also delete the branch' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await askAgain()

    expect(screen.getByRole('checkbox', { name: 'Also delete the branch' })).not.toBeChecked()
  })

  it('answers a destructive question the same way as any other', async () => {
    const { answer, user } = await ask({ ...QUESTION, destructive: true })

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(answer).toHaveBeenCalledWith({ confirmed: true, checked: false })
  })
})
