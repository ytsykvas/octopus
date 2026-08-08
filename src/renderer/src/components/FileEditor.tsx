import { useEffect, useState } from 'react'

import { Field } from './Field.js'

interface FileEditorProps {
  readonly label: string
  readonly hint: string
  readonly placeholder?: string
  readonly rows?: number
  /** Loads the current contents; a file that does not exist yields a template. */
  readonly read: () => Promise<string | null>
  readonly save: (contents: string) => void
}

/**
 * A project file edited in place — a script, an instruction.
 *
 * Saves on blur like every other field in this dialog. The two kinds differ
 * only in where the text comes from and where it goes, which is what the two
 * callbacks are for.
 */
export function FileEditor({
  label,
  hint,
  placeholder,
  rows = 16,
  read,
  save
}: FileEditorProps): React.JSX.Element {
  const [body, setBody] = useState('')
  const [saved, setSaved] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const contents = await read()
      if (controller.signal.aborted || contents === null) return

      setBody(contents)
      setSaved(contents)
    })()

    return () => {
      controller.abort()
    }
    // `read` is rebuilt on every render by its caller; re-running on it would
    // reload the file while it is being typed into.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label])

  const commit = (): void => {
    // Writing an unchanged body would create the file, and a file that exists
    // is one the app treats as configured — an untouched template must not
    // count as one.
    if (body === saved) return

    setSaved(body)
    save(body)
  }

  return (
    <Field label={label} hint={hint}>
      <textarea
        value={body}
        spellCheck={false}
        rows={rows}
        onChange={(event) => {
          setBody(event.target.value)
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="focus-ring border-line bg-canvas w-full resize-y rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] leading-relaxed"
      />
    </Field>
  )
}
