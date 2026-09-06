import { useCallback, useState } from 'react'

import { useErrorMessage } from './useErrorMessage.js'

export interface AttachmentController {
  /** The paths riding out with the next message, in the order they were added. */
  readonly files: readonly string[]
  /**
   * Opens the system dialog. Cancelling adds nothing, which is a choice.
   *
   * The title is passed in rather than written here: it is text somebody
   * reads, so it belongs in the locales and this hook has no `t`.
   */
  readonly choose: (title: string) => Promise<void>
  /** Takes the paths of files dropped on the composer. */
  readonly drop: (files: readonly File[]) => void
  /** Writes a pasted image and adds where it landed. */
  readonly paste: (item: Blob) => Promise<void>
  readonly remove: (path: string) => void
  readonly clear: () => void
}

/**
 * Files the next message carries a path to.
 *
 * The whole of an attachment is its **path**. A file dragged in or chosen from
 * disk is never copied: the message says where it is, which is the plainest
 * form §4's rule that nothing implicit reaches the agent can take, and copying
 * would put a second copy of somebody's file somewhere they did not put it.
 *
 * A pasted image is the one exception and cannot be anything else — a clipboard
 * carries a picture rather than a file — so core writes it and answers with a
 * path like the others.
 */
export function useAttachments(onError: (message: string) => void): AttachmentController {
  const describeFailure = useErrorMessage()
  const [files, setFiles] = useState<readonly string[]>([])

  /* Added once. The same file chosen twice is one attachment, and a message
     naming a path twice reads as though the two were different files. */
  const add = useCallback((paths: readonly string[]) => {
    setFiles((current) => [...current, ...paths.filter((path) => !current.includes(path))])
  }, [])

  const choose = useCallback(
    async (title: string) => {
      const picked = await window.octopus.dialog.pickFiles(title)
      if (picked.ok) add(picked.value)
      else onError(describeFailure(picked))
    },
    [add, onError, describeFailure]
  )

  const drop = useCallback(
    (dropped: readonly File[]) => {
      // Empty for anything that never was a file on disk — a drag out of a
      // browser, say — and there is no path to carry for those.
      add(
        dropped
          .map((file) => window.octopus.attachments.pathFor(file))
          .filter((path) => path !== '')
      )
    },
    [add]
  )

  const paste = useCallback(
    async (item: Blob) => {
      const written = await window.octopus.attachments.paste(
        item.type,
        new Uint8Array(await item.arrayBuffer())
      )

      if (written.ok) add([written.value])
      else onError(describeFailure(written))
    },
    [add, onError, describeFailure]
  )

  const remove = useCallback((path: string) => {
    setFiles((current) => current.filter((item) => item !== path))
  }, [])

  const clear = useCallback(() => {
    setFiles([])
  }, [])

  return { files, choose, drop, paste, remove, clear }
}
