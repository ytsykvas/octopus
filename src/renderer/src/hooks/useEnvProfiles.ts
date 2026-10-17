import { useEffect, useState } from 'react'

import { useErrorMessage } from './useErrorMessage.js'

export interface EnvProfiles {
  /** The project's sets of variables, sorted; empty until they are read. */
  readonly profiles: readonly string[]
  /** The set a workspace that follows the project runs with. */
  readonly projectDefault: string
  /** Puts a workspace on a set, or back on the project's with null. */
  readonly setWorkspaceProfile: (workspaceId: string, name: string | null) => Promise<void>
}

/**
 * A project's sets of variables, and the one way a workspace is moved between
 * them.
 *
 * Out of `RightPanel` so that a second place offering the same choice reads
 * and writes it the same way: two copies would be two answers to "which set is
 * this on".
 *
 * Read when the project changes rather than kept in `App`: the sets change in
 * the settings dialog, which closes back onto whichever pane asked.
 */
export function useEnvProfiles(
  projectId: string | null,
  /** Which set the project uses, until the list is read. */
  fallbackDefault: string,
  onError: (message: string | null) => void,
  /** Something about a workspace changed, and whatever lists them should re-read. */
  onChanged: () => void
): EnvProfiles {
  const describeFailure = useErrorMessage()
  const [profiles, setProfiles] = useState<readonly string[]>([])
  const [projectDefault, setProjectDefault] = useState(fallbackDefault)

  useEffect(() => {
    if (projectId === null) return
    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.projects.envProfiles(projectId)
      if (controller.signal.aborted || !answer.ok) return

      setProfiles(answer.value.profiles)
      setProjectDefault(answer.value.projectDefault)
    })()

    return () => {
      controller.abort()
    }
  }, [projectId, fallbackDefault])

  const setWorkspaceProfile = async (workspaceId: string, name: string | null): Promise<void> => {
    onError(null)
    const done = await window.octopus.workspaces.setEnvProfile(workspaceId, name)
    if (done.ok) onChanged()
    else onError(describeFailure(done))
  }

  return { profiles, projectDefault, setWorkspaceProfile }
}
