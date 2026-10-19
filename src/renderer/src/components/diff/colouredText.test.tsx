import { act, render, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { held } from '../../test/held.js'
import { ColouredLine, useColouredText } from './colouredText.js'
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
