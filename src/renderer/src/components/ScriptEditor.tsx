import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ScriptKind } from '@core/scripts.js'

import { Field } from './Field.js'

interface ScriptEditorProps {
  readonly projectId: string
  readonly kind: ScriptKind
  readonly label: string
  readonly hint: string
}

/**
 * A project script, edited in place.
 *
 * Saves on blur like every other field in this dialog. The body is a shell
 * script rather than a command line: a build step grows conditionals soon
 * enough, and the file stays runnable outside the app either way.
 */
export function ScriptEditor({
  projectId,
  kind,
  label,
  hint
}: ScriptEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.projects.readScript(projectId, kind)
      if (controller.signal.aborted || !result.ok) return

      setBody(result.value)
      setSaved(result.value)
    })()

    return () => {
      controller.abort()
    }
  }, [projectId, kind])

  const commit = (): void => {
    // Writing an unchanged body would create the file — and a file that exists
    // is a script the tab offers to run, so an untouched template must not
    // count as one.
    if (body === saved) return

    setSaved(body)
    void window.octopus.projects.saveScript(projectId, kind, body)
  }

  return (
    <Field label={label} hint={hint}>
      <textarea
        value={body}
        spellCheck={false}
        rows={9}
        onChange={(event) => {
          setBody(event.target.value)
        }}
        onBlur={commit}
        placeholder={t('scripts.placeholder')}
        className="focus-ring border-line bg-canvas w-full resize-y rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] leading-relaxed"
      />
    </Field>
  )
}
