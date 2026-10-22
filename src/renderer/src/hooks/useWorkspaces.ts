import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { WorkspaceChat, WorkspaceView } from '@core/workspaces.js'

/** A conversation as the tab strip knows it: everything but the turn's start. */
export type TabChat = Omit<WorkspaceChat, 'turnStartedAt'>

import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { useErrorMessage } from './useErrorMessage.js'
import { onChatEvent } from './chatEvents.js'
import { useLatest } from './useLatest.js'

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
  /**
   * Replaces a workspace's conversation list, from the pane that owns it.
   *
   * Pushed rather than re-read: the tab strip has just opened or closed one and
   * knows the answer, while a re-read would put git to work on every workspace
   * of the project to learn something this window already decided. The dots on
   * the row would otherwise only catch up when the next turn ended.
   */
  readonly setChats: (workspaceId: string, chats: readonly TabChat[]) => void
  /**
   * Makes a workspace in a project, answering with its id — or null where
   * nothing was made, a second press included, so the caller can open it.
   */
  readonly create: (projectId: string) => Promise<string | null>
  /**
   * Whether a workspace is being made right now.
   *
   * Named for the one operation it guards rather than `busy`: this hook offers
   * three that change something, and only creation waits on the network.
   */
  readonly creating: boolean
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
  onError: (message: string | null) => void
): UseWorkspaces {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [byProject, setByProject] = useState<ReadonlyMap<string, readonly WorkspaceView[]>>(
    new Map()
  )
  const [editingId, setEditingId] = useState<string | null>(null)

  // Read inside callbacks without making them depend on the projects array,
  // which changes identity on every refresh.
  const latestProjects = useLatest(projects)

  const load = useCallback(async (): Promise<Map<string, readonly WorkspaceView[]>> => {
    const entries = await Promise.all(
      latestProjects.current.map(async (project) => {
        const result = await window.octopus.workspaces.list(project.id)
        return [project.id, result.ok ? result.value : []] as const
      })
    )

    return new Map(entries)
  }, [latestProjects])

  const refresh = useCallback(async () => {
    setByProject(await load())
  }, [load])

  /**
   * Applies a change to whichever project holds this workspace.
   *
   * The map is keyed by project and the callers only know the workspace, so the
   * search would otherwise be written out at each of them — and each of them
   * would have to remember to leave the other projects' arrays alone, which is
   * what keeps their rows from redrawing.
   *
   * A patch that hands the row back unchanged leaves the state as it was. This
   * state lives in `App`, so a fresh map — even one equal to the last — redrew
   * the whole window, several times a turn, for changes that were not there.
   */
  const patchWorkspace = useCallback(
    (workspaceId: string, patch: (workspace: WorkspaceView) => WorkspaceView) => {
      setByProject((current) => {
        let next: Map<string, readonly WorkspaceView[]> | null = null

        for (const [projectId, workspaces] of current) {
          let changed = false
          const patched: WorkspaceView[] = []
          for (const workspace of workspaces) {
            const after = workspace.id === workspaceId ? patch(workspace) : workspace
            if (after !== workspace) changed = true
            patched.push(after)
          }
          if (!changed) continue

          next ??= new Map(current)
          next.set(projectId, patched)
        }

        return next ?? current
      })
    },
    []
  )

  const setChats = useCallback(
    (workspaceId: string, chats: readonly TabChat[]) => {
      // The strip knows the tabs but not when a turn began, which only the core
      // says — so a conversation keeps the start this list already had for it.
      patchWorkspace(workspaceId, (workspace) => {
        const started = new Map(workspace.chats.map((chat) => [chat.id, chat.turnStartedAt]))
        return {
          ...workspace,
          chats: chats.map((chat) => ({ ...chat, turnStartedAt: started.get(chat.id) ?? null }))
        }
      })
    },
    [patchWorkspace]
  )

  /**
   * The pending re-read, so a turn ending twice over is one of them.
   *
   * One per workspace. A single timer was cleared by whichever workspace the
   * next event came from, so two turns finishing within the settle window left
   * one of them with no re-read at all — its row going on showing the count it
   * had before the agent touched anything. Several agents working at once is
   * this application's whole premise, so that is not a corner.
   */
  const settle = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  /**
   * Workspaces whose turn ended while the window was hidden, read on its return.
   *
   * Nobody can see the row then, and an agent's turns go on ending while the
   * window is in the background — which is when somebody leaves agents to it.
   */
  const unseen = useRef(new Map<string, string>())

  /*
   * The changed-file count, re-read when the work that changes it stops.
   *
   * It used to be read on create, rename, remove and first load and never
   * again, so the agent could rewrite twenty files while the row went on saying
   * what it said an hour ago — beside a diff pane that re-reads itself on the
   * same event, and now inside the same dot that carries the agent's state.
   *
   * Only the workspace whose turn ended: nothing else had an agent at work in
   * it. Re-reading its whole project ran `git status` and `rev-list` for every
   * sibling after every turn of every agent. A sibling's row catches up on its
   * own turn's end, or on a full refresh.
   */
  useEffect(() => {
    // Read into variables here rather than in the cleanup: a ref may point at
    // something else by the time a cleanup runs, and the timers to clear are
    // the ones this subscription started.
    const timers = settle.current
    const hidden = unseen.current

    const projectOf = (workspaceId: string): string | undefined =>
      latestProjects.current.find((project) => workspaceId.startsWith(`${project.id}/`))?.id

    const reread = async (workspaceId: string, projectId: string): Promise<void> => {
      const result = await window.octopus.workspaces.read(workspaceId)
      if (!result.ok) return

      const read = result.value
      if (read !== null) {
        // Compared whole, nested lists included, so a field added later is never
        // skipped; a needless miss costs one render, never a stale row.
        patchWorkspace(workspaceId, (held) =>
          JSON.stringify(held) === JSON.stringify(read) ? held : read
        )
        return
      }

      // Gone — the one thing a single read cannot draw. The project's list can.
      const listed = await window.octopus.workspaces.list(projectId)
      if (listed.ok) setByProject((current) => new Map(current).set(projectId, listed.value))
    }

    const unsubscribe = onChatEvent((announced) => {
      // A turn ends either way, and one that failed may well have written files
      // before it did.
      if (announced.event.type !== 'result' && announced.event.type !== 'error') return

      const { workspaceId } = announced
      const projectId = projectOf(workspaceId)
      if (projectId === undefined) return

      const pending = timers.get(workspaceId)
      if (pending !== undefined) clearTimeout(pending)

      timers.set(
        workspaceId,
        setTimeout(() => {
          timers.delete(workspaceId)
          // Asked when the timer fires rather than when the turn ended, so a
          // window hidden within the settle window is held too.
          if (document.hidden) hidden.set(workspaceId, projectId)
          else void reread(workspaceId, projectId)
        }, SETTLE_MS)
      )
    })

    const onVisibility = (): void => {
      if (document.hidden) return
      for (const [workspaceId, projectId] of hidden) void reread(workspaceId, projectId)
      hidden.clear()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      for (const pending of timers.values()) clearTimeout(pending)
      timers.clear()
    }
  }, [patchWorkspace, latestProjects])

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
        patchWorkspace(workspaceId, (workspace) =>
          workspace.status === status ? workspace : { ...workspace, status }
        )
      }),
    [patchWorkspace]
  )

  /*
   * The same, one level in: what each of a workspace's conversations is doing.
   *
   * A second subscription rather than more work in the one above, because the
   * row draws both — a summarising dot while there is one conversation, and one
   * dot per conversation once there are more, and the two move at different
   * moments. A conversation this window has not read yet is left alone; the
   * strip that opened it pushes the list down through `setChats`.
   */
  useEffect(
    () =>
      window.octopus.chats.onStatus(
        ({ chatId, workspaceId, status, interrupted, turnStartedAt }) => {
          patchWorkspace(workspaceId, (workspace) => {
            const held = workspace.chats.find((chat) => chat.id === chatId)
            // Unchanged, or a conversation this window has not read: nothing to draw.
            if (held === undefined) return workspace
            if (
              held.status === status &&
              held.interrupted === interrupted &&
              held.turnStartedAt === turnStartedAt
            ) {
              return workspace
            }

            return {
              ...workspace,
              chats: workspace.chats.map((chat) =>
                chat === held ? { ...chat, status, interrupted, turnStartedAt } : chat
              )
            }
          })
        }
      ),
    [patchWorkspace]
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

  const creatingRef = useRef(false)
  const [creating, setCreating] = useState(false)

  const create = useCallback(
    async (projectId: string) => {
      /*
       * A ref rather than the state, because the state is what a second press
       * would not have seen yet.
       *
       * Creation used to be a few local git commands and over before a second
       * press was possible. It now fetches first, which is a real interval —
       * and two presses inside it do worse than make two workspaces: both read
       * the same list of taken names, so the second is handed a name the first
       * has already claimed and fails on a path that exists. A refusal the user
       * did nothing to earn.
       */
      if (creatingRef.current) return null
      creatingRef.current = true
      setCreating(true)

      try {
        onError(null)
        const result = await window.octopus.workspaces.create(projectId)
        if (!result.ok) {
          onError(describeFailure(result))
          return null
        }

        /*
         * Read before answering, so the workspace the caller opens is already
         * in the list it draws from.
         *
         * No rename here any more. It went straight into one while the name was
         * a placeholder — but what somebody knows at this moment is the task,
         * and that goes into the conversation the caller now opens. The name
         * can be changed whenever it is worth it.
         */
        await refresh()
        return result.value.id
      } finally {
        creatingRef.current = false
        setCreating(false)
      }
    },
    [refresh, describeFailure, onError]
  )

  const rename = useCallback(
    async (workspaceId: string, name: string) => {
      onError(null)
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

      onError(null)
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

  // Held against the map: a list made anew on every render was a new value
  // for every memo downstream that takes it, on every render of the window.
  const flat = useMemo(() => [...byProject.values()].flat(), [byProject])

  return {
    byProject,
    flat,
    editingId,
    setEditingId,
    refresh,
    setChats,
    create,
    creating,
    rename,
    remove
  }
}
