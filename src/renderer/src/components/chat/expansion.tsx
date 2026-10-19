import { createContext, useContext, useState } from 'react'

/**
 * Whether the log is showing everything, as Claude Code's ctrl+o does.
 *
 * `generation` counts the presses. A row the reader opened or closed by hand
 * keeps that choice only until the next press, so "show everything" really
 * shows everything — and a click afterwards still works on the row it hits.
 */
export interface Expansion {
  readonly all: boolean
  readonly generation: number
}

export const COLLAPSED: Expansion = { all: false, generation: 0 }

export const ExpandContext = createContext<Expansion>(COLLAPSED)

/**
 * A fold's state: the reader's own choice since the last press, or the log's.
 *
 * Kept in the fold rather than by the log, so opening one row re-renders that
 * row and nothing else.
 */
export function useExpanded(): readonly [boolean, (open: boolean) => void] {
  const expansion = useContext(ExpandContext)
  const [own, setOwn] = useState<{ readonly generation: number; readonly open: boolean } | null>(
    null
  )

  const open = own !== null && own.generation === expansion.generation ? own.open : expansion.all

  return [
    open,
    (next) => {
      setOwn({ generation: expansion.generation, open: next })
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
