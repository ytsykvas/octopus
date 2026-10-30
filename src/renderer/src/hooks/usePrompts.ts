import { useCallback, useEffect, useState } from 'react'

import type { Prompt } from '@core/promptSchema.js'

export interface PromptLists {
  /** This project's own, in the order the user gave them. */
  readonly project: readonly Prompt[]
  readonly global: readonly Prompt[]
}

const NONE: PromptLists = { project: [], global: [] }

/**
 * Both lists, each as its store answers — and nothing, not a failure, for a
 * store that cannot be read.
 *
 * A picker that threw would take the composer with it, and the composer is
 * where the user is typing. What is wrong with a list is the settings section's
 * to say, where the user can do something about it.
 */
async function readBoth(projectId: string): Promise<PromptLists> {
  const [project, global] = await Promise.all([
    window.octopus.prompts.list({ kind: 'project', projectId }),
    window.octopus.prompts.list({ kind: 'global' })
  ])

  return {
    project: project.ok ? project.value : [],
    global: global.ok ? global.value : []
  }
}

/**
 * The saved prompts a conversation in this project can pick from.
 *
 * Read when the hook mounts and again whenever `refresh` is called, which the
 * picker does each time it opens: a prompt saved in Settings a moment ago is
 * then there without anything having to tell the composer so. A subscription
 * would be a second way for the same list to go stale, for a list that is
 * looked at a few times an hour.
 */
export function usePrompts(projectId: string): PromptLists & {
  readonly refresh: () => Promise<void>
} {
  const [lists, setLists] = useState<PromptLists>(NONE)

  const refresh = useCallback(async () => {
    setLists(await readBoth(projectId))
  }, [projectId])

  // Its own copy, with the abandon check: an effect that called `refresh` would
  // be a `setState` in an effect as far as the lint can tell, and a refresh is
  // awaited by its caller where this is not.
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const read = await readBoth(projectId)
      if (!controller.signal.aborted) setLists(read)
    })()

    return () => {
      controller.abort()
    }
  }, [projectId])

  return { ...lists, refresh }
}
