import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { CARD_TEXT_MAX, type DescriptionSave } from '@core/boardSchema.js'

import type { Failure } from '../../../../preload/index.js'
import { refusal } from '../../test/board.js'
import { held } from '../../test/held.js'
import type { DescriptionDraft } from './boardDrafts.js'
import { CardDescription } from './CardDescription.js'

const OPENED = '# Fix login\n\nOld text.\n'

let onDraft: Mock<(draft: DescriptionDraft | null) => void>
let onSave: Mock<(save: DescriptionSave) => Promise<Failure | null>>

beforeEach(() => {
  onDraft = vi.fn<(draft: DescriptionDraft | null) => void>()
  onSave = vi.fn<(save: DescriptionSave) => Promise<Failure | null>>(() => Promise.resolve(null))
})

function renderDescription(
  description = OPENED,
  draft: DescriptionDraft | null = null
): ReturnType<typeof render> {
  return render(
    <CardDescription description={description} draft={draft} onDraft={onDraft} onSave={onSave} />
  )
}

function field(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Description' })
}

describe('CardDescription', () => {
  it('shows the description without its title line', () => {
    renderDescription('# Fix login\n\nThe form forgets the e-mail.\n')

    expect(screen.getByText('The form forgets the e-mail.')).toBeInTheDocument()
    expect(screen.queryByText('Fix login')).toBeNull()
  })

  it('says there is no description yet', () => {
    renderDescription('# Fix login\n')

    expect(screen.getByText('No description yet.')).toBeInTheDocument()
  })

  it('is a section named Description', () => {
    renderDescription()

    expect(screen.getByRole('region', { name: 'Description' })).toBeInTheDocument()
  })

  it('opens the whole description for editing', async () => {
    renderDescription()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(field()).toHaveValue(OPENED)
    expect(field()).toHaveFocus()
    expect(field()).toHaveAttribute('maxlength', String(CARD_TEXT_MAX))
  })

  it('saves with ⌘Enter against the text it opened on', async () => {
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(field())
    await user.type(field(), 'New')
    await user.keyboard('{Meta>}{Enter}{/Meta}')

    expect(onSave).toHaveBeenCalledWith({ text: 'New', base: OPENED })
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('saves with Ctrl+Enter', async () => {
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('does not save on the Enter that confirms an IME candidate', async () => {
    renderDescription()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true, isComposing: true })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves with the button', async () => {
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(field())
    await user.type(field(), 'New')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith({ text: 'New', base: OPENED })
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('cancels with Escape', async () => {
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(field(), 'New')
    await user.keyboard('{Escape}')

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Old text.')).toBeInTheDocument()
  })

  it('cancels with the button', async () => {
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('Old text.')).toBeInTheDocument()
  })

  it('previews what is typed', async () => {
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(field())
    await user.type(field(), '# T\n\n**bold**')
    await user.click(screen.getByRole('button', { name: 'Preview' }))

    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('previews an emptied description as none and keeps the text', async () => {
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(field())
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getByText('No description yet.')).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('group', { name: 'Description' })).getByRole('button', {
        name: 'Edit'
      })
    )

    expect(field()).toHaveValue('')
  })

  it('offers to reload or overwrite a description changed on disk', async () => {
    onSave.mockResolvedValueOnce(refusal('cardChanged', { name: 'Fix login.md' }))
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(field())
    await user.type(field(), 'New')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(
      await screen.findByText('This description changed on disk while you were editing it.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeInTheDocument()
    expect(field()).toHaveValue('New')
  })

  it('overwrites on purpose', async () => {
    onSave.mockResolvedValueOnce(refusal('cardChanged', { name: 'Fix login.md' }))
    const user = userEvent.setup()
    renderDescription()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(field())
    await user.type(field(), 'New')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await user.click(await screen.findByRole('button', { name: 'Overwrite' }))

    expect(onSave).toHaveBeenLastCalledWith({ text: 'New', base: null })
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('reloads by dropping the edit', async () => {
    onSave.mockResolvedValueOnce(refusal('cardChanged', { name: 'Fix login.md' }))
    const user = userEvent.setup()
    renderDescription()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(field(), 'New')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await user.click(await screen.findByRole('button', { name: 'Reload' }))

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Old text.')).toBeInTheDocument()
  })

  it('forgets the conflict once the edit is dropped', async () => {
    onSave.mockResolvedValueOnce(refusal('cardChanged', { name: 'Fix login.md' }))
    const user = userEvent.setup()
    renderDescription()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Reload' }))

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(
      screen.queryByText('This description changed on disk while you were editing it.')
    ).toBeNull()
  })

  it('opens without a conflict that answered a save it cancelled', async () => {
    const answer = held<Failure | null>()
    onSave.mockReturnValueOnce(answer.promise)
    const user = userEvent.setup()
    renderDescription()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await act(async () => {
      answer.resolve(refusal('cardChanged', { name: 'Fix login.md' }))
      await answer.promise
    })

    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.queryByRole('button', { name: 'Overwrite' })).toBeNull()
  })

  it('keeps the editor open after another refusal', async () => {
    onSave.mockResolvedValueOnce(refusal('cardMissing', { name: 'Fix login.md' }))
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('button', { name: 'Save' })).toBeEnabled()
    expect(field()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('cannot save twice while a save is under way', async () => {
    const answer = held<Failure | null>()
    onSave.mockReturnValueOnce(answer.promise)
    const user = userEvent.setup()
    renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(field(), '{Meta>}{Enter}{/Meta}')
    expect(onSave).toHaveBeenCalledTimes(1)
    await act(async () => {
      answer.resolve(refusal('cardMissing', { name: 'Fix login.md' }))
      await answer.promise
    })

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(field()).toBeInTheDocument()
  })

  it('cannot overwrite twice while it is under way', async () => {
    onSave.mockResolvedValueOnce(refusal('cardChanged', { name: 'Fix login.md' }))
    const answer = held<Failure | null>()
    onSave.mockReturnValueOnce(answer.promise)
    const user = userEvent.setup()
    renderDescription()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await user.click(await screen.findByRole('button', { name: 'Overwrite' }))

    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeDisabled()
    await act(async () => {
      answer.resolve(null)
      await answer.promise
    })
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it('opens on the draft it is handed', () => {
    renderDescription(OPENED, { text: 'Kept', base: OPENED })

    expect(field()).toHaveValue('Kept')
  })

  it('leaves the focus alone when it opens on a draft', () => {
    renderDescription(OPENED, { text: 'Kept', base: OPENED })

    expect(field()).not.toHaveFocus()
  })

  it('takes the focus when a restored draft goes back to editing', async () => {
    const user = userEvent.setup()
    renderDescription(OPENED, { text: 'Kept', base: OPENED })

    await user.click(screen.getByRole('button', { name: 'Preview' }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))

    expect(field()).toHaveFocus()
  })

  it('hands the edit up on the way out', async () => {
    const user = userEvent.setup()
    const { unmount } = renderDescription()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(field(), '!')
    unmount()

    expect(onDraft).toHaveBeenCalledWith({ text: `${OPENED}!`, base: OPENED })
  })

  it('hands up nothing when nothing is being edited', () => {
    const { unmount } = renderDescription()

    unmount()

    expect(onDraft).toHaveBeenCalledWith(null)
  })
})
