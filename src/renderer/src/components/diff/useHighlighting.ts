import { useEffect, useRef, useState } from 'react'

import type { DiffLine, FileSides, WorkspaceDiff } from '@core/diff.js'

import { highlight, type Token } from './highlight.js'
import { languageFor } from './language.js'
import { assignTokens, assignWholeTokens, sideTexts } from './sides.js'

export type Highlighting = ReadonlyMap<DiffLine, readonly Token[]>

/**
 * The colours of every file, each file's under its own path.
 *
 * Nested rather than one map of every line, so a file's colours have an
 * identity of their own. They arrive one file at a time, and a single map meant
 * every arrival handed all forty files a value they had to treat as new — which
 * is a redraw of the whole pane per file coloured.
 */
export type HighlightingByFile = ReadonlyMap<string, Highlighting>

/** What a file with no colours gets, shared so it stays the same object. */
export const NO_TOKENS: Highlighting = new Map()

const NOTHING: HighlightingByFile = new Map()

/**
 * Past this, a line is not code anyone is reading.
 *
 * A minified bundle or a bundled lockfile is a handful of enormous lines, and
 * the highlighter spends about a second on each of them whatever their length —
 * seconds of a frozen window, spent colouring something nobody will read. The
 * file still draws; it simply draws plain.
 */
export const MAX_LINE_LENGTH = 2_000

function drawableAsCode(
  hunks: readonly { readonly lines: readonly { readonly text: string }[] }[]
): boolean {
  return hunks.every((hunk) => hunk.lines.every((line) => line.text.length <= MAX_LINE_LENGTH))
}

/**
 * Syntax colours for every open file of a diff, as they arrive.
 *
 * Asynchronous and additive on purpose: the diff is drawn plain the moment it
 * is read, and the colours land a little after. Nothing waits for a grammar to
 * load, and a highlighter that never starts costs the reader nothing but the
 * colours.
 *
 * Files are done one at a time with an await between them, so a forty-file
 * change never holds a frame. The core has already bounded how much can arrive
 * here, so there is no second budget to keep.
 *
 * Only the files that are open: every file starts folded, and colouring both
 * whole sides of each — a one-line edit in a 3 000-line file is 6 000 lines
 * tokenised — spent the main thread on lines nobody could see, on every read
 * of the diff, which is every turn's end. A file is coloured when it is
 * opened, and keeps its colours while the diff stands.
 */
export function useHighlighting(
  diff: WorkspaceDiff | null,
  /**
   * Each file's two sides whole, where they could be had.
   *
   * A construct opened in the lines *between* two hunks is invisible to a
   * highlighter reading the hunks joined end to end, so the hunk after it comes
   * out coloured as though the construct were not open — most likely in exactly
   * the files worth reading closely, where a hunk sits in the middle of a long
   * function. A file missing from here is coloured the old way.
   *
   * Must keep its identity between reads, and does: it is state in
   * `useWorkspaceDiff`, set once beside the diff from the same answer. A caller
   * passing a fresh object each render would re-colour every file on every
   * render, which is the redraw the map above exists to avoid.
   */
  sides: Readonly<Record<string, FileSides>>,
  /** The paths whose rows are open, which are the ones worth colouring. */
  open: ReadonlySet<string>
): HighlightingByFile {
  const [tokens, setTokens] = useState<HighlightingByFile>(NOTHING)
  // What has been coloured for the diff on screen, kept across the runs below
  // — a file opened later is added, the ones already coloured are left alone —
  // and started afresh for another diff.
  const collectedFor = useRef<{ diff: WorkspaceDiff | null; files: Map<string, Highlighting> }>({
    diff: null,
    files: new Map()
  })

  useEffect(() => {
    if (!diff) return

    if (collectedFor.current.diff !== diff) {
      collectedFor.current = { diff, files: new Map() }
    }
    const collected = collectedFor.current.files

    // An `AbortController` rather than a boolean, the way `useWorkspaces` and
    // `useSessionUsage` already guard their reads: a flag assigned only in the
    // cleanup reads as a constant to the type checker inside the loop.
    const controller = new AbortController()

    void (async () => {
      for (const file of diff.files) {
        if (!open.has(file.path) || collected.has(file.path)) continue
        const language = languageFor(file.path)
        if (language === null || file.hunks.length === 0) continue
        if (!drawableAsCode(file.hunks)) continue

        const whole = sides[file.path]
        const { old, current } = whole ?? sideTexts(file.hunks)
        const [oldTokens, currentTokens] = await Promise.all([
          old === '' ? Promise.resolve(null) : highlight(language, old),
          current === '' ? Promise.resolve(null) : highlight(language, current)
        ])

        // Checked after the wait rather than before it: that is the only place
        // the diff can have been replaced while this was running.
        if (controller.signal.aborted) return

        // Two ways of lining tokens up with lines, because the two readings are
        // different documents: whole sides are indexed by the line's own
        // number, joined hunks by walking them in step with the join.
        collected.set(
          file.path,
          whole
            ? assignWholeTokens(file.hunks, oldTokens, currentTokens)
            : assignTokens(file.hunks, oldTokens, currentTokens)
        )

        // A fresh outer map each time: React compares by identity, and mutating
        // the one already on screen would colour nothing until the next file.
        // The inner maps are left alone, which is what lets the files that were
        // already coloured skip the redraw.
        setTokens(new Map(collected))
      }
    })()

    return () => {
      controller.abort()
    }
  }, [diff, sides, open])

  return tokens
}
