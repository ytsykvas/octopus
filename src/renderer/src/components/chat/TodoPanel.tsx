import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Todo } from '@core/todos.js'

import { DisclosureButton } from '../Disclosure.js'
import { TodoChecklist } from './TodoChecklist.js'

interface TodoPanelProps {
  readonly todos: readonly Todo[]
}

/**
 * The agent's own task list, pinned above the field.
 *
 * A long turn is mostly the agent working through a list it wrote for itself,
 * and from the log that progress is a scatter of tool rows. This is the same
 * list as one line — how far it has got and what it is doing now — which can
 * be opened to read the rest.
 *
 * Shown while there is something left. A finished list pinned above the field
 * would be a standing report on work already in the log, taking the line the
 * next message needs.
 */
export function TodoPanel({ todos }: TodoPanelProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const done = todos.filter((todo) => todo.status === 'completed').length
  if (todos.length === 0 || done === todos.length) return null

  const current = todos.find((todo) => todo.status === 'in_progress')
  // The progressive form is how the agent says what it is doing; the plain one
  // is how it said what to do. Either reads as a label, and the second is the
  // fallback for a list written without it.
  const now = current === undefined ? null : current.activeForm || current.content

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pb-2">
      <div className="border-line bg-surface rounded-[var(--radius-control)] border">
        <DisclosureButton
          open={open}
          onOpenChange={setOpen}
          className="focus-ring flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-1.5 text-left"
        >
          <span className="text-ink-soft shrink-0 font-medium">{t('chat.todos')}</span>
          <span className="text-ink-faint shrink-0 tabular-nums">
            {t('chat.todosProgress', { done, total: todos.length })}
          </span>
          {now !== null && <span className="text-ink-soft min-w-0 flex-1 truncate">{now}</span>}
        </DisclosureButton>

        {open && (
          <div className="border-line border-t px-2.5 py-1.5">
            <TodoChecklist todos={todos} />
          </div>
        )}
      </div>
    </div>
  )
}
