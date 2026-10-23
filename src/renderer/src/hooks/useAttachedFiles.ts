import { useCallback, useState } from 'react'

export interface AttachedFileController {
  /** One conversation's attached paths in the open workspace, in the order added. */
  readonly filesFor: (tabKey: string) => readonly string[]
  readonly add: (tabKey: string, paths: readonly string[]) => void
  readonly clear: (tabKey: string) => void
}

const NONE: readonly string[] = []

/**
 * Paths waiting to be written into each conversation's field, held per tab.
 *
 * A queue rather than a list that lives: the composer writes what arrives into
 * the text at its caret and clears it. Here rather than inside the
 * conversation because the Files tab points at files too, and the two panes
 * are siblings that know nothing of each other — the arrangement `useCodeNotes`
 * already has for the viewer's notes, keyed the same way.
 *
 * In memory only, like the notes: a path is part of a question being typed now.
 */
export function useAttachedFiles(workspaceId: string | null): AttachedFileController {
  const [byTab, setByTab] = useState<ReadonlyMap<string, readonly string[]>>(new Map())

  const update = useCallback(
    (tabKey: string, change: (files: readonly string[]) => readonly string[]) => {
      if (workspaceId === null) return
      const slot = `${workspaceId}#${tabKey}`

      setByTab((current) => new Map(current).set(slot, change(current.get(slot) ?? NONE)))
    },
    [workspaceId]
  )

  const filesFor = useCallback(
    (tabKey: string) =>
      (workspaceId === null ? undefined : byTab.get(`${workspaceId}#${tabKey}`)) ?? NONE,
    [byTab, workspaceId]
  )

  /* Added once. The same file chosen twice is one attachment, and a message
     naming a path twice reads as though the two were different files. */
  const add = useCallback(
    (tabKey: string, paths: readonly string[]) => {
      update(tabKey, (files) => [...files, ...paths.filter((path) => !files.includes(path))])
    },
    [update]
  )

  const clear = useCallback(
    (tabKey: string) => {
      update(tabKey, () => NONE)
    },
    [update]
  )

  return { filesFor, add, clear }
}
