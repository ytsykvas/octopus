import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { type HelpKind, helpMessage } from '../components/helpMessage.js'
import type { ChatTabsController } from './useChatTabs.js'
import { useErrorMessage } from './useErrorMessage.js'
import { useLatest } from './useLatest.js'

/**
 * What Help does when one of its items is chosen: a new conversation, started
 * on the instruction and what octopus knows already.
 *
 * Sent rather than put down, because choosing the item is the asking: a draft
 * left a second press to make and nothing to change in it. The reader still
 * sees every word (§4) — it is the conversation's first message — and edits
 * what the agent is told in Project settings. A new conversation rather than
 * the one on screen, so the ask never lands in the middle of another task.
 *
 * A message that could not be sent is put in the composer instead, so the
 * text is never lost and one press of Send retries it.
 *
 * Every read is done before anything is created, so a failure creates nothing;
 * an answer that arrives after the workspace changed is dropped, as
 * `useChatTabs` drops its own.
 */
export function useHelp(
  workspaceId: string | null,
  create: ChatTabsController['create'],
  keepDraft: (workspaceId: string, tabKey: string, text: string) => void,
  report: (message: string) => void
): (kind: HelpKind) => void {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  // The workspace on screen, for the answer to check against when it comes
  // back. Updated in an effect and read only inside the callback, as in
  // `useChatTabs`, never during render.
  const shown = useLatest(workspaceId)

  // A press while the last one is still reading would open a second conversation.
  const busy = useRef(false)

  return useCallback(
    (kind: HelpKind) => {
      const id = workspaceId
      // The menu is drawn only inside a workspace; the guard is for the type.
      /* v8 ignore next */
      if (id === null) return
      if (busy.current) return
      busy.current = true

      void (async () => {
        try {
          const [instruction, context] = await Promise.all([
            window.octopus.workspaces.instruction(id, kind),
            window.octopus.workspaces.helpContext(id)
          ])
          if (shown.current !== id) return

          if (!instruction.ok) {
            report(describeFailure(instruction))
            return
          }
          if (!context.ok) {
            report(describeFailure(context))
            return
          }

          const text = helpMessage(kind, instruction.value, context.value, t)
          await create(async (chatId) => {
            let reason: string
            try {
              const sent = await window.octopus.chats.send(chatId, text)
              if (sent.ok) return
              reason = describeFailure(sent)
            } catch (cause) {
              // Caught here rather than below: `create` would stop short of
              // showing a conversation that exists.
              reason = String(cause)
            }
            keepDraft(id, chatId, text)
            report(t('help.notSent', { reason }))
          })
        } catch (cause) {
          // A rejected read — main gone, a channel an older build has not got —
          // would otherwise close the menu and do nothing, as `Terminal` knows.
          report(t('help.failed', { reason: String(cause) }))
        } finally {
          busy.current = false
        }
      })()
    },
    [workspaceId, create, keepDraft, report, describeFailure, t, shown]
  )
}
