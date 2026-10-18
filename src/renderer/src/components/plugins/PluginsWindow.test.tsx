import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CATALOG_BUSY, type PluginsController } from '../../hooks/usePlugins.js'
import { stubDialogElement } from '../../test/dialog.js'
import { catalogOf, installedPlugin, pluginsController } from '../../test/plugins.js'
import { PluginsWindow } from './PluginsWindow.js'

interface Drawn {
  plugins: PluginsController
  onOpenAgentSettings: () => void
  onClose: () => void
  rerender: (overrides: Partial<PluginsController>) => void
}

function draw(overrides: Partial<PluginsController> = {}, userLayerLoaded = true): Drawn {
  const onOpenAgentSettings = vi.fn()
  const onClose = vi.fn()
  const plugins = pluginsController(overrides)
  const view = (next: PluginsController): React.JSX.Element => (
    <PluginsWindow
      plugins={next}
      userLayerLoaded={userLayerLoaded}
      onOpenAgentSettings={onOpenAgentSettings}
      onClose={onClose}
    />
  )
  const { rerender } = render(view(plugins))

  return {
    plugins,
    onOpenAgentSettings,
    onClose,
    rerender: (more) => {
      rerender(view({ ...plugins, ...more }))
    }
  }
}

describe('PluginsWindow', () => {
  beforeEach(() => {
    stubDialogElement()
  })

  it('opens on what is installed, and counts it', () => {
    draw({ installed: [installedPlugin()] })

    expect(screen.getByRole('tab', { name: 'Installed · 1' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('context7')
  })

  it('counts nothing before the listing has answered', () => {
    draw({ installed: null })

    expect(screen.getByRole('tab', { name: 'Installed' })).toBeInTheDocument()
  })

  // The catalog is a slow listing, so it waits for the store to be shown —
  // and is asked for once, not on every visit.
  it('reads the catalog the first time the store is shown, and only then', async () => {
    const user = userEvent.setup()
    const { plugins, rerender } = draw()

    expect(plugins.readCatalog).not.toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'Store' }))
    expect(plugins.readCatalog).toHaveBeenCalledOnce()
    expect(screen.getByRole('tab', { name: 'Store' })).toHaveAttribute('aria-selected', 'true')

    rerender({ catalogLoading: true })
    await user.click(screen.getByRole('tab', { name: 'Installed · 0' }))
    await user.click(screen.getByRole('tab', { name: 'Store' }))

    rerender({ catalog: catalogOf([]) })
    await user.click(screen.getByRole('tab', { name: 'Installed · 0' }))
    await user.click(screen.getByRole('tab', { name: 'Store' }))

    expect(plugins.readCatalog).toHaveBeenCalledOnce()
  })

  it('goes to the store from an empty installed list', async () => {
    const user = userEvent.setup()
    const { plugins } = draw({ installed: [] })

    await user.click(screen.getByRole('button', { name: 'Browse the store' }))

    expect(screen.getByRole('tab', { name: 'Store' })).toHaveAttribute('aria-selected', 'true')
    expect(plugins.readCatalog).toHaveBeenCalledOnce()
  })

  it('refreshes the marketplaces from the store, once there is a catalog to refresh', async () => {
    const user = userEvent.setup()
    const { plugins, rerender } = draw()

    const name = 'Check the marketplaces for new plugins'
    expect(screen.queryByRole('button', { name })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Store' }))
    expect(screen.getByRole('button', { name })).toBeDisabled()

    rerender({ catalog: catalogOf([]) })
    await user.click(screen.getByRole('button', { name }))
    expect(plugins.refreshCatalog).toHaveBeenCalledOnce()

    rerender({ catalog: catalogOf([]), busy: new Set([CATALOG_BUSY]) })
    expect(screen.getByRole('button', { name })).toBeDisabled()
  })

  /*
   * A plugin installed for every project is switched on in the user's own
   * settings. With that layer left out, it is installed and nothing here loads
   * it — the window says so instead of letting the switch look broken.
   */
  it('says when the Agent setting keeps the plugins from loading', async () => {
    const user = userEvent.setup()
    const { onOpenAgentSettings } = draw({}, false)

    expect(screen.getByText(/Settings → Agent leaves your user settings out/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Agent settings' }))

    expect(onOpenAgentSettings).toHaveBeenCalledOnce()
  })

  it('says nothing about the Agent setting when it loads the plugins', () => {
    draw()

    expect(screen.queryByText(/Settings → Agent/)).toBeNull()
  })

  it('says how far the last change reached', () => {
    const { rerender } = draw({ applied: 3 })
    expect(screen.getByRole('status')).toHaveTextContent('Applied to 3 open conversations.')

    rerender({ applied: 0 })
    expect(screen.getByRole('status')).toHaveTextContent(
      'Applied. Conversations started from now on will load it.'
    )

    // A failure is the newer news, and outranks the count.
    rerender({ applied: 2, error: 'Claude Code refused: no' })
    expect(screen.getByRole('status')).toHaveTextContent('Claude Code refused: no')
    expect(screen.getByRole('status')).toHaveClass('text-danger')
  })

  it('says nothing before anything has happened', () => {
    draw()

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('closes', async () => {
    const user = userEvent.setup()
    const { onClose } = draw()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})
