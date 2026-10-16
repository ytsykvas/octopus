import { useCallback, useEffect, useRef, useState } from 'react'

import type { FileContent } from '@core/workspaceFiles.js'

import { useErrorMessage } from './useErrorMessage.js'
import { useWorkspaceSettled } from './useWorkspaceSettled.js'

export interface FileContentController {
  readonly content: FileContent | null
  readonly error: string | null
  readonly reload: () => void
  /** Hands the file to the system's editor; answers what went wrong, if anything. */
  readonly openExternally: () => Promise<string | null>
}

/**
 * One file of a workspace, for the viewer, kept current the way the tree is:
 * read on opening, after a turn ends and when the window comes back.
 *
 * The viewer is mounted only while its tab is in front and keyed by the path,
 * so "read on opening" is also "read each time the tab comes to the front".
 */
export function useFileContent(workspaceId: string, path: string): FileContentController {
  const describeFailure = useErrorMessage()
  const [content, setContent] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Rejects a reply overtaken by a newer read. */
  const generation = useRef(0)

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof window.octopus.files.read>>, attempt: number) => {
      if (attempt !== generation.current) return
      if (result.ok) {
        setContent(result.value)
        setError(null)
      } else {
        setError(describeFailure(result))
      }
    },
    [describeFailure]
  )

  const read = useCallback(async () => {
    const attempt = ++generation.current
    apply(await window.octopus.files.read(workspaceId, path), attempt)
  }, [workspaceId, path, apply])

  // Read inline rather than through `read`, so nothing sets state before the
  // first await — a synchronous setState in an effect is what the linter forbids.
  useEffect(() => {
    const attempt = ++generation.current
    void window.octopus.files.read(workspaceId, path).then((result) => {
      apply(result, attempt)
    })
  }, [workspaceId, path, apply])

  const reload = useCallback(() => {
    void read()
  }, [read])

  useWorkspaceSettled(workspaceId, true, reload)

  const openExternally = useCallback(async () => {
    const result = await window.octopus.files.open(workspaceId, path)
    return result.ok ? null : describeFailure(result)
  }, [workspaceId, path, describeFailure])

  return { content, error, reload, openExternally }
}
