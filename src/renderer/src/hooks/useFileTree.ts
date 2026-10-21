import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  buildTree,
  type DirectoryListing,
  drawnOpen,
  type FileTreeSnapshot,
  folderStatuses,
  foldersFromDisk,
  listingNodes,
  nodeAt,
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
  readonly refresh: () => void
}

type Held = DirectoryListing | 'failed'

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
 * Whether a listing held above `folder` says it is not there — its parent's,
 * or that of any folder further up.
 *
 * `foldersFromDisk` cannot see this: `node_modules/pkg` removed by a reinstall
 * is still inside a folder git names whole, so it was read again on every
 * turn, failing each time, for a row nothing drew. Only a listing that was
 * read and answered decides — one not in yet, or one that failed, says nothing
 * about what is in it, and a folder opened with its parent must not be dropped
 * before the parent's listing lands.
 */
function unnamed(listings: ReadonlyMap<string, Held>, folder: string): boolean {
  for (let at = folder; at.includes('/'); at = at.slice(0, at.lastIndexOf('/'))) {
    const slash = at.lastIndexOf('/')
    const above = listings.get(at.slice(0, slash))
    const name = at.slice(slash + 1)
    if (
      typeof above === 'object' &&
      !above.entries.some((entry) => entry.kind === 'directory' && entry.name === name)
    ) {
      return true
    }
  }
  return false
}

/**
 * The worktree's files and marks for the Files tab, kept in step with the
 * agent the way the Changes tab is: read when the tab is shown, after a turn
 * ends, and when the window comes back — never while the tab is hidden.
 *
 * A folder whose rows come from disk — ignored, a submodule, a nested
 * repository, an empty folder — is read once it is drawn open, and again with
 * the tree for as long as it stays so.
 */
export function useFileTree(
  workspaceId: string | null,
  enabled: boolean,
  /** The open folders, as the panel remembers them — some inside a closed one. */
  expanded: ReadonlySet<string>
): FileTreeController {
  const describeFailure = useErrorMessage()
  const [state, setState] = useState<TreeState>(() => empty(workspaceId))

  if (state.id !== workspaceId) setState(empty(workspaceId))

  /** Rejects a reply that arrived after the workspace changed, or a newer read began. */
  const generation = useRef(0)

  const drawn = useMemo(() => drawnOpen(expanded), [expanded])

  /*
   * The folders read from disk, held, still drawn open and still named whole,
   * so a re-read refreshes them with the rest — and only them:
   * `node_modules/.pnpm` opened once and closed again must not cost a
   * 5 000-entry read on every turn from then on, nor may `node_modules/pkg`
   * left open inside it. Mirrored into refs rather than read from state,
   * because the read is started from callbacks that would otherwise hold a
   * stale copy.
   */
  const open = useRef(drawn)
  const opened = useRef<readonly string[]>([])
  useEffect(() => {
    open.current = drawn
    opened.current = [...state.listings.keys()].filter((folder) => drawn.has(folder))
  }, [state.listings, drawn])

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

      setState((current) => {
        if (current.id !== id) return current
        if (!tree.ok) return { ...current, error: describeFailure(tree) }

        // Merged into what is held rather than replacing it: a folder whose
        // first read landed while this one was under way is not among those
        // re-read, and dropping its listing would only have it read again.
        // A folder no longer drawn open — closed, or inside one closed — is let
        // go, and read afresh once it is drawn again. So is one git no longer
        // names whole, deleted or taken back in: held, it would be read on
        // every turn for a listing nothing lays out.
        const fromDisk = new Set(foldersFromDisk(tree.value.entries, open.current))
        const kept = new Map<string, Held>(
          [...current.listings].filter(([folder]) => fromDisk.has(folder))
        )
        for (const [folder, listing] of again) {
          if (fromDisk.has(folder)) kept.set(folder, listing.ok ? listing.value : 'failed')
        }
        for (const folder of [...kept.keys()]) if (unnamed(kept, folder)) kept.delete(folder)
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

  /*
   * Every folder drawn open whose rows come from disk is read when no listing
   * holds it — the one just clicked, those opened to show the open file, one
   * left open inside a folder opened again, and every one after a switch to
   * another workspace and back, since the open folders outlive the switch and
   * the listings do not. One rule rather than a call from each of those, so
   * none can be missed; until its listing lands the row reads as loading.
   *
   * Checked against what is held, so `node_modules/pkg` back after a reinstall
   * is read as soon as the outer listing names it again. Each read is noted
   * by workspace while it is under way, so a render in the meantime does not
   * ask twice, and a folder of the same name in the next workspace is not
   * taken for it.
   */
  const reading = useRef(new Set<string>())
  useEffect(() => {
    const { id, snapshot, listings } = state
    if (id === null || snapshot === null || !enabled) return

    for (const folder of foldersFromDisk(snapshot.entries, drawn)) {
      const key = `${id}\0${folder}`
      if (listings.has(folder) || unnamed(listings, folder) || reading.current.has(key)) continue

      reading.current.add(key)
      void window.octopus.files.directory(id, folder).then((listing) => {
        reading.current.delete(key)
        setState((current) =>
          current.id === id
            ? {
                ...current,
                listings: new Map(current.listings).set(
                  folder,
                  listing.ok ? listing.value : 'failed'
                )
              }
            : current
        )
      })
    }
  }, [state, enabled, drawn])

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
      const row = nodeAt(merged, folder)
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
    refresh
  }
}
