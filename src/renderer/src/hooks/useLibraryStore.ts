import { useCallback, useEffect, useMemo, useState } from 'react'

import type { LibraryEntry, LibraryImport, LibraryPreview } from '@core/library.js'
import type { LibraryKind } from '@core/libraryNames.js'
import type { Store } from '@core/stores.js'

import { useErrorMessage } from './useErrorMessage.js'

export interface LibraryStoreController {
  readonly entries: readonly LibraryEntry[]
  /** The last failure in words, or null; cleared by the next attempt that works. */
  readonly error: string | null
  /** Saves an edit over what is there. */
  readonly save: (name: string, text: string) => Promise<boolean>
  /** Writes one that is not here yet — an import, or the empty-file button. */
  readonly create: (name: string, text: string) => Promise<boolean>
  readonly remove: (name: string) => Promise<void>
  readonly rename: (name: string, to: string) => Promise<boolean>
  /** What an import would write, and the name it suggests for it. */
  readonly inspect: (request: LibraryImport) => Promise<LibraryPreview | null>
}

/**
 * One kind of one store's library, and the five things a settings section does.
 *
 * The same shape `useSkillStore` has, and for the same reasons: a component
 * laying out a dialog should not also know what an IPC failure looks like, and
 * the list is re-read after every write rather than patched from the answer —
 * disk is the thing being edited.
 *
 * `projectId` is taken apart from the store and put back together in a `useMemo`
 * so the dependency arrays can say what they actually depend on: the caller
 * builds the object inline on every render, and an identity check would re-read
 * the list on each one.
 */
export function useLibraryStore(store: Store, kind: LibraryKind): LibraryStoreController {
  const [entries, setEntries] = useState<readonly LibraryEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const describeFailure = useErrorMessage()

  const projectId = store.kind === 'project' ? store.projectId : null
  const target = useMemo<Store>(
    () => (projectId === null ? { kind: 'global' } : { kind: 'project', projectId }),
    [projectId]
  )

  const refresh = useCallback(async () => {
    const answer = await window.octopus.library.list(target, kind)
    if (answer.ok) setEntries(answer.value)
    else setError(describeFailure(answer))
  }, [target, kind, describeFailure])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.library.list(target, kind)
      if (controller.signal.aborted) return
      if (answer.ok) setEntries(answer.value)
      else setError(describeFailure(answer))
    })()

    return () => {
      controller.abort()
    }
  }, [target, kind, describeFailure])

  const save = useCallback(
    async (name: string, text: string) => {
      const written = await window.octopus.library.save(target, kind, name, text)
      if (!written.ok) {
        setError(describeFailure(written))
        return false
      }

      setError(null)
      await refresh()
      return true
    },
    [target, kind, describeFailure, refresh]
  )

  const create = useCallback(
    async (name: string, text: string) => {
      const written = await window.octopus.library.create(target, kind, name, text)
      if (!written.ok) {
        setError(describeFailure(written))
        return false
      }

      setError(null)
      await refresh()
      return true
    },
    [target, kind, describeFailure, refresh]
  )

  const remove = useCallback(
    async (name: string) => {
      const removed = await window.octopus.library.remove(target, kind, name)
      if (removed.ok) setError(null)
      else setError(describeFailure(removed))

      await refresh()
    },
    [target, kind, describeFailure, refresh]
  )

  const rename = useCallback(
    async (name: string, to: string) => {
      const renamed = await window.octopus.library.rename(target, kind, name, to)
      if (!renamed.ok) {
        setError(describeFailure(renamed))
        return false
      }

      setError(null)
      await refresh()
      return true
    },
    [target, kind, describeFailure, refresh]
  )

  const inspect = useCallback(
    async (request: LibraryImport) => {
      const seen = await window.octopus.library.inspect(kind, request)
      if (!seen.ok) {
        setError(describeFailure(seen))
        return null
      }

      setError(null)
      return seen.value
    },
    [kind, describeFailure]
  )

  return { entries, error, save, create, remove, rename, inspect }
}
