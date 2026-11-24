import { act, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TOOLTIP_DELAY_MS, TitleTooltips } from './TitleTooltips.js'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderWith(children: ReactNode): ReturnType<typeof render> {
  return render(
    <>
      <TitleTooltips />
      <div data-testid="elsewhere" />
      {children}
    </>
  )
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function rest(element: Element, at = { clientX: 100, clientY: 100 }): void {
  fireEvent.pointerOver(element, at)
  wait(TOOLTIP_DELAY_MS)
}

function leave(): void {
  fireEvent.pointerOver(screen.getByTestId('elsewhere'))
}

function renderRenamed(initial: string): {
  button: HTMLElement
  rename: (title: string | undefined) => Promise<void>
} {
  let setTitle: (title: string | undefined) => void = () => undefined
  function Renamed(): React.JSX.Element {
    const [title, set] = useState<string | undefined>(initial)
    setTitle = set
    return <button type="button" title={title} />
  }
  renderWith(<Renamed />)

  return {
    button: screen.getByRole('button'),
    rename: async (title) => {
      await act(async () => {
        setTitle(title)
        await Promise.resolve()
      })
    }
  }
}

describe('TitleTooltips', () => {
  it('shows a title in its own tooltip after a short delay, and not before', () => {
    renderWith(<button type="button" title="Revert" />)

    fireEvent.pointerOver(screen.getByRole('button'), { clientX: 100, clientY: 100 })
    wait(TOOLTIP_DELAY_MS - 1)
    expect(screen.queryByRole('tooltip')).toBeNull()

    wait(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Revert')
    expect(screen.getByRole('tooltip')).toHaveStyle({ top: '116px', left: '100px' })
  })

  it('blanks the title while the pointer is on it and gives it back on leaving', () => {
    renderWith(<button type="button" title="Revert" />)
    const button = screen.getByRole('button')

    fireEvent.pointerOver(button)
    expect(button).toHaveAttribute('title', '')

    leave()
    expect(button).toHaveAttribute('title', 'Revert')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows again when the pointer comes back', () => {
    renderWith(<button type="button" title="Revert" />)
    const button = screen.getByRole('button')

    rest(button)
    leave()
    rest(button)

    expect(screen.getByRole('tooltip')).toHaveTextContent('Revert')
  })

  it('shows nothing for a pointer that leaves before the delay is up', () => {
    renderWith(<button type="button" title="Revert" />)

    fireEvent.pointerOver(screen.getByRole('button'))
    wait(TOOLTIP_DELAY_MS / 2)
    leave()
    wait(TOOLTIP_DELAY_MS)

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('keeps counting the delay while the pointer crosses the children of the titled element', () => {
    renderWith(
      <span title="1 file out of date">
        <b>cloud</b>1
      </span>
    )
    const owner = screen.getByText('cloud').parentElement!

    fireEvent.pointerOver(owner)
    wait(TOOLTIP_DELAY_MS / 2)
    fireEvent.pointerOver(screen.getByText('cloud'))
    wait(TOOLTIP_DELAY_MS / 2)

    expect(screen.getByRole('tooltip')).toHaveTextContent('1 file out of date')
    expect(owner).toHaveAttribute('title', '')
  })

  it('lets a nested title win, and gives the outer one back', () => {
    renderWith(
      <div title="Row">
        <button type="button" title="Revert" />
      </div>
    )
    const button = screen.getByRole('button')
    const row = button.parentElement!

    rest(row)
    rest(button)

    expect(screen.getByRole('tooltip')).toHaveTextContent('Revert')
    expect(row).toHaveAttribute('title', 'Row')
  })

  it('moves straight to the next title once a tooltip is showing', () => {
    renderWith(
      <>
        <button type="button" title="Revert" />
        <button type="button" title="Copy path" />
      </>
    )
    const [revert, copy] = screen.getAllByRole('button')

    rest(revert!)
    fireEvent.pointerOver(copy!)

    expect(screen.getByRole('tooltip')).toHaveTextContent('Copy path')
  })

  it('shows nothing under an empty title, the way the native one does not', () => {
    renderWith(
      <div title="Row">
        <span title="">
          <b>quiet</b>
        </span>
      </div>
    )

    rest(screen.getByText('quiet'))

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows nothing, and throws nothing, where no element carries a title', () => {
    const errors = vi.fn()
    window.addEventListener('error', errors)
    renderWith(<b>plain</b>)

    rest(screen.getByText('plain'))
    window.removeEventListener('error', errors)

    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(errors).not.toHaveBeenCalled()
  })

  it.each([
    ['a press', (target: Element) => fireEvent.pointerDown(target)],
    ['a key', (target: Element) => fireEvent.keyDown(target, { key: 'a' })],
    ['a wheel', (target: Element) => fireEvent.wheel(target)],
    ['a scroll', (target: Element) => fireEvent.scroll(target)],
    ['a resize', () => fireEvent(window, new Event('resize'))]
  ])('hides on %s and keeps the native tooltip away while the pointer stays', (_, dismiss) => {
    const stop = (event: { stopPropagation: () => void }): void => {
      event.stopPropagation()
    }
    renderWith(
      <div onPointerDown={stop} onKeyDown={stop}>
        <button type="button" title="Revert" />
      </div>
    )
    const button = screen.getByRole('button')

    rest(button)
    dismiss(button)

    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button).toHaveAttribute('title', '')
  })

  it('lets go when the pointer leaves the window', () => {
    renderWith(<button type="button" title="Revert" />)
    const button = screen.getByRole('button')

    rest(button)
    fireEvent.pointerOut(button, { relatedTarget: screen.getByTestId('elsewhere') })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.pointerOut(button, { relatedTarget: null })
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button).toHaveAttribute('title', 'Revert')
  })

  it('lets go when the window loses focus', () => {
    renderWith(<button type="button" title="Revert" />)
    const button = screen.getByRole('button')

    rest(button)
    fireEvent.blur(window)

    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(button).toHaveAttribute('title', 'Revert')
  })

  it('follows a title React changes while the pointer is on it', async () => {
    const { button, rename } = renderRenamed('Copy path')

    rest(button)
    await rename('Path copied')

    expect(screen.getByRole('tooltip')).toHaveTextContent('Path copied')
    expect(button).toHaveAttribute('title', '')
    leave()
    expect(button).toHaveAttribute('title', 'Path copied')
  })

  it('leaves alone a title React changes after the pointer has gone', async () => {
    const { button, rename } = renderRenamed('Copy path')

    rest(button)
    leave()
    await rename('Path copied')

    expect(button).toHaveAttribute('title', 'Path copied')
  })

  it('takes a title React changes during the delay', async () => {
    const { button, rename } = renderRenamed('Copy path')

    fireEvent.pointerOver(button)
    await rename('Path copied')
    wait(TOOLTIP_DELAY_MS)

    expect(screen.getByRole('tooltip')).toHaveTextContent('Path copied')
  })

  it('never resurrects a title removed just before the pointer left', () => {
    renderWith(<button type="button" title="Push" />)
    const button = screen.getByRole('button')

    rest(button)
    button.removeAttribute('title')
    leave()

    expect(button).not.toHaveAttribute('title')
  })

  it('drops the tooltip when React removes the title, and never puts the old one back', async () => {
    const { button, rename } = renderRenamed('Push')

    rest(button)
    await rename(undefined)

    expect(screen.queryByRole('tooltip')).toBeNull()
    leave()
    expect(button).not.toHaveAttribute('title')
  })

  it('stands where the pointer came to rest, not where it came in', () => {
    renderWith(<button type="button" title="Revert" />)
    const button = screen.getByRole('button')

    fireEvent.pointerOver(button, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(button, { clientX: 150, clientY: 120 })
    wait(TOOLTIP_DELAY_MS)

    expect(screen.getByRole('tooltip')).toHaveStyle({ top: '136px', left: '150px' })
  })

  it('opens above and to the left of a pointer near the bottom-right corner', () => {
    renderWith(<button type="button" title="Revert" />)

    rest(screen.getByRole('button'), {
      clientX: window.innerWidth - 100,
      clientY: window.innerHeight - 20
    })

    expect(screen.getByRole('tooltip')).toHaveStyle({ bottom: '26px', right: '100px' })
  })

  it('is drawn inside the dialog the element sits in', () => {
    renderWith(
      <dialog open>
        <button type="button" title="Revert" />
      </dialog>
    )

    rest(screen.getByRole('button'))

    expect(screen.getByRole('tooltip').parentElement?.tagName).toBe('DIALOG')
  })

  it('gives the title back when it goes away itself', () => {
    const layer = render(<TitleTooltips />)
    render(<button type="button" title="Revert" />)
    const button = screen.getByRole('button')

    rest(button)
    layer.unmount()

    expect(button).toHaveAttribute('title', 'Revert')
  })
})
