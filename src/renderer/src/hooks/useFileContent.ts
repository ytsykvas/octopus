import { useCallback, useEffect, useRef, useState } from 'react'

import type { LineChanges } from '@core/lineChanges.js'
import type { FileContent } from '@core/workspaceFiles.js'

import { useErrorMessage } from './useErrorMessage.js'
import { useWorkspaceSettled } from './useWorkspaceSettled.js'

export interface FileContentController {
  readonly content: FileContent | null
  /**
   * The lines of a text file that differ from where the branch began, read
   * with it and applied in the same step; null for anything that is not text
   * and for a file whose marks could not be read.
   */
  readonly changes: LineChanges | null
  readonly error: string | null
  readonly reload: () => void
  /** Hands the file to the system's editor; answers what went wrong, if anything. */
  readonly openExternally: () => Promise<string | null>
}

/**
 * Whether two readings mark the same lines.
 *
 * Every turn reads the file again and most leave it as it was; the marks are
 * kept as the object they were so the layer drawn from them is not redrawn for
 * a read that found nothing new.
 */
function sameChanges(a: LineChanges | null, b: LineChanges | null): boolean {
  // Compared by value: both are built by one parser, so their keys come in one
  // order, and a handful of ranges costs less than the code that walks them.
  return JSON.stringify(a) === JSON.stringify(b)
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
  const [changes, setChanges] = useState<LineChanges | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Rejects a reply overtaken by a newer read. */
  const generation = useRef(0)

  const apply = useCallback(
    (
      result: Awaited<ReturnType<typeof window.octopus.files.read>>,
      marks: Awaited<ReturnType<typeof window.octopus.files.lineChanges>> | null,
      attempt: number
    ) => {
      if (attempt !== generation.current) return
      if (result.ok) {
        setContent(result.value)
        // A reading that failed marks nothing rather than failing the file:
        // the marks are a courtesy and the text is what was asked for.
        const next = marks?.ok ? marks.value : null
        setChanges((kept) => (sameChanges(kept, next) ? kept : next))
        setError(null)
      } else {
        setError(describeFailure(result))
      }
    },
    [describeFailure]
  )

  /*
   * The text first and the marks after it, applied together.
   *
   * Asked only of a text file, which is the only kind with lines to mark: a
   * binary or oversized file would otherwise cost a git read for nothing. One
   * path's diff and one listing, no more.
   */
  const read = useCallback(async () => {
    const attempt = ++generation.current
    const result = await window.octopus.files.read(workspaceId, path)
    const marks =
      result.ok && result.value.kind === 'text'
        ? await window.octopus.files.lineChanges(workspaceId, path)
        : null
    apply(result, marks, attempt)
  }, [workspaceId, path, apply])

  // Nothing sets state before the first await inside `read`, which is what the
  // cascading-render rule asks of a read started from an effect.
  useEffect(() => {
    void read()
  }, [read])

  const reload = useCallback(() => {
    void read()
  }, [read])

  useWorkspaceSettled(workspaceId, true, reload)

  const openExternally = useCallback(async () => {
    const result = await window.octopus.files.open(workspaceId, path)
    return result.ok ? null : describeFailure(result)
  }, [workspaceId, path, describeFailure])

  return { content, changes, error, reload, openExternally }
}
