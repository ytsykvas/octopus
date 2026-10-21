import { useCallback, useState } from 'react'

export interface AttachedFileController {
  /** One conversation's attached paths in the open workspace, in the order added. */
  readonly filesFor: (tabKey: string) => readonly string[]
  readonly add: (tabKey: string, paths: readonly string[]) => void
  readonly remove: (tabKey: string, path: string) => void
  readonly clear: (tabKey: string) => void
}

const NONE: readonly string[] = []

/**
 * The paths each conversation's next message will name, held per tab.
 *
 * Here rather than inside the conversation because the Files tab attaches to
 * it too, and the two panes are siblings that know nothing of each other —
 * the arrangement `useCodeNotes` already has for the viewer's notes, keyed the
 * same way so a tab keeps its files across its first message.
 *
 * In memory only, like the notes: an attachment is part of a question being
 * typed now.
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

  const remove = useCallback(
    (tabKey: string, path: string) => {
      update(tabKey, (files) => files.filter((held) => held !== path))
    },
    [update]
  )

  const clear = useCallback(
    (tabKey: string) => {
      update(tabKey, () => NONE)
    },
    [update]
  )

  return { filesFor, add, remove, clear }
}
