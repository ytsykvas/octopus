import { useMemo, useState } from 'react'

import type { TreeIndex, TreeNode } from '@core/fileTree.js'

import { filterFiles } from '../components/files/treeRows.js'

export interface FileFilter {
  readonly query: string
  /** The files answering, best first; null while nothing is typed. */
  readonly matches: readonly TreeNode[] | null
  /** More files answered than the list holds. */
  readonly capped: boolean
  /** Where the arrows are among the matches; -1 when there are none. */
  readonly chosen: number
  readonly setQuery: (query: string) => void
  readonly choose: (path: string) => void
  readonly clear: () => void
  /** The field's keys: the arrows move, Enter keeps the chosen file open, Escape clears. */
  readonly onKeyDown: (
    event: React.KeyboardEvent,
    onOpen: (path: string, pinned: boolean) => void
  ) => void
}

/**
 * The Files tab's filter: what is typed, what answers it, and which answer the
 * arrows are on.
 *
 * The chosen answer is held by its path, not its place. The tree is read again
 * after every turn, and a place held across a re-read pointed at another file,
 * or past the end of a shorter list. A path that is no longer among the answers
 * falls back to the first.
 */
export function useFileFilter(index: TreeIndex | null): FileFilter {
  const [query, setQueryState] = useState('')
  const [chosenPath, setChosenPath] = useState<string | null>(null)

  const found = useMemo(
    () => (index === null || query.trim() === '' ? null : filterFiles(index, query)),
    [index, query]
  )
  const matches = found?.matches ?? null

  const at = matches?.findIndex((node) => node.path === chosenPath) ?? -1
  const chosen = matches === null || matches.length === 0 ? -1 : Math.max(0, at)

  const setQuery = (next: string): void => {
    setQueryState(next)
    // A new list, whose first answer is the likeliest.
    setChosenPath(null)
  }

  const moveTo = (list: readonly TreeNode[], place: number): void => {
    for (const node of list.slice(place, place + 1)) setChosenPath(node.path)
  }

  return {
    query,
    matches,
    capped: found?.capped ?? false,
    chosen,
    setQuery,
    choose: setChosenPath,
    clear: () => {
      setQuery('')
    },
    onKeyDown: (event, onOpen) => {
      if (matches === null) return
      switch (event.key) {
        case 'ArrowDown':
          moveTo(matches, Math.min(matches.length - 1, chosen + 1))
          break
        case 'ArrowUp':
          moveTo(matches, Math.max(0, chosen - 1))
          break
        case 'Enter':
          for (const node of matches.slice(chosen, chosen + 1)) onOpen(node.path, true)
          break
        case 'Escape':
          setQuery('')
          break
        default:
          return
      }
      event.preventDefault()
    }
  }
}
