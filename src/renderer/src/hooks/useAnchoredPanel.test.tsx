import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { type PanelSize, useAnchoredPanel } from './useAnchoredPanel.js'

/**
 * A trigger, a panel and something else to click — the arrangement every
 * caller of the hook builds.
 *
 * A component rather than `renderHook`, because half of what the hook does is
 * about where its `container` sits in the document: a ref that is attached to
 * nothing would make "a click inside is the panel's own business" untestable,
 * and that is the rule most easily got wrong.
 */
function Harness({ size }: { size: PanelSize }): React.JSX.Element {
  const { open, position, container, toggle, close } = useAnchoredPanel()

  return (
    <div>
      <div ref={container}>
        <button
          type="button"
          onClick={(event) => {
            toggle(event.currentTarget, size)
          }}
        >
          Open
        </button>

        {open && position && (
          <div data-testid="panel" style={{ top: position.top, left: position.left }}>
            <p>Panel contents</p>
            <button type="button" onClick={close}>
              Dismiss
            </button>
          </div>
        )}
      </div>

      <div data-testid="elsewhere">
        <button type="button">Somewhere else</button>
      </div>
    </div>
  )
}

/** jsdom lays nothing out and answers zeroes, so the trigger says where it is. */
function place(element: HTMLElement, at: { top: number; left: number }): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top: at.top,
    bottom: at.top + 24,
    left: at.left,
    right: at.left + 120,
    width: 120,
    height: 24,
    x: at.left,
    y: at.top,
    toJSON: () => ({})
  })
}

const SIZE: PanelSize = { width: 200, height: 100 }

const trigger = (): HTMLElement => screen.getByRole('button', { name: 'Open' })
const panel = (): HTMLElement => screen.getByTestId('panel')

/** Opens the panel with the trigger claiming to be somewhere in particular. */
async function openAt(at: { top: number; left: number }, size: PanelSize = SIZE): Promise<void> {
  const user = userEvent.setup()
  render(<Harness size={size} />)
  place(trigger(), at)

  await user.click(trigger())
}

describe('where the panel lands', () => {
  // jsdom's window is 1024 × 768, which is what every sum below is against.
  it('sits under the trigger when there is room below', async () => {
    await openAt({ top: 100, left: 50 })

    expect(panel()).toHaveStyle({ top: '130px', left: '50px' })
  })

  it('flips above the trigger when the space below runs out', async () => {
    await openAt({ top: 700, left: 50 })

    expect(panel()).toHaveStyle({ top: '594px' })
  })

  // A panel taller than the window has nowhere good to go, so it starts at the
  // top and is cut off at the bottom — where the part nobody can reach is the
  // end of a list rather than its beginning.
  it('stays on screen when there is no room either way', async () => {
    await openAt({ top: 20, left: 50 }, { width: 200, height: 760 })

    expect(panel()).toHaveStyle({ top: '6px' })
  })

  it('pulls itself back from the right edge', async () => {
    await openAt({ top: 100, left: 900 })

    expect(panel()).toHaveStyle({ left: '818px' })
  })

  it('keeps a margin at the left edge too', async () => {
    await openAt({ top: 100, left: -40 })

    expect(panel()).toHaveStyle({ left: '6px' })
  })
})

describe('what closes it', () => {
  it('opens nothing until the trigger is used', () => {
    render(<Harness size={SIZE} />)

    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('closes on a second press of the trigger', async () => {
    const user = userEvent.setup()
    await openAt({ top: 100, left: 50 })

    await user.click(trigger())

    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    await openAt({ top: 100, left: 50 })

    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('closes when something outside it is clicked', async () => {
    const user = userEvent.setup()
    await openAt({ top: 100, left: 50 })

    await user.click(screen.getByRole('button', { name: 'Somewhere else' }))

    expect(screen.queryByTestId('panel')).toBeNull()
  })

  // A click inside is the panel's own business: the model panel stays open
  // across two picks, and closing under the pointer would take the second.
  it('stays open when the click lands inside it', async () => {
    const user = userEvent.setup()
    await openAt({ top: 100, left: 50 })

    await user.click(screen.getByText('Panel contents'))

    expect(screen.getByTestId('panel')).toBeInTheDocument()
  })

  // Which leaves the panel's own controls as the only way to shut it from
  // within — the one the effort scale has no use for and the model panel does.
  it('closes when its own contents ask it to', async () => {
    const user = userEvent.setup()
    await openAt({ top: 100, left: 50 })

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByTestId('panel')).toBeNull()
  })

  it('closes when the window is resized', async () => {
    await openAt({ top: 100, left: 50 })

    fireEvent(window, new Event('resize'))

    expect(screen.queryByTestId('panel')).toBeNull()
  })

  /*
   * The coordinates are a snapshot, so a scroll that could move the trigger
   * leaves the panel behind — and one that cannot must be ignored. The chat log
   * pins itself to the bottom on every streamed fragment, and closing on that
   * shut the composer's panels a few times a second while the agent answered.
   */
  it('closes on a scroll that could move the trigger, and not on any other', async () => {
    await openAt({ top: 100, left: 50 })

    fireEvent.scroll(screen.getByTestId('elsewhere'))
    expect(screen.getByTestId('panel')).toBeInTheDocument()

    fireEvent.scroll(document)
    expect(screen.queryByTestId('panel')).toBeNull()
  })

  // Listeners are hung on the window, so an unmount that left them behind would
  // close a panel that no longer exists on the next scroll anywhere.
  it('takes its listeners with it when it goes', async () => {
    const user = userEvent.setup()
    render(<Harness size={SIZE} />)
    place(trigger(), { top: 100, left: 50 })

    await user.click(trigger())
    await user.keyboard('{Escape}')

    expect(() => {
      fireEvent(window, new Event('resize'))
    }).not.toThrow()
  })
})
