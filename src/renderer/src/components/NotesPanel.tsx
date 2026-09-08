import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NOTES_LIMIT } from '@core/notes.js'

import { useErrorMessage } from '../hooks/useErrorMessage.js'

/**
 * How long the typing has to stop before the note is written.
 *
 * `commit` rewrites `state.json` whole, so a write per keystroke would rewrite
 * the file per keystroke. Long enough that ordinary typing is one write per
 * pause, short enough that a note is safe almost as soon as somebody stops —
 * and the blur below settles it at once anyway.
 */
const SETTLE_MS = 600

interface NotesPanelProps {
  /** The workspace this note belongs to, or null when none is chosen. */
  readonly workspaceId: string | null
  /** What is stored, as the workspace list last reported it. */
  readonly notes: string
}

/**
 * A line the user writes to themselves about this workspace.
 *
 * A workspace is a task that runs for days, and what is worth keeping about one
 * is usually not code: what was half-done, what to check before opening the
 * request, the thing that would otherwise be worked out again tomorrow.
 *
 * **Nothing here reaches the agent.** Everything else a workspace carries is
 * something the agent reads or acts on; this is the one thing that is only for
 * the person. Saying so is the whole reason it is a tab of its own rather than
 * another box in a settings dialog.
 *
 * **It saves itself.** A note headed "so I do not forget" behind a Save button
 * somebody forgets to press is a note that was not written. So: a pause while
 * typing, and at once on leaving the field.
 *
 * The pane is **remounted per workspace** by its caller's `key`, which is what
 * makes a pending save safe. An editor that loads against one target and saves
 * a moment later writes the old text into the newly chosen destination — the
 * trap this repository already recorded once, in the env editor.
 */
export function NotesPanel({ workspaceId, notes }: NotesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const [text, setText] = useState(notes)
  const [error, setError] = useState<string | null>(null)

  /*
   * What is on disk, and the timer that will put it there.
   *
   * Refs rather than state: the flush on the way out runs from a cleanup, which
   * sees the values captured when the effect was set up — and by then they are
   * a keystroke or two out of date, which is exactly the text worth keeping.
   */
  const written = useRef(notes)
  const pending = useRef(text)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const save = useCallback(async () => {
    clearTimeout(timer.current)
    timer.current = undefined

    const body = pending.current
    // Nothing to say: writing an unchanged note would rewrite the whole state
    // file to store what it already holds.
    if (workspaceId === null || body === written.current) return

    written.current = body
    const done = await window.octopus.workspaces.setNotes(workspaceId, body)
    if (done.ok) setError(null)
    else {
      // Put back, so the next attempt tries again rather than believing this
      // text is already stored.
      written.current = notes
      setError(describeFailure(done))
    }
  }, [workspaceId, notes, describeFailure])

  /*
   * The last thing typed, on the way out.
   *
   * The pane is hidden rather than unmounted when another tab is chosen, so
   * this runs when the workspace changes or the window closes the pane — both
   * moments where a debounce still counting down would otherwise lose the last
   * few characters.
   */
  useEffect(
    () => () => {
      void save()
    },
    [save]
  )

  if (workspaceId === null) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <p className="text-ink-faint leading-relaxed">{t('notes.noWorkspace')}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error !== null && (
        <p className="text-danger border-line shrink-0 border-b px-3 py-1.5">{error}</p>
      )}

      <textarea
        value={text}
        aria-label={t('panel.notes')}
        placeholder={t('notes.placeholder')}
        spellCheck={false}
        /* The field refuses the character rather than the save refusing the
           message. Without it somebody types on into a note that will not be
           kept, and finds out from a red line after the fact — the boundary
           parse still refuses it, but a boundary is not a place to learn. */
        maxLength={NOTES_LIMIT}
        onChange={(event) => {
          setText(event.target.value)
          pending.current = event.target.value

          clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            void save()
          }, SETTLE_MS)
        }}
        // At once, rather than waiting out the pause: leaving the field is as
        // clear a "that is what I meant" as stopping typing.
        onBlur={() => {
          void save()
        }}
        className="focus-ring min-h-0 flex-1 resize-none bg-transparent p-3 leading-relaxed outline-none"
      />

      {/* Only near the end. A count standing over a scratchpad all day is noise
          about a limit almost nobody meets; one that appears as it approaches
          is the same rule the pane's other footnotes follow. */}
      {text.length > NOTES_LIMIT - 500 && (
        <p className="text-ink-faint border-line shrink-0 border-t px-3 py-1.5 text-[11px]">
          {t('notes.remaining', { count: NOTES_LIMIT - text.length })}
        </p>
      )}
    </div>
  )
}
