import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useErrorMessage } from './useErrorMessage.js'

interface UseWorkspaces {
  readonly byProject: ReadonlyMap<string, readonly WorkspaceView[]>
  readonly flat: readonly WorkspaceView[]
  readonly editingId: string | null
  readonly setEditingId: (workspaceId: string | null) => void
  readonly refresh: () => Promise<void>
  readonly create: (projectId: string) => Promise<void>
  readonly rename: (workspaceId: string, name: string) => Promise<void>
  readonly remove: (workspaceId: string) => Promise<void>
}

/**
 * Workspaces of every known project.
 *
 * Kept in one place because the sidebar, the shortcuts and the centre pane all
 * need the same list, and each of them asking separately would mean several
 * git reads per render.
 */
export function useWorkspaces(
  projects: readonly Project[],
  confirm: (request: ConfirmRequest) => Promise<ConfirmResult>,
  onError: (message: string) => void
): UseWorkspaces {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [byProject, setByProject] = useState<ReadonlyMap<string, readonly WorkspaceView[]>>(
    new Map()
  )
  const [editingId, setEditingId] = useState<string | null>(null)

  // Read inside callbacks without making them depend on the projects array,
  // which changes identity on every refresh.
  const latestProjects = useRef(projects)

  useEffect(() => {
    latestProjects.current = projects
  }, [projects])

  const load = useCallback(async (): Promise<Map<string, readonly WorkspaceView[]>> => {
    const entries = await Promise.all(
      latestProjects.current.map(async (project) => {
        const result = await window.octopus.workspaces.list(project.id)
        return [project.id, result.ok ? result.value : []] as const
      })
    )

    return new Map(entries)
  }, [])

  const refresh = useCallback(async () => {
    setByProject(await load())
  }, [load])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      // Read the current projects directly: the ref update above runs in its
      // own effect, which may not have fired yet on the first pass.
      const entries = await Promise.all(
        projects.map(async (project) => {
          const result = await window.octopus.workspaces.list(project.id)
          return [project.id, result.ok ? result.value : []] as const
        })
      )

      if (!controller.signal.aborted) setByProject(new Map(entries))
    })()

    return () => {
      controller.abort()
    }
  }, [projects])

  const create = useCallback(
    async (projectId: string) => {
      const result = await window.octopus.workspaces.create(projectId)
      if (!result.ok) {
        onError(describeFailure(result))
        return
      }

      await refresh()
      // Straight into rename: the generated name is a placeholder, and this is
      // the moment the user knows what the task is.
      setEditingId(result.value.id)
    },
    [refresh, describeFailure, onError]
  )

  const rename = useCallback(
    async (workspaceId: string, name: string) => {
      const result = await window.octopus.workspaces.rename(workspaceId, name)
      if (!result.ok) {
        onError(describeFailure(result))
        return
      }
      await refresh()
    },
    [refresh, describeFailure, onError]
  )

  const remove = useCallback(
    async (workspaceId: string) => {
      const workspace = [...byProject.values()].flat().find((item) => item.id === workspaceId)
      if (!workspace) return

      const dirty = await window.octopus.workspaces.hasChanges(workspaceId)
      const hasChanges = dirty.ok && dirty.value

      const answer = await confirm({
        title: t('workspaces.removeTitle'),
        message: t('workspaces.removeMessage', { name: workspace.name }),
        // Unsaved work is the only thing here that cannot be recovered, so it
        // replaces the reassuring text rather than sitting next to it.
        detail: hasChanges ? t('workspaces.removeDirty') : t('workspaces.removeDetail'),
        confirmLabel: t('workspaces.removeConfirm'),
        cancelLabel: t('workspaces.removeCancel'),
        destructive: true,
        checkbox: { label: t('workspaces.removeBranch', { branch: workspace.branch }) }
      })

      if (!answer.confirmed) return

      const result = await window.octopus.workspaces.remove(workspaceId, {
        force: hasChanges,
        deleteBranch: answer.checked
      })

      if (!result.ok) {
        onError(describeFailure(result))
        return
      }
      await refresh()
    },
    [byProject, confirm, refresh, describeFailure, onError, t]
  )

  return {
    byProject,
    flat: [...byProject.values()].flat(),
    editingId,
    setEditingId,
    refresh,
    create,
    rename,
    remove
  }
}
