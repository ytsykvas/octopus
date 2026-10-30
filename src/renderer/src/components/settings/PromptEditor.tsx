import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PROMPT_TEXT_MAX,
  PROMPT_TITLE_MAX,
  type Prompt,
  type PromptDraft
} from '@core/promptSchema.js'

import { Button } from '../Button.js'
import { Field } from '../Field.js'
import { Modal } from '../Modal.js'
import { Switch } from '../Switch.js'

interface PromptEditorProps {
  /** The prompt being edited, or null for one written from nothing. */
  readonly prompt: Prompt | null
  /** What the last write said, in words — drawn here, because this dialog covers the list. */
  readonly error: string | null
  readonly onSave: (draft: PromptDraft) => Promise<boolean>
  readonly onClose: () => void
}

/**
 * A saved prompt, edited as three things: what it is called, what it says, and
 * whether the plan dialog offers it too.
 *
 * The switch comes first, above the words, because it is the one choice that
 * changes where the prompt shows up at all. The title's limit is the pill's: a
 * longer one would be cut off in the fan, and a field that accepted it would
 * only be promising something the fan cannot keep.
 *
 * Whitespace-only counts as empty, as core counts it, so "Save" is never
 * offered for a draft the bridge would refuse.
 */
export function PromptEditor({
  prompt,
  error,
  onSave,
  onClose
}: PromptEditorProps): React.JSX.Element {
  const { t } = useTranslation()

  const [title, setTitle] = useState(prompt?.title ?? '')
  const [text, setText] = useState(prompt?.text ?? '')
  const [forPlan, setForPlan] = useState(prompt?.forPlan ?? false)
  const [saving, setSaving] = useState(false)

  const ready = title.trim() !== '' && text.trim() !== '' && !saving

  const submit = async (): Promise<void> => {
    setSaving(true)
    const written = await onSave({ title: title.trim(), text: text.trim(), forPlan })
    setSaving(false)
    if (written) onClose()
  }

  return (
    <Modal
      size="md"
      title={prompt === null ? t('prompts.editorNew') : t('prompts.editorEdit')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('prompts.cancel')}</Button>
          <Button
            variant="accent"
            disabled={!ready}
            onClick={() => {
              void submit()
            }}
          >
            {t('prompts.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-4 text-[13px]">
        <div className="flex items-start gap-3">
          <Switch checked={forPlan} onChange={setForPlan} label={t('prompts.forPlan')} />
          <div>
            <p className="font-medium">{t('prompts.forPlan')}</p>
            <p className="text-ink-faint mt-0.5 max-w-lg text-[11px] leading-relaxed">
              {t('prompts.forPlanHint')}
            </p>
          </div>
        </div>

        <Field label={t('prompts.title')} hint={t('prompts.titleHint')}>
          {(id) => (
            <input
              id={id}
              value={title}
              maxLength={PROMPT_TITLE_MAX}
              onChange={(event) => {
                setTitle(event.target.value)
              }}
              className="input w-full max-w-sm"
            />
          )}
        </Field>

        <Field label={t('prompts.text')}>
          {(id) => (
            <textarea
              id={id}
              value={text}
              maxLength={PROMPT_TEXT_MAX}
              onChange={(event) => {
                setText(event.target.value)
              }}
              className="input h-56 w-full resize-none"
            />
          )}
        </Field>

        {error !== null && <p className="text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
