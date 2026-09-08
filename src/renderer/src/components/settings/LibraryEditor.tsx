import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LibraryDocument } from '@core/library.js'
import { isLibraryName, type LibraryKind } from '@core/libraryNames.js'

import { Button } from '../Button.js'
import { Field } from '../Field.js'
import { Modal } from '../Modal.js'

interface LibraryEditorProps {
  readonly kind: LibraryKind
  /** The item being edited, or null for one being written from nothing. */
  readonly item: LibraryDocument | null
  /** Names already taken here, so a new one is refused before the round trip. */
  readonly taken: readonly string[]
  readonly onSave: (name: string, text: string) => Promise<boolean>
  readonly onClose: () => void
}

/**
 * What each kind starts as, so the writer edits something rather than nothing.
 *
 * A command has no frontmatter in the template because it needs none — the file
 * is the prompt, and inventing a YAML block for it would teach the writer a
 * shape Claude Code does not ask them for. A subagent's is required: it will
 * not be offered to the model without a description saying when to use it.
 */
const TEMPLATE: Readonly<Record<LibraryKind, string>> = {
  command: `Say what the agent should do when this is typed.

Arguments the user typed after the command arrive as $ARGUMENTS.
`,
  subagent: `---
name: helper
description: One sentence saying when the model should reach for this.
---

You are a helper. Say what it is for, and how it should work.
`
}

/**
 * A command or a subagent, edited as the document it is.
 *
 * One field rather than the form-and-raw pair a skill's editor offers, and that
 * is a decision rather than a corner cut. A command **is** its text; there is
 * nothing above the prompt to separate out. A subagent has fields — `tools`,
 * `model` — that a two-field form could only drop, and dropping the tools list
 * of a subagent somebody narrowed on purpose is the kind of quiet loss the
 * skill editor's raw half exists to prevent.
 *
 * The name is a field only while creating. Renaming afterwards is a menu action
 * on the row, the way it is for a skill — not because anything is keyed on it,
 * but because a name that can be changed in two places is a name with two
 * answers.
 */
export function LibraryEditor({
  kind,
  item,
  taken,
  onSave,
  onClose
}: LibraryEditorProps): React.JSX.Element {
  const { t } = useTranslation()

  const creating = item === null
  const [name, setName] = useState(item?.name ?? '')
  const [text, setText] = useState(item?.raw ?? TEMPLATE[kind])
  const [saving, setSaving] = useState(false)

  const nameProblem = ((): string | null => {
    if (!creating || name === '') return null
    if (!isLibraryName(name)) return t('library.nameInvalid')

    return taken.includes(name) ? t('library.nameTaken') : null
  })()

  const ready = name !== '' && text !== '' && nameProblem === null && !saving

  const submit = async (): Promise<void> => {
    setSaving(true)
    const written = await onSave(name, text)
    setSaving(false)
    if (written) onClose()
  }

  return (
    <Modal
      size="md"
      title={creating ? t(`library.new.${kind}`) : t('library.editing', { name: item.name })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('library.cancel')}</Button>
          <Button
            variant="accent"
            disabled={!ready}
            onClick={() => {
              void submit()
            }}
          >
            {t('library.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-4 text-[13px]">
        {creating && (
          <Field label={t('library.name')} hint={t(`library.nameHint.${kind}`)}>
            {(id) => (
              <>
                <input
                  id={id}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                  }}
                  spellCheck={false}
                  className="input w-full max-w-sm"
                />
                {nameProblem !== null && (
                  <p className="text-danger mt-1.5 text-[11px]">{nameProblem}</p>
                )}
              </>
            )}
          </Field>
        )}

        <Field label={t('library.document')} hint={t(`library.documentHint.${kind}`)}>
          {(id) => (
            <textarea
              id={id}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
              }}
              spellCheck={false}
              className="input h-80 w-full resize-none font-mono text-[11px]"
            />
          )}
        </Field>
      </div>
    </Modal>
  )
}
