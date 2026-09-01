import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isSkillName } from '@core/skillNames.js'
import type { SkillDocument, SkillSave } from '@core/skills.js'

import { Button } from '../Button.js'
import { Field } from '../Field.js'
import { Modal } from '../Modal.js'

interface SkillEditorProps {
  /** The skill being edited, or null for one being written from nothing. */
  readonly skill: SkillDocument | null
  /** Names already taken in this store, so a new one can be refused early. */
  readonly taken: readonly string[]
  readonly onSave: (name: string, save: SkillSave) => Promise<boolean>
  readonly onClose: () => void
}

/** What a skill starts as, so the writer edits something rather than nothing. */
const TEMPLATE = `# What this skill does

Steps, conventions, or whatever the agent needs once it has picked this up.
`

/**
 * A skill, edited as two fields and a body — or as the document itself.
 *
 * The form is the way in because the frontmatter is a format rather than a
 * decision: a name and a sentence about when to reach for the skill is what
 * anybody writing one is actually choosing, and the YAML around it is a detail
 * that only has to be right.
 *
 * The raw mode is not an escape hatch bolted on: `allowed-tools`, `when_to_use`
 * and a skill's own conventions live in that frontmatter, and a form that
 * silently dropped them would be worse than no form. The save keeps every key
 * it does not know about, so the two halves can be used in turn.
 *
 * The name is fixed once created. It is the directory the skill lives in and
 * the key every stored answer uses — the default lists, each conversation's
 * overrides — so renaming is a migration rather than an edit.
 */
export function SkillEditor({
  skill,
  taken,
  onSave,
  onClose
}: SkillEditorProps): React.JSX.Element {
  const { t } = useTranslation()

  const [name, setName] = useState(skill?.name ?? '')
  const [description, setDescription] = useState(skill?.description ?? '')
  const [body, setBody] = useState(skill?.body ?? TEMPLATE)
  const [raw, setRaw] = useState(skill?.raw ?? '')
  const [showRaw, setShowRaw] = useState(false)
  const [saving, setSaving] = useState(false)

  const creating = skill === null
  const nameProblem = ((): string | null => {
    if (!creating) return null
    if (name === '') return null
    if (!isSkillName(name)) return t('skills.nameInvalid')

    return taken.includes(name) ? t('skills.nameTaken') : null
  })()

  const ready = name !== '' && nameProblem === null && !saving

  const submit = async (): Promise<void> => {
    setSaving(true)
    const written = await onSave(
      name,
      showRaw ? { kind: 'raw', text: raw } : { kind: 'form', content: { description, body } }
    )
    setSaving(false)
    if (written) onClose()
  }

  return (
    <Modal
      size="md"
      title={creating ? t('skills.editorNew') : t('skills.editorEdit', { name: skill.name })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('skills.cancel')}</Button>
          <Button
            variant="accent"
            disabled={!ready}
            onClick={() => {
              void submit()
            }}
          >
            {t('skills.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-4 text-[13px]">
        {showRaw ? (
          <Field label={t('skills.body')} hint={t('skills.rawHint')}>
            <textarea
              // `Field` draws its label as a paragraph rather than a `label`
              // element — it is shared with rows that hold a grid of swatches,
              // which no single control could be labelled by. So each control
              // here names itself, which is also the only handle a test has.
              aria-label={t('skills.body')}
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value)
              }}
              spellCheck={false}
              className="input h-80 w-full resize-none font-mono text-[11px]"
            />
          </Field>
        ) : (
          <>
            <Field label={t('skills.name')} hint={t('skills.nameHint')}>
              <input
                aria-label={t('skills.name')}
                value={name}
                disabled={!creating}
                onChange={(event) => {
                  setName(event.target.value)
                }}
                spellCheck={false}
                className="input w-full max-w-sm"
              />
              {nameProblem !== null && (
                <p className="text-danger mt-1.5 text-[11px]">{nameProblem}</p>
              )}
            </Field>

            <Field label={t('skills.description')} hint={t('skills.descriptionHint')}>
              <input
                aria-label={t('skills.description')}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value)
                }}
                className="input w-full"
              />
            </Field>

            <Field label={t('skills.body')} hint={t('skills.bodyHint')}>
              <textarea
                aria-label={t('skills.body')}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value)
                }}
                spellCheck={false}
                className="input h-56 w-full resize-none font-mono text-[11px]"
              />
            </Field>
          </>
        )}

        {/* Only for a skill that has a document to show. A new one has no
            frontmatter yet — the save composes it — so there is nothing to
            edit raw until it exists. */}
        {!creating && (
          <button
            type="button"
            onClick={() => {
              setShowRaw(!showRaw)
            }}
            className="focus-ring text-ink-faint hover:text-ink rounded-[var(--radius-control)] text-[11px]"
          >
            {showRaw ? t('skills.hideRaw') : t('skills.showRaw')}
          </button>
        )}
      </div>
    </Modal>
  )
}
