import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginsController } from '../../hooks/usePlugins.js'
import { stubDialogElement } from '../../test/dialog.js'
import { rowKey } from '../../hooks/usePlugins.js'
import { installedPlugin, pluginsController } from '../../test/plugins.js'
import { InstalledPlugins } from './InstalledPlugins.js'

function draw(overrides: Partial<PluginsController> = {}): {
  plugins: PluginsController
  onBrowseStore: () => void
} {
  const plugins = pluginsController(overrides)
  const onBrowseStore = vi.fn()
  render(<InstalledPlugins plugins={plugins} onBrowseStore={onBrowseStore} />)
  return { plugins, onBrowseStore }
}

const SITE = installedPlugin({
  id: 'commit-commands@claude-plugins-official',
  name: 'commit-commands',
  scope: 'local',
  projectPath: '/work/site',
  enabled: false,
  description: 'Commit, push and open a pull request',
  components: ['skills', 'commands'],
  homepage: 'https://example.com/commit'
})

describe('InstalledPlugins', () => {
  beforeEach(() => {
    stubDialogElement()
  })

  it('says it is reading before the first listing has answered', () => {
    draw({ installed: null })

    expect(screen.getByText('Reading plugins…')).toBeInTheDocument()
  })

  it('points at the store when nothing is installed', async () => {
    const user = userEvent.setup()
    const { onBrowseStore } = draw({ installed: [] })

    expect(screen.getByText('No plugins yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Browse the store' }))

    expect(onBrowseStore).toHaveBeenCalledOnce()
  })

  it('draws each plugin with where it is installed and what it brings', () => {
    draw({
      installed: [
        installedPlugin(),
        SITE,
        installedPlugin({
          id: 'broken@m',
          name: 'broken',
          version: null,
          marketplace: '',
          description: null,
          errors: ['MCP server failed', 'hook refused']
        })
      ]
    })

    const [first, second, third] = screen.getAllByRole('listitem')
    expect(first).toHaveTextContent('claude-plugins-official · Version 1.0.0 · All projects')
    expect(second).toHaveTextContent('Project, just you')
    expect(second).toHaveTextContent('/work/site')
    expect(second).toHaveTextContent('Commit, push and open a pull request')
    expect(within(second!).getByText('Skills')).toBeInTheDocument()
    expect(within(second!).getByText('Commands')).toBeInTheDocument()
    // Nothing missing joins the line: no stray separators for an empty field.
    expect(within(third!).getByText('All projects')).toBeInTheDocument()
    expect(third).toHaveTextContent('Would not load: MCP server failed; hook refused')
  })

  /*
   * `shell.openExternal` starts any scheme the system knows, and a homepage is
   * a marketplace's to write.
   */
  it('links a homepage only when it is a web page', () => {
    draw({
      installed: [
        SITE,
        installedPlugin({ id: 'odd@m', name: 'odd', homepage: 'file:///etc/passwd' }),
        installedPlugin({ id: 'bad@m', name: 'bad', homepage: 'not a url' })
      ]
    })

    const links = screen.getAllByRole('link', { name: 'Homepage' })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://example.com/commit')
    expect(links[0]).toHaveAttribute('target', '_blank')
  })

  it('filters by name and description', async () => {
    const user = userEvent.setup()
    draw({ installed: [installedPlugin(), SITE] })

    await user.type(screen.getByRole('searchbox'), 'pull request')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('commit-commands')).toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('Nothing matches “zzz”.')).toBeInTheDocument()
  })

  it('switches a plugin where it was installed', async () => {
    const user = userEvent.setup()
    const { plugins } = draw({ installed: [SITE] })

    await user.click(screen.getByRole('switch', { name: 'Use commit-commands' }))

    expect(plugins.setEnabled).toHaveBeenCalledWith(SITE.id, true, {
      scope: 'local',
      projectPath: '/work/site'
    })
  })

  // Removing deletes the plugin's data too, which is not undone by installing
  // it again — so it is asked first, and says so.
  it('asks before removing, and removes only on a yes', async () => {
    const user = userEvent.setup()
    const { plugins } = draw({ installed: [installedPlugin()] })

    await user.click(screen.getByRole('button', { name: 'Remove context7' }))
    expect(screen.getByText(/Its data directory goes with it/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(plugins.uninstall).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Remove context7' }))
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(plugins.uninstall).toHaveBeenCalledWith('context7@claude-plugins-official', {
      scope: 'user'
    })
  })

  /*
   * One plugin can be installed for every project and in a project as well:
   * acting on one row holds that row, not its twin.
   */
  it('holds a row’s controls while its action runs, and only that row’s', () => {
    draw({
      installed: [
        installedPlugin(),
        installedPlugin({ scope: 'local', projectPath: '/work/site' })
      ],
      busy: new Set([rowKey('context7@claude-plugins-official', { scope: 'user' })])
    })

    const [held, free] = screen.getAllByRole('switch', { name: 'Use context7' })
    expect(held).toBeDisabled()
    expect(free).toBeEnabled()
    expect(screen.getAllByRole('button', { name: 'Remove context7' })[0]).toBeDisabled()
  })

  /*
   * An administrator's install is shown, not hidden — and with words rather
   * than a switch nobody can move, which would read as "not now".
   */
  it('shows a plugin it cannot change, and says why', () => {
    draw({
      installed: [
        installedPlugin({ scope: 'managed' }),
        installedPlugin({ id: 'odd@m', name: 'odd', scope: 'enterprise', enabled: false })
      ]
    })

    const [managed, odd] = screen.getAllByRole('listitem')
    expect(managed).toHaveTextContent('Managed')
    expect(managed).toHaveTextContent('On')
    expect(managed).toHaveTextContent('Set up by your organisation')
    // A scope the window has no word for is shown as the CLI wrote it.
    expect(odd).toHaveTextContent('enterprise')
    expect(odd).toHaveTextContent('Off')
    // Not an organisation's: Claude Code just did not say where it is.
    expect(odd).toHaveTextContent('Claude Code did not say where this one is installed')
    expect(odd).not.toHaveTextContent('organisation')
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
  })
})
