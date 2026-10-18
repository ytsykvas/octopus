import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { InstalledPlugin, PluginCatalog } from '@core/plugins.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { CATALOG_BUSY, targetOf, usePlugins } from './usePlugins.js'

const CONTEXT7: InstalledPlugin = {
  id: 'context7@claude-plugins-official',
  name: 'context7',
  marketplace: 'claude-plugins-official',
  version: '1.0.0',
  scope: 'user',
  enabled: true,
  projectPath: null,
  description: 'Docs lookup',
  author: 'Upstash',
  homepage: null,
  components: ['mcp'],
  errors: []
}

const CATALOG: PluginCatalog = {
  officialConnected: true,
  marketplaces: ['claude-plugins-official'],
  plugins: []
}

interface Listing {
  ok: true
  value: InstalledPlugin[]
}

describe('where a write to a row lands', () => {
  it('is the user scope for a plugin installed everywhere', () => {
    expect(targetOf(CONTEXT7)).toEqual({ scope: 'user' })
  })

  it('is the project, with its path, for one installed in a project', () => {
    expect(targetOf({ ...CONTEXT7, scope: 'project', projectPath: '/work/site' })).toEqual({
      scope: 'project',
      projectPath: '/work/site'
    })
    expect(targetOf({ ...CONTEXT7, scope: 'local', projectPath: '/work/site' })).toEqual({
      scope: 'local',
      projectPath: '/work/site'
    })
  })

  /*
   * Without its project a project target would aim the CLI at home — the
   * user's own settings. And an administrator's install is not ours to change.
   */
  it('is nowhere for a managed plugin or a project install with no project', () => {
    expect(targetOf({ ...CONTEXT7, scope: 'managed' })).toBeNull()
    expect(targetOf({ ...CONTEXT7, scope: 'project', projectPath: null })).toBeNull()
  })
})

describe('usePlugins', () => {
  // At start-up, for the rail's warning dot; the catalog waits for the store.
  it('reads the installed list on mount, and not the catalog', async () => {
    vi.mocked(octopus().plugins.list).mockResolvedValue({ ok: true, value: [CONTEXT7] })

    const { result } = renderHook(() => usePlugins())

    await waitFor(() => {
      expect(result.current.installed).toEqual([CONTEXT7])
    })
    expect(result.current.catalog).toBeNull()
    expect(octopus().plugins.catalog).not.toHaveBeenCalled()
  })

  it('drops a first read the window has already abandoned', async () => {
    const abandoned = held<Listing>()
    vi.mocked(octopus().plugins.list)
      .mockReturnValueOnce(abandoned.promise)
      .mockResolvedValue({ ok: true, value: [] })

    const { result } = renderHook(() => usePlugins(), { wrapper: StrictMode })
    await waitFor(() => {
      expect(result.current.installed).toEqual([])
    })

    await act(async () => {
      abandoned.resolve({ ok: true, value: [CONTEXT7] })
      await abandoned.promise
    })

    expect(result.current.installed).toEqual([])
  })

  it('says why a listing failed, in words', async () => {
    vi.mocked(octopus().plugins.list).mockResolvedValue({
      ok: false,
      error: 'timed out',
      code: 'pluginTimedOut',
      params: { seconds: '120' }
    })

    const { result } = renderHook(() => usePlugins())

    await waitFor(() => {
      expect(result.current.error).toContain('120')
    })
    expect(result.current.installed).toBeNull()

    await act(() => result.current.readInstalled())
    expect(result.current.installed).toBeNull()
  })

  it('reads the catalog when asked, and says why it could not', async () => {
    const { result } = renderHook(() => usePlugins())
    const pending = held<{ ok: true; value: PluginCatalog }>()
    vi.mocked(octopus().plugins.catalog).mockReturnValueOnce(pending.promise)

    let read: Promise<void> = Promise.resolve()
    act(() => {
      read = result.current.readCatalog()
    })
    expect(result.current.catalogLoading).toBe(true)

    await act(async () => {
      pending.resolve({ ok: true, value: CATALOG })
      await read
    })
    expect(result.current.catalogLoading).toBe(false)
    expect(result.current.catalog).toEqual(CATALOG)

    vi.mocked(octopus().plugins.catalog).mockResolvedValueOnce({
      ok: false,
      error: 'x',
      code: 'pluginCliUnavailable',
      params: { message: 'spawn EACCES' }
    })
    await act(() => result.current.readCatalog())
    expect(result.current.error).toContain('spawn EACCES')
    expect(result.current.catalog).toEqual(CATALOG)
  })

  it('marks a plugin busy while its action runs, and says how far it reached', async () => {
    const { result } = renderHook(() => usePlugins())
    const pending = held<{ ok: true; value: { reloaded: number } }>()
    vi.mocked(octopus().plugins.setEnabled).mockReturnValueOnce(pending.promise)

    let write: Promise<void> = Promise.resolve()
    act(() => {
      write = result.current.setEnabled(CONTEXT7.id, false, { scope: 'user' })
    })
    expect(result.current.busy.has(CONTEXT7.id)).toBe(true)

    await act(async () => {
      pending.resolve({ ok: true, value: { reloaded: 3 } })
      await write
    })

    expect(result.current.busy.has(CONTEXT7.id)).toBe(false)
    expect(result.current.applied).toBe(3)
    expect(octopus().plugins.setEnabled).toHaveBeenCalledWith(CONTEXT7.id, false, {
      scope: 'user'
    })
  })

  /*
   * After a write the CLI is what changed the lists, and after a failure most
   * of all: a refusal is often the list having moved under the window.
   */
  it('reads the lists again after every write, the failed ones too', async () => {
    const { result } = renderHook(() => usePlugins())
    await waitFor(() => {
      expect(octopus().plugins.list).toHaveBeenCalledTimes(1)
    })
    await act(() => result.current.readCatalog())

    vi.mocked(octopus().plugins.uninstall).mockResolvedValueOnce({
      ok: false,
      error: 'x',
      code: 'pluginNotInstalled'
    })
    await act(() => result.current.uninstall(CONTEXT7.id, { scope: 'user' }))

    expect(result.current.error).toBe(
      'That plugin is no longer installed there. The list has been read again.'
    )
    expect(result.current.applied).toBeNull()
    expect(octopus().plugins.list).toHaveBeenCalledTimes(2)
    expect(octopus().plugins.catalog).toHaveBeenCalledTimes(2)

    await act(() => result.current.uninstall(CONTEXT7.id, { scope: 'user' }))
    expect(result.current.error).toBeNull()
    expect(result.current.applied).toBe(0)
  })

  it('leaves the catalog unread after a write when the store was never opened', async () => {
    const { result } = renderHook(() => usePlugins())

    await act(() => result.current.setEnabled(CONTEXT7.id, true, { scope: 'user' }))

    expect(octopus().plugins.catalog).not.toHaveBeenCalled()
  })

  it('keeps the last count when a switch fails', async () => {
    const { result } = renderHook(() => usePlugins())
    await act(() => result.current.setEnabled(CONTEXT7.id, true, { scope: 'user' }))
    expect(result.current.applied).toBe(0)

    vi.mocked(octopus().plugins.setEnabled).mockResolvedValueOnce({
      ok: false,
      error: 'x',
      code: 'pluginProjectMissing',
      params: { path: '/work/site' }
    })
    await act(() =>
      result.current.setEnabled(CONTEXT7.id, false, { scope: 'local', projectPath: '/work/site' })
    )

    expect(result.current.error).toContain('/work/site')
    expect(result.current.applied).toBe(0)
  })

  it('hands a command back for consent, and installs with its digest', async () => {
    const sha = 'a'.repeat(64)
    vi.mocked(octopus().plugins.install)
      .mockResolvedValueOnce({
        ok: true,
        value: { kind: 'needsConsent', command: 'npx run', sha256: sha, reloaded: 0 }
      })
      .mockResolvedValueOnce({ ok: true, value: { kind: 'installed', reloaded: 2 } })
    const { result } = renderHook(() => usePlugins())

    let consent: Awaited<ReturnType<typeof result.current.install>> = null
    await act(async () => {
      consent = await result.current.install('runner@m')
    })
    expect(consent).toEqual({ kind: 'needsConsent', command: 'npx run', sha256: sha, reloaded: 0 })
    // Nothing was installed, so nothing was applied.
    expect(result.current.applied).toBeNull()

    await act(async () => {
      consent = await result.current.install('runner@m', sha)
    })
    expect(consent).toBeNull()
    expect(result.current.applied).toBe(2)
    expect(octopus().plugins.install).toHaveBeenLastCalledWith('runner@m', sha)
  })

  it('answers nothing for an install that failed', async () => {
    vi.mocked(octopus().plugins.install).mockResolvedValueOnce({
      ok: false,
      error: 'x',
      code: 'pluginActionFailed',
      params: { message: 'not found' }
    })
    const { result } = renderHook(() => usePlugins())

    let consent: Awaited<ReturnType<typeof result.current.install>> = null
    await act(async () => {
      consent = await result.current.install('nope@m')
    })

    expect(consent).toBeNull()
    expect(result.current.error).toBe('Claude Code refused: not found')
  })

  it('marks the marketplace actions busy under one key', async () => {
    const { result } = renderHook(() => usePlugins())
    const pending = held<{ ok: true; value: undefined }>()
    vi.mocked(octopus().plugins.connectOfficial).mockReturnValueOnce(pending.promise)

    let connect: Promise<void> = Promise.resolve()
    act(() => {
      connect = result.current.connectOfficial()
    })
    expect(result.current.busy.has(CATALOG_BUSY)).toBe(true)

    await act(async () => {
      pending.resolve({ ok: true, value: undefined })
      await connect
    })
    expect(result.current.busy.size).toBe(0)

    await act(() => result.current.refreshCatalog())
    expect(octopus().plugins.refresh).toHaveBeenCalledOnce()
  })
})
