import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NameEditor } from './NameEditor.js'

function renderEditor(initial = 'anna'): {
  field: HTMLElement
  onCommit: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
} {
  const onCommit = vi.fn()
  const onCancel = vi.fn()

  render(<NameEditor initial={initial} onCommit={onCommit} onCancel={onCancel} />)

  return { field: screen.getByRole('textbox'), onCommit, onCancel }
}

describe('NameEditor', () => {
  it('opens focused with the current name selected, so typing replaces it', async () => {
    const user = userEvent.setup()
    const { field } = renderEditor('anna')

    expect(field).toHaveFocus()

    // No click first: a click would collapse the selection the editor set up.
    await user.type(field, 'bruno', { skipClick: true })

    expect(field).toHaveValue('bruno')
  })

  // The worst of the three sites, because this one writes to disk: a name
  // typed through an IME was renamed on every confirmed candidate.
  it('does not commit on the enter that confirms an IME candidate', async () => {
    const user = userEvent.setup()
    const { onCommit } = renderEditor()
    const field = screen.getByRole('textbox')

    await user.type(field, '名前', { skipClick: true })
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true })

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the new name on Enter', async () => {
    const user = userEvent.setup()
    const { field, onCommit, onCancel } = renderEditor('anna')

    await user.type(field, 'bruno{Enter}', { skipClick: true })

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('bruno')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('discards the edit on Escape', async () => {
    const user = userEvent.setup()
    const { field, onCommit, onCancel } = renderEditor('anna')

    await user.type(field, 'bruno{Escape}', { skipClick: true })

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onCommit).not.toHaveBeenCalled()
  })

  // Clicking away is a common way to mean "done"; losing the edit there would
  // be surprising.
  it('commits when the field loses focus', async () => {
    const user = userEvent.setup()
    const { field, onCommit } = renderEditor('anna')

    await user.type(field, 'bruno', { skipClick: true })
    await user.tab()

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('bruno')
  })

  it('trims the surrounding whitespace off the committed name', async () => {
    const user = userEvent.setup()
    const { field, onCommit } = renderEditor('anna')

    await user.type(field, '   bruno   {Enter}', { skipClick: true })

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('bruno')
  })

  // An empty field mid-typing is a slip, not a request to erase the name.
  it('cancels rather than committing when the name is emptied', async () => {
    const user = userEvent.setup()
    const { field, onCommit, onCancel } = renderEditor('anna')

    await user.clear(field)
    await user.type(field, '{Enter}')

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('treats a name of only spaces as empty', async () => {
    const user = userEvent.setup()
    const { field, onCommit, onCancel } = renderEditor('anna')

    await user.type(field, '   ', { skipClick: true })
    await user.tab()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits the unchanged name when the field is left alone', async () => {
    const user = userEvent.setup()
    const { onCommit } = renderEditor('anna')

    await user.tab()

    expect(onCommit).toHaveBeenCalledExactlyOnceWith('anna')
  })

  it('spells out the shortcuts on the field itself', () => {
    const { field } = renderEditor('anna')

    expect(screen.getByTitle('Enter to save, Escape to cancel')).toBe(field)
  })
})
