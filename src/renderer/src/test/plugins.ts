import { vi } from 'vitest'

import type { CatalogPlugin, InstalledPlugin, PluginCatalog } from '@core/plugins.js'

import type { PluginsController } from '../hooks/usePlugins.js'

/** An installed plugin, as the listing reports one, with what a test changes. */
export function installedPlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    id: 'context7@claude-plugins-official',
    name: 'context7',
    marketplace: 'claude-plugins-official',
    version: '1.0.0',
    scope: 'user',
    enabled: true,
    projectPath: null,
    description: 'Up-to-date documentation lookup',
    author: 'Upstash',
    homepage: null,
    components: [],
    errors: [],
    ...overrides
  }
}

/** One plugin the store offers. */
export function catalogPlugin(overrides: Partial<CatalogPlugin> = {}): CatalogPlugin {
  return {
    id: 'context7@claude-plugins-official',
    name: 'context7',
    marketplace: 'claude-plugins-official',
    description: 'Up-to-date documentation lookup',
    version: null,
    installs: 1000,
    category: 'development',
    author: 'Upstash',
    homepage: null,
    keywords: [],
    ...overrides
  }
}

export function catalogOf(plugins: CatalogPlugin[], officialConnected = true): PluginCatalog {
  return {
    officialConnected,
    marketplaces: officialConnected ? ['claude-plugins-official'] : [],
    plugins
  }
}

/**
 * The window's controller with every action a mock, for a component test that
 * is about what is drawn and what a click asks for — the hook has its own.
 */
export function pluginsController(overrides: Partial<PluginsController> = {}): PluginsController {
  return {
    installed: [],
    catalog: null,
    catalogLoading: false,
    busy: new Set(),
    applied: null,
    error: null,
    clearNote: vi.fn(),
    readInstalled: vi.fn(() => Promise.resolve()),
    readCatalog: vi.fn(() => Promise.resolve()),
    install: vi.fn(() => Promise.resolve(null)),
    uninstall: vi.fn(() => Promise.resolve()),
    setEnabled: vi.fn(() => Promise.resolve()),
    connectOfficial: vi.fn(() => Promise.resolve()),
    refreshCatalog: vi.fn(() => Promise.resolve()),
    ...overrides
  }
}
