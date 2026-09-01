import { useCallback, useEffect, useState } from 'react'

import type { SkillListing } from '@core/skills.js'

/**
 * Every skill a conversation could use, and whether it is on.
 *
 * Read rather than derived: the answer is three directories over two lists of
 * defaults over the conversation's own overrides, and the service already does
 * that arithmetic for the session it starts. A second copy of it here would be
 * a second answer, and the one the agent actually gets is not this one.
 *
 * Re-read when the panel is opened rather than kept live, because the things
 * that change it — a skill written in settings, a project's defaults edited —
 * happen in another window entirely. `refresh` is what the panel calls; the
 * toggle applies its own answer optimistically so the switch does not lag a
 * round trip behind the finger.
 */
export function useSkills(chatId: string | null): {
  readonly skills: readonly SkillListing[]
  readonly toggle: (key: string, enabled: boolean) => void
  readonly refresh: () => void
} {
  const [skills, setSkills] = useState<readonly SkillListing[]>([])
  const [shownFor, setShownFor] = useState<string | null>(chatId)

  // Cleared during render rather than in an effect: a list belonging to the
  // conversation just left is not stale, it is wrong — and `react-hooks` here
  // refuses a `setState` in an effect anyway.
  if (chatId !== shownFor) {
    setShownFor(chatId)
    setSkills([])
  }

  const read = useCallback(async (id: string) => {
    const answer = await window.octopus.skills.forChat(id)
    // A failed read leaves the last good list standing: "could not ask" and
    // "there are none" are different statements, and an emptied panel would
    // make the first look like the second.
    if (answer.ok) setSkills(answer.value)
  }, [])

  useEffect(() => {
    if (chatId === null) return

    const controller = new AbortController()

    void (async () => {
      const answer = await window.octopus.skills.forChat(chatId)
      if (!controller.signal.aborted && answer.ok) setSkills(answer.value)
    })()

    return () => {
      controller.abort()
    }
  }, [chatId])

  const toggle = useCallback(
    (key: string, enabled: boolean) => {
      if (chatId === null) return

      setSkills((current) =>
        current.map((skill) => (skill.key === key ? { ...skill, enabled } : skill))
      )

      void (async () => {
        const written = await window.octopus.skills.setForChat(chatId, key, enabled)
        // Put back from the service's own answer if the write did not land, so
        // the switch never shows a state the agent is not in.
        if (!written.ok) await read(chatId)
      })()
    },
    [chatId, read]
  )

  const refresh = useCallback(() => {
    if (chatId !== null) void read(chatId)
  }, [chatId, read])

  return { skills, toggle, refresh }
}
