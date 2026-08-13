import { useCallback, useEffect, useState } from 'react'

import type { AgentModel } from '@core/chats.js'

/**
 * The models this account may use.
 *
 * Separate from `useChat` for the same reason as the rate limit: the list
 * belongs to the account rather than to a conversation, and switching workspace
 * must not empty the picker.
 *
 * Read once when the pane opens, and again whenever a session starts — that is
 * the only moment the answer can change, because the agent can only be asked
 * while one is running. Nothing is polled.
 *
 * The previous list survives a failed read. An empty picker would say "no
 * models", which is a different and wrong claim from "could not ask just now".
 */
export function useModels(): readonly AgentModel[] {
  const [models, setModels] = useState<readonly AgentModel[]>([])

  const refresh = useCallback(async () => {
    const known = await window.octopus.chats.models()
    if (known.ok) setModels(known.value)
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const known = await window.octopus.chats.models()
      if (!controller.signal.aborted && known.ok) setModels(known.value)
    })()

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(
    () =>
      window.octopus.chats.onEvent(({ event }) => {
        if (event.type === 'session_started') void refresh()
      }),
    [refresh]
  )

  return models
}
