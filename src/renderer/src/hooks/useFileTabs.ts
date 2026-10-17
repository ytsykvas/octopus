import { useCallback, useMemo, useState } from 'react'

/**
 * A file open in the centre.
 *
 * `pinned` is the editor's preview rule: a file opened with one click is held
 * loosely, and the next one-click file takes its place, so browsing a tree does
 * not leave a tab behind per file looked at. A double-click — or Enter — keeps
 * it.
 */
export interface FileTab {
  readonly path: string
  readonly pinned: boolean
}

export interface FileTabsController {
  readonly tabs: readonly FileTab[]
  /** The file in front of the centre, or null when a conversation is. */
  readonly active: string | null
  /** Opens a file loosely, in the place of the loose one if there is one. */
  readonly preview: (path: string) => void
  /** Opens a file and keeps it. */
  readonly open: (path: string) => void
  readonly pin: (path: string) => void
  readonly select: (path: string) => void
  readonly close: (path: string) => void
  /** Brings the conversations back to the front, leaving the files open. */
  readonly showChat: () => void
}

interface Strip {
  readonly tabs: readonly FileTab[]
  readonly active: string | null
}

const EMPTY: Strip = { tabs: [], active: null }

function previewed(strip: Strip, path: string): Strip {
  if (strip.tabs.some((tab) => tab.path === path)) return { ...strip, active: path }

  const loose = strip.tabs.findIndex((tab) => !tab.pinned)
  const tab = { path, pinned: false }
  const tabs =
    loose === -1
      ? [...strip.tabs, tab]
      : strip.tabs.map((held, index) => (index === loose ? tab : held))
  return { tabs, active: path }
}

function pinned(strip: Strip, path: string): Strip {
  return {
    ...strip,
    tabs: strip.tabs.map((tab) => (tab.path === path ? { path, pinned: true } : tab))
  }
}

/**
 * Closing the tab in front shows its neighbour on the right, then the one on
 * the left — where the eye already is — and the conversation once none is left.
 */
function closed(strip: Strip, path: string): Strip {
  const at = strip.tabs.findIndex((tab) => tab.path === path)
  if (at === -1) return strip

  const tabs = strip.tabs.filter((tab) => tab.path !== path)
  if (strip.active !== path) return { tabs, active: strip.active }
  return { tabs, active: (tabs[at] ?? tabs[at - 1])?.path ?? null }
}

/**
 * The files open in the centre, per workspace.
 *
 * In memory only, like which conversation was in front: a restart opens on the
 * conversations, which is what the window is for. Kept per workspace so coming
 * back to one finds its files where they were. A removed workspace's entry is
 * simply never read again — ids are not reused.
 *
 * Held by `App` rather than the centre, because the right pane's tree opens
 * files into it and the keyboard closes them.
 */
export function useFileTabs(workspaceId: string | null): FileTabsController {
  const [strips, setStrips] = useState<Readonly<Record<string, Strip>>>({})
  const strip = (workspaceId === null ? undefined : strips[workspaceId]) ?? EMPTY

  const update = useCallback(
    (change: (strip: Strip) => Strip) => {
      if (workspaceId === null) return
      setStrips((current) => ({
        ...current,
        [workspaceId]: change(current[workspaceId] ?? EMPTY)
      }))
    },
    [workspaceId]
  )

  return useMemo(
    () => ({
      tabs: strip.tabs,
      active: strip.active,
      preview: (path) => {
        update((current) => previewed(current, path))
      },
      open: (path) => {
        update((current) => pinned(previewed(current, path), path))
      },
      pin: (path) => {
        update((current) => pinned(current, path))
      },
      select: (path) => {
        update((current) => ({ ...current, active: path }))
      },
      close: (path) => {
        update((current) => closed(current, path))
      },
      showChat: () => {
        update((current) => ({ ...current, active: null }))
      }
    }),
    [strip, update]
  )
}
