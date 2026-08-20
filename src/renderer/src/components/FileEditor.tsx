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
  /**
   * What is wrong with the text as it stands, shown under the box.
   *
   * Warnings, never a refusal to save: the file is read by somebody else's
   * parser, and ours cannot be the authority on what that one accepts.
   */
  readonly notes?: (contents: string) => readonly string[]
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
  save,
  notes
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

  // Recomputed as it is typed, which is what makes a warning worth anything:
  // told on blur, it arrives after the attention that could act on it.
  const problems = notes?.(body) ?? []

  return (
    <Field label={label} hint={hint}>
      <textarea
        value={body}
        spellCheck={false}
        rows={rows}
        /* `Field` draws the label as a paragraph, which names nothing to a
           screen reader. One editor to a section, that was merely thin; five
           instruction editors one after another are five unnamed boxes, and the
           only way to tell them apart is to see them. It is also the only handle
           a test has on the right one. */
        aria-label={label}
        onChange={(event) => {
          setBody(event.target.value)
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="focus-ring border-line bg-canvas w-full resize-y rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] leading-relaxed"
      />

      {problems.length > 0 && (
        <ul className="text-warning mt-1.5 space-y-0.5">
          {problems.map((problem, index) => (
            // By position: one line can carry the same complaint twice — a
            // variable misspelled the same way in two places — and identical
            // strings collide as keys.
            <li key={index}>{problem}</li>
          ))}
        </ul>
      )}
    </Field>
  )
}
