import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileContent } from '@core/workspaceFiles.js'

import { octopus } from '../../test/octopus.js'
import { highlight } from '../diff/highlight.js'
import { MAX_LINE_LENGTH } from '../diff/useHighlighting.js'
import { FileViewer, MAX_HIGHLIGHT_CHARS, MAX_HIGHLIGHT_LINES } from './FileViewer.js'

vi.mock('../diff/highlight.js', () => ({ highlight: vi.fn() }))

const WORKSPACE = 'planner/anna'

const answering = (content: FileContent): void => {
  vi.mocked(octopus().files.read).mockResolvedValue({ ok: true, value: content })
}

beforeEach(() => {
  // A module mock keeps its calls across tests unless it is reset.
  vi.mocked(highlight).mockReset().mockResolvedValue(null)
})

function renderViewer(path = 'src/a.ts'): { onError: ReturnType<typeof vi.fn> } {
  const onError = vi.fn()
  render(<FileViewer workspaceId={WORKSPACE} path={path} onError={onError} />)
  return { onError }
}

/** The code column, which is the `<pre>` that is not the line numbers. */
const code = (): HTMLElement | null => document.querySelector('pre.diff-code')

describe('FileViewer', () => {
  it('shows the file with its path and a number for every line', async () => {
    answering({ kind: 'text', text: 'one\ntwo\n', bytes: 8 })

    renderViewer()

    expect(screen.getByText('Opening…')).toBeInTheDocument()
    await waitFor(() => {
      expect(code()).toHaveTextContent('one two')
    })
    expect(screen.getByTitle('src/a.ts')).toBeInTheDocument()
    expect(document.querySelector('pre[aria-hidden]')?.textContent).toBe('1\n2')
  })

  it('colours the code once the highlighter answers', async () => {
    answering({ kind: 'text', text: 'const a\nlet b', bytes: 13 })
    vi.mocked(highlight).mockResolvedValue([
      [{ text: 'const a', light: '#111', dark: '#eee' }],
      [{ text: 'let b', light: '#222', dark: undefined }]
    ])

    renderViewer()

    await waitFor(() => {
      expect(code()?.querySelectorAll('span')).toHaveLength(2)
    })
    expect(highlight).toHaveBeenCalledWith('typescript', 'const a\nlet b')
    const [first] = code()?.querySelectorAll('span') ?? []
    expect(first?.style.getPropertyValue('--shiki-light')).toBe('#111')
    expect(code()?.textContent).toBe('const a\nlet b')
  })

  it('draws a file it has no grammar for plain, without a word about it', async () => {
    answering({ kind: 'text', text: 'plain', bytes: 5 })

    renderViewer('notes.unknown')

    await waitFor(() => {
      expect(code()).toHaveTextContent('plain')
    })
    expect(highlight).not.toHaveBeenCalled()
    expect(screen.queryByText(/too large to highlight/)).not.toBeInTheDocument()
  })

  it.each([
    ['too many characters', 'x'.repeat(MAX_HIGHLIGHT_CHARS + 1)],
    ['too many lines', 'x\n'.repeat(MAX_HIGHLIGHT_LINES + 1)],
    ['a line too long', 'x'.repeat(MAX_LINE_LENGTH + 1)]
  ])('draws a file with %s plain, and says why', async (_, text) => {
    answering({ kind: 'text', text, bytes: text.length })

    renderViewer()

    expect(
      await screen.findByText('Shown without colours: the file is too large to highlight.')
    ).toBeInTheDocument()
    expect(highlight).not.toHaveBeenCalled()
  })

  // The file changed while the colours were being worked out.
  it('drops colours for text that is no longer showing', async () => {
    answering({ kind: 'text', text: 'old', bytes: 3 })
    let finish: (tokens: { text: string; light: string; dark: string }[][]) => void = () =>
      undefined
    vi.mocked(highlight).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    renderViewer()
    await waitFor(() => {
      expect(code()).toHaveTextContent('old')
    })

    answering({ kind: 'text', text: 'new', bytes: 3 })
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => {
      expect(code()).toHaveTextContent('new')
    })
    await act(async () => {
      finish([[{ text: 'old', light: '#111', dark: '#eee' }]])
      await Promise.resolve()
    })

    expect(code()).toHaveTextContent('new')
  })

  it.each<[string, FileContent, RegExp]>([
    ['binary', { kind: 'binary', bytes: 2048 }, /binary file \(2 kB\)/],
    [
      'too large',
      { kind: 'tooLarge', bytes: 2 * 1024 * 1024, limit: 1024 * 1024 },
      /This file is 2 MB, more than the 1 MB shown here/
    ],
    ['missing', { kind: 'missing' }, /no longer there/],
    [
      'deleted beyond showing',
      { kind: 'deleted', text: null },
      /last committed version cannot be shown/
    ]
  ])('says why a %s file is not shown', async (_, content, message) => {
    answering(content)

    renderViewer()

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(code()).toBeNull()
  })

  it('shows what a deleted file held, under a banner saying so', async () => {
    answering({ kind: 'deleted', text: 'was here' })

    renderViewer()

    expect(
      await screen.findByText('This file has been deleted. This is its last committed version.')
    ).toBeInTheDocument()
    expect(code()).toHaveTextContent('was here')
  })

  it('says why the file could not be read', async () => {
    vi.mocked(octopus().files.read).mockResolvedValue({ ok: false, error: 'no workspace' })

    renderViewer()

    expect(await screen.findByText(/no workspace/)).toHaveClass('text-danger')
  })

  it('opens the file in the editor, and says so when the system will not', async () => {
    answering({ kind: 'text', text: 'a', bytes: 1 })
    const { onError } = renderViewer()

    await userEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(octopus().files.open).toHaveBeenCalledWith(WORKSPACE, 'src/a.ts')
    expect(onError).not.toHaveBeenCalled()

    vi.mocked(octopus().files.open).mockResolvedValue({ ok: false, error: 'no application' })
    await userEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('no application'))
  })
})
