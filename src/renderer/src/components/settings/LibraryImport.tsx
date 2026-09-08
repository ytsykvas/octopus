import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LibraryImport as LibraryImportRequest, LibraryPreview } from '@core/library.js'
import { isLibraryName, type LibraryKind } from '@core/libraryNames.js'

import { Button } from '../Button.js'
import { Field } from '../Field.js'
import { Modal } from '../Modal.js'

interface LibraryImportProps {
  readonly kind: LibraryKind
  /** Names already taken here, so a collision is caught before the round trip. */
  readonly taken: readonly string[]
  readonly onImport: (name: string, text: string) => Promise<boolean>
  /** What the import would write, read before anything is written. */
  readonly onInspect: (request: LibraryImportRequest) => Promise<LibraryPreview | null>
  /**
   * The last refusal in words, from the store this writes into.
   *
   * Passed in rather than kept here because the modal covers the section's own
   * banner: a refusal shown behind it is one nobody reads.
   */
  readonly error: string | null
  readonly onClose: () => void
}

type Route = 'path' | 'text' | 'url'

/**
 * A command or subagent written elsewhere, brought in.
 *
 * The same three routes a skill has, minus the folder: both of these are a
 * single markdown file, so "from disk" picks a file rather than a directory.
 *
 * **The name is asked for, where a skill's import never asks.** A skill names
 * itself in its frontmatter and a second name here would file it under
 * something the document does not say. A command names itself nowhere — the
 * file it lives in is the whole of its name — so somebody has to choose, and
 * the read step exists to put the document on screen before they do. What the
 * source suggests is prefilled; a subagent suggests its own name, a file
 * suggests its own, and pasted text suggests nothing at all.
 */
export function LibraryImport({
  kind,
  taken,
  onImport,
  onInspect,
  error,
  onClose
}: LibraryImportProps): React.JSX.Element {
  const { t } = useTranslation()

  const [route, setRoute] = useState<Route>('path')
  const [path, setPath] = useState('')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  /*
   * What the import would write, read before it writes it — and what it would
   * be called, which is the answer this step is really for.
   */
  const [preview, setPreview] = useState<LibraryPreview | null>(null)

  const routes: readonly { readonly id: Route; readonly label: string }[] = [
    { id: 'path', label: t('library.fromDisk') },
    { id: 'text', label: t('library.fromText') },
    { id: 'url', label: t('library.fromUrl') }
  ]

  /*
   * The request and whether it is ready are two questions, deliberately kept
   * apart — the same split `SkillImport` records: folded into one nullable
   * value, the submit had to re-check for a null the disabled button had
   * already ruled out, which is a line no test could reach.
   */
  const ready = route === 'path' ? path !== '' : route === 'text' ? text !== '' : url !== ''

  const request = (): LibraryImportRequest => {
    if (route === 'path') return { kind: 'path', path }
    if (route === 'text') return { kind: 'text', text }

    return { kind: 'url', url }
  }

  const nameProblem = ((): string | null => {
    if (name === '') return null
    if (!isLibraryName(name)) return t('library.nameInvalid')

    return taken.includes(name) ? t('library.nameTaken') : null
  })()

  const choose = async (): Promise<void> => {
    const picked = await window.octopus.dialog.pickMarkdown(t('library.fromDisk'))
    if (picked.ok && picked.value !== null) setPath(picked.value)
  }

  /** Reads what would be written, and shows it rather than writing it. */
  const look = async (): Promise<void> => {
    setBusy(true)
    const seen = await onInspect(request())
    setPreview(seen)
    if (seen !== null) setName(seen.name)
    setBusy(false)
  }

  /*
   * Takes what was read rather than reaching for it, so there is no null to
   * re-check that the disabled button has already ruled out — the line no test
   * could reach, which `SkillImport` records having written once already.
   */
  const submit = async (read: LibraryPreview): Promise<void> => {
    setBusy(true)
    // The document that was read, not the source again: fetching an address a
    // second time could answer differently, and it is the first answer the
    // reader agreed to.
    const brought = await onImport(name, read.text)
    setBusy(false)
    if (brought) onClose()
  }

  const canWrite = preview !== null && name !== '' && nameProblem === null

  return (
    <Modal
      size="md"
      title={t(`library.importTitle.${kind}`)}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('library.cancel')}</Button>
          {/* Two steps, because neither what is being imported nor what it will
              be called is on screen until it has been read. */}
          <Button
            variant="accent"
            disabled={busy || (preview === null ? !ready : !canWrite)}
            onClick={() => {
              void (preview === null ? look() : submit(preview))
            }}
          >
            {preview === null ? t('library.inspectAction') : t('library.importAction')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-4 text-[13px]">
        {error !== null && <p className="text-danger">{error}</p>}

        {preview !== null && (
          <div className="border-line bg-muted/40 space-y-3 rounded-[var(--radius-panel)] border px-3 py-2.5">
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

            <p className="text-ink-soft leading-relaxed">
              {preview.description === '' ? t('library.noDescription') : preview.description}
            </p>
          </div>
        )}

        {/* A radio group rather than tabs: three answers to one question, one
            of them true at a time, and the panel underneath is what changes. */}
        <div role="radiogroup" aria-label={t(`library.importTitle.${kind}`)} className="flex gap-1">
          {routes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={route === item.id}
              onClick={() => {
                setRoute(item.id)
                // What was read was read about the other route.
                setPreview(null)
                setName('')
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
          <Field label={t('library.fromDisk')} hint={t('library.fromDiskNote')}>
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
                  {t('library.choose')}
                </Button>
              </div>
            )}
          </Field>
        )}

        {route === 'text' && (
          <Field label={t('library.fromText')} hint={t('library.fromTextNote')}>
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
          <Field label={t('library.url')} hint={t('library.fromUrlNote')}>
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
