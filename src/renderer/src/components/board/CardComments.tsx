import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CardComment } from '@core/boardSchema.js'

import { Markdown } from '../chat/Markdown.js'
import { NoteEditor } from '../NoteEditor.js'

export function CardComments({
  thread,
  onAdd
}: {
  readonly thread: readonly CardComment[]
  readonly onAdd: (text: string) => Promise<boolean>
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const headingId = useId()
  const [writing, setWriting] = useState(false)
  const [adding, setAdding] = useState(false)
  const format = (at: string): string =>
    new Date(at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  // NoteEditor has no pending state of its own; without this a second ⌘Enter posted the comment twice.
  const add = async (text: string): Promise<void> => {
    setAdding(true)
    const added = await onAdd(text)
    setAdding(false)
    if (added) setWriting(false)
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="section-label">
        {t('board.comments.title')}
      </h3>
      {thread.length === 0 ? (
        <p className="text-ink-soft">{t('board.comments.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {thread.map((comment, index) => (
            <li key={index} className="flex flex-col gap-0.5">
              <time dateTime={comment.at} className="text-ink-faint text-[11px]">
                {format(comment.at)}
              </time>
              <Markdown text={comment.text} />
            </li>
          ))}
        </ol>
      )}
      {writing ? (
        <NoteEditor
          initial=""
          placeholder={t('board.comments.placeholder')}
          className=""
          onSave={(text) => {
            if (!adding) void add(text)
          }}
          onCancel={() => {
            setWriting(false)
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setWriting(true)
          }}
          className="input focus-ring text-ink-faint text-left"
        >
          {t('board.comments.add')}
        </button>
      )}
    </section>
  )
}
