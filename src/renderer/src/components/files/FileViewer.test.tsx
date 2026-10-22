import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileContent } from '@core/workspaceFiles.js'

import { octopus } from '../../test/octopus.js'
import { MAX_HIGHLIGHT_CHARS, MAX_HIGHLIGHT_LINES } from '../diff/colouredText.js'
import { highlight } from '../diff/highlight.js'
import { MAX_LINE_LENGTH } from '../diff/useHighlighting.js'
import { FileViewer, type NoteTarget } from './FileViewer.js'

vi.mock('../diff/highlight.js', () => ({ highlight: vi.fn() }))

const WORKSPACE = 'planner/anna'

const answering = (content: FileContent): void => {
  vi.mocked(octopus().files.read).mockResolvedValue({ ok: true, value: content })
}

beforeEach(() => {
  // A module mock keeps its calls across tests unless it is reset.
  vi.mocked(highlight).mockReset().mockResolvedValue(null)
})

const TARGETS: readonly NoteTarget[] = [
  { key: 'first', name: 'Claude 1', active: false },
  { key: 'chat-2', name: 'Claude 2', active: true }
]

function renderViewer(path = 'src/a.ts'): {
  onError: ReturnType<typeof vi.fn>
  onNote: ReturnType<typeof vi.fn>
} {
  const onError = vi.fn()
  const onNote = vi.fn()
  render(
    <FileViewer
      workspaceId={WORKSPACE}
      path={path}
      onError={onError}
      targets={TARGETS}
      onNote={onNote}
    />
  )
  return { onError, onNote }
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

describe('reviewing selected lines', () => {
  /*
   * jsdom lays nothing out, so the code has no box and a range none either;
   * the toolbar is placed from the code's box and the line numbers, so the
   * code is given one 100px down. Lines are 18px under 12px of padding.
   */
  const codeBox = (top: number): void => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(20, top, 400, 600)
    )
  }
  beforeEach(() => {
    codeBox(100)
    Range.prototype.getBoundingClientRect = () => new DOMRect(20, 100, 80, 36)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.getSelection()?.removeAllRanges()
    vi.useRealTimers()
  })

  /** Opens a three-line file and selects from inside line two into line three. */
  async function selected(): Promise<{ onNote: ReturnType<typeof vi.fn> }> {
    answering({ kind: 'text', text: 'one\ntwo\nthree\n', bytes: 14 })
    const view = renderViewer()
    await waitFor(() => {
      expect(code()).toHaveTextContent('one two three')
    })
    selectText(5, 10)
    return view
  }

  function selectText(start: number, end: number): void {
    const node = code()?.firstChild
    if (!node) throw new Error('no code')
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    act(() => {
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      // jsdom does not fire it; a browser does for every way a selection is made.
      document.dispatchEvent(new Event('selectionchange'))
    })
  }

  const toolbar = (): HTMLElement => screen.getByRole('toolbar', { name: 'Lines 2-3' })

  it('offers a note to each conversation, the last one in front first among them', async () => {
    await selected()

    const buttons = within(toolbar()).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Add to Claude 1',
      'Add to Claude 2',
      'Copy path'
    ])
    expect(buttons[1]).toHaveClass('bg-accent')
    expect(buttons[0]).not.toHaveClass('bg-accent')
    // Above line two, which starts 130px down: the code's 100, its padding
    // and one line. At the code's left edge, since the selection spans lines.
    expect(toolbar()).toHaveStyle({ top: '96px', left: '20px' })
  })

  it('floats below a selection at the very top of the window', async () => {
    codeBox(0)
    await selected()

    // Under line three's bottom edge: padding and three lines, plus the gap.
    expect(toolbar()).toHaveStyle({ top: '72px' })
  })

  /*
   * Every read of the selection — each move of the mouse while dragging one —
   * used to redraw the whole file, a span per token. The colours are read
   * through a getter, so a redraw shows up as a count.
   */
  it('reads the selection without redrawing the file', async () => {
    let reads = 0
    const token = { light: '#111', dark: '#eee' }
    vi.mocked(highlight).mockResolvedValue([
      [
        {
          ...token,
          get text() {
            reads += 1
            return 'one'
          }
        }
      ],
      [{ ...token, text: 'two' }],
      [{ ...token, text: 'three' }]
    ])
    answering({ kind: 'text', text: 'one\ntwo\nthree\n', bytes: 14 })
    renderViewer()
    await waitFor(() => {
      expect(code()?.querySelectorAll('span')).toHaveLength(3)
    })
    const drawn = reads

    // From inside the first span to inside the last: the file is spans now.
    const spans = code()?.querySelectorAll('span') ?? []
    const range = document.createRange()
    range.setStart(spans[0]?.firstChild ?? document.body, 1)
    range.setEnd(spans[2]?.firstChild ?? document.body, 2)
    act(() => {
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })

    expect(screen.getByRole('toolbar', { name: 'Lines 1-3' })).toBeInTheDocument()
    expect(reads).toBe(drawn)
  })

  // A press on the toolbar must not clear the selection it acts on.
  it('keeps the selection when the toolbar is pressed', async () => {
    await selected()

    expect(fireEvent.mouseDown(toolbar())).toBe(false)
  })

  it('goes when the selection does', async () => {
    await selected()

    act(() => {
      window.getSelection()?.removeAllRanges()
      document.dispatchEvent(new Event('selectionchange'))
    })

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('sends a note on the whole lines to the conversation chosen', async () => {
    const user = userEvent.setup()
    const { onNote } = await selected()

    await user.click(within(toolbar()).getByRole('button', { name: 'Add to Claude 1' }))
    expect(screen.getByText('src/a.ts:2-3')).toBeInTheDocument()
    await user.type(
      screen.getByRole('textbox', {
        name: 'What should the agent know about these lines? (optional)'
      }),
      'rename these'
    )
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(onNote).toHaveBeenCalledWith('first', {
      path: 'src/a.ts',
      line: 2,
      endLine: 3,
      // Read from the file, whole lines, not the half of line two selected.
      code: 'two\nthree',
      text: 'rename these'
    })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(window.getSelection()?.rangeCount).toBe(0)
  })

  // The lines and their place are worth sending without a word.
  it('sends a note with no words', async () => {
    const user = userEvent.setup()
    const { onNote } = await selected()

    await user.click(within(toolbar()).getByRole('button', { name: 'Add to Claude 2' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(onNote).toHaveBeenCalledWith('chat-2', expect.objectContaining({ text: '' }))
  })

  it('drops the note on Escape', async () => {
    const user = userEvent.setup()
    const { onNote } = await selected()

    await user.click(within(toolbar()).getByRole('button', { name: 'Add to Claude 2' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(onNote).not.toHaveBeenCalled()
  })

  it('copies the reference to the lines rather than their text with ⌘C', async () => {
    await selected()
    const setData = vi.fn()

    const allowed = fireEvent.copy(code() ?? document.body, { clipboardData: { setData } })

    expect(setData).toHaveBeenCalledWith('text/plain', 'src/a.ts:2-3')
    expect(allowed).toBe(false)
  })

  it('leaves ⌘C alone when nothing in the code is selected', async () => {
    await selected()
    window.getSelection()?.removeAllRanges()
    const setData = vi.fn()

    const allowed = fireEvent.copy(code() ?? document.body, { clipboardData: { setData } })

    expect(setData).not.toHaveBeenCalled()
    expect(allowed).toBe(true)
  })

  it('copies the reference from the toolbar, says so, and offers it again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await selected()

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Copy path' }))

    expect(await within(toolbar()).findByRole('button', { name: 'Path copied' })).toBeVisible()
    expect(writeText).toHaveBeenCalledWith('src/a.ts:2-3')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(within(toolbar()).getByRole('button', { name: 'Copy path' })).toBeVisible()
  })

  it('says when the clipboard refused', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.reject(new Error('not focused'))) },
      configurable: true
    })
    await selected()

    fireEvent.click(within(toolbar()).getByRole('button', { name: 'Copy path' }))

    expect(await within(toolbar()).findByRole('button', { name: 'Could not copy' })).toBeVisible()
  })
})
