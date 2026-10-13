import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { octopus } from '../test/octopus.js'
import { SidebarFooter } from './SidebarFooter.js'

type FooterProps = React.ComponentProps<typeof SidebarFooter>

function renderFooter(overrides: Partial<FooterProps> = {}): FooterProps {
  const props: FooterProps = {
    sidebarOpen: true,
    onToggleSidebar: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides
  }

  render(<SidebarFooter {...props} />)
  return props
}

describe('SidebarFooter', () => {
  it('opens settings from an icon, with no text beside it', async () => {
    const user = userEvent.setup()
    const props = renderFooter()

    const settings = screen.getByRole('button', { name: 'Settings' })
    // The name is for assistive technology and the tooltip; drawing it as well
    // is what the footer used to do, and what this row exists to stop.
    expect(settings).toHaveTextContent('')
    await user.click(settings)

    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  // The strip is what survives the fold, so the way back has to live in the
  // footer rather than in the column it hides.
  it('folds the workspace list away', async () => {
    const user = userEvent.setup()
    const props = renderFooter({ sidebarOpen: true })

    await user.click(screen.getByRole('button', { name: 'Hide workspaces' }))

    expect(props.onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('offers to bring the workspace list back once it is folded away', async () => {
    const user = userEvent.setup()
    const props = renderFooter({ sidebarOpen: false })

    expect(screen.queryByRole('button', { name: 'Hide workspaces' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show workspaces' }))

    expect(props.onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('keeps the fold and Settings together in one row', () => {
    renderFooter()

    const settings = screen.getByRole('button', { name: 'Settings' })
    const fold = screen.getByRole('button', { name: 'Hide workspaces' })

    expect(fold.parentElement).toBe(settings.parentElement)
  })

  it('shows the account limits while the list is open', async () => {
    renderFooter({ sidebarOpen: true })

    expect(await screen.findByRole('button', { name: 'Read the limits now' })).toBeInTheDocument()
  })

  // Folded, the column is the width of the strip: there is no room for the
  // block, and nobody to read it — so nothing is asked of the account either.
  it('draws no limits, and asks for none, while the list is folded away', () => {
    renderFooter({ sidebarOpen: false })

    expect(screen.queryByRole('button', { name: 'Read the limits now' })).toBeNull()
    expect(octopus().chats.refreshSubscription).not.toHaveBeenCalled()
  })

  /*
   * The accessible name comes from `aria-label`, which is what every query
   * above uses — so a tooltip lost with the visible label (the icon being the
   * only thing left to hover) would pass all of them.
   */
  it('names both icons in a tooltip as well', () => {
    const { rerender } = render(
      <SidebarFooter sidebarOpen onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('title', 'Settings')
    expect(screen.getByRole('button', { name: 'Hide workspaces' })).toHaveAttribute(
      'title',
      'Hide workspaces'
    )

    rerender(
      <SidebarFooter sidebarOpen={false} onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Show workspaces' })).toHaveAttribute(
      'title',
      'Show workspaces'
    )
  })

  /*
   * The footer is always there and only the block inside it comes and goes, so
   * folding must stop the reading and unfolding must ask again. The hook polls
   * on a timer and on focus, and the docs promise nothing is read for a block
   * nobody can see — which a footer that called the hook itself would break
   * without drawing anything differently.
   */
  it('stops asking the account while folded, and asks again when it opens', async () => {
    const { rerender } = render(
      <SidebarFooter sidebarOpen onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()} />
    )
    await waitFor(() => {
      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(1)
    })

    rerender(
      <SidebarFooter sidebarOpen={false} onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()} />
    )
    expect(screen.queryByRole('button', { name: 'Read the limits now' })).toBeNull()
    expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(1)

    rerender(<SidebarFooter sidebarOpen onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()} />)

    await waitFor(() => {
      expect(octopus().chats.refreshSubscription).toHaveBeenCalledTimes(2)
    })
  })

  /*
   * Layout, which jsdom cannot measure, so the classes are the only handle —
   * and each is the whole mechanism rather than a look:
   *
   * `w-0 min-w-full` keeps the footer from helping to decide the column's width
   * (a long limit row would push the column wider than the strip and the list
   * and open a gap beside the list); `justify-between` puts the two icons at
   * opposite ends; `flex-col` stacks them when the column is only the strip.
   */
  it('takes its width from the column, and lays the icons out for the width it has', () => {
    const { container, rerender } = render(
      <SidebarFooter sidebarOpen onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()} />
    )
    const row = (): HTMLElement | null =>
      screen.getByRole('button', { name: 'Settings' }).parentElement

    expect(container.firstElementChild).toHaveClass('w-0', 'min-w-full')
    expect(row()).toHaveClass('justify-between')
    expect(row()).not.toHaveClass('flex-col')

    rerender(
      <SidebarFooter sidebarOpen={false} onToggleSidebar={vi.fn()} onOpenSettings={vi.fn()} />
    )

    expect(row()).toHaveClass('flex-col')
    expect(row()).not.toHaveClass('justify-between')
  })
})
