import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  buildTree,
  type DirectoryListing,
  type FileTreeSnapshot,
  folderStatuses,
  foldersFromDisk,
  listingNodes,
  type TreeIndex,
  type TreeStatus
} from '@core/fileTree.js'

import type { ListingState } from '../components/files/treeRows.js'
import { useErrorMessage } from './useErrorMessage.js'
import { useWorkspaceSettled } from './useWorkspaceSettled.js'

export interface FileTreeController {
  /** Children by folder, folders read from disk so far included; null before the first read. */
  readonly index: TreeIndex | null
  readonly statuses: Readonly<Record<string, TreeStatus>>
  /** Each folder's strongest status below it, for the dot on a collapsed one. */
  readonly folders: Readonly<Record<string, TreeStatus>>
  readonly listings: ReadonlyMap<string, ListingState>
  readonly truncated: boolean
  readonly error: string | null
  /** Reads a folder from disk — ignored, a submodule, a nested repository, an empty folder. The caller asks only for one not yet held. */
  readonly openFolder: (path: string) => void
  readonly refresh: () => void
}

type Held = DirectoryListing | 'loading' | 'failed'

/**
 * Everything one workspace's tree is made of.
 *
 * One object, keyed by the workspace it describes, so switching workspace is a
 * single reset during render rather than four — and so no frame can pair one
 * workspace's files with another's folders.
 */
interface TreeState {
  readonly id: string | null
  readonly snapshot: FileTreeSnapshot | null
  readonly listings: ReadonlyMap<string, Held>
  readonly error: string | null
}

const NO_STATUSES: Readonly<Record<string, TreeStatus>> = {}

const empty = (id: string | null): TreeState => ({
  id,
  snapshot: null,
  listings: new Map(),
  error: null
})

/**
 * The worktree's files and marks for the Files tab, kept in step with the
 * agent the way the Changes tab is: read when the tab is shown, after a turn
 * ends, and when the window comes back — never while the tab is hidden.
 */
export function useFileTree(
  workspaceId: string | null,
  enabled: boolean,
  /** The open folders: only an open folder read from disk is read again with the tree. */
  expanded: ReadonlySet<string>
): FileTreeController {
  const describeFailure = useErrorMessage()
  const [state, setState] = useState<TreeState>(() => empty(workspaceId))

  if (state.id !== workspaceId) setState(empty(workspaceId))

  /** Rejects a reply that arrived after the workspace changed, or a newer read began. */
  const generation = useRef(0)

  /*
   * The folders read from disk, held, still open and still named whole, so a
   * re-read refreshes them with the rest — and only them: `node_modules/.pnpm`
   * opened once and closed again must not cost a 5 000-entry read on every
   * turn from then on. Mirrored into
   * refs rather than read from state, because the read is started from
   * callbacks that would otherwise hold a stale copy.
   */
  const open = useRef(expanded)
  const opened = useRef<readonly string[]>([])
  useEffect(() => {
    open.current = expanded
    opened.current = [...state.listings.keys()].filter((folder) => expanded.has(folder))
  }, [state.listings, expanded])

  const read = useCallback(
    async (id: string) => {
      const attempt = ++generation.current
      const directory = async (folder: string) =>
        [folder, await window.octopus.files.directory(id, folder)] as const
      const [tree, again] = await Promise.all([
        window.octopus.files.tree(id),
        Promise.all(opened.current.map(directory))
      ])
      if (attempt !== generation.current) return

      /*
       * The open folders the tree says are read from disk and no listing holds
       * — open before this hook had read anything, which is every one of them
       * after a switch to another workspace and back. Read now rather than with
       * the tree, which is what says which folders they are. Checked against
       * the listings as they are now, so one opened while the tree was read is
       * not asked for twice.
       */
      const unheld = tree.ok
        ? foldersFromDisk(tree.value.entries, open.current).filter(
            (folder) => !opened.current.includes(folder)
          )
        : []
      const late = await Promise.all(unheld.map(directory))
      if (attempt !== generation.current) return

      setState((current) => {
        if (current.id !== id) return current
        if (!tree.ok) return { ...current, error: describeFailure(tree) }

        // Merged into what is held rather than replacing it: a folder opened
        // while this read was under way is not among those re-read, and
        // dropping it would leave its row reading for ever.
        // A closed folder is let go, and read afresh if it is opened again. So
        // is one git no longer names whole, deleted or taken back in: held, it
        // would be read on every turn for a listing nothing lays out.
        const fromDisk = new Set(foldersFromDisk(tree.value.entries, open.current))
        const kept = new Map<string, Held>(
          [...current.listings].filter(([folder]) => fromDisk.has(folder))
        )
        for (const [folder, listing] of [...again, ...late]) {
          if (fromDisk.has(folder)) kept.set(folder, listing.ok ? listing.value : 'failed')
        }
        return { id, snapshot: tree.value, listings: kept, error: null }
      })
    },
    [describeFailure]
  )

  // Read inline in the effect body, so nothing sets state before the first
  // await — a synchronous setState in an effect is what the linter forbids.
  useEffect(() => {
    if (workspaceId === null || !enabled) return
    void read(workspaceId)
  }, [workspaceId, enabled, read])

  const refresh = useCallback(() => {
    if (workspaceId !== null) void read(workspaceId)
  }, [workspaceId, read])

  useWorkspaceSettled(workspaceId, enabled, refresh)

  const openFolder = useCallback(
    (path: string) => {
      if (workspaceId === null) return
      const id = workspaceId

      const settle = (value: Held): void => {
        setState((current) =>
          current.id === id
            ? { ...current, listings: new Map(current.listings).set(path, value) }
            : current
        )
      }

      settle('loading')
      void window.octopus.files.directory(id, path).then((listing) => {
        settle(listing.ok ? listing.value : 'failed')
      })
    },
    [workspaceId]
  )

  const base = useMemo(
    () => (state.snapshot === null ? null : buildTree(state.snapshot.entries)),
    [state.snapshot]
  )

  /*
   * Git's tree with the folders read from disk laid into it — each only while
   * its own row is still one git names whole. A folder that stops being ignored
   * (`.gitignore` edited, `git add -f`) goes back to git's children and marks,
   * rather than staying a grey listing that git no longer describes.
   *
   * Shallowest first, so a folder read inside another read folder finds its
   * row already laid in.
   */
  const index = useMemo(() => {
    if (base === null) return null
    const merged = new Map(base)
    const folders = [...state.listings].sort(([a], [b]) => a.length - b.length)
    for (const [folder, listing] of folders) {
      if (typeof listing === 'string') continue
      const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : ''
      const row = merged.get(parent)?.find((node) => node.path === folder)
      if (row?.childrenFromDisk === true) merged.set(folder, listingNodes(row, listing))
    }
    return merged
  }, [base, state.listings])

  const listings = useMemo(() => {
    const states = new Map<string, ListingState>()
    for (const [folder, listing] of state.listings) {
      states.set(
        folder,
        typeof listing === 'string'
          ? { status: listing }
          : { status: 'ready', truncated: listing.truncated }
      )
    }
    return states
  }, [state.listings])

  const statuses = state.snapshot?.statuses ?? NO_STATUSES
  const folders = useMemo(() => folderStatuses(statuses), [statuses])

  return {
    index,
    statuses,
    folders,
    listings,
    truncated: state.snapshot?.truncated ?? false,
    error: state.error,
    openFolder,
    refresh
  }
}
