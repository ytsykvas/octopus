import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useCloseOnMove } from './useCloseOnMove.js'

/**
 * Something the panel's anchor sits in, and something it does not — the pair a
 * scroll has to tell apart.
 */
function Anchor({
  open,
  close
}: {
  readonly open: boolean
  readonly close: () => void
}): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  useCloseOnMove(open, container, close)

  return (
    <div>
      <div ref={container}>
        <button type="button">Anchor</button>
      </div>
      <div data-testid="elsewhere" />
    </div>
  )
}

describe('useCloseOnMove', () => {
  it('closes when the window is resized', () => {
    const close = vi.fn()
    render(<Anchor open close={close} />)

    fireEvent(window, new Event('resize'))

    expect(close).toHaveBeenCalledOnce()
  })

  // The chat log pins itself to the bottom on every streamed fragment, and
  // closing on that shut the composer's panels a few times a second while the
  // agent answered. Only a scroll of something the anchor sits in can move it.
  it('closes on a scroll of something the anchor sits in, and not on any other', () => {
    const close = vi.fn()
    render(<Anchor open close={close} />)

    fireEvent.scroll(screen.getByTestId('elsewhere'))
    expect(close).not.toHaveBeenCalled()

    fireEvent.scroll(document)
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes on a scroll of the window itself, which holds everything', () => {
    const close = vi.fn()
    render(<Anchor open close={close} />)

    fireEvent.scroll(window)

    expect(close).toHaveBeenCalledOnce()
  })

  it('listens to nothing while it is closed', () => {
    const close = vi.fn()
    render(<Anchor open={false} close={close} />)

    fireEvent(window, new Event('resize'))
    fireEvent.scroll(document)

    expect(close).not.toHaveBeenCalled()
  })

  // Listeners are hung on the window, so an unmount that left them behind would
  // close a panel that no longer exists on the next scroll anywhere.
  it('takes its listeners with it when it goes', () => {
    const close = vi.fn()
    const { unmount } = render(<Anchor open close={close} />)

    unmount()
    fireEvent(window, new Event('resize'))
    fireEvent.scroll(document)

    expect(close).not.toHaveBeenCalled()
  })

  it('stops listening once it closes', () => {
    const close = vi.fn()
    const { rerender } = render(<Anchor open close={close} />)

    rerender(<Anchor open={false} close={close} />)
    fireEvent(window, new Event('resize'))

    expect(close).not.toHaveBeenCalled()
  })
})
