import { useEffect, useState } from 'react'

import type { MentionFile } from '@core/fileSearch.js'

/** Long enough that a burst of keystrokes is one search, short enough to feel live. */
const DEBOUNCE_MS = 80

/**
 * The files matching what is typed after an `@`.
 *
 * The last answer stays up while the next is on its way. Handed back only for
 * the query it answered, the list went away on every keystroke for the debounce
 * and the round trip — and the Enter pressed in that gap found no list to take
 * and sent the message with `@aut` in it. A list that is a moment behind is the
 * lesser fault: it narrows as soon as the answer lands.
 *
 * What is stored with each answer is the query it was for, so that one arriving
 * late is dropped when a newer one is already in: the slow answer for `a` must
 * not take the place of the quick one for `ab`.
 */
export function useFileMentions(
  query: string | null,
  search: (query: string) => Promise<readonly MentionFile[]>
): readonly MentionFile[] {
  const [answer, setAnswer] = useState<readonly MentionFile[]>([])

  useEffect(() => {
    if (query === null) return

    let stale = false
    const timer = setTimeout(() => {
      void search(query).then((files) => {
        if (!stale) setAnswer(files)
      })
    }, DEBOUNCE_MS)

    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, search])

  // Nothing while there is no mention, whatever the last answer was: a list
  // offered outside one would be a list for a token that is no longer there.
  return query === null ? [] : answer
}
