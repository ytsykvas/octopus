import { useCallback, useEffect, useRef, useState } from 'react'

import type { InstalledPlugin, InstallOutcome, PluginCatalog, PluginTarget } from '@core/plugins.js'

import type { Failure } from '../../../preload/index.js'
import { useErrorMessage } from './useErrorMessage.js'

export interface PluginsController {
  /** Null until the first listing has answered. */
  readonly installed: readonly InstalledPlugin[] | null
  /** Null until the store has been opened once. */
  readonly catalog: PluginCatalog | null
  readonly catalogLoading: boolean
  /** Store ids and installed rows ({@link rowKey}) with an action under way. */
  readonly busy: ReadonlySet<string>
  /** How many open conversations the last write reached, or null before one. */
  readonly applied: number | null
  /**
   * The last failure in words, or null. An action's outranks a read's, and each
   * is cleared by the next of its own kind that works.
   */
  readonly error: string | null
  /** Forgets the last action's count and failure, for a window opened afresh. */
  readonly clearNote: () => void
  readonly readInstalled: () => Promise<void>
  readonly readCatalog: () => Promise<void>
  /**
   * Installs, or answers with the command a person has to read first. The
   * caller asks, then calls again with the digest.
   */
  readonly install: (
    id: string,
    acceptCommand?: string
  ) => Promise<Extract<InstallOutcome, { kind: 'needsConsent' }> | null>
  /** For a row {@link targetOf} answers for; one it does not cannot be changed. */
  readonly uninstall: (id: string, target: PluginTarget) => Promise<void>
  readonly setEnabled: (id: string, enabled: boolean, target: PluginTarget) => Promise<void>
  readonly connectOfficial: () => Promise<void>
  readonly refreshCatalog: () => Promise<void>
}

/**
 * What a row's action is marked busy under: one plugin can be installed for
 * every project and in a project as well, and acting on one row must not hold
 * the other.
 */
export function rowKey(id: string, target: PluginTarget): string {
  return target.scope === 'user' ? `${id} user` : `${id} ${target.scope} ${target.projectPath}`
}

/** The id the marketplace actions are marked busy under, beside plugin ids. */
export const CATALOG_BUSY = '#catalog'

/**
 * Where a write to this row lands, or null for one octopus cannot change.
 *
 * `managed` — put in place by an administrator — is the usual null, and a
 * project install whose project the CLI did not report is the other: a target
 * without its project would aim at the user's own settings.
 */
export function targetOf(plugin: InstalledPlugin): PluginTarget | null {
  if (plugin.scope === 'user') return { scope: 'user' }
  if ((plugin.scope === 'project' || plugin.scope === 'local') && plugin.projectPath !== null) {
    return { scope: plugin.scope, projectPath: plugin.projectPath }
  }

  return null
}

/**
 * Claude Code's plugins for the window: both lists, the actions, and what the
 * last one came to.
 *
 * The installed list is read when the app starts, not when the window opens:
 * the rail's tile marks a plugin that would not load, and it has to know before
 * anybody looks. The catalog is a slow listing and waits for the store.
 *
 * Both lists are read again after every write rather than patched from the
 * answer — the CLI is what changed them, and after a failure most of all,
 * since a refusal is often the list having moved under the window.
 */
export function usePlugins(): PluginsController {
  const [installed, setInstalled] = useState<readonly InstalledPlugin[] | null>(null)
  const [catalog, setCatalog] = useState<PluginCatalog | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [applied, setApplied] = useState<number | null>(null)
  // Two failures, kept apart: a write's refusal is followed by a re-read that
  // works, and one shared field would have the re-read clear the refusal the
  // moment it was shown. A read clears only its own.
  const [readFailure, setReadFailure] = useState<string | null>(null)
  const [actionFailure, setActionFailure] = useState<string | null>(null)
  const describeFailure = useErrorMessage()

  /*
   * Each read claims a number before its await and draws only if it is still
   * the newest. Two switches on two plugins re-read the list twice at once, and
   * the older reply landing last would flip the first switch back on screen.
   */
  const installedRead = useRef(0)
  const catalogRead = useRef(0)

  const showInstalled = useCallback(
    (answer: { ok: true; value: InstalledPlugin[] } | Failure) => {
      if (answer.ok) {
        setInstalled(answer.value)
        setReadFailure(null)
      } else {
        setReadFailure(describeFailure(answer))
      }
    },
    [describeFailure]
  )

  const readInstalled = useCallback(async () => {
    const claim = ++installedRead.current
    const answer = await window.octopus.plugins.list()
    if (claim === installedRead.current) showInstalled(answer)
  }, [showInstalled])

  const readCatalog = useCallback(async () => {
    const claim = ++catalogRead.current
    setCatalogLoading(true)
    const answer = await window.octopus.plugins.catalog()
    if (claim !== catalogRead.current) return

    setCatalogLoading(false)
    if (answer.ok) {
      setCatalog(answer.value)
      setReadFailure(null)
    } else {
      setReadFailure(describeFailure(answer))
    }
  }, [describeFailure])

  useEffect(() => {
    const claim = ++installedRead.current
    let live = true
    void window.octopus.plugins.list().then((answer) => {
      // Dropped for a window that has gone — or, under `StrictMode`, for the
      // first of two mounts — and for a reply a newer read has overtaken.
      if (live && claim === installedRead.current) showInstalled(answer)
    })

    return () => {
      live = false
    }
  }, [showInstalled])

  const clearNote = useCallback(() => {
    setApplied(null)
    setActionFailure(null)
  }, [])

  /** Runs one action under a busy mark, and reads both lists again after it. */
  const run = useCallback(
    async <T>(
      key: string,
      action: () => Promise<{ ok: true; value: T } | Failure>
    ): Promise<T | null> => {
      setBusy((current) => new Set(current).add(key))
      const answer = await action()
      setBusy((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })

      setActionFailure(answer.ok ? null : describeFailure(answer))

      await Promise.all([readInstalled(), catalog === null ? undefined : readCatalog()])

      return answer.ok ? answer.value : null
    },
    [describeFailure, readInstalled, readCatalog, catalog]
  )

  const install = useCallback(
    async (id: string, acceptCommand?: string) => {
      const outcome = await run(id, () => window.octopus.plugins.install(id, acceptCommand))
      if (outcome === null) return null
      if (outcome.kind === 'needsConsent') return outcome

      setApplied(outcome.reloaded)
      return null
    },
    [run]
  )

  const uninstall = useCallback(
    async (id: string, target: PluginTarget) => {
      const result = await run(rowKey(id, target), () =>
        window.octopus.plugins.uninstall(id, target)
      )
      if (result !== null) setApplied(result.reloaded)
    },
    [run]
  )

  const setEnabled = useCallback(
    async (id: string, enabled: boolean, target: PluginTarget) => {
      const result = await run(rowKey(id, target), () =>
        window.octopus.plugins.setEnabled(id, enabled, target)
      )
      if (result !== null) setApplied(result.reloaded)
    },
    [run]
  )

  const connectOfficial = useCallback(async () => {
    await run(CATALOG_BUSY, () => window.octopus.plugins.connectOfficial())
  }, [run])

  const refreshCatalog = useCallback(async () => {
    await run(CATALOG_BUSY, () => window.octopus.plugins.refresh())
  }, [run])

  return {
    installed,
    catalog,
    catalogLoading,
    busy,
    applied,
    error: actionFailure ?? readFailure,
    clearNote,
    readInstalled,
    readCatalog,
    install,
    uninstall,
    setEnabled,
    connectOfficial,
    refreshCatalog
  }
}
