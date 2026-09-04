import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SkillImport as SkillImportRequest } from '@core/skills.js'

import { Button } from '../Button.js'
import { Field } from '../Field.js'
import { Modal } from '../Modal.js'

interface SkillImportProps {
  readonly onImport: (request: SkillImportRequest) => Promise<boolean>
  readonly onClose: () => void
}

type Route = 'path' | 'text' | 'url'

/**
 * A skill written elsewhere, brought in.
 *
 * Three routes because a skill arrives in three shapes, and the differences are
 * not cosmetic. A folder is what one with references or scripts looks like and
 * is copied whole. Text is what one copied out of a README or a chat looks
 * like. A link is the only one of the three the user does not already have on
 * their disk — so it is the narrowest: one document, https only, and nothing
 * beside it fetched.
 *
 * The name is never asked for. A skill names itself in its frontmatter, and a
 * second name here would be a way to file it under something the document does
 * not say.
 */
export function SkillImport({ onImport, onClose }: SkillImportProps): React.JSX.Element {
  const { t } = useTranslation()

  const [route, setRoute] = useState<Route>('path')
  const [path, setPath] = useState('')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const routes: readonly { readonly id: Route; readonly label: string }[] = [
    { id: 'path', label: t('skills.fromDisk') },
    { id: 'text', label: t('skills.fromText') },
    { id: 'url', label: t('skills.fromUrl') }
  ]

  /*
   * The request and whether it is ready are two questions, deliberately kept
   * apart. Folded into one nullable value, `submit` had to re-check for a null
   * the disabled button already ruled out — a line no test could ever reach.
   */
  const ready = route === 'path' ? path !== '' : route === 'text' ? text !== '' : url !== ''

  const request = (): SkillImportRequest => {
    if (route === 'path') return { kind: 'path', path }
    if (route === 'text') return { kind: 'text', text }

    return { kind: 'url', url }
  }

  const choose = async (): Promise<void> => {
    const picked = await window.octopus.dialog.pickSkill(t('skills.fromDisk'))
    if (picked.ok && picked.value !== null) setPath(picked.value)
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    const brought = await onImport(request())
    setBusy(false)
    if (brought) onClose()
  }

  return (
    <Modal
      size="md"
      title={t('skills.importTitle')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('skills.cancel')}</Button>
          <Button
            variant="accent"
            disabled={!ready || busy}
            onClick={() => {
              void submit()
            }}
          >
            {t('skills.importAction')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-4 text-[13px]">
        {/* A radio group rather than tabs: three answers to one question, one
            of them true at a time, and the panel underneath is what changes. */}
        <div role="radiogroup" aria-label={t('skills.importTitle')} className="flex gap-1">
          {routes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={route === item.id}
              onClick={() => {
                setRoute(item.id)
              }}
              className={`focus-ring h-7 rounded-[var(--radius-control)] px-3 text-[12px] transition-colors ${
                route === item.id
                  ? 'bg-accent/12 text-accent'
                  : 'text-ink-soft hover:bg-muted hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {route === 'path' && (
          <Field label={t('skills.fromDisk')} hint={t('skills.fromDiskNote')}>
            {(id) => (
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  value={path}
                  readOnly
                  className="input min-w-0 flex-1 font-mono text-[11px]"
                />
                <Button
                  onClick={() => {
                    void choose()
                  }}
                >
                  {t('skills.choose')}
                </Button>
              </div>
            )}
          </Field>
        )}

        {route === 'text' && (
          <Field label={t('skills.fromText')} hint={t('skills.fromTextNote')}>
            {(id) => (
              <textarea
                id={id}
                value={text}
                onChange={(event) => {
                  setText(event.target.value)
                }}
                spellCheck={false}
                className="input h-64 w-full resize-none font-mono text-[11px]"
              />
            )}
          </Field>
        )}

        {route === 'url' && (
          <Field label={t('skills.url')} hint={t('skills.fromUrlNote')}>
            {(id) => (
              <input
                id={id}
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value)
                }}
                spellCheck={false}
                placeholder="https://"
                className="input w-full font-mono text-[11px]"
              />
            )}
          </Field>
        )}
      </div>
    </Modal>
  )
}
