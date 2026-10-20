import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { SideItem } from '../../hooks/useSideQuestions.js'
import { SideQuestions } from './SideQuestions.js'

/** The drawer with `open` kept as state, the way the controller keeps it. */
function Harness({
  items = [],
  unread = false,
  initiallyOpen = false,
  visible = true,
  onAsk = vi.fn(),
  onClear = vi.fn()
}: {
  items?: SideItem[]
  unread?: boolean
  initiallyOpen?: boolean
  visible?: boolean
  onAsk?: (question: string) => void
  onClear?: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(initiallyOpen)

  return (
    <div>
      <button type="button">the main field</button>
      <SideQuestions
        thread={{ items, unread, open }}
        visible={visible}
        onOpenChange={setOpen}
        onAsk={onAsk}
        onClear={onClear}
      />
    </div>
  )
}

const bump = (expanded: boolean): HTMLElement => screen.getByRole('button', { expanded })
const drawer = (): HTMLElement | null => screen.queryByRole('region', { name: 'Side questions' })
const field = (): HTMLElement => screen.getByRole('textbox', { name: 'Your side question' })

describe('SideQuestions', () => {
  it('pulls the drawer out from the bump, and pushes it back', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(drawer()).toBeNull()
    await user.click(bump(false))
    expect(drawer()).toBeInTheDocument()

    await user.click(bump(true))
    expect(drawer()).toBeNull()
  })

  it('takes the caret on opening and gives it back on closing', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(bump(false))
    expect(field()).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(bump(false)).toHaveFocus()
  })

  it('says what it is for while the thread is empty', () => {
    render(<Harness initiallyOpen />)

    expect(screen.getByText(/without interrupting it/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear side questions' })).toBeNull()
  })

  it('closes on a click elsewhere, without taking the caret back from it', async () => {
    const user = userEvent.setup()
    render(<Harness initiallyOpen />)

    await user.click(screen.getByRole('button', { name: 'the main field' }))

    expect(drawer()).toBeNull()
    expect(screen.getByRole('button', { name: 'the main field' })).toHaveFocus()
  })

  it('ignores the window while its conversation is not on screen', async () => {
    const user = userEvent.setup()
    render(<Harness initiallyOpen visible={false} />)

    await user.click(screen.getByRole('button', { name: 'the main field' }))
    await user.keyboard('{Escape}')

    expect(drawer()).toBeInTheDocument()
  })

  it('leaves Escape to a dialog that is open over it', async () => {
    const user = userEvent.setup()
    render(<Harness initiallyOpen />)
    const dialog = document.createElement('dialog')
    dialog.setAttribute('open', '')
    document.body.append(dialog)

    await user.keyboard('{Escape}')

    expect(drawer()).toBeInTheDocument()
    dialog.remove()
  })

  it('asks on Enter, breaks the line on Shift+Enter, and empties the field', async () => {
    const user = userEvent.setup()
    const onAsk = vi.fn()
    render(<Harness initiallyOpen onAsk={onAsk} />)

    await user.type(field(), 'first{Shift>}{Enter}{/Shift}second{Enter}')

    expect(onAsk).toHaveBeenCalledWith('first\nsecond')
    expect(field()).toHaveValue('')
  })

  it('asks from the button, and not at all with nothing written', async () => {
    const user = userEvent.setup()
    const onAsk = vi.fn()
    render(<Harness initiallyOpen onAsk={onAsk} />)

    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled()
    await user.type(field(), '   {Enter}')
    expect(onAsk).not.toHaveBeenCalled()

    await user.type(field(), 'why?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    expect(onAsk).toHaveBeenCalledWith('why?')
  })

  it('draws every state an exchange can be in', () => {
    render(
      <Harness
        initiallyOpen
        items={[
          { id: 1, question: 'q1', state: 'answered', answer: 'It is **Kyiv**.', synthetic: false },
          { id: 2, question: 'q2', state: 'answered', answer: '(No answer.)', synthetic: true },
          { id: 3, question: 'q3', state: 'pending' },
          { id: 4, question: 'q4', state: 'empty' },
          { id: 5, question: 'q5', state: 'failed', error: 'It timed out.' }
        ]}
      />
    )

    expect(screen.getByText('Kyiv').tagName).toBe('STRONG')
    expect(screen.getByText('(No answer.)').closest('.text-ink-faint')).not.toBeNull()
    expect(screen.getByText('Kyiv').closest('.text-ink-faint')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Answering…')
    expect(screen.getByText('The agent had no answer for this one.')).toBeInTheDocument()
    expect(screen.getByText('It timed out.')).toHaveClass('text-danger')
  })

  it('clears the thread from the header', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <Harness
        initiallyOpen
        onClear={onClear}
        items={[{ id: 1, question: 'q', state: 'pending' }]}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Clear side questions' }))

    expect(onClear).toHaveBeenCalled()
  })

  it('names the bump for an answer waiting unseen, and not once the drawer is out', () => {
    const { rerender } = render(<Harness unread />)
    expect(bump(false)).toHaveAccessibleName('An answer is waiting')
    expect(bump(false).querySelector('span')).not.toBeNull()

    rerender(<Harness unread initiallyOpen key="open" />)
    expect(bump(true)).toHaveAccessibleName('Close side questions')
    expect(bump(true).querySelector('span')).toBeNull()
  })
})
