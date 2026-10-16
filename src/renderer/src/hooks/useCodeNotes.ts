import { useCallback, useState } from 'react'

/**
 * A note on lines of a file as it stands, written in the viewer and aimed at
 * one conversation.
 *
 * Not a `DiffComment`: there is no side, because the viewer shows one file,
 * the one on disk now. Identified by where it is, as a diff note is — a second
 * note over the same lines replaces the first.
 */
export interface CodeNote {
  readonly path: string
  readonly line: number
  /** The last line the note covers; equal to `line` when it covers one. */
  readonly endLine: number
  /** The lines as they read when the note was written, whole lines only. */
  readonly code: string
  /** The remark, which may be empty: then the reference and the code go alone. */
  readonly text: string
}

export interface CodeNoteController {
  /** One conversation's notes in the open workspace, in the order written. */
  readonly pendingFor: (tabKey: string) => readonly CodeNote[]
  readonly add: (tabKey: string, note: CodeNote) => void
  readonly remove: (tabKey: string, note: CodeNote) => void
  readonly clear: (tabKey: string) => void
}

/** Where a note sits, which is also what makes it the same note. */
export function codeNoteKey(note: Pick<CodeNote, 'path' | 'line' | 'endLine'>): string {
  return `${note.path}:${String(note.line)}-${String(note.endLine)}`
}

const NONE: readonly CodeNote[] = []

/**
 * Notes from the viewer, held per conversation.
 *
 * Per conversation where the diff's notes are per workspace, because these are
 * aimed: the viewer offers one button per conversation, and a note sent to the
 * second would otherwise be taken by whichever composer sent first. Keyed by
 * the tab's key, which stays fixed for the tab's life — the first one keeps
 * `first` after its first message.
 *
 * In memory only, like the diff's: a note points at lines that are about to
 * change, and one restored after a restart would point at whatever moved there.
 */
export function useCodeNotes(workspaceId: string | null): CodeNoteController {
  const [byTab, setByTab] = useState<ReadonlyMap<string, readonly CodeNote[]>>(new Map())

  const update = useCallback(
    (tabKey: string, change: (notes: readonly CodeNote[]) => readonly CodeNote[]) => {
      if (workspaceId === null) return
      const slot = `${workspaceId}#${tabKey}`

      setByTab((current) => new Map(current).set(slot, change(current.get(slot) ?? NONE)))
    },
    [workspaceId]
  )

  const pendingFor = useCallback(
    (tabKey: string) =>
      (workspaceId === null ? undefined : byTab.get(`${workspaceId}#${tabKey}`)) ?? NONE,
    [byTab, workspaceId]
  )

  const add = useCallback(
    (tabKey: string, note: CodeNote) => {
      update(tabKey, (notes) => [
        ...notes.filter((held) => codeNoteKey(held) !== codeNoteKey(note)),
        note
      ])
    },
    [update]
  )

  const remove = useCallback(
    (tabKey: string, note: CodeNote) => {
      update(tabKey, (notes) => notes.filter((held) => codeNoteKey(held) !== codeNoteKey(note)))
    },
    [update]
  )

  const clear = useCallback(
    (tabKey: string) => {
      update(tabKey, () => NONE)
    },
    [update]
  )

  return { pendingFor, add, remove, clear }
}
