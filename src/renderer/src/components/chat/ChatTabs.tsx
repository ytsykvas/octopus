import { GitBranchPlus, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AGENT_NAMES } from '@core/chats.js'

import type { ChatTab, ChatTabsController } from '../../hooks/useChatTabs.js'
import { chatStatusLabel, chatStatusTone } from '../agentStatus.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { NameEditor } from '../NameEditor.js'

interface ChatTabsProps {
  readonly tabs: ChatTabsController
}

/**
 * The conversations of this workspace, and which one is showing.
 *
 * Underlined rather than boxed, unlike the right pane's tabs. Those switch
 * between three different kinds of thing, so each wants an edge of its own;
 * these are three of one kind, told apart by a number and a dot, and a row of
 * boxes around "Claude 1" would weigh more than what it labels.
 *
 * `aria-current` rather than a `tablist`, which is what every other switch in
 * this window uses — a reader who has learned the project strip and the right
 * pane should not meet a third convention here.
 */
export function ChatTabs({ tabs }: ChatTabsProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <nav aria-label={t('chat.tabs')} className="flex shrink-0 items-center">
      {tabs.tabs.map((tab, index) => (
        <TabButton
          key={tab.key}
          tab={tab}
          number={index + 1}
          active={tab.key === tabs.activeKey}
          // The last conversation cannot be closed — a workspace with none has
          // no way back to one but the first message, and emptying the only one
          // is what `/clear` is for.
          closable={tabs.tabs.length > 1}
          controller={tabs}
        />
      ))}

      {tabs.canCreate && (
        <button
          type="button"
          onClick={() => void tabs.create()}
          title={t('chat.newTab')}
          aria-label={t('chat.newTab')}
          className="text-ink-faint hover:text-ink focus-ring ml-1 flex size-6 items-center justify-center rounded-[var(--radius-control)] transition-colors"
        >
          <Plus aria-hidden size={13} />
        </button>
      )}
    </nav>
  )
}

interface TabButtonProps {
  readonly tab: ChatTab
  readonly number: number
  readonly active: boolean
  readonly closable: boolean
  readonly controller: ChatTabsController
}

function TabButton({
  tab,
  number,
  active,
  closable,
  controller
}: TabButtonProps): React.JSX.Element {
  const { t } = useTranslation()

  // The agent's own name rather than a word for "conversation": what a tab
  // holds is a Claude, and the strip is where that stops being a guess once
  // there is more than one kind. Not localised — a proper noun (`AGENT_NAMES`).
  // The name it was given wins over the one it is given. The automatic one is
  // not written into the record, so closing the tab beside it renumbers this
  // one rather than leaving it called after a place it no longer holds.
  const named = tab.title ?? t('chat.tab', { agent: AGENT_NAMES[tab.agent], number })
  // Composed through a key rather than by joining two translated strings: what
  // separates a name from its state is a matter for the language.
  const described = t('chat.tabStatus', { name: named, state: t(chatStatusLabel(tab.status)) })

  // Read into a constant so the closures below carry a string rather than a
  // nullable field they would each have to answer for.
  const id = tab.id

  const actions =
    id === null
      ? []
      : [
          {
            id: 'rename',
            label: t('chat.renameTab'),
            icon: <Pencil aria-hidden size={13} />,
            onSelect: () => {
              controller.setEditingKey(tab.key)
            }
          },
          // Absent rather than disabled while there is nothing to continue: a
          // menu item that never works is a promise the interface does not keep.
          ...(tab.started
            ? [
                {
                  id: 'fork',
                  label: t('chat.forkTab'),
                  description: t('chat.forkTabHint'),
                  icon: <GitBranchPlus aria-hidden size={13} />,
                  onSelect: () => void controller.fork(id)
                }
              ]
            : []),
          ...(closable
            ? [
                {
                  id: 'close',
                  label: t('chat.closeTab'),
                  icon: <Trash2 aria-hidden size={13} />,
                  destructive: true,
                  onSelect: () => void controller.close(id)
                }
              ]
            : [])
        ]

  if (id !== null && controller.editingKey === tab.key) {
    return (
      <span className="flex h-9 items-center px-1.5">
        <NameEditor
          // Its own name where there is one, and the automatic one otherwise:
          // the field opens on what the tab says, which is what makes a small
          // correction a small edit rather than a retype.
          initial={named}
          onCommit={(title) => void controller.rename(id, title)}
          // Emptying it is a request rather than a slip — the conversation goes
          // back to being named after its agent and its place.
          onClear={() => void controller.rename(id, '')}
          onCancel={() => {
            controller.setEditingKey(null)
          }}
          className="input focus-ring h-6 w-32 text-[12px]"
        />
      </span>
    )
  }

  return (
    <span className="group relative flex items-center">
      <button
        type="button"
        onClick={() => {
          controller.select(tab.key)
        }}
        // The same way a workspace is renamed one pane to the left, so the
        // gesture is learned once.
        onDoubleClick={() => {
          if (id !== null) controller.setEditingKey(tab.key)
        }}
        aria-current={active ? 'page' : undefined}
        title={described}
        className={`focus-ring flex h-9 items-center gap-1.5 px-2.5 text-[12px] transition-colors ${
          active
            ? 'text-ink after:bg-[var(--project-color)] after:absolute after:inset-x-1.5 after:bottom-0 after:h-px after:content-[""]'
            : 'text-ink-faint hover:text-ink-soft'
        }`}
      >
        {/* Always drawn, quiet state included: a dot that appeared only once a
            turn started would shift the whole strip sideways the moment the
            agent began working. */}
        <span
          aria-hidden
          className={`size-1.5 shrink-0 rounded-full ${chatStatusTone(tab.status)}`}
        />
        <span aria-hidden>{named}</span>
        {/* The visible label is a name, and the dot beside it says nothing
            aloud at all. The button's whole meaning is in here. */}
        <span className="sr-only">{described}</span>
      </button>

      {actions.length > 0 && (
        <DropdownMenu
          align="left"
          actions={actions}
          trigger={({ onClick, open }) => (
            <button
              type="button"
              onClick={onClick}
              title={named}
              aria-label={named}
              // Held in the layout rather than added on hover, so the strip
              // does not jump under the pointer as it crosses a tab.
              className={`text-ink-faint hover:text-ink focus-ring -ml-1 flex size-5 items-center justify-center rounded transition-opacity ${
                open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
              }`}
            >
              <MoreHorizontal aria-hidden size={12} />
            </button>
          )}
        />
      )}
    </span>
  )
}
