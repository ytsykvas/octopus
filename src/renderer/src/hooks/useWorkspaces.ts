import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useErrorMessage } from './useErrorMessage.js'

/**
 * How long to wait after a turn ends before asking git again.
 *
 * Long enough that a turn ending twice over — an error and then a result — is
 * one read rather than two, and short enough that the row is current by the
 * time the eye reaches it. The same number the diff pane settles on, for the
 * same reason.
 */
const SETTLE_MS = 300

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

  /** The pending re-read, so a turn ending twice over is one of them. */
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)

  /*
   * The changed-file count, re-read when the work that changes it stops.
   *
   * It used to be read on create, rename, remove and first load and never
   * again, so the agent could rewrite twenty files while the row went on saying
   * what it said an hour ago — beside a diff pane that re-reads itself on the
   * same event, and now inside the same dot that carries the agent's state.
   *
   * Only the project the workspace belongs to: a turn ending is a poor reason
   * to run `git status` over every workspace of every project.
   */
  useEffect(() => {
    const unsubscribe = window.octopus.chats.onEvent((announced) => {
      // A turn ends either way, and one that failed may well have written files
      // before it did.
      if (announced.event.type !== 'result' && announced.event.type !== 'error') return

      const projectId = latestProjects.current.find((project) =>
        announced.workspaceId.startsWith(`${project.id}/`)
      )?.id
      if (projectId === undefined) return

      if (settle.current !== null) clearTimeout(settle.current)
      settle.current = setTimeout(() => {
        void (async () => {
          const result = await window.octopus.workspaces.list(projectId)
          if (!result.ok) return

          setByProject((current) => new Map(current).set(projectId, result.value))
        })()
      }, SETTLE_MS)
    })

    return () => {
      unsubscribe()
      if (settle.current !== null) clearTimeout(settle.current)
    }
  }, [])

  /*
   * What a workspace is doing, patched in as the core says so.
   *
   * Patched rather than re-read: a full read asks git about every workspace of
   * every project, and this arrives several times a turn. The value is the one
   * the core already decided, so there is nothing to work out here — only where
   * to put it.
   */
  useEffect(
    () =>
      window.octopus.workspaces.onStatus(({ workspaceId, status }) => {
        setByProject((current) => {
          const next = new Map(current)

          for (const [projectId, workspaces] of current) {
            if (!workspaces.some((workspace) => workspace.id === workspaceId)) continue
            next.set(
              projectId,
              workspaces.map((workspace) =>
                workspace.id === workspaceId ? { ...workspace, status } : workspace
              )
            )
          }

          return next
        })
      }),
    []
  )

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
        // Ticked to begin with: a workspace is one task, and once it is done
        // with, the branch behind it is too. Leaving it behind is the rarer
        // choice, and the one still worth a click.
        checkbox: {
          label: t('workspaces.removeBranch', { branch: workspace.branch }),
          checked: true
        }
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
