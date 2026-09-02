import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useDismiss } from './useDismiss.js'

/**
 * A minimal stand-in for the menus and comboboxes that use the hook: something
 * to click inside, and something to click beside.
 */
function Popup({
  open,
  onDismiss
}: {
  readonly open: boolean
  readonly onDismiss: () => void
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  useDismiss(open, container, onDismiss)

  return (
    <>
      <button type="button">Elsewhere on the page</button>
      <div ref={container}>
        <button type="button">Inside the popup</button>
        <input aria-label="Search" />
      </div>
    </>
  )
}

describe('useDismiss', () => {
  it('dismisses when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<Popup open onDismiss={onDismiss} />)

    await user.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('dismisses when a click lands outside it', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<Popup open onDismiss={onDismiss} />)

    await user.click(screen.getByRole('button', { name: 'Elsewhere on the page' }))

    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('stays open when the click lands inside it', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<Popup open onDismiss={onDismiss} />)

    // Dismissed from outside first, so the silence below is the guard doing its
    // work rather than a listener the effect never registered — which would
    // leave `onDismiss` uncalled just as convincingly.
    await user.click(screen.getByRole('button', { name: 'Elsewhere on the page' }))
    expect(onDismiss).toHaveBeenCalledOnce()
    onDismiss.mockClear()

    await user.click(screen.getByRole('button', { name: 'Inside the popup' }))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  // Typing into a search field inside a menu must not close the menu under it.
  it('stays open on keys other than Escape', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<Popup open onDismiss={onDismiss} />)

    // Escape first, for the same reason: a dead listener says nothing to any
    // key, and this test is about the ones it hears and lets past.
    await user.keyboard('{Escape}')
    expect(onDismiss).toHaveBeenCalledOnce()
    onDismiss.mockClear()

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'planner')

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does nothing at all while it is closed', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<Popup open={false} onDismiss={onDismiss} />)

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Elsewhere on the page' }))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  // A listener that outlives the open popup dismisses the next one that opens.
  it('stops listening once it closes', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const { rerender } = render(<Popup open onDismiss={onDismiss} />)

    rerender(<Popup open={false} onDismiss={onDismiss} />)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Elsewhere on the page' }))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('stops listening after it unmounts', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const { unmount } = render(<Popup open onDismiss={onDismiss} />)

    unmount()
    await user.keyboard('{Escape}')
    await user.click(document.body)

    expect(onDismiss).not.toHaveBeenCalled()
  })
})
