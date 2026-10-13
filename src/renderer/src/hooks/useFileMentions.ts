import { useEffect, useState } from 'react'

import type { MentionFile } from '@core/fileSearch.js'

/** Long enough that a burst of keystrokes is one search, short enough to feel live. */
const DEBOUNCE_MS = 80

/**
 * The files matching what is typed after an `@`.
 *
 * Each answer is stored with the query it was for, and handed back only while
 * that is still the query. A late answer for `co` therefore never shows under
 * `comp`, and nothing has to be cleared when the mention goes away — the old
 * answer simply stops matching.
 */
export function useFileMentions(
  query: string | null,
  search: (query: string) => Promise<readonly MentionFile[]>
): readonly MentionFile[] {
  const [answer, setAnswer] = useState<{
    readonly query: string
    readonly files: readonly MentionFile[]
  } | null>(null)

  useEffect(() => {
    if (query === null) return

    let stale = false
    const timer = setTimeout(() => {
      void search(query).then((files) => {
        if (!stale) setAnswer({ query, files })
      })
    }, DEBOUNCE_MS)

    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query, search])

  return answer !== null && answer.query === query ? answer.files : []
}
