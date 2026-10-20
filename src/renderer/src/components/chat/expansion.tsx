import { createContext, useContext, useState } from 'react'

/**
 * Whether the log is showing everything, as Claude Code's ctrl+o does — and
 * which rows were asked to open on their own.
 *
 * `generation` counts the presses. A row the reader opened or closed by hand
 * keeps that choice only until the next press, so "show everything" really
 * shows everything — and a click afterwards still works on the row it hits.
 *
 * `reveal` is the rows "Show in conversation" needs open to reach an agent
 * nested inside another, counted by `revealed` the same way; a reveal opens
 * them without touching any other row the reader has open or closed.
 */
export interface Expansion {
  readonly all: boolean
  readonly generation: number
  readonly reveal: ReadonlySet<string>
  readonly revealed: number
}

export const COLLAPSED: Expansion = { all: false, generation: 0, reveal: new Set(), revealed: 0 }

export const ExpandContext = createContext<Expansion>(COLLAPSED)

interface OwnChoice {
  readonly generation: number
  readonly revealed: number
  readonly open: boolean
}

/**
 * A fold's state: the reader's own choice since the last press or reveal, or
 * the log's.
 *
 * Kept in the fold rather than by the log, so opening one row re-renders that
 * row and nothing else. `id` is the row's, for a reveal to find it by.
 */
export function useExpanded(id?: string): readonly [boolean, (open: boolean) => void] {
  const expansion = useContext(ExpandContext)
  const [own, setOwn] = useState<OwnChoice | null>(null)

  const revealedHere =
    id !== undefined && expansion.reveal.has(id) && own?.revealed !== expansion.revealed
  const open = revealedHere || (own?.generation === expansion.generation ? own.open : expansion.all)

  return [
    open,
    (next) => {
      setOwn({ generation: expansion.generation, revealed: expansion.revealed, open: next })
    }
  ]
}

/** What a row needs to open the file it names. */
export interface FileLinks {
  /** The checkout the agent works in, which every path it names is relative to. */
  readonly workspacePath: string
  /** Opens a workspace-relative path in the centre: kept open, or as a preview. */
  readonly onOpenFile: (path: string, pinned: boolean) => void
}

export const FileLinkContext = createContext<FileLinks | null>(null)
