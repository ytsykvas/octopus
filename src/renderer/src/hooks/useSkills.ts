import { useCallback, useEffect, useState } from 'react'

import type { Chat } from '@core/chats.js'
import type { SkillListing } from '@core/skills.js'

import type { Result } from '../../../preload/index.js'

/**
 * Who to ask about, in the one place that decides.
 *
 * Outside the hook so both the first read and every later one go through it:
 * written twice, one of the two copies would have had a branch no test could
 * reach, which is the coverage threshold's way of pointing at a duplication.
 */
function readSkills(chatId: string | null, workspaceId: string): Promise<Result<SkillListing[]>> {
  return chatId === null
    ? window.octopus.skills.forWorkspace(workspaceId)
    : window.octopus.skills.forChat(chatId)
}

export interface SkillsController {
  readonly skills: readonly SkillListing[]
  readonly toggle: (key: string, enabled: boolean) => void
  readonly refresh: () => void
}

/**
 * Every skill a conversation could use, and whether it is on.
 *
 * Read rather than derived: the answer is three directories over two lists of
 * defaults over the conversation's own overrides, and the service already does
 * that arithmetic for the session it starts. A second copy of it here would be
 * a second answer, and the one the agent actually gets is not this one.
 *
 * **Asked of the workspace until the conversation exists.** `openChat` is lazy
 * — there is no record until the first message — and the panel would otherwise
 * be empty in every fresh workspace, which is exactly where somebody opens it
 * first. Nothing has been said about any skill at that point, so the defaults
 * are the whole answer, and switching one is the moment the record is created:
 * the same thing the model and effort pickers beside it already do.
 *
 * Re-read when the panel is opened rather than kept live, because the things
 * that change it — a skill written in settings, a project's defaults edited —
 * happen in another window entirely. The toggle applies its own answer
 * optimistically so the switch does not lag a round trip behind the finger.
 */
export function useSkills(
  chatId: string | null,
  workspaceId: string,
  ensureChat: () => Promise<Chat | null>
): SkillsController {
  const [skills, setSkills] = useState<readonly SkillListing[]>([])
  const [shownFor, setShownFor] = useState<string | null>(chatId)

  // Cleared during render rather than in an effect: a list belonging to the
  // conversation just left is not stale, it is wrong — and `react-hooks` here
  // refuses a `setState` in an effect anyway.
  if (chatId !== shownFor) {
    setShownFor(chatId)
    setSkills([])
  }

  const read = useCallback(async () => {
    const answer = await readSkills(chatId, workspaceId)

    // A failed read leaves the last good list standing: "could not ask" and
    // "there are none" are different statements, and an emptied panel would
    // make the first look like the second.
    if (answer.ok) setSkills(answer.value)
  }, [chatId, workspaceId])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const answer = await readSkills(chatId, workspaceId)

      if (!controller.signal.aborted && answer.ok) setSkills(answer.value)
    })()

    return () => {
      controller.abort()
    }
  }, [chatId, workspaceId])

  const toggle = useCallback(
    (key: string, enabled: boolean) => {
      setSkills((current) =>
        current.map((skill) => (skill.key === key ? { ...skill, enabled } : skill))
      )

      void (async () => {
        // Whatever record there is, or the one this switch brings into being.
        const target = chatId ?? (await ensureChat())?.id
        if (target === undefined) return

        const written = await window.octopus.skills.setForChat(target, key, enabled)
        // Put back from the service's own answer if the write did not land, so
        // the switch never shows a state the agent is not in.
        if (!written.ok) await read()
      })()
    },
    [chatId, ensureChat, read]
  )

  const refresh = useCallback(() => {
    void read()
  }, [read])

  return { skills, toggle, refresh }
}
