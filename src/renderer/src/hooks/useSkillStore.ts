import { useCallback, useEffect, useMemo, useState } from 'react'

import type { SkillStore } from '@core/skillNames.js'
import type { SkillEntry, SkillImport, SkillSave } from '@core/skills.js'

import { useErrorMessage } from './useErrorMessage.js'

export interface SkillStoreController {
  readonly skills: readonly SkillEntry[]
  /** The last failure in words, or null; cleared by the next attempt that works. */
  readonly error: string | null
  /** Both take the directory the listing found, which is what addresses a skill. */
  readonly save: (folder: string, save: SkillSave) => Promise<boolean>
  readonly remove: (folder: string) => Promise<void>
  /** Gives one another name, moving every answer stored against it. */
  readonly rename: (folder: string, to: string) => Promise<boolean>
  readonly bring: (request: SkillImport) => Promise<boolean>
  readonly refresh: () => Promise<void>
}

/**
 * One store's skills, and the four things a settings section does to them.
 *
 * A hook rather than state in the section, which is the pattern `useProjects`
 * set: a component laying out a dialog should not also know what an IPC failure
 * looks like.
 *
 * The list is re-read after every write rather than patched from the answer.
 * Disk is the thing being edited — a save can change a description, an import
 * decides its own name — and a second copy of that reasoning here would be a
 * second answer to a question the store has already answered.
 *
 * `projectId` is taken apart from the store and put back together in a `useMemo`
 * so the dependency arrays can say what they actually depend on: the caller
 * builds the object inline on every render, and an identity check would re-read
 * the list on each one.
 */
export function useSkillStore(store: SkillStore): SkillStoreController {
  const [skills, setSkills] = useState<readonly SkillEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const describeFailure = useErrorMessage()

  const projectId = store.kind === 'project' ? store.projectId : null
  const target = useMemo<SkillStore>(
    () => (projectId === null ? { kind: 'global' } : { kind: 'project', projectId }),
    [projectId]
  )

  const refresh = useCallback(async () => {
    const answer = await window.octopus.skills.list(target)
    if (answer.ok) setSkills(answer.value)
    else setError(describeFailure(answer))
  }, [target, describeFailure])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.skills.list(target)
      if (controller.signal.aborted) return
      if (answer.ok) setSkills(answer.value)
      else setError(describeFailure(answer))
    })()

    return () => {
      controller.abort()
    }
  }, [target, describeFailure])

  const save = useCallback(
    async (folder: string, request: SkillSave) => {
      const written = await window.octopus.skills.save(target, folder, request)
      if (!written.ok) {
        setError(describeFailure(written))
        return false
      }

      setError(null)
      await refresh()
      return true
    },
    [target, describeFailure, refresh]
  )

  const remove = useCallback(
    async (folder: string) => {
      const removed = await window.octopus.skills.remove(target, folder)
      if (removed.ok) setError(null)
      else setError(describeFailure(removed))

      await refresh()
    },
    [target, describeFailure, refresh]
  )

  const rename = useCallback(
    async (folder: string, to: string) => {
      const renamed = await window.octopus.skills.rename(target, folder, to)
      if (!renamed.ok) {
        setError(describeFailure(renamed))
        return false
      }

      setError(null)
      await refresh()
      return true
    },
    [target, describeFailure, refresh]
  )

  const bring = useCallback(
    async (request: SkillImport) => {
      const imported = await window.octopus.skills.import(target, request)
      if (!imported.ok) {
        setError(describeFailure(imported))
        return false
      }

      setError(null)
      await refresh()
      return true
    },
    [target, describeFailure, refresh]
  )

  return { skills, error, save, remove, rename, bring, refresh }
}
