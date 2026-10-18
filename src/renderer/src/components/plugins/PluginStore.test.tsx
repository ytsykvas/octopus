import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PluginsController } from '../../hooks/usePlugins.js'
import { CATALOG_BUSY } from '../../hooks/usePlugins.js'
import { stubDialogElement } from '../../test/dialog.js'
import { catalogOf, catalogPlugin, installedPlugin, pluginsController } from '../../test/plugins.js'
import { PluginStore } from './PluginStore.js'

function draw(overrides: Partial<PluginsController> = {}): PluginsController {
  const plugins = pluginsController(overrides)
  render(<PluginStore plugins={plugins} />)
  return plugins
}

const CONTEXT7 = catalogPlugin({ installs: 412_000, keywords: ['docs', 'mcp'] })
const FIGMA = catalogPlugin({
  id: 'figma@claude-plugins-official',
  name: 'figma',
  description: 'Design files and tokens',
  installs: 12_300,
  category: 'design',
  author: null
})
const LONELY = catalogPlugin({
  id: 'lonely@claude-plugins-official',
  name: 'lonely',
  description: null,
  installs: null,
  category: null,
  author: null
})
const ODD = catalogPlugin({
  id: 'odd@claude-plugins-official',
  name: 'odd',
  installs: null,
  category: 'astrology'
})

/** The card names in the order drawn. */
function cardNames(): string[] {
  return screen
    .getAllByRole('article')
    .map((card) => within(card).getAllByRole('button')[0]?.getAttribute('aria-label') ?? '')
}

describe('PluginStore', () => {
  beforeEach(() => {
    stubDialogElement()
  })

  it('draws cards in outline while the catalog is read', () => {
    draw({ catalog: null, catalogLoading: true })

    expect(screen.getByRole('status', { name: 'Reading plugins…' })).toBeInTheDocument()
  })

  /*
   * A read that failed leaves the catalog unread, and the refresh button
   * needs a catalog to refresh: pulsing cards for ever hid the one way out.
   */
  it('offers to read again when the catalog could not be read', async () => {
    const user = userEvent.setup()
    const plugins = draw({ catalog: null, catalogLoading: false })

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('The store could not be read')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(plugins.readCatalog).toHaveBeenCalledOnce()
  })

  /*
   * Claude Code adds the official marketplace on a first terminal session, so
   * a machine that only ever ran it through octopus has an empty store, and
   * has to be told why.
   */
  it('offers to connect the official marketplace to an empty store', async () => {
    const user = userEvent.setup()
    const plugins = draw({ catalog: catalogOf([], false) })

    expect(screen.getByText('The store is empty')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Connect the official marketplace' }))

    expect(plugins.connectOfficial).toHaveBeenCalledOnce()
  })

  it('holds the connect button while it connects', () => {
    draw({ catalog: catalogOf([], false), busy: new Set([CATALOG_BUSY]) })

    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled()
  })

  it('still offers the official marketplace beside another one', () => {
    draw({ catalog: catalogOf([FIGMA], false) })

    expect(
      screen.getByText('The official Claude Code marketplace is not connected.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect the official marketplace' })).toBeEnabled()
  })

  it('orders the cards by installs, the uncounted last and by name', () => {
    // Before the installed list has answered, too: nothing is marked installed.
    draw({ catalog: catalogOf([ODD, LONELY, FIGMA, CONTEXT7]), installed: null })

    expect(cardNames()).toEqual(['context7', 'figma', 'lonely', 'odd'])
  })

  it('prints counts the way a store does, in the reader’s language', () => {
    draw({
      catalog: catalogOf([
        CONTEXT7,
        FIGMA,
        catalogPlugin({ id: 'one@m', name: 'one', installs: 1 })
      ])
    })

    expect(screen.getByText('412K installs')).toBeInTheDocument()
    expect(screen.getByText('12.3K installs')).toBeInTheDocument()
    expect(screen.getByText('1 install')).toBeInTheDocument()
  })

  it('searches names, descriptions and keywords', async () => {
    const user = userEvent.setup()
    draw({ catalog: catalogOf([CONTEXT7, FIGMA, LONELY]) })

    await user.type(screen.getByRole('searchbox'), 'tokens')
    expect(cardNames()).toEqual(['figma'])

    await user.clear(screen.getByRole('searchbox'))
    await user.type(screen.getByRole('searchbox'), 'MCP')
    expect(cardNames()).toEqual(['context7'])

    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('Nothing matches “MCPzzz”.')).toBeInTheDocument()
  })

  it('filters by category, the largest first, with the uncategorised as Other', async () => {
    const user = userEvent.setup()
    draw({
      catalog: catalogOf([
        CONTEXT7,
        catalogPlugin({ id: 'two@m', name: 'two', installs: 5 }),
        FIGMA,
        LONELY,
        ODD
      ])
    })

    const pills = within(screen.getByRole('radiogroup', { name: 'Categories' })).getAllByRole(
      'radio'
    )
    expect(pills.map((pill) => pill.textContent)).toEqual([
      'All',
      'Development',
      // A category the window has no word for is shown as the marketplace wrote it.
      'astrology',
      'Design',
      'Other'
    ])
    expect(pills[0]).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: 'Design' }))
    expect(cardNames()).toEqual(['figma'])

    await user.click(screen.getByRole('radio', { name: 'Other' }))
    expect(cardNames()).toEqual(['lonely'])

    await user.click(screen.getByRole('radio', { name: 'All' }))
    expect(cardNames()).toHaveLength(5)
  })

  it('draws no category row for a catalog with one category', () => {
    draw({ catalog: catalogOf([CONTEXT7]) })

    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('installs from a card', async () => {
    const user = userEvent.setup()
    const plugins = draw({ catalog: catalogOf([CONTEXT7, FIGMA]) })

    await user.click(
      within(screen.getAllByRole('article')[0]!).getByRole('button', {
        name: 'Install'
      })
    )

    expect(plugins.install).toHaveBeenCalledWith(CONTEXT7.id)
  })

  // Installing from the store means every project, and a plugin installed in
  // one project only can still be — the CLI adds the user install beside it.
  it('offers to install a plugin that one project has, and not one every project has', () => {
    draw({
      catalog: catalogOf([CONTEXT7, FIGMA]),
      installed: [
        installedPlugin({ id: FIGMA.id, scope: 'local', projectPath: '/work/site' }),
        installedPlugin({ scope: 'managed' })
      ]
    })

    const [managed, local] = screen.getAllByRole('article')
    expect(managed).toHaveTextContent('Installed')
    expect(within(local!).getByRole('button', { name: 'Install' })).toBeEnabled()
  })

  it('marks what is already installed and what is installing', () => {
    draw({
      catalog: catalogOf([CONTEXT7, FIGMA]),
      installed: [installedPlugin()],
      busy: new Set([FIGMA.id])
    })

    const [installed, installing] = screen.getAllByRole('article')
    expect(installed).toHaveTextContent('Installed')
    expect(within(installed!).queryByRole('button', { name: 'Install' })).toBeNull()
    expect(within(installing!).getByRole('button', { name: 'Installing…' })).toBeDisabled()
  })

  /*
   * A marketplace that installs by running a command: the CLI refuses to run
   * it unseen, so the window shows it whole and installs only on a yes.
   */
  it('shows the command a plugin would run, and installs with its digest only on a yes', async () => {
    const user = userEvent.setup()
    const sha = 'a'.repeat(64)
    const install = vi
      .fn<PluginsController['install']>()
      .mockResolvedValue({ kind: 'needsConsent', command: 'npx -y runner@latest', sha256: sha })
    draw({ catalog: catalogOf([CONTEXT7]), install })

    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(screen.getByText('npx -y runner@latest')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(install).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Install' }))
    await user.click(screen.getByRole('button', { name: 'Run it and install' }))
    expect(install).toHaveBeenLastCalledWith(CONTEXT7.id, sha)
  })

  it('opens a plugin’s details, installs from them, and goes back', async () => {
    const user = userEvent.setup()
    const detailed = catalogPlugin({
      version: '2.2.157',
      keywords: ['docs', 'mcp'],
      homepage: 'https://context7.com'
    })
    const plugins = draw({ catalog: catalogOf([detailed, FIGMA]) })

    // Named by the plugin and described by its own words.
    expect(screen.getByRole('button', { name: 'context7' })).toHaveAccessibleDescription(
      'Up-to-date documentation lookup'
    )
    await user.click(screen.getByRole('button', { name: 'context7' }))

    expect(screen.getByRole('heading', { name: 'context7' })).toBeInTheDocument()
    expect(
      screen.getByText('by Upstash · From claude-plugins-official · Version 2.2.157')
    ).toBeInTheDocument()
    expect(screen.getByText('mcp')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Homepage' })).toHaveAttribute(
      'href',
      'https://context7.com'
    )
    expect(
      screen.getByText(/A plugin runs with the same access as Claude Code/)
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(plugins.install).toHaveBeenCalledWith(detailed.id)

    await user.click(screen.getByRole('button', { name: 'Close details' }))
    expect(cardNames()).toEqual(['figma', 'context7'])
  })

  it('opens the details of a plugin that says little about itself', async () => {
    const user = userEvent.setup()
    draw({
      catalog: catalogOf([LONELY, catalogPlugin({ id: 'x@m', name: 'x', category: 'design' })])
    })

    await user.click(screen.getByRole('button', { name: 'lonely' }))

    expect(screen.getByText('From claude-plugins-official')).toBeInTheDocument()
    expect(screen.getByText('No description.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
