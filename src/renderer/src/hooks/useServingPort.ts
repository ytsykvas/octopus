import { useEffect, useState } from 'react'

/**
 * How many times to ask before saying nothing is there.
 *
 * A dev server takes a moment to bind, and asking once would call every slow
 * boot a mistake. Five seconds is longer than a framework needs and shorter
 * than somebody will sit wondering why the link is blank.
 */
const ATTEMPTS = 5
const INTERVAL_MS = 1_000

/**
 * Whether a workspace's own port has stayed silent while its server runs.
 *
 * octopus assigns the port, hands it over as `$OCTOPUS_PORT` and links to it —
 * and a script is free to ignore all of that. `rails s` binds 3000 whatever it
 * was told, so the link opens on nothing and the pane is the thing that looks
 * broken. Asking is the only way to know, and false is the honest answer until
 * we have asked enough times to mean it.
 *
 * Keyed on the **run**, not the workspace: what is being measured is a server
 * start, and a restart is another one. Keyed on the workspace alone, the
 * verdict of the first start stood for every later run of it — including a
 * restart that fixed the very thing the warning complained about.
 */
export function useServingPort(workspaceId: string | null, run = 0): boolean {
  const key = workspaceId === null ? null : `${workspaceId}#${String(run)}`
  const [state, setState] = useState<{ id: string | null; silent: boolean }>({
    id: key,
    silent: false
  })

  // Adjusted during render rather than in an effect: an effect runs after the
  // paint, so a workspace that has just started would inherit one frame of the
  // last one's answer.
  if (state.id !== key) setState({ id: key, silent: false })

  useEffect(() => {
    if (workspaceId === null) return

    let stopped = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const probe = async (): Promise<void> => {
      const result = await window.octopus.workspaces.serving(workspaceId)
      if (stopped) return

      // Answered, so there is nothing to say and nothing left to ask.
      if (result.ok && result.value) return

      attempts += 1
      if (attempts >= ATTEMPTS) {
        setState({ id: key, silent: true })
        return
      }

      timer = setTimeout(() => void probe(), INTERVAL_MS)
    }

    void probe()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [key, workspaceId])

  return state.id === key && state.silent
}
