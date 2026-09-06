import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiffLine } from '@core/diff.js'

import { fileDiff, hunk, workspaceDiff } from '../../test/diff.js'
import { highlight } from './highlight.js'
import { useHighlighting } from './useHighlighting.js'

vi.mock('./highlight.js', () => ({ highlight: vi.fn() }))

/** One token per line, carrying the text so a test can tell the sides apart. */
const rowsOf = (code: string): { text: string; light: string; dark: string }[][] =>
  code.split('\n').map((text) => [{ text, light: '#111', dark: '#222' }])

beforeEach(() => {
  // The mock is a module singleton, so its record of calls outlives the test
  // that made them — and how many times it was asked is what most of these
  // assert on.
  vi.mocked(highlight).mockReset()
  vi.mocked(highlight).mockImplementation((_language, code) => Promise.resolve(rowsOf(code)))
})

const added = (text: string): DiffLine => ({
  kind: 'added',
  text,
  oldNumber: null,
  newNumber: 1,
  noNewline: false
})

const removed = (text: string): DiffLine => ({
  kind: 'removed',
  text,
  oldNumber: 1,
  newNumber: null,
  noNewline: false
})

/* One object, not a fresh `{}` per render: the hook re-colours when this
   changes, which is right for a new answer and wrong for a new literal. */
const NO_SIDES = {}

describe('the colours a diff is drawn in', () => {
  it('starts with none, so the diff is readable before they arrive', () => {
    const { result } = renderHook(() => useHighlighting(workspaceDiff([fileDiff('a.ts')]), {}))

    expect(result.current.size).toBe(0)
  })

  it('colours the lines of a file it knows the language of', async () => {
    const line = added('const x = 1')
    const diff = workspaceDiff([fileDiff('a.ts', { hunks: [hunk({ lines: [line] })] })])

    const { result } = renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(result.current.get('a.ts')?.get(line)?.[0]?.text).toBe('const x = 1')
    })
  })

  /*
   * Files are coloured one at a time, and each arrival used to hand every file
   * a value it had to treat as new — a redraw of the whole pane per file. The
   * one already coloured keeps the same object, so a memoised row can tell that
   * nothing about it moved.
   */
  it('leaves a file already coloured holding the same colours', async () => {
    const first = added('const x = 1')
    const second = added('const y = 2')
    const diff = workspaceDiff([
      fileDiff('a.ts', { hunks: [hunk({ lines: [first] })] }),
      fileDiff('b.ts', { hunks: [hunk({ lines: [second] })] })
    ])

    const { result } = renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(result.current.get('a.ts')).toBeDefined()
    })
    const coloured = result.current.get('a.ts')

    await waitFor(() => {
      expect(result.current.get('b.ts')).toBeDefined()
    })
    expect(result.current.get('a.ts')).toBe(coloured)
  })

  it('has nothing to colour before a diff has been read', () => {
    const { result } = renderHook(() => useHighlighting(null, {}))

    expect(result.current.size).toBe(0)
    expect(highlight).not.toHaveBeenCalled()
  })

  // Guessing a grammar would colour a file as a language it is not, with
  // nothing on screen to say so.
  it('leaves a file whose language it cannot name alone', async () => {
    const diff = workspaceDiff([fileDiff('notes.wat')])

    renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(highlight).not.toHaveBeenCalled()
    })
  })

  it('leaves a file with no lines alone', async () => {
    const diff = workspaceDiff([fileDiff('a.ts', { hunks: [] })])

    renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(highlight).not.toHaveBeenCalled()
    })
  })

  // A file that is all additions has no earlier side to colour, and asking for
  // one would tokenise an empty document for every new file in the change.
  it('asks for only the side that exists', async () => {
    const diff = workspaceDiff([
      fileDiff('a.ts', { hunks: [hunk({ lines: [added('brand new')] })] })
    ])

    renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(highlight).toHaveBeenCalledTimes(1)
    })
    expect(highlight).toHaveBeenCalledWith('typescript', 'brand new')
  })

  // A deleted file has no current side, and asking for one would tokenise an
  // empty document for every file the change removes.
  it('asks for only the earlier side when a file was deleted', async () => {
    const diff = workspaceDiff([
      fileDiff('a.ts', { hunks: [hunk({ lines: [removed('was here')] })] })
    ])

    renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(highlight).toHaveBeenCalledTimes(1)
    })
    expect(highlight).toHaveBeenCalledWith('typescript', 'was here')
  })

  /*
   * A minified bundle is a handful of enormous lines.
   *
   * The highlighter spends about a second on one of those whatever its length,
   * and that second is the window not responding. Nobody is reading a minified
   * line anyway, so it is drawn plain.
   */
  it('leaves a file whose lines are enormous alone', async () => {
    const diff = workspaceDiff([
      fileDiff('bundle.js', { hunks: [hunk({ lines: [added('x'.repeat(5_000))] })] })
    ])

    renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(highlight).not.toHaveBeenCalled()
    })
  })

  it('asks for both sides when a file has both', async () => {
    const diff = workspaceDiff([
      fileDiff('a.ts', { hunks: [hunk({ lines: [removed('was'), added('is')] })] })
    ])

    renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(highlight).toHaveBeenCalledTimes(2)
    })
  })

  // The diff is replaced on every turn the agent finishes; colours for the one
  // before it must not land on top of the one now on screen.
  it('drops the work when the diff is replaced under it', async () => {
    const line = added('const x = 1')
    const first = workspaceDiff([fileDiff('a.ts', { hunks: [hunk({ lines: [line] })] })])

    vi.mocked(highlight).mockReturnValue(new Promise(() => undefined))

    const { result, rerender } = renderHook(({ diff }) => useHighlighting(diff, NO_SIDES), {
      initialProps: { diff: first }
    })

    rerender({ diff: workspaceDiff([]) })

    await waitFor(() => {
      expect(result.current.size).toBe(0)
    })
  })
  /*
   * The finding this exists for. Joining the hunks end to end hides a construct
   * opened in the lines *between* two of them — a block comment, a template
   * literal, a heredoc — and the hunk after it is then coloured as though the
   * construct were not open. Most likely in exactly the files worth reading
   * closely: a hunk in the middle of a long function, three lines of context
   * either side, and everything that gave those lines their meaning left out.
   */
  it('colours from the whole file when it has one', async () => {
    const line = added('const x = 1')
    const diff = workspaceDiff([fileDiff('a.ts', { hunks: [hunk({ lines: [line] })] })])

    renderHook(() =>
      useHighlighting(diff, { 'a.ts': { old: 'WHOLE OLD FILE', current: 'WHOLE NEW FILE' } })
    )

    await waitFor(() => {
      expect(highlight).toHaveBeenCalledWith('typescript', 'WHOLE NEW FILE')
    })
    expect(highlight).toHaveBeenCalledWith('typescript', 'WHOLE OLD FILE')
  })

  /* A file too large to carry, or a workspace whose sides could not be read at
     all: the colours go back to the hunks, which is what they read before any
     of this existed. */
  it('falls back to the hunks for a file it has no whole sides for', async () => {
    const line = added('const x = 1')
    const diff = workspaceDiff([fileDiff('a.ts', { hunks: [hunk({ lines: [line] })] })])

    renderHook(() => useHighlighting(diff, NO_SIDES))

    await waitFor(() => {
      expect(highlight).toHaveBeenCalledWith('typescript', 'const x = 1')
    })
  })
})
