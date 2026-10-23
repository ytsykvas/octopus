import type { TFunction } from 'i18next'

import { type AgentKind, AGENT_NAMES, MAX_CHATS_PER_WORKSPACE } from '@core/chats.js'

/**
 * What a conversation is called: the name it was given, or its agent and its
 * place in the strip — "Claude 2".
 *
 * One spelling for every place that names one, so a mark in the diff, a button
 * in the viewer and a tab in the strip are recognisably the same conversation.
 * The automatic name is not stored, so closing the tab beside one renumbers it
 * rather than leaving it called after a place it no longer holds.
 */
export function chatName(
  t: TFunction,
  chat: { readonly title: string | null; readonly agent: AgentKind },
  number: number
): string {
  return chat.title ?? t('chat.tab', { agent: AGENT_NAMES[chat.agent], number })
}

/**
 * Why nothing more can open a conversation here, in one wording for every
 * place that cannot: the history's rows and the Help menu's items.
 */
export function chatCapHint(t: TFunction): string {
  return t('chat.historyFull', { limit: MAX_CHATS_PER_WORKSPACE })
}
