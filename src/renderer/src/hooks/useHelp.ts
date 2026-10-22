import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { type HelpKind, helpMessage } from '../components/helpMessage.js'
import type { ChatTabsController } from './useChatTabs.js'
import { useErrorMessage } from './useErrorMessage.js'

/**
 * What Help does when one of its items is chosen: a new conversation with the
 * instruction and what octopus knows already in its composer, and nothing sent.
 *
 * Put down rather than sent, because the app adds nothing to what the agent is
 * told that the reader has not seen (§4): the text is there to read, edit and
 * send. A new conversation rather than the one on screen, because a draft
 * cannot be put into a composer that is already drawn: it reads its draft once,
 * as it mounts.
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
  const shown = useRef(workspaceId)

  useEffect(() => {
    shown.current = workspaceId
  }, [workspaceId])

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
          await create((chatId) => {
            keepDraft(id, chatId, text)
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
    [workspaceId, create, keepDraft, report, describeFailure, t]
  )
}
