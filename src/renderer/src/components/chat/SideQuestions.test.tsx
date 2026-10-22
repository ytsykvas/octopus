import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { SideExchange } from '@core/sideQuestions.js'

import type { SideItem } from '../../hooks/useSideQuestions.js'
import { SideQuestions } from './SideQuestions.js'

/** The drawer with `open` kept as state, the way the controller keeps it. */
function Harness({
  items = [],
  unread = false,
  initiallyOpen = false,
  visible = true,
  onAsk = vi.fn(),
  onClear = vi.fn(),
  onFork = vi.fn(() => Promise.resolve())
}: {
  items?: SideItem[]
  unread?: boolean
  initiallyOpen?: boolean
  visible?: boolean
  onAsk?: (question: string) => void
  onClear?: () => void
  onFork?: (exchange: SideExchange) => Promise<void>
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
        onFork={onFork}
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

  it('moves the caret in and back without scrolling anything to reach it', async () => {
    const user = userEvent.setup()
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    render(<Harness />)

    await user.click(bump(false))
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(field()).toHaveFocus()

    focus.mockClear()
    await user.keyboard('{Escape}')
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true })
    expect(bump(false)).toHaveFocus()
  })

  it('keeps the newest exchange in view by scrolling its own list, never the window', () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    const first: SideItem = { id: 1, question: 'q1', state: 'pending' }
    const { rerender } = render(<Harness initiallyOpen items={[first]} />)
    const list = screen.getByRole('list').parentElement
    if (list === null) throw new Error('the list has no scroller')
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 640 })

    rerender(<Harness initiallyOpen items={[first, { id: 2, question: 'q2', state: 'pending' }]} />)

    expect(list.scrollTop).toBe(640)
    expect(scrollIntoView).not.toHaveBeenCalled()
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

  describe('continuing from an answer', () => {
    const fork = (): HTMLElement[] =>
      screen.queryAllByRole('button', { name: 'Continue from this answer in a new conversation' })

    // Only a real answer has anything to continue from.
    it('is offered on an answer the agent gave, and nowhere else', () => {
      render(
        <Harness
          initiallyOpen
          items={[
            { id: 1, question: 'q1', state: 'answered', answer: 'Kyiv', synthetic: false },
            { id: 2, question: 'q2', state: 'answered', answer: '(No answer.)', synthetic: true },
            { id: 3, question: 'q3', state: 'pending' },
            { id: 4, question: 'q4', state: 'empty' },
            { id: 5, question: 'q5', state: 'failed', error: 'It timed out.' }
          ]}
        />
      )

      expect(fork()).toHaveLength(1)
    })

    it('hands over the question and its answer', async () => {
      const user = userEvent.setup()
      const onFork = vi.fn(() => Promise.resolve())
      render(
        <Harness
          initiallyOpen
          onFork={onFork}
          items={[
            { id: 1, question: 'where?', state: 'answered', answer: 'Kyiv', synthetic: false }
          ]}
        />
      )

      await user.click(fork()[0]!)

      expect(onFork).toHaveBeenCalledWith({ question: 'where?', response: 'Kyiv' })
    })

    // A second click while the first is out would open two tabs.
    it('waits for one fork before offering another', async () => {
      const user = userEvent.setup()
      let settle = (): void => undefined
      const onFork = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve
          })
      )
      render(
        <Harness
          initiallyOpen
          onFork={onFork}
          items={[
            { id: 1, question: 'q1', state: 'answered', answer: 'a1', synthetic: false },
            { id: 2, question: 'q2', state: 'answered', answer: 'a2', synthetic: false }
          ]}
        />
      )

      await user.click(fork()[0]!)
      for (const button of fork()) expect(button).toBeDisabled()

      await act(async () => {
        settle()
        await Promise.resolve()
      })
      for (const button of fork()) expect(button).toBeEnabled()
      expect(onFork).toHaveBeenCalledTimes(1)
    })
  })
})
