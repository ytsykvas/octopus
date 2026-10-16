import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { FileRewind } from '@core/chats.js'
import type { RewindPreview, RewindScope } from '@core/rewind.js'

import { stubDialogElement } from '../test/dialog.js'
import { useRewindChoice } from './useRewindChoice.js'

beforeAll(stubDialogElement)

const FILES: FileRewind = {
  canRewind: true,
  error: null,
  filesChanged: ['a.ts', 'b.ts'],
  insertions: 12,
  deletions: 4,
  skippedLinks: 0
}

/**
 * Stands in for the pane: asks once, on a click, and reports the answer.
 *
 * The hook hands back a dialog and a promise, so something has to render the
 * one and wait for the other before there is anything to assert.
 */
function Asker({
  preview,
  onAnswer
}: {
  readonly preview: RewindPreview
  readonly onAnswer: (scope: RewindScope | null) => void
}): React.JSX.Element {
  const { choose, dialog } = useRewindChoice()

  return (
    <>
      <button type="button" onClick={() => void choose(preview).then(onAnswer)}>
        ask
      </button>
      {dialog}
    </>
  )
}

async function ask(preview: RewindPreview): Promise<ReturnType<typeof vi.fn>> {
  const onAnswer = vi.fn()
  render(<Asker preview={preview} onAnswer={onAnswer} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'ask' }))
  return onAnswer
}

const choice = (name: RegExp): HTMLElement => screen.getByRole('button', { name })

describe('what to put back', () => {
  it('offers all three when both halves can be had, each saying what it does', async () => {
    await ask({ conversation: true, files: FILES })

    expect(choice(/Conversation and files/)).toBeEnabled()
    expect(choice(/Conversation and files/)).toHaveTextContent(
      'Removes this message and everything after it.'
    )
    expect(choice(/Conversation and files/)).toHaveTextContent('Puts 2 files back')
    expect(choice(/Conversation only/)).toHaveTextContent('The files stay as they are.')
    expect(choice(/Files only/)).toHaveTextContent('+12 −4')
    expect(choice(/Files only/)).toHaveTextContent('The conversation stays as it is.')
    // What the numbers cannot say, once, while the files are on offer.
    expect(screen.getByText(/is overwritten, and cannot be brought back/)).toBeInTheDocument()
  })

  it.each(['both', 'conversation', 'files'] as const)(
    'answers with %s when it is chosen',
    async (scope) => {
      const onAnswer = await ask({ conversation: true, files: FILES })
      const name = {
        both: /Conversation and files/,
        conversation: /Conversation only/,
        files: /Files only/
      }

      await userEvent.setup().click(choice(name[scope]))

      expect(onAnswer).toHaveBeenCalledExactlyOnceWith(scope)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }
  )

  it('answers with nothing when dismissed', async () => {
    const onAnswer = await ask({ conversation: true, files: FILES })

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onAnswer).toHaveBeenCalledExactlyOnceWith(null)
  })

  // Escape, as every dialog here closes: the browser sends `cancel`.
  it('answers with nothing when Escape closes it', async () => {
    const onAnswer = await ask({ conversation: true, files: FILES })

    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))

    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledExactlyOnceWith(null)
    })
  })
})

/*
 * A choice that cannot be had stays in its place with the reason, rather
 * than vanishing: a missing row reads as a feature that is not there, and the
 * reason is the one thing the user can act on.
 */
describe('why a choice is not on offer', () => {
  it('says the conversation no longer holds the point, for both and for the conversation', async () => {
    await ask({ conversation: false, files: FILES })

    for (const name of [/Conversation and files/, /Conversation only/]) {
      expect(choice(name)).toBeDisabled()
      expect(choice(name)).toHaveTextContent('The agent no longer holds this point')
    }
    expect(choice(/Files only/)).toBeEnabled()
  })

  it('says another conversation is working, for the halves with files', async () => {
    await ask({ conversation: true, files: null })

    for (const name of [/Conversation and files/, /Files only/]) {
      expect(choice(name)).toBeDisabled()
      expect(choice(name)).toHaveTextContent('Another conversation in this workspace is working.')
    }
    expect(choice(/Conversation only/)).toBeEnabled()
    // Nothing will be overwritten, so nothing is warned about.
    expect(screen.queryByText(/is overwritten/)).not.toBeInTheDocument()
  })

  it('gives the agent’s own reason when it has one', async () => {
    await ask({ conversation: true, files: { ...FILES, canRewind: false, error: 'No checkpoint' } })

    expect(choice(/Files only/)).toHaveTextContent('The files cannot be put back: No checkpoint')
  })

  it('says it plainly when the agent gave none', async () => {
    await ask({ conversation: true, files: { ...FILES, canRewind: false, error: null } })

    expect(choice(/Files only/)).toHaveTextContent('The files cannot be put back to this message.')
  })

  it('says there is nothing to undo when nothing would change', async () => {
    await ask({ conversation: true, files: { ...FILES, filesChanged: [] } })

    expect(choice(/Files only/)).toBeDisabled()
    expect(choice(/Files only/)).toHaveTextContent(
      'The files are already as they were before this message.'
    )
  })

  // The conversation is named first, so its reason is the one given.
  it('gives the conversation’s reason for both when neither half can be had', async () => {
    await ask({ conversation: false, files: null })

    expect(choice(/Conversation and files/)).toHaveTextContent(
      'The agent no longer holds this point'
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })
})
