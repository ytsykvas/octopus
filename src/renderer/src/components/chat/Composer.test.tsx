import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Composer } from './Composer.js'

function renderComposer(overrides: Partial<React.ComponentProps<typeof Composer>> = {}): {
  onSend: ReturnType<typeof vi.fn>
  onStop: ReturnType<typeof vi.fn>
} {
  const onSend = vi.fn()
  const onStop = vi.fn()

  render(<Composer busy={false} onSend={onSend} onStop={onStop} {...overrides} />)
  return { onSend, onStop }
}

const field = (): HTMLElement => screen.getByRole('textbox')

describe('sending', () => {
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
})
