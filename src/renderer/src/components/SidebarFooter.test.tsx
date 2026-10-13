import { render, screen } from '@testing-library/react'
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
})
