import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { movedTo } from '@core/lists.js'
import { firstLine, type Prompt } from '@core/promptSchema.js'
import type { Store } from '@core/stores.js'

import { useConfirm } from '../../hooks/useConfirm.js'
import { usePromptStore } from '../../hooks/usePromptStore.js'
import { Button } from '../Button.js'
import { PromptEditor } from './PromptEditor.js'

interface PromptsSectionProps {
  readonly store: Store
}

/**
 * The saved prompts of one store.
 *
 * Shared by both settings dialogs, as `LibrarySection` is: the same list twice
 * over, with only the reach differing, and that is what the store says.
 *
 * **The order is the priority.** The fan in the composer shows as many prompts
 * as fit, from the top of this list, so dragging one up is how it is made
 * easier to reach — which is why a row can be dragged, and why the same move is
 * on the keyboard (Alt and an arrow, on the handle): an order that only a
 * pointer can change is one that only some people get to have.
 */
export function PromptsSection({ store }: PromptsSectionProps): React.JSX.Element {
  const { t } = useTranslation()
  const prompts = usePromptStore(store)
  const { confirm, dialog } = useConfirm()

  const [editing, setEditing] = useState<Prompt | null>(null)
  const [creating, setCreating] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const ids = prompts.prompts.map((prompt) => prompt.id)
  const indexOf = (id: string | null): number => ids.indexOf(id ?? '')

  const requestRemove = async (prompt: Prompt): Promise<void> => {
    const { confirmed } = await confirm({
      title: t('prompts.removeTitle', { title: prompt.title }),
      message: t('prompts.removeMessage'),
      confirmLabel: t('prompts.removeConfirm'),
      cancelLabel: t('prompts.removeCancel'),
      destructive: true
    })

    if (confirmed) await prompts.remove(prompt.id)
  }

  // Dropped on a row, the dragged prompt takes that row's place, so moving down
  // lands below it and moving up lands above it — as the tab strip does.
  const drop = (targetId: string): void => {
    const from = indexOf(draggingId)
    const to = indexOf(targetId)
    if (from !== -1 && from !== to) void prompts.reorder(movedTo(ids, from, to))

    setDraggingId(null)
    setOverId(null)
  }

  const moveBy = (index: number, step: -1 | 1): void => {
    if (index + step < 0 || index + step >= ids.length) return
    void prompts.reorder(movedTo(ids, index, index + step))
  }

  const dialogOpen = creating || editing !== null

  return (
    <div className="text-[13px]">
      <div className="mb-1.5 flex items-start justify-between gap-3">
        <p className="text-ink-faint max-w-lg leading-relaxed">{t('prompts.intro')}</p>
        <Button
          variant="accent"
          onClick={() => {
            setCreating(true)
          }}
        >
          <Plus aria-hidden size={12} />
          {t('prompts.add')}
        </Button>
      </div>
      {store.kind === 'global' && (
        <p className="text-ink-faint mb-1.5 max-w-lg leading-relaxed">{t('prompts.globalNote')}</p>
      )}
      <p className="text-ink-faint mb-3 max-w-lg leading-relaxed">{t('prompts.orderHint')}</p>

      {/* Not while the editor is open: it draws the message itself, because a
          modal covers this line and a refusal shown behind one is a refusal
          nobody reads. */}
      {prompts.error !== null && !dialogOpen && <p className="text-danger mb-3">{prompts.error}</p>}

      {prompts.prompts.length === 0 ? (
        <p className="text-ink-faint">{t('prompts.empty')}</p>
      ) : (
        <ul className="border-line divide-line divide-y rounded-[var(--radius-panel)] border">
          {prompts.prompts.map((prompt, index) => {
            const dropEdge =
              prompt.id === overId && prompt.id !== draggingId
                ? index > indexOf(draggingId)
                  ? 'below'
                  : 'above'
                : null

            return (
              <li
                key={prompt.id}
                aria-label={prompt.title}
                draggable
                onDragStart={() => {
                  setDraggingId(prompt.id)
                }}
                onDragOver={(event) => {
                  // Without this the browser refuses the drop.
                  event.preventDefault()
                  setOverId(prompt.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  drop(prompt.id)
                }}
                onDragEnd={() => {
                  setDraggingId(null)
                  setOverId(null)
                }}
                className={`relative flex items-center gap-2 px-3 py-2 ${
                  prompt.id === draggingId ? 'opacity-40' : ''
                }`}
              >
                <button
                  type="button"
                  aria-label={t('prompts.reorderHandle', { title: prompt.title })}
                  onKeyDown={(event) => {
                    if (!event.altKey) return
                    if (event.key === 'ArrowUp') moveBy(index, -1)
                    else if (event.key === 'ArrowDown') moveBy(index, 1)
                    else return

                    event.preventDefault()
                  }}
                  className="focus-ring text-ink-faint hover:text-ink -ml-1 cursor-grab rounded-[var(--radius-control)] p-0.5"
                >
                  <GripVertical aria-hidden size={14} />
                </button>

                <span className="min-w-0 flex-1">
                  <span className="text-ink block truncate font-medium">{prompt.title}</span>
                  <span className="text-ink-faint block truncate text-[11px]">
                    {firstLine(prompt.text)}
                  </span>
                </span>

                {prompt.forPlan && (
                  <span className="border-line text-accent rounded-full border px-1.5 text-[10px]">
                    {t('prompts.planBadge')}
                  </span>
                )}

                <Button
                  size="sm"
                  aria-label={t('prompts.edit', { title: prompt.title })}
                  onClick={() => {
                    setEditing(prompt)
                  }}
                >
                  <Pencil aria-hidden size={12} />
                </Button>
                <Button
                  size="sm"
                  aria-label={t('prompts.remove', { title: prompt.title })}
                  onClick={() => {
                    void requestRemove(prompt)
                  }}
                >
                  <Trash2 aria-hidden size={12} />
                </Button>

                {dropEdge !== null && (
                  <span
                    data-testid="drop-line"
                    aria-hidden
                    className={`bg-accent pointer-events-none absolute right-0 left-0 h-0.5 rounded-full ${
                      dropEdge === 'above' ? '-top-[3px]' : '-bottom-[3px]'
                    }`}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {dialogOpen && (
        <PromptEditor
          prompt={editing}
          error={prompts.error}
          onSave={(draft) =>
            editing === null ? prompts.create(draft) : prompts.update(editing.id, draft)
          }
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}

      {dialog}
    </div>
  )
}
