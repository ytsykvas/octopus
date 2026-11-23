import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CARD_TEXT_MAX, type DescriptionSave } from '@core/boardSchema.js'
import { withoutTitle } from '@core/boardText.js'

import type { Failure } from '../../../../preload/index.js'
import { useLatest } from '../../hooks/useLatest.js'
import { Button } from '../Button.js'
import { Markdown } from '../chat/Markdown.js'
import { Callout } from '../pr/Callout.js'
import { Segmented } from '../Segmented.js'
import type { DescriptionDraft } from './boardDrafts.js'

interface Editing extends DescriptionDraft {
  readonly mode: 'edit' | 'preview'
}

export function CardDescription({
  description,
  draft,
  onDraft,
  onSave
}: {
  readonly description: string
  readonly draft: DescriptionDraft | null
  /** Called once, on the way out, with the edit as it stands — null when nothing is being edited. */
  readonly onDraft: (draft: DescriptionDraft | null) => void
  readonly onSave: (save: DescriptionSave) => Promise<Failure | null>
}): React.JSX.Element {
  const { t } = useTranslation()
  const headingId = useId()
  const [editing, setEditing] = useState<Editing | null>(
    draft === null ? null : { ...draft, mode: 'edit' }
  )
  const [conflict, setConflict] = useState(false)
  const [saving, setSaving] = useState(false)
  // Handed up once, on the way out, as the composer does: a setState in App on every key would
  // redraw the window behind the field. Refs written in a handler, read in a cleanup.
  const latest = useRef(editing)
  const leave = useLatest(onDraft)
  useEffect(
    () => () => {
      const edit = latest.current
      leave.current(edit === null ? null : { text: edit.text, base: edit.base })
    },
    [leave]
  )

  const edit = (next: Editing | null): void => {
    latest.current = next
    setEditing(next)
  }
  const close = (): void => {
    edit(null)
    setConflict(false)
  }
  const save = async (current: Editing, base: string | null): Promise<void> => {
    setSaving(true)
    const failure = await onSave({ text: current.text, base })
    setSaving(false)
    if (failure === null) close()
    else if (failure.code === 'cardChanged') setConflict(true)
  }
  const body = (text: string): React.JSX.Element => {
    const shown = withoutTitle(text).trim()
    return shown === '' ? (
      <p className="text-ink-soft">{t('board.panel.noDescription')}</p>
    ) : (
      <Markdown text={shown} />
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 id={headingId} className="section-label">
          {t('board.panel.description')}
        </h3>
        {editing === null && (
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => {
              edit({ text: description, base: description, mode: 'edit' })
              setConflict(false)
            }}
          >
            {t('board.panel.edit')}
          </Button>
        )}
      </div>
      {editing === null ? (
        body(description)
      ) : (
        <>
          <Segmented
            label={t('board.panel.description')}
            size="sm"
            value={editing.mode}
            options={[
              { value: 'edit', label: t('board.panel.edit') },
              { value: 'preview', label: t('board.panel.preview') }
            ]}
            onChange={(mode) => {
              edit({ ...editing, mode })
            }}
          />
          {editing.mode === 'edit' ? (
            <textarea
              autoFocus
              aria-label={t('board.panel.description')}
              value={editing.text}
              maxLength={CARD_TEXT_MAX}
              spellCheck={false}
              onChange={(event) => {
                edit({ ...editing, text: event.target.value })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                }
                if (
                  event.key === 'Enter' &&
                  (event.metaKey || event.ctrlKey) &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault()
                  if (!saving) void save(editing, editing.base)
                }
              }}
              className="input focus-ring h-auto min-h-[240px] resize-y py-1.5 font-mono text-[12px] leading-relaxed"
            />
          ) : (
            <div className="border-line min-h-[240px] rounded-[var(--radius-control)] border px-2.5 py-2">
              {body(editing.text)}
            </div>
          )}
          {conflict && (
            <>
              <Callout tone="warning">{t('board.panel.changed')}</Callout>
              <div className="flex gap-2">
                <Button size="sm" onClick={close}>
                  {t('board.panel.reload')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={saving}
                  onClick={() => void save(editing, null)}
                >
                  {t('board.panel.overwrite')}
                </Button>
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={close}>
              {t('board.panel.cancel')}
            </Button>
            <Button
              size="sm"
              variant="accent"
              disabled={saving}
              onClick={() => void save(editing, editing.base)}
            >
              {t('board.panel.save')}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
