import { useEffect, useState } from 'react'

import type { DiffLine, WorkspaceDiff } from '@core/diff.js'

import { highlight, type Token } from './highlight.js'
import { languageFor } from './language.js'
import { assignTokens, sideTexts } from './sides.js'

export type Highlighting = ReadonlyMap<DiffLine, readonly Token[]>

const NOTHING: Highlighting = new Map()

/**
 * Syntax colours for every line of a diff, as they arrive.
 *
 * Asynchronous and additive on purpose: the diff is drawn plain the moment it
 * is read, and the colours land a little after. Nothing waits for a grammar to
 * load, and a highlighter that never starts costs the reader nothing but the
 * colours.
 *
 * Files are done one at a time with an await between them, so a forty-file
 * change never holds a frame. The core has already bounded how much can arrive
 * here, so there is no second budget to keep.
 */
export function useHighlighting(diff: WorkspaceDiff | null): Highlighting {
  const [tokens, setTokens] = useState<Highlighting>(NOTHING)

  useEffect(() => {
    if (!diff) return

    // An `AbortController` rather than a boolean, the way `useWorkspaces` and
    // `useSessionUsage` already guard their reads: a flag assigned only in the
    // cleanup reads as a constant to the type checker inside the loop.
    const controller = new AbortController()
    const collected = new Map<DiffLine, readonly Token[]>()

    void (async () => {
      for (const file of diff.files) {
        const language = languageFor(file.path)
        if (language === null || file.hunks.length === 0) continue

        const { old, current } = sideTexts(file.hunks)
        const [oldTokens, currentTokens] = await Promise.all([
          old === '' ? Promise.resolve(null) : highlight(language, old),
          current === '' ? Promise.resolve(null) : highlight(language, current)
        ])

        // Checked after the wait rather than before it: that is the only place
        // the diff can have been replaced while this was running.
        if (controller.signal.aborted) return

        for (const [line, lineTokens] of assignTokens(file.hunks, oldTokens, currentTokens)) {
          collected.set(line, lineTokens)
        }

        // A fresh map each time: React compares by identity, and mutating the
        // one already on screen would colour nothing until the next file.
        setTokens(new Map(collected))
      }
    })()

    return () => {
      controller.abort()
    }
  }, [diff])

  return tokens
}
