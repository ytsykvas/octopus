import { fireEvent, render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ResizeHandle } from './ResizeHandle.js'

type WidthSpy = Mock<(width: number) => void>

interface Rendered {
  readonly handle: HTMLElement
  readonly named: (name: string) => HTMLElement
  readonly onResize: WidthSpy
  readonly onCommit: WidthSpy
  /** Feeds a new width back in, the way a parent that stores it would. */
  readonly setWidth: (width: number) => void
}

const bounds = { min: 200, max: 600 }

function renderHandle({
  width = 300,
  grows
}: { width?: number; grows?: 'left' | 'right' } = {}): Rendered {
  const onResize: WidthSpy = vi.fn()
  const onCommit: WidthSpy = vi.fn()
  const props = { ...bounds, onResize, onCommit, ...(grows === undefined ? {} : { grows }) }

  const { rerender, container } = render(<ResizeHandle width={width} {...props} />)
  // Scoped to this render, so a test may put two handles on the screen at once.
  const own = within(container)

  return {
    handle: own.getByRole('separator'),
    named: (name) => own.getByRole('separator', { name }),
    onResize,
    onCommit,
    setWidth: (next) => {
      rerender(<ResizeHandle width={next} {...props} />)
    }
  }
}

// jsdom has no pointer device, and the drag only touches the handle once: the
// moves and the release are delivered to the window, exactly where the
// component listens for them.
const grab = (handle: HTMLElement, clientX: number): boolean =>
  fireEvent.pointerDown(handle, { clientX })
const movePointerTo = (clientX: number): void => {
  fireEvent.pointerMove(window, { clientX })
}
const releasePointer = (): void => {
  fireEvent.pointerUp(window)
}

/** Every width the component reported while dragging, in order. */
const reported = (onResize: WidthSpy): number[] => onResize.mock.calls.map(([width]) => width)

// A drag lives on `window` and on `document.body`, neither of which unmounting
// the component touches. So a test that ends mid-drag — including one that ends
// there because it failed — would otherwise hand the next test a body still
// styled `col-resize` and a live listener.
afterEach(() => {
  fireEvent.pointerUp(window)
  document.body.removeAttribute('style')
})

describe('ResizeHandle', () => {
  it('reports every width while the pointer moves and commits once on release', () => {
    const { handle, onResize, onCommit } = renderHandle({ width: 300 })

    grab(handle, 500)
    movePointerTo(480)
    movePointerTo(460)

    // A pane on the right grows as the pointer travels left.
    expect(reported(onResize)).toEqual([320, 340])
    // Persisting each intermediate pixel would be a disk write per mouse move.
    expect(onCommit).not.toHaveBeenCalled()

    releasePointer()

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(340)
  })

  it('moves the opposite way for the same pointer travel when the pane grows to the right', () => {
    const rightwards = renderHandle({ width: 300, grows: 'right' })

    grab(rightwards.handle, 500)
    movePointerTo(560)
    releasePointer()

    expect(rightwards.onCommit).toHaveBeenCalledExactlyOnceWith(360)

    const leftwards = renderHandle({ width: 300, grows: 'left' })

    grab(leftwards.handle, 500)
    movePointerTo(560)
    releasePointer()

    expect(leftwards.onCommit).toHaveBeenCalledExactlyOnceWith(240)
  })

  it('never reports a width above the maximum however far the pointer travels', () => {
    const { handle, onResize, onCommit } = renderHandle({ width: 300 })

    grab(handle, 500)
    movePointerTo(-2000)
    releasePointer()

    expect(reported(onResize)).toEqual([600])
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(600)
  })

  it('never reports a width below the minimum however far the pointer travels', () => {
    const { handle, onResize, onCommit } = renderHandle({ width: 300 })

    grab(handle, 500)
    movePointerTo(2000)
    releasePointer()

    expect(reported(onResize)).toEqual([200])
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(200)
  })

  it('reports whole pixels even when the width it was given is fractional', () => {
    const { handle, onResize } = renderHandle({ width: 300.6 })

    grab(handle, 500)
    movePointerTo(499)
    releasePointer()

    expect(reported(onResize)).toEqual([302])
  })

  it('stops following the pointer once it has been released', () => {
    const { handle, onResize, onCommit } = renderHandle({ width: 300 })

    grab(handle, 500)
    movePointerTo(480)
    releasePointer()
    onResize.mockClear()

    // Neither a later move nor a later release belongs to this handle any
    // more: both listeners come off the window, not just the one for moves.
    movePointerTo(400)
    releasePointer()

    expect(onResize).not.toHaveBeenCalled()
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(320)
  })

  // The parent may not feed the new width back in until the drag ends, so the
  // handle has to remember where it left the edge.
  it('starts the next drag where the last one ended even if the width has not been fed back', () => {
    const { handle, onCommit } = renderHandle({ width: 300 })

    grab(handle, 500)
    movePointerTo(480)
    releasePointer()

    grab(handle, 500)
    movePointerTo(480)
    releasePointer()

    expect(onCommit).toHaveBeenLastCalledWith(340)
  })

  it('starts the next drag from a width set from outside', () => {
    const { handle, setWidth, onCommit } = renderHandle({ width: 300 })

    setWidth(420)
    grab(handle, 500)
    movePointerTo(480)
    releasePointer()

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(440)
  })

  // Without this the cursor flickers back to an arrow whenever it outruns the
  // edge, and dragging selects the text of whatever it passes over.
  it('holds the resize cursor and suppresses text selection for the length of the drag', () => {
    const { handle } = renderHandle()

    grab(handle, 500)

    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    releasePointer()

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('does not let the browser start its own drag or selection from the handle', () => {
    const { handle } = renderHandle()
    // `fireEvent` returns false only when the handler cancelled the event.
    const defaultAllowed = grab(handle, 500)

    expect(defaultAllowed).toBe(false)

    releasePointer()
  })

  it('takes keyboard focus so the pane can be resized without a mouse', async () => {
    const user = userEvent.setup()
    const { handle } = renderHandle()

    await user.tab()

    expect(handle).toHaveFocus()
  })

  it('widens a right-hand pane with the left arrow and commits the nudge at once', async () => {
    const user = userEvent.setup()
    const { handle, onResize, onCommit } = renderHandle({ width: 300 })

    handle.focus()
    await user.keyboard('{ArrowLeft}')

    expect(onResize).toHaveBeenCalledExactlyOnceWith(316)
    // A key press is already a finished gesture, so there is nothing to wait for.
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(316)

    await user.keyboard('{ArrowRight}')

    expect(onCommit).toHaveBeenLastCalledWith(300)
  })

  it('reverses both arrows when the pane grows to the right', async () => {
    const user = userEvent.setup()
    const { handle, onCommit } = renderHandle({ width: 300, grows: 'right' })

    handle.focus()
    await user.keyboard('{ArrowRight}')

    expect(onCommit).toHaveBeenLastCalledWith(316)

    await user.keyboard('{ArrowLeft}')

    expect(onCommit).toHaveBeenLastCalledWith(300)
  })

  it('holds at the maximum when an arrow would push the pane past it', async () => {
    const user = userEvent.setup()
    const { handle, onResize, onCommit } = renderHandle({ width: 595 })

    handle.focus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')

    // The first press lands short of a full step, the second has nowhere to go.
    expect(reported(onResize)).toEqual([600, 600])
    expect(onCommit).toHaveBeenLastCalledWith(600)
  })

  it('holds at the minimum when an arrow would shrink the pane past it', async () => {
    const user = userEvent.setup()
    const { handle, onResize, onCommit } = renderHandle({ width: 205 })

    handle.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')

    expect(reported(onResize)).toEqual([200, 200])
    expect(onCommit).toHaveBeenLastCalledWith(200)
  })

  it('leaves keys other than the horizontal arrows alone', async () => {
    const user = userEvent.setup()
    const { handle, onResize, onCommit } = renderHandle()

    handle.focus()
    await user.keyboard('{ArrowUp}{ArrowDown}{Enter}{ }')

    expect(onResize).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('stops the arrow from also scrolling whatever the handle sits in', () => {
    const { handle } = renderHandle()

    expect(fireEvent.keyDown(handle, { key: 'ArrowLeft' })).toBe(false)
    expect(fireEvent.keyDown(handle, { key: 'ArrowRight' })).toBe(false)
  })

  it('announces itself as a vertical separator carrying the width and its bounds', () => {
    const { handle, named } = renderHandle({ width: 300 })

    expect(named('Resize panel')).toBe(handle)
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    expect(handle).toHaveAttribute('aria-valuemin', '200')
    expect(handle).toHaveAttribute('aria-valuemax', '600')
  })

  it('announces the new width once the parent has stored it', () => {
    const { handle, setWidth } = renderHandle({ width: 300 })

    setWidth(420)

    expect(handle).toHaveAttribute('aria-valuenow', '420')
  })
})
