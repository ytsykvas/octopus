import { act, render, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { held } from '../../test/held.js'
import { ColouredLine, ColouredLines, useColouredText } from './colouredText.js'
import { highlight, type Token } from './highlight.js'

vi.mock('./highlight.js', () => ({ highlight: vi.fn() }))

const tokensOf = (text: string, light: string): Token[][] => [[{ text, light, dark: undefined }]]

beforeEach(() => {
  vi.mocked(highlight).mockReset()
})

/*
 * Two guards against colours that belong to another text, and each covers what
 * the other cannot: a text drawn with colours already landed and its new ones
 * still on their way, and an older answer arriving after a newer one.
 */
describe('colours for a text that changed', () => {
  it('draws the new text plain while its colours are on their way', async () => {
    const next = held<Token[][] | null>()
    vi.mocked(highlight)
      .mockResolvedValueOnce(tokensOf('old', '#111'))
      .mockReturnValueOnce(next.promise)
    const { result, rerender } = renderHook(({ text }) => useColouredText('a.ts', text), {
      initialProps: { text: 'old' }
    })
    await waitFor(() => {
      expect(result.current.tokens).not.toBeNull()
    })

    rerender({ text: 'new' })

    expect(result.current.tokens).toBeNull()
    expect(result.current.lines).toEqual(['new'])
    await act(async () => {
      next.resolve(null)
      await next.promise
    })
  })

  it('keeps the newer colours when an older answer arrives late', async () => {
    const older = held<Token[][] | null>()
    vi.mocked(highlight)
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(tokensOf('new', '#222'))
    const { result, rerender } = renderHook(({ text }) => useColouredText('a.ts', text), {
      initialProps: { text: 'old' }
    })

    rerender({ text: 'new' })
    await waitFor(() => {
      expect(result.current.tokens?.[0]?.[0]?.light).toBe('#222')
    })
    await act(async () => {
      older.resolve(tokensOf('old', '#111'))
      await older.promise
    })

    expect(result.current.tokens?.[0]?.[0]?.light).toBe('#222')
  })
})

/*
 * What `ColouredLines` is memoised on: the lines keep their identity for the
 * same text, and a render that changed neither them nor the tokens draws
 * nothing — the colours are read through a getter, so a redraw is a count.
 */
describe('drawing the lines again', () => {
  it('hands back the same lines for the same text', () => {
    vi.mocked(highlight).mockResolvedValue(null)
    const { result, rerender } = renderHook(() => useColouredText('a.ts', 'one\ntwo'))
    const first = result.current.lines

    rerender()

    expect(result.current.lines).toBe(first)
  })

  it('draws nothing for a render that changed neither lines nor tokens', () => {
    let reads = 0
    const tokens: Token[][] = [
      [
        {
          light: '#111',
          dark: undefined,
          get text() {
            reads += 1
            return 'one'
          }
        }
      ]
    ]
    const lines = ['one']
    const { rerender } = render(<ColouredLines lines={lines} tokens={tokens} />)
    const drawn = reads

    rerender(<ColouredLines lines={lines} tokens={tokens} />)
    expect(reads).toBe(drawn)

    rerender(<ColouredLines lines={['one']} tokens={tokens} />)
    expect(reads).toBeGreaterThan(drawn)
  })
})

describe('one coloured line', () => {
  it('draws each token in its colours, naming what would not draw as itself', () => {
    const { container } = render(
      <ColouredLine
        text="ignored once there are tokens"
        tokens={[
          { text: 'const', light: '#1', dark: '#2' },
          { text: ' a‮', light: '#3', dark: '#4' }
        ]}
      />
    )

    const spans = container.querySelectorAll(':scope > span')
    expect(spans).toHaveLength(2)
    expect(spans[0]).toHaveStyle({ '--shiki-light': '#1', '--shiki-dark': '#2' })
    expect(container).toHaveTextContent('const aU+202E')
  })

  it('draws the plain text until there are tokens', () => {
    const { container } = render(<ColouredLine text="plain" tokens={undefined} />)
    expect(container).toHaveTextContent('plain')
  })
})
