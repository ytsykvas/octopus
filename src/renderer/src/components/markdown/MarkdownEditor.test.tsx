import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { editorText } from '../../test/editor.js'
import { MarkdownEditor, type MarkdownEditorProps } from './MarkdownEditor.js'

function renderEditor(
  initial = 'Old text.\n',
  overrides: Partial<MarkdownEditorProps> = {}
): MarkdownEditorProps {
  const props: MarkdownEditorProps = {
    label: 'Description',
    initial,
    maxLength: 100,
    autoFocus: true,
    onChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
  render(<MarkdownEditor {...props} />)
  return props
}

function field(): HTMLElement {
  return screen.getByRole('textbox', { name: 'Description' })
}

describe('MarkdownEditor', () => {
  it('opens on the text it is given, the caret at its end', async () => {
    const { onChange } = renderEditor()

    expect(editorText(field())).toBe('Old text.\n')
    expect(field()).toHaveFocus()
    await userEvent.keyboard('!')

    expect(onChange).toHaveBeenLastCalledWith('Old text.\n!')
  })

  it('leaves the focus alone when asked to', () => {
    renderEditor('Old text.\n', { autoFocus: false })

    expect(field()).not.toHaveFocus()
  })

  it.each(['Meta', 'Control'])('saves the text with %s+Enter', async (modifier) => {
    const { onSave, onChange } = renderEditor()

    await userEvent.keyboard(`{${modifier}>}{Enter}{/${modifier}}`)

    expect(onSave).toHaveBeenCalledWith('Old text.\n')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('hands up nothing when only the caret moves', async () => {
    const { onChange } = renderEditor()

    await userEvent.keyboard('{ArrowLeft}')

    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves a plain Enter to the text', async () => {
    const { onSave, onChange } = renderEditor()

    await userEvent.keyboard('{Enter}')

    expect(onSave).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenLastCalledWith('Old text.\n\n')
  })

  it('does not save on the Enter that confirms an IME candidate', () => {
    const { onSave } = renderEditor()

    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true, isComposing: true })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('cancels with Escape', async () => {
    const { onCancel } = renderEditor()

    await userEvent.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('stops the text at its limit', async () => {
    const { onChange } = renderEditor('Old text.\n', { maxLength: 12 })

    await userEvent.keyboard('abc')

    expect(onChange).toHaveBeenLastCalledWith('Old text.\nab')
  })

  it('refuses a paste that would cross its limit, rather than cutting it', async () => {
    const { onChange } = renderEditor('Old text.\n', { maxLength: 12 })

    await userEvent.paste('abc')

    expect(onChange).not.toHaveBeenCalled()
    expect(editorText(field())).toBe('Old text.\n')
  })

  it('takes a paste that fits', async () => {
    const { onChange } = renderEditor('Old text.\n', { maxLength: 12 })

    await userEvent.paste('ab')

    expect(onChange).toHaveBeenLastCalledWith('Old text.\nab')
  })

  it('keeps a task box through a caret move', async () => {
    renderEditor('- [ ] task\n\nend')
    const box = screen.getByRole('checkbox', { name: 'Done' })

    await userEvent.keyboard('{ArrowLeft}')

    expect(screen.getByRole('checkbox', { name: 'Done' })).toBe(box)
  })

  it('still takes a deletion from a text already past its limit', async () => {
    const { onChange } = renderEditor('Old text.\n', { maxLength: 5 })

    await userEvent.keyboard('{Backspace}')

    expect(onChange).toHaveBeenLastCalledWith('Old text.')
  })

  it.each([
    ['Heading', '### x'],
    ['Bold (⌘B)', 'x****'],
    ['Italic (⌘I)', 'x__'],
    ['Strikethrough', 'x~~~~'],
    ['Quote', '> x'],
    ['Code (⌘E)', 'x``'],
    ['Code block', '```\nx\n```'],
    ['Link (⌘K)', 'x[]()'],
    ['Bulleted list', '- x'],
    ['Numbered list', '1. x'],
    ['Task list', '- [ ] x']
  ])('formats with %s and gives the focus back', async (name, expected) => {
    const { onChange } = renderEditor('x', { autoFocus: false })
    const tools = screen.getByRole('group', { name: 'Formatting' })

    await userEvent.click(within(tools).getByRole('button', { name }))

    expect(onChange).toHaveBeenLastCalledWith(expected)
    expect(field()).toHaveFocus()
  })

  // jsdom is not a Mac, so CodeMirror reads Mod as Ctrl here.
  it.each([
    ['b', 'x****'],
    ['i', 'x__'],
    ['e', 'x``'],
    ['k', 'x[]()']
  ])('formats with Mod+%s', async (key, expected) => {
    const { onChange, onSave } = renderEditor('x')

    await userEvent.keyboard(`{Control>}${key}{/Control}`)

    expect(onChange).toHaveBeenLastCalledWith(expected)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('hides the syntax away from the caret and shows it on the caret line', async () => {
    renderEditor('**bold** x\n\n- item\n- [ ] task\n\nend')

    expect(field().textContent).toBe('bold x• item taskend')
    await userEvent.keyboard('{Control>}{Home}{/Control}')

    expect(field().textContent).toBe('**bold** x• item taskend')
  })

  it.each([
    ['- [ ] task', false, '- [x] task'],
    ['- [x] task', true, '- [ ] task']
  ])('ticks %j through its box', async (task, checked, expected) => {
    const { onChange } = renderEditor(`${task}\n\nend`)
    const box = screen.getByRole('checkbox', { name: 'Done' })

    expect(box).toHaveProperty('checked', checked)
    await userEvent.click(box)

    expect(onChange).toHaveBeenLastCalledWith(`${expected}\n\nend`)
  })
})
