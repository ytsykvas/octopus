import { useCallback, useEffect, useState } from 'react'

import type { SourceItemId, SourceView } from '@core/sourceItems.js'

/**
 * Where each of a project's scripts, instructions and live fields comes from.
 *
 * One read for the whole dialog: the badges, the layer tabs and the overview
 * table all draw from it, so two of them cannot disagree about what is in
 * effect. `reload` is for after something changed what the answer would be —
 * a save, a switch to the project's own.
 *
 * A read that fails leaves the list empty rather than stale: a badge naming
 * the wrong source is worse than none.
 */
export function useProjectSources(
  projectId: string,
  workspaceId: string | null,
  enabled: boolean
): {
  readonly sources: ReadonlyMap<SourceItemId, SourceView>
  readonly reload: () => void
} {
  const [sources, setSources] = useState<ReadonlyMap<SourceItemId, SourceView>>(new Map())
  const [asked, setAsked] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.sources(projectId, workspaceId)
      if (controller.signal.aborted) return
      setSources(new Map(answer.ok ? answer.value.map((view) => [view.id, view]) : []))
    })()

    return () => {
      controller.abort()
    }
  }, [projectId, workspaceId, enabled, asked])

  const reload = useCallback(() => {
    setAsked((count) => count + 1)
  }, [])

  return { sources, reload }
}
