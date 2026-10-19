import { Check, Circle, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Todo } from '@core/todos.js'

import { shown } from '../diff/shown.js'

/**
 * The agent's task list as a checklist: done, under way, still to do.
 *
 * Drawn under a `TodoWrite` row in the log, as Claude Code draws it, and inside
 * the pinned panel above the field — one list in both places, so the two never
 * disagree about what a mark means.
 */
export function TodoChecklist({ todos }: { readonly todos: readonly Todo[] }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ul className="flex flex-col">
      {todos.map((todo, index) => (
        // Position as the key: the list is rewritten whole on every call and
        // two items may legitimately read the same.
        <li
          key={`${String(index)}-${todo.content}`}
          className={`flex items-baseline gap-2 py-0.5 ${
            todo.status === 'completed' ? 'text-ink-faint' : 'text-ink-soft'
          }`}
        >
          <span className="shrink-0 self-center" title={t(`chat.todoStatus.${todo.status}`)}>
            <TodoMark status={todo.status} />
          </span>
          <span className="sr-only">{t(`chat.todoStatus.${todo.status}`)}</span>
          <span className={todo.status === 'completed' ? 'line-through' : ''}>
            {shown(todo.content)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function TodoMark({ status }: { readonly status: Todo['status'] }): React.JSX.Element {
  if (status === 'completed') return <Check aria-hidden size={12} className="text-success" />
  if (status === 'in_progress') {
    return (
      <LoaderCircle
        aria-hidden
        size={12}
        className="text-accent animate-spin motion-reduce:animate-none"
      />
    )
  }

  return <Circle aria-hidden size={12} />
}
