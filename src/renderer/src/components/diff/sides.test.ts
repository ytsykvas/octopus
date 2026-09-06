import { describe, expect, it } from 'vitest'

import type { DiffLine, Hunk } from '@core/diff.js'

import type { Token } from './highlight.js'
import { assignTokens, assignWholeTokens, sideTexts } from './sides.js'

const line = (kind: DiffLine['kind'], text: string): DiffLine => ({
  kind,
  text,
  oldNumber: kind === 'added' ? null : 1,
  newNumber: kind === 'removed' ? null : 1,
  noNewline: false
})

const hunk = (lines: readonly DiffLine[]): Hunk => ({
  oldStart: 1,
  oldLines: lines.length,
  newStart: 1,
  newLines: lines.length,
  heading: '',
  lines
})

const token = (text: string, light: string): Token => ({ text, light, dark: light })

describe('sideTexts', () => {
  it('leaves an added line out of the file as it was', () => {
    const lines = [line('context', 'kept'), line('added', 'new')]

    expect(sideTexts([hunk(lines)]).old).toBe('kept')
  })

  it('leaves a removed line out of the file as it is', () => {
    const lines = [line('context', 'kept'), line('removed', 'gone')]

    expect(sideTexts([hunk(lines)]).current).toBe('kept')
  })

  it('joins the hunks of a file into one document per side', () => {
    const texts = sideTexts([hunk([line('context', 'one')]), hunk([line('context', 'two')])])

    expect(texts.current).toBe('one\ntwo')
  })

  it('has nothing to colour in a file with no hunks', () => {
    expect(sideTexts([])).toEqual({ old: '', current: '' })
  })
})

describe('assignTokens', () => {
  it('gives a removed line the colours of the file as it was', () => {
    const removed = line('removed', 'gone')
    const lines = [line('context', 'kept'), removed]

    const tokens = assignTokens(
      [hunk(lines)],
      [[token('kept', '#111')], [token('gone', '#222')]],
      [[token('kept', '#333')]]
    )

    expect(tokens.get(removed)?.[0]?.light).toBe('#222')
  })

  it('gives an added line the colours of the file as it is', () => {
    const added = line('added', 'new')
    const lines = [line('context', 'kept'), added]

    const tokens = assignTokens(
      [hunk(lines)],
      [[token('kept', '#111')]],
      [[token('kept', '#333')], [token('new', '#444')]]
    )

    expect(tokens.get(added)?.[0]?.light).toBe('#444')
  })

  // It reads the same either way, and the current file is the one on screen.
  it('gives a context line the colours of the file as it is', () => {
    const context = line('context', 'kept')

    const tokens = assignTokens(
      [hunk([context])],
      [[token('kept', '#111')]],
      [[token('kept', '#333')]]
    )

    expect(tokens.get(context)?.[0]?.light).toBe('#333')
  })

  it('keeps the two sides in step across several hunks', () => {
    const second = line('added', 'later')
    const hunks = [hunk([line('removed', 'first')]), hunk([second])]

    const tokens = assignTokens(hunks, [[token('first', '#111')]], [[token('later', '#444')]])

    expect(tokens.get(second)?.[0]?.light).toBe('#444')
  })

  // A line the highlighter never reached is simply absent, and its row is
  // drawn plain rather than waiting for a colour that is not coming.
  it('leaves out a line whose side was never coloured', () => {
    const added = line('added', 'new')

    expect(assignTokens([hunk([added])], null, null).size).toBe(0)
  })

  it('leaves out a line the colours ran short of', () => {
    const second = line('added', 'second')

    const tokens = assignTokens([hunk([line('added', 'first'), second])], null, [
      [token('first', '#444')]
    ])

    expect(tokens.has(second)).toBe(false)
  })
})

describe('assignWholeTokens', () => {
  /** A line that sits at a given row of each side, as git numbers them. */
  const at = (
    kind: DiffLine['kind'],
    text: string,
    oldNumber: number,
    newNumber: number
  ): DiffLine => ({
    kind,
    text,
    oldNumber: kind === 'added' ? null : oldNumber,
    newNumber: kind === 'removed' ? null : newNumber,
    noNewline: false
  })

  /*
   * By line number rather than by walking, which is the whole difference from
   * `assignTokens`: these tokens describe every line of the file and the hunks
   * describe some of them, so there is no shared walk to keep in step.
   */
  it('takes a line\u2019s colours from its own row of the whole file', () => {
    const context = at('context', 'kept', 40, 40)
    const removed = at('removed', 'gone', 41, 0)

    const tokens = assignWholeTokens(
      [
        {
          oldStart: 40,
          oldLines: 2,
          newStart: 40,
          newLines: 1,
          heading: '',
          lines: [context, removed]
        }
      ],
      Array.from({ length: 41 }, (_, index) => [token(`old ${String(index + 1)}`, '#111')]),
      Array.from({ length: 40 }, (_, index) => [token(`new ${String(index + 1)}`, '#333')])
    )

    expect(tokens.get(context)?.[0]?.text).toBe('new 40')
    expect(tokens.get(removed)?.[0]?.text).toBe('old 41')
  })

  /* The two readings disagreeing about a file — it changed between them — is a
     plain line rather than a wrong one. */
  it('leaves a line whose row is past the tokens plain', () => {
    const line = at('context', 'kept', 99, 99)

    const tokens = assignWholeTokens(
      [{ oldStart: 99, oldLines: 1, newStart: 99, newLines: 1, heading: '', lines: [line] }],
      [[token('one', '#111')]],
      [[token('one', '#333')]]
    )

    expect(tokens.has(line)).toBe(false)
  })

  it('has nothing to give when neither side was coloured', () => {
    const line = at('context', 'kept', 1, 1)

    expect(
      assignWholeTokens(
        [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, heading: '', lines: [line] }],
        null,
        null
      ).size
    ).toBe(0)
  })
})
