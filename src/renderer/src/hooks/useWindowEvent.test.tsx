import { fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useWindowEvent } from './useWindowEvent.js'

function Probe({
  label,
  heard,
  active = true,
  pressOnCommit = false
}: {
  readonly label: string
  readonly heard: (label: string) => void
  readonly active?: boolean
  readonly pressOnCommit?: boolean
}): null {
  useWindowEvent(
    'keydown',
    () => {
      heard(label)
    },
    { active }
  )

  useLayoutEffect(() => {
    if (pressOnCommit) window.dispatchEvent(new KeyboardEvent('keydown'))
  })

  return null
}

function Scroller({
  heard,
  capture
}: {
  readonly heard: () => void
  readonly capture: boolean
}): React.JSX.Element {
  useWindowEvent('scroll', heard, { capture })

  return <div aria-label="Log" />
}

describe('a listener on the window', () => {
  it('is in place, and current, as soon as the render that drew it commits', () => {
    const heard = vi.fn()
    const { rerender } = render(<Probe label="first" heard={heard} pressOnCommit />)

    rerender(<Probe label="second" heard={heard} pressOnCommit />)

    expect(heard.mock.calls).toEqual([['first'], ['second']])
  })

  it('hears the event it was given and nothing else', () => {
    const heard = vi.fn()
    render(<Probe label="probe" heard={heard} />)

    fireEvent.keyUp(window)
    fireEvent.keyDown(window)

    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('stops listening while inactive and once unmounted', () => {
    const heard = vi.fn()
    const { rerender, unmount } = render(<Probe label="probe" heard={heard} active={false} />)
    fireEvent.keyDown(window)

    rerender(<Probe label="probe" heard={heard} />)
    fireEvent.keyDown(window)
    unmount()
    fireEvent.keyDown(window)

    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('hears an event that does not bubble only when listening in the capture phase', () => {
    const heard = vi.fn()
    const { rerender } = render(<Scroller heard={heard} capture={false} />)
    fireEvent.scroll(screen.getByLabelText('Log'))

    rerender(<Scroller heard={heard} capture />)
    fireEvent.scroll(screen.getByLabelText('Log'))

    expect(heard).toHaveBeenCalledTimes(1)
  })
})
