import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project, ProjectPatch } from '@core/store.js'

import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useErrorMessage } from './useErrorMessage.js'

interface UseProjects {
  readonly all: readonly Project[]
  /** A directory picker is open — the add button stays disabled meanwhile. */
  readonly busy: boolean
  readonly refresh: () => Promise<void>
  /** Adds from a directory the user picks; resolves to the new project or null if cancelled. */
  readonly addFromDisk: () => Promise<Project | null>
  /** Returns whether the change went through, so a dialog can report a refusal. */
  readonly update: (projectId: string, patch: ProjectPatch) => Promise<boolean>
  /** Asks first, then removes the project and everything it owns. */
  readonly remove: (projectId: string, workspaceCount: number) => Promise<boolean>
}

/**
 * The list of projects and the operations on it.
 *
 * A counterpart to `useWorkspaces`: without it the same four calls sat inline
 * in `App`, which then had to know about IPC results and error messages on top
 * of laying out the window.
 */
export function useProjects(
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>,
  /**
   * Reports a failure to the window — or, with `null`, that an attempt has
   * begun and the last one's message is no longer about anything. Without the
   * `null` the banner had no way to leave.
   */
  onError: (message: string | null) => void
): UseProjects {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [all, setAll] = useState<readonly Project[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const result = await window.octopus.projects.list()
    if (result.ok) {
      setAll(result.value)
    } else {
      onError(describeFailure(result))
    }
  }, [describeFailure, onError])

  // Aborting protects against writing state into an unmounted component if the
  // window closes mid-request.
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.projects.list()
      if (controller.signal.aborted) return

      if (result.ok) {
        setAll(result.value)
      } else {
        onError(describeFailure(result))
      }
    })()

    return () => {
      controller.abort()
    }
  }, [describeFailure, onError])

  const addFromDisk = useCallback(async (): Promise<Project | null> => {
    setBusy(true)
    try {
      onError(null)
      const result = await window.octopus.projects.add()
      if (!result.ok) {
        onError(describeFailure(result))
        return null
      }

      // null means the directory picker was cancelled — not an error.
      if (result.value) await refresh()
      return result.value
    } finally {
      setBusy(false)
    }
  }, [refresh, describeFailure, onError])

  const update = useCallback(
    async (projectId: string, patch: ProjectPatch): Promise<boolean> => {
      onError(null)
      const result = await window.octopus.projects.update(projectId, patch)
      if (!result.ok) {
        onError(describeFailure(result))
        return false
      }

      await refresh()
      return true
    },
    [refresh, describeFailure, onError]
  )

  const remove = useCallback(
    async (projectId: string, workspaceCount: number): Promise<boolean> => {
      const project = all.find((item) => item.id === projectId)
      if (!project) return false

      // The count is part of the question: "remove a project" reads much
      // smaller than "delete four branches", and neither is recoverable.
      const answer = await confirm({
        title: t('sidebar.removeTitle'),
        message: t('sidebar.removeMessage', { name: project.name }),
        detail:
          workspaceCount > 0
            ? t('sidebar.removeDetailWorkspaces', { count: workspaceCount })
            : t('sidebar.removeDetail'),
        confirmLabel: t('sidebar.removeConfirm'),
        cancelLabel: t('sidebar.removeCancel'),
        destructive: true
      })

      if (!answer.confirmed) return false

      onError(null)
      const result = await window.octopus.projects.remove(projectId)
      if (!result.ok) {
        onError(describeFailure(result))
        return false
      }

      await refresh()
      return true
    },
    [all, confirm, refresh, describeFailure, onError, t]
  )

  return { all, busy, refresh, addFromDisk, update, remove }
}
