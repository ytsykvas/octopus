import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { highlight } from './highlight.js'
import { octopus } from '../../test/octopus.js'
import { fileDiff, hunk, workspaceDiff } from '../../test/diff.js'
import { commentController, revertController } from '../../test/comments.js'
import type { WorkspaceChat } from '@core/workspaces.js'

import { workspaceView } from '../../test/workspaces.js'
import { DiffPanel } from './DiffPanel.js'

// The highlighter is exercised by its own tests. Here it would only break every
// assertion about a line's text into the spans shiki splits it into, and slow
// the suite down loading grammars to prove something about shiki.
//
// A mock rather than a constant, so the one test that is about the coloured
// path can hand back tokens: a line reaches the reader through those spans in
// the running app, and drawing it plain is the exception.
vi.mock('./highlight.js', () => ({ highlight: vi.fn(() => Promise.resolve(null)) }))

const anna = workspaceView('anna')
const bob = workspaceView('bob')

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve())
})

afterEach(() => {
  vi.useRealTimers()
})

/** A user, then our clipboard — `userEvent.setup` installs one of its own. */
function withClipboard(): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return user
}

/** Makes the next read answer with this diff. */
function answer(diff: ReturnType<typeof workspaceDiff>): void {
  vi.mocked(octopus().workspaces.diff).mockResolvedValue({ ok: true, value: diff })
}

/** The same file after a reload that dropped a line above the annotated one. */
function shiftedFile(): ReturnType<typeof fileDiff> {
  return fileDiff('src/a.ts', {
    hunks: [
      hunk({
        lines: [
          { kind: 'context', text: 'kept', oldNumber: 1, newNumber: 1, noNewline: false },
          { kind: 'added', text: 'is here now', oldNumber: null, newNumber: 2, noNewline: false }
        ]
      })
    ]
  })
}

/** A turn ending in this workspace, which is what makes the pane read again. */
function emitTurnEnd(): void {
  const handlers = vi.mocked(octopus().chats.onEvent).mock.calls.map(([handler]) => handler)

  act(() => {
    for (const handler of handlers) {
      handler({
        chatId: 'chat-1',
        workspaceId: anna.id,
        event: {
          type: 'result',
          ok: true,
          costUsd: 0,
          durationMs: 1,
          inputTokens: 0,
          outputTokens: 0,
          terminalReason: 'completed'
        }
      })
    }
  })
}

const WIDE = 900

function renderPanel(workspace = anna, visible = true): void {
  render(
    <DiffPanel
      workspace={workspace}
      visible={visible}
      view="unified"
      onView={vi.fn()}
      width={WIDE}
      comments={commentController()}
      revert={revertController()}
      onError={vi.fn()}
    />
  )
}

describe('DiffPanel', () => {
  it('asks for nothing until a workspace is chosen', () => {
    render(
      <DiffPanel
        workspace={null}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    expect(screen.getByText(/Select a workspace/)).toBeInTheDocument()
    expect(octopus().workspaces.diff).not.toHaveBeenCalled()
  })

  it('says so when the workspace has changed nothing', async () => {
    renderPanel()

    expect(await screen.findByText(/Nothing has changed/)).toBeInTheDocument()
  })

  it('counts the files and the lines, and names what they are measured against', async () => {
    answer(
      workspaceDiff([
        fileDiff('src/a.ts', { added: 3, removed: 1 }),
        fileDiff('src/b.ts', { added: 2, removed: 2 })
      ])
    )
    renderPanel()

    expect(await screen.findByText('2 files')).toBeInTheDocument()
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getByText('−3')).toBeInTheDocument()
    expect(screen.getByText('against main')).toBeInTheDocument()
  })

  it('draws the lines of each file', async () => {
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    expect(await screen.findByText('is here now')).toBeInTheDocument()
    expect(screen.getByText('was here')).toBeInTheDocument()
    expect(screen.getByText('kept')).toBeInTheDocument()
  })

  it('collapses a file and puts it back', async () => {
    const user = userEvent.setup()
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    const header = await screen.findByRole('button', { name: 'src/a.ts' })
    expect(header).toHaveAttribute('aria-expanded', 'true')

    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('is here now')).not.toBeInTheDocument()

    await user.click(header)
    expect(screen.getByText('is here now')).toBeInTheDocument()
  })

  it('collapses and expands every file at once', async () => {
    const user = userEvent.setup()
    answer(workspaceDiff([fileDiff('src/a.ts'), fileDiff('src/b.ts')]))
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Collapse every file' }))
    expect(screen.queryByText('is here now')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand every file' }))
    expect(screen.getAllByText('is here now')).toHaveLength(2)
  })

  // A generated file or a wholesale rewrite is not read line by line, and
  // putting it in the way of the files that are is what makes review tedious.
  it('starts a very large file collapsed', async () => {
    answer(workspaceDiff([fileDiff('generated.ts', { added: 900, removed: 900 })]))
    renderPanel()

    expect(await screen.findByRole('button', { name: 'generated.ts' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('says where a file was moved from', async () => {
    answer(workspaceDiff([fileDiff('src/b.ts', { oldPath: 'src/a.ts', status: 'renamed' })]))
    renderPanel()

    expect(await screen.findByText('moved from src/a.ts')).toBeInTheDocument()
  })

  /*
   * A permission change has no lines by construction, so without this the row
   * was a chevron, an `M`, a path and a revert control — a live file that
   * changed nothing, which reads as more confusing than an empty row.
   */
  it('says a file was made executable, which draws no lines at all', async () => {
    answer(
      workspaceDiff([fileDiff('run.sh', { mode: { from: '100644', to: '100755' }, hunks: [] })])
    )
    renderPanel()

    expect(await screen.findByText('made executable')).toBeInTheDocument()
  })

  // The other direction has its own words rather than two octal numbers, since
  // this is the bit octopus itself depends on.
  it('says when one stopped being executable', async () => {
    answer(
      workspaceDiff([fileDiff('run.sh', { mode: { from: '100755', to: '100644' }, hunks: [] })])
    )
    renderPanel()

    expect(await screen.findByText('no longer executable')).toBeInTheDocument()
  })

  /*
   * Anything else is spelled, which is also what stops a type change being
   * reported as a bare `T`: 100644 to 120000 is a file becoming a symlink.
   */
  it('spells a mode change that is not about the executable bit', async () => {
    answer(workspaceDiff([fileDiff('link', { mode: { from: '100644', to: '120000' }, hunks: [] })]))
    renderPanel()

    expect(await screen.findByText('mode 100644 \u2192 120000')).toBeInTheDocument()
  })

  // And an ordinary edit says nothing about modes, so the line means something
  // the moment it appears.
  it('says nothing about the mode of a file that only changed', async () => {
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    await screen.findByRole('button', { name: 'src/a.ts' })
    expect(screen.queryByText(/^mode |executable/)).not.toBeInTheDocument()
  })

  it('says a binary file has nothing to show', async () => {
    answer(workspaceDiff([fileDiff('logo.png', { omitted: 'binary', hunks: [] })]))
    renderPanel()

    expect(await screen.findByText(/Binary file/)).toBeInTheDocument()
  })

  it('says a file is too large to draw, and how many others were', async () => {
    answer(
      workspaceDiff([fileDiff('huge.json', { omitted: 'tooLarge', hunks: [] })], {
        omittedFiles: 1
      })
    )
    renderPanel()

    expect(await screen.findByText(/Too large to draw/)).toBeInTheDocument()
    expect(screen.getByText('1 file is too large to draw')).toBeInTheDocument()
  })

  /*
   * A line carrying a right-to-left override reads one way and runs another.
   * Nothing is executed — React escapes the markup — but the pane exists to be
   * where work is checked, and a reviewer approving a line that is not the
   * line is the one failure it cannot have.
   */
  it('names a character that would not draw as itself, in place of drawing it', async () => {
    answer(
      workspaceDiff([
        fileDiff('src/auth.ts', {
          hunks: [
            hunk({
              lines: [
                {
                  kind: 'added',
                  text: 'if (user.isAdmin) { \u202E',
                  oldNumber: null,
                  newNumber: 1,
                  noNewline: false
                }
              ]
            })
          ]
        })
      ])
    )
    renderPanel()

    expect(await screen.findByText('U+202E')).toBeInTheDocument()
    expect(screen.getByLabelText(/characters that do not draw as themselves/)).toBeInTheDocument()
  })

  /*
   * The same line, on the path it actually takes.
   *
   * Almost every line in the running app is drawn through the highlighter's
   * spans, and that is a different branch of `Code` from the plain one above.
   * A chip that worked in one and not the other would look right in every
   * other test in this file.
   */
  it('names it inside a coloured line too', async () => {
    // The tokens say something the line does not, so a fall back to the plain
    // branch fails this rather than passing it: the chip would be there either
    // way, and a test that cannot tell the two apart asserts nothing.
    vi.mocked(highlight).mockResolvedValueOnce([
      [{ text: 'tokenised \u202E', light: '#005cc5', dark: '#79b8ff' }]
    ])
    answer(
      workspaceDiff([
        fileDiff('src/auth.ts', {
          hunks: [
            hunk({
              lines: [
                {
                  kind: 'added',
                  text: 'if (user.isAdmin) { \u202E',
                  oldNumber: null,
                  newNumber: 1,
                  noNewline: false
                }
              ]
            })
          ]
        })
      ])
    )
    renderPanel()

    expect(await screen.findByText('tokenised')).toBeInTheDocument()
    expect(screen.getByText('U+202E')).toBeInTheDocument()
  })

  /*
   * A path is drawn from the same bytes as the lines and reorders the same way,
   * so a file can be named to read as an image while ending in `.js`. That one
   * costs a click rather than a line, and the header is the only place it shows.
   */
  it('names a character in the file’s own name', async () => {
    answer(workspaceDiff([fileDiff(`src/report\u202Egnp.js`)]))
    renderPanel()

    expect(await screen.findByText('U+202E')).toBeInTheDocument()
    expect(screen.getByLabelText(/characters that do not draw as themselves/)).toBeInTheDocument()
  })

  it('leaves an ordinary file unmarked', async () => {
    answer(workspaceDiff([fileDiff('src/auth.ts')]))
    renderPanel()

    await screen.findByText('is here now')
    expect(
      screen.queryByLabelText(/characters that do not draw as themselves/)
    ).not.toBeInTheDocument()
  })

  // A rename with nothing else changed has no lines by construction; the header
  // has already said everything there is to say about it.
  it('draws nothing under a file that only moved', async () => {
    answer(
      workspaceDiff([
        fileDiff('b.ts', { oldPath: 'a.ts', status: 'renamed', added: 0, removed: 0, hunks: [] })
      ])
    )
    renderPanel()

    expect(await screen.findByText('moved from a.ts')).toBeInTheDocument()
    expect(screen.queryByText('is here now')).not.toBeInTheDocument()
  })

  it('shows the hunk heading git supplied', async () => {
    answer(
      workspaceDiff([fileDiff('src/a.ts', { hunks: [hunk({ heading: 'function greet()' })] })])
    )
    renderPanel()

    expect(await screen.findByText('function greet()')).toBeInTheDocument()
  })

  it('reads again when asked', async () => {
    const user = userEvent.setup()
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Re-read the changes' }))

    expect(octopus().workspaces.diff).toHaveBeenCalledTimes(2)
  })

  it('explains a failure in the reader’s language rather than git’s', async () => {
    vi.mocked(octopus().workspaces.diff).mockResolvedValue({
      ok: false,
      error: 'merge-base failed',
      code: 'baseUnknown',
      params: { branch: 'main' }
    })
    renderPanel()

    expect(
      await screen.findByText(/Could not find where this workspace branched off main/)
    ).toBeInTheDocument()
  })

  // jsdom measures every box as zero, so the sample the pane reads its cell
  // width from has to be given one before the threshold means anything.
  function withMonospaceCell(pixels: number): void {
    vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, pixels, 16)
    )
  }

  it('offers to put the two sides beside each other', async () => {
    const user = userEvent.setup()
    const onView = vi.fn()
    withMonospaceCell(64)
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="unified"
        onView={onView}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Side by side' }))

    expect(onView).toHaveBeenCalledWith('split')
  })

  it('pairs the removed line with the one that replaced it', async () => {
    withMonospaceCell(64)
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="split"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    expect(await screen.findByRole('button', { name: 'One column' })).toBeInTheDocument()
    // Context sits on both sides in split view, which is what tells the two
    // columns apart from the single one.
    expect(screen.getAllByText('kept')).toHaveLength(2)
  })

  it('offers the way back to one column', async () => {
    const user = userEvent.setup()
    const onView = vi.fn()
    withMonospaceCell(64)
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="split"
        onView={onView}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'One column' }))

    expect(onView).toHaveBeenCalledWith('unified')
  })

  // A line with nothing opposite it is what shows an addition as an addition
  // rather than as one that merely happens to sit beside something.
  it('leaves the other side blank where a line has no counterpart', async () => {
    withMonospaceCell(64)
    answer(
      workspaceDiff([
        fileDiff('src/a.ts', {
          hunks: [
            hunk({
              lines: [
                {
                  kind: 'added',
                  text: 'brand new',
                  oldNumber: null,
                  newNumber: 1,
                  noNewline: false
                }
              ]
            })
          ]
        })
      ])
    )
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="split"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    // Waits for the measurement: the toggle only offers the way back to one
    // column once the pane has worked out that two of them fit.
    await screen.findByRole('button', { name: 'One column' })

    // Once, not twice: a context line occupies both columns, and an addition
    // with nothing opposite it must not be mistaken for one.
    expect(screen.getAllByText('brand new')).toHaveLength(1)
  })

  /*
   * The right column belongs to the file as it now stands.
   *
   * A context line sits in both columns, and once anything has been added above
   * it the two files number it differently. Reading the number off the line's
   * kind gives the old file's number on both sides, so the right column is
   * wrong for every context line below the first insertion.
   */
  it('numbers each column from its own file', async () => {
    withMonospaceCell(64)
    answer(
      workspaceDiff([
        fileDiff('src/a.ts', {
          hunks: [
            hunk({
              oldStart: 10,
              newStart: 20,
              lines: [
                { kind: 'context', text: 'shared', oldNumber: 10, newNumber: 20, noNewline: false }
              ]
            })
          ]
        })
      ])
    )
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="split"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    await screen.findByRole('button', { name: 'One column' })

    expect(screen.getByText('10')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
  })

  // The stored preference is not overwritten by the pane being too narrow:
  // dragging it wide again brings the two columns back.
  it('falls back to one column when the pane is too narrow for two', async () => {
    withMonospaceCell(320)
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="split"
        onView={vi.fn()}
        width={300}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    await screen.findByText('is here now')
    expect(screen.getAllByText('kept')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /too narrow/ })).toBeDisabled()
  })

  describe('review notes', () => {
    /** Renders with a controller a test can watch and preload. */
    function renderWithComments(
      overrides: Parameters<typeof commentController>[0] = {}
    ): ReturnType<typeof commentController> {
      const comments = commentController(overrides)
      render(
        <DiffPanel
          workspace={anna}
          visible
          view="unified"
          onView={vi.fn()}
          width={WIDE}
          comments={comments}
          revert={revertController()}
          onError={vi.fn()}
        />
      )
      return comments
    }

    /*
     * jsdom implements `Range` and `Selection` but not `getBoundingClientRect`
     * on a range — it lays nothing out, so it has no rectangle to answer with.
     * The pane reads one to place the button, so without this every selection
     * throws inside the handler and no button ever appears.
     */
    beforeEach(() => {
      Range.prototype.getBoundingClientRect = () => new DOMRect(20, 100, 80, 16)
    })

    /**
     * The first run of text inside an element, however deeply it sits.
     *
     * A browser puts a selection's ends in **text** nodes, not in the elements
     * around them, and once the highlighter has run the text of a line is
     * inside however many token spans shiki produced. Anchoring a test's range
     * to the element instead would model a selection no browser makes, and
     * would stop exercising the very nesting the running app always has.
     */
    function textIn(element: Element): Text {
      return document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode() as Text
    }

    /**
     * A drag across the rendered code, as the browser reports one.
     *
     * jsdom fires no `selectionchange` of its own, so the event is dispatched
     * here — the pane listens for that one because it is the only event
     * covering every way a selection can be made.
     */
    function selectAcross(from: Element, to: Element): void {
      const end = textIn(to)

      const range = document.createRange()
      range.setStart(textIn(from), 0)
      range.setEnd(end, end.length)

      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)

      act(() => {
        document.dispatchEvent(new Event('selectionchange'))
      })
    }

    /** The code spans, in the order the pane drew them. */
    const codeLines = (): Element[] => [...document.querySelectorAll('[data-line]')]

    /*
     * Awaited rather than read outright. The button appears from a state change
     * made inside a document-level listener, and under a full suite's load that
     * lands a tick after the event does — `getBy` looked before it had.
     */
    const askButton = (): Promise<HTMLElement> =>
      screen.findByRole('button', { name: 'Ask about the selected code' })

    it('offers to ask about a passage that was selected', async () => {
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()
      await screen.findByText('kept')

      const lines = codeLines()
      selectAcross(lines[0]!, lines[2]!)

      expect(await askButton()).toBeInTheDocument()
    })

    // Reading is not asking. The button appears where a passage was chosen, and
    // a click that chose nothing has not chosen a passage.
    it('offers nothing for a selection that is only a cursor', async () => {
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()
      await screen.findByText('kept')

      // Awaited rather than left implied: the selection below is what the test
      // is about, and it can only take the button away if the button was there.
      // Without this the whole test holds just as well when the listener was
      // never registered and neither dispatch reached anything.
      const lines = codeLines()
      selectAcross(lines[0]!, lines[0]!)
      await screen.findByRole('button', { name: 'Ask about the selected code' })

      act(() => {
        window.getSelection()!.removeAllRanges()
        document.dispatchEvent(new Event('selectionchange'))
      })

      expect(
        screen.queryByRole('button', { name: 'Ask about the selected code' })
      ).not.toBeInTheDocument()
    })

    /*
     * The whole point of the gesture: one note covering the lines that were
     * dragged over, quoted in full and in order. The two lines here are both on
     * the new side — the removed line between them belongs to the other file.
     */
    it('writes one note covering every line the selection touched', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()
      await screen.findByText('kept')

      const lines = codeLines()
      selectAcross(lines[0]!, lines[2]!)
      await user.click(await askButton())
      await user.type(await screen.findByRole('textbox'), 'this pair is wrong')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith({
        path: 'src/a.ts',
        side: 'new',
        line: 1,
        endLine: 2,
        code: 'kept\nis here now',
        text: 'this pair is wrong'
      })
    })

    // Half a line selected is still a line asked about: an expression without
    // the line around it is precise about the wrong thing.
    it('quotes the whole of a line that was only half selected', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()
      await screen.findByText('kept')

      const text = textIn(codeLines()[0]!)
      const range = document.createRange()
      range.setStart(text, 1)
      range.setEnd(text, 3)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      act(() => {
        document.dispatchEvent(new Event('selectionchange'))
      })

      await user.click(await askButton())
      await user.type(await screen.findByRole('textbox'), 'why')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith(
        expect.objectContaining({ line: 1, endLine: 1, code: 'kept' })
      )
    })

    it('keeps a selection dragged past the end of a file to that file', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts'), fileDiff('src/b.ts')]))
      const comments = renderWithComments()
      // Both files carry the same three lines, so the count is what says the
      // second one has arrived — its path is drawn in two spans, not one.
      await waitFor(() => {
        expect(codeLines()).toHaveLength(6)
      })

      const lines = codeLines()
      // From the first file's last line into the second file's first.
      selectAcross(lines[2]!, lines[3]!)
      await user.click(await askButton())
      await user.type(await screen.findByRole('textbox'), 'and this')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'src/a.ts', line: 2, endLine: 2 })
      )
    })

    // The editor opens above the first line of the passage, so a note about a
    // screenful of code is not written somewhere the reader has to scroll to.
    it('opens the editor at the top of the passage', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()
      await screen.findByText('kept')

      const lines = codeLines()
      selectAcross(lines[0]!, lines[2]!)
      await user.click(await askButton())

      const editor = screen.getByRole('textbox')
      expect(editor.compareDocumentPosition(screen.getByText('is here now'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    })

    // A browser with nothing selected at all, which is what `getSelection`
    // answers before anything has been clicked in the document.
    it('offers nothing when the browser reports no selection', async () => {
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()
      await screen.findByText('kept')

      // A real selection first — `selectAcross` needs the genuine article, and
      // the button appearing is what makes its absence below mean the browser's
      // null answer rather than a listener that was never registered.
      const lines = codeLines()
      selectAcross(lines[0]!, lines[0]!)
      await screen.findByRole('button', { name: 'Ask about the selected code' })

      vi.spyOn(window, 'getSelection').mockReturnValue(null)
      act(() => {
        document.dispatchEvent(new Event('selectionchange'))
      })

      expect(
        screen.queryByRole('button', { name: 'Ask about the selected code' })
      ).not.toBeInTheDocument()
    })

    // The file header, the gutters, the counts in the toolbar: a selection that
    // touched none of the code has no passage in it to ask about.
    it('offers nothing for a selection that touched no code', async () => {
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()
      await screen.findByText('kept')

      // Select real code first and wait for the button. Asserting an absence
      // is the one shape of test that passes just as well when nothing
      // happened at all: the `selectionchange` listener is registered by an
      // effect, and until it is, every dispatch below goes nowhere and the
      // button is missing for the wrong reason. This half proves it is live.
      const lines = codeLines()
      selectAcross(lines[0]!, lines[0]!)
      await screen.findByRole('button', { name: 'Ask about the selected code' })

      selectAcross(screen.getByText('src/'), screen.getByText('a.ts'))

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Ask about the selected code' })
        ).not.toBeInTheDocument()
      })
    })

    /*
     * A passage can span the gap between two hunks, where the file has lines
     * the diff never drew. Quoting a blank for each of them would tell the
     * agent the file has empty lines it does not have.
     */
    it('quotes only the lines the diff actually shows', async () => {
      const user = userEvent.setup()
      answer(
        workspaceDiff([
          fileDiff('src/a.ts', {
            hunks: [
              hunk(),
              hunk({
                oldStart: 10,
                newStart: 10,
                lines: [
                  {
                    kind: 'added',
                    text: 'far below',
                    oldNumber: null,
                    newNumber: 10,
                    noNewline: false
                  }
                ]
              })
            ]
          })
        ])
      )
      const comments = renderWithComments()
      await screen.findByText('far below')

      const lines = codeLines()
      selectAcross(lines[2]!, lines[3]!)
      await user.click(await askButton())
      await user.type(await screen.findByRole('textbox'), 'these two')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith(
        expect.objectContaining({ line: 2, endLine: 10, code: 'is here now\nfar below' })
      )
    })

    /*
     * Every other test here draws the code plain, because the highlighter is
     * mocked away. The running app almost never does: a line's text is inside
     * however many token spans shiki produced, and the address the pane reads a
     * selection from is on the span **around** them. A selection made inside a
     * token has to still find it.
     */
    it('reads a selection made inside the coloured spans', async () => {
      const user = userEvent.setup()
      vi.mocked(highlight).mockResolvedValueOnce([
        [
          { text: 'const ', light: '#d73a49', dark: '#f97583' },
          { text: 'answer', light: '#005cc5', dark: '#79b8ff' }
        ]
      ])
      answer(
        workspaceDiff([
          fileDiff('src/a.ts', {
            hunks: [
              hunk({
                lines: [
                  {
                    kind: 'added',
                    text: 'const answer',
                    oldNumber: null,
                    newNumber: 1,
                    noNewline: false
                  }
                ]
              })
            ]
          })
        ])
      )
      const comments = renderWithComments()

      // The token, not the line: a fall back to the plain branch would leave
      // this element out of the document entirely.
      const token = await screen.findByText('answer')
      selectAcross(token, token)
      await user.click(await askButton())
      await user.type(await screen.findByRole('textbox'), 'name it better')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith(
        expect.objectContaining({ line: 1, endLine: 1, code: 'const answer' })
      )
    })

    // Side by side, the two columns are two files. A selection in the left one
    // is about the file as it was, whatever the same numbers mean on the right.
    it('anchors a selection in the left column to the file as it was', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = commentController()
      render(
        <DiffPanel
          workspace={anna}
          visible
          view="split"
          onView={vi.fn()}
          width={WIDE}
          comments={comments}
          revert={revertController()}
          onError={vi.fn()}
        />
      )
      await screen.findByText('was here')

      selectAcross(screen.getByText('was here'), screen.getByText('was here'))
      await user.click(await askButton())
      await user.type(await screen.findByRole('textbox'), 'why go?')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith(
        expect.objectContaining({ side: 'old', line: 2, endLine: 2 })
      )
    })

    // The button acted on the passage; leaving it there would invite a second
    // press on a selection whose editor is already open below it.
    it('takes the button away once it has been pressed', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()
      await screen.findByText('kept')

      const lines = codeLines()
      selectAcross(lines[0]!, lines[2]!)
      await user.click(await askButton())

      expect(
        screen.queryByRole('button', { name: 'Ask about the selected code' })
      ).not.toBeInTheDocument()
    })

    // Written against three lines, shown against the first of them — the same
    // rule the editor follows, so a remark does not appear somewhere the reader
    // has to scroll to find it.
    it('shows a note covering a passage at the top of that passage', async () => {
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments({
        pending: [
          {
            path: 'src/a.ts',
            side: 'new',
            line: 1,
            endLine: 2,
            code: 'kept\nis here now',
            text: 'this pair is wrong'
          }
        ]
      })

      const note = await screen.findByText('this pair is wrong')
      expect(note.compareDocumentPosition(screen.getByText('is here now'))).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    })

    it('offers a note against every line', async () => {
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()

      // The added line is line 2 of the file as it now stands.
      expect(await screen.findByRole('button', { name: 'Comment on line 2' })).toBeInTheDocument()
    })

    it('writes a note against the line it was opened on', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(await screen.findByRole('textbox'), 'call this something else')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith({
        path: 'src/a.ts',
        side: 'new',
        line: 2,
        endLine: 2,
        code: 'is here now',
        text: 'call this something else'
      })
    })

    // A removed line belongs to the file as it was, and its number is the one
    // it had there — sending the agent to that number in the current file
    // would point at whatever now sits in its place.
    it('anchors a note on a removed line to the file as it was', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(
        await screen.findByRole('button', { name: 'Comment on line 2 of the file as it was' })
      )
      await user.type(await screen.findByRole('textbox'), 'why was this dropped?')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith({
        path: 'src/a.ts',
        side: 'old',
        line: 2,
        endLine: 2,
        code: 'was here',
        text: 'why was this dropped?'
      })
    })

    it('keeps the line as it was when the note is abandoned', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(await screen.findByRole('textbox'), 'never mind')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(comments.add).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    /*
     * The diff re-reads itself when a turn ends, which is exactly when someone
     * is writing a note — and a re-read moves the lines.
     *
     * Rows used to be keyed by their place in the hunk, so a line that had
     * shifted was drawn by the component holding a different one; the editor's
     * text lived in that component, and the half-written sentence went with it
     * silently. The draft now sits above the rows, so it survives either way.
     */
    it('keeps a note being typed when the diff reloads under it', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(await screen.findByRole('textbox'), 'half a thought')

      // The same file with a line inserted above the one being annotated, which
      // is what shifts every row below it.
      answer(workspaceDiff([shiftedFile()]))
      emitTurnEnd()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400))
      })

      expect(await screen.findByRole('textbox')).toHaveValue('half a thought')
    })

    /*
     * The rows go entirely when a file is folded, so nothing about how they are
     * keyed can save the sentence being typed. The draft is held above them for
     * this half of it.
     */
    it('keeps a note being typed when its file is folded away and back', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(await screen.findByRole('textbox'), 'half a thought')

      const fold = screen.getByRole('button', { name: 'src/a.ts', expanded: true })
      await user.click(fold)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      await user.click(fold)

      expect(await screen.findByRole('textbox')).toHaveValue('half a thought')
    })

    // Focus used to drop to `<body>`, so a keyboard user restarted from the top
    // of the pane — after writing a note, which is the deepest into it they get.
    it('hands focus back to the trigger when the note closes', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()

      const trigger = await screen.findByRole('button', { name: 'Comment on line 2' })
      await user.click(trigger)
      await user.type(await screen.findByRole('textbox'), 'never mind')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(trigger).toHaveFocus()
    })

    it('sends nothing when the note was left empty', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).not.toHaveBeenCalled()
    })

    it('shows a note that was already written, where it was written', async () => {
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments({
        pending: [
          {
            path: 'src/a.ts',
            side: 'new',
            line: 2,
            endLine: 2,
            code: 'is here now',
            text: 'rename this'
          }
        ]
      })

      expect(await screen.findByText('rename this')).toBeInTheDocument()
    })

    it('gives a note back from where it sits', async () => {
      const user = userEvent.setup()
      const held = {
        path: 'src/a.ts',
        side: 'new' as const,
        line: 2,
        endLine: 2,
        code: 'is here now',
        text: 'rename this'
      }
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments({ pending: [held] })

      await user.click(await screen.findByRole('button', { name: 'Remove this note' }))

      expect(comments.remove).toHaveBeenCalledWith(held)
    })

    it('saves a note with the keyboard alone', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(await screen.findByRole('textbox'), 'shorter{Meta>}{Enter}{/Meta}')

      expect(comments.add).toHaveBeenCalledWith(expect.objectContaining({ text: 'shorter' }))
    })

    // Ctrl as well as Command: the same chord on a keyboard that has no Meta.
    it('saves a note with Ctrl and Enter too', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(await screen.findByRole('textbox'), 'shorter{Control>}{Enter}{/Control}')

      expect(comments.add).toHaveBeenCalledWith(expect.objectContaining({ text: 'shorter' }))
    })

    // The chord does not consult the button, so the emptiness is checked twice.
    it('sends nothing when the keyboard saves an empty note', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(await screen.findByRole('textbox'), '  {Meta>}{Enter}{/Meta}')

      expect(comments.add).not.toHaveBeenCalled()
    })

    it('abandons a note with Escape', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(await screen.findByRole('textbox'), 'never mind{Escape}')

      expect(comments.add).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    // Nothing git produces looks like this, but the type admits it, and a row
    // with nowhere to anchor a note is better off offering none.
    it('offers no note on a line that is numbered on neither side', async () => {
      answer(
        workspaceDiff([
          fileDiff('src/a.ts', {
            hunks: [
              hunk({
                lines: [
                  {
                    kind: 'context',
                    text: 'nowhere',
                    oldNumber: null,
                    newNumber: null,
                    noNewline: false
                  }
                ]
              })
            ]
          })
        ])
      )
      renderWithComments()

      expect(await screen.findByText('nowhere')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Comment on line/ })).not.toBeInTheDocument()
    })

    // A removal with nothing opposite it is the left half of a paired row, and
    // the note belongs to it because there is no newer line to prefer.
    it('anchors a note to the left half when a row has no right one', async () => {
      const user = userEvent.setup()
      vi.spyOn(HTMLSpanElement.prototype, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 64, 16)
      )
      answer(
        workspaceDiff([
          fileDiff('src/a.ts', {
            hunks: [
              hunk({
                lines: [
                  {
                    kind: 'removed',
                    text: 'dropped',
                    oldNumber: 7,
                    newNumber: null,
                    noNewline: false
                  }
                ]
              })
            ]
          })
        ])
      )
      const comments = commentController()
      render(
        <DiffPanel
          workspace={anna}
          visible
          view="split"
          onView={vi.fn()}
          width={WIDE}
          comments={comments}
          revert={revertController()}
          onError={vi.fn()}
        />
      )

      // Waits for the measurement: until it lands the pane is still drawing one
      // column, and the row clicked would be unmounted mid-click.
      await screen.findByRole('button', { name: 'One column' })

      await user.click(
        screen.getByRole('button', { name: 'Comment on line 7 of the file as it was' })
      )
      await user.type(await screen.findByRole('textbox'), 'why?')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith(expect.objectContaining({ side: 'old', line: 7 }))
    })

    it('closes the note when its own trigger is pressed again', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      renderWithComments()

      const trigger = await screen.findByRole('button', { name: 'Comment on line 2' })
      await user.click(trigger)
      expect(screen.getByRole('textbox')).toBeInTheDocument()

      await user.click(trigger)
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })

  it('reads nothing while another tab is showing', () => {
    renderPanel(anna, false)

    expect(octopus().workspaces.diff).not.toHaveBeenCalled()
  })

  it('reads when its tab comes back', async () => {
    const { rerender } = render(
      <DiffPanel
        workspace={anna}
        visible={false}
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )
    rerender(
      <DiffPanel
        workspace={anna}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledWith(anna.id)
    })
  })

  it('asks again for another workspace', async () => {
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    const { rerender } = render(
      <DiffPanel
        workspace={anna}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )
    await screen.findByText('is here now')

    rerender(
      <DiffPanel
        workspace={bob}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledWith(bob.id)
    })
  })

  it('opens a file where the system would', async () => {
    const user = userEvent.setup()
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Actions for src/a.ts' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open file' }))

    expect(octopus().files.open).toHaveBeenCalledWith(anna.id, 'src/a.ts')
  })

  // The main process reports what the system said about a refused open; a pane
  // that drops it leaves a click that opened nothing looking like one that did.
  it('says so when a file would not open', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    vi.mocked(octopus().files.open).mockResolvedValue({
      ok: false,
      error: 'no application knows this file'
    })
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={onError}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Actions for src/a.ts' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open file' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining('no application knows this file')
      )
    })
  })

  it('confirms a path that was copied', async () => {
    const user = withClipboard()
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Actions for src/a.ts' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copy path' }))
    await user.click(screen.getByRole('button', { name: 'Actions for src/a.ts' }))

    expect(await screen.findByRole('menuitem', { name: 'Path copied' })).toBeInTheDocument()
  })

  it('copies a file’s path', async () => {
    const user = withClipboard()
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Actions for src/a.ts' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copy path' }))

    expect(writeText).toHaveBeenCalledWith('src/a.ts')
  })

  // A refused clipboard is real — an unfocused document is enough — and a click
  // that quietly did nothing is worse than one that says so.
  it('says when the path could not be copied', async () => {
    writeText = vi.fn(() => Promise.reject(new Error('denied')))
    const user = withClipboard()
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Actions for src/a.ts' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copy path' }))
    await user.click(screen.getByRole('button', { name: 'Actions for src/a.ts' }))

    expect(await screen.findByRole('menuitem', { name: 'Could not copy' })).toBeInTheDocument()
  })

  // The menu goes back to offering the action: a row that keeps saying it
  // failed is describing a clipboard that has moved on since.
  it('offers to copy again a moment after a refusal', async () => {
    writeText = vi.fn(() => Promise.reject(new Error('denied')))
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    // `fireEvent` rather than `userEvent` throughout: user-event schedules its
    // own work on the timers this test has taken control of, and the two wait
    // on each other until the runner gives up.
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Actions for src/a.ts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Actions for src/a.ts' }))
    expect(screen.getByRole('menuitem', { name: 'Could not copy' })).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })

    expect(screen.getByRole('menuitem', { name: 'Copy path' })).toBeInTheDocument()
  })
})

describe('reverting one file', () => {
  it('offers a button on each file, named after that file', async () => {
    answer(workspaceDiff([fileDiff('src/a.ts'), fileDiff('src/b.ts')]))
    renderPanel()

    expect(await screen.findByRole('button', { name: /Revert src\/a\.ts/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Revert src\/b\.ts/ })).toBeInTheDocument()
  })

  it('hands the file to the controller and reads the diff again', async () => {
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    const revert = revertController({ revert: vi.fn(() => Promise.resolve(true)) })
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revert}
        onError={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: /Revert src\/a\.ts/ }))

    expect(revert.revert).toHaveBeenCalledWith('src/a.ts', null)
    await waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledTimes(2)
    })
  })

  // A reader who said no has changed nothing, and a refusal has already been
  // reported — re-reading either would be work for a diff that cannot differ.
  it('leaves the diff alone when nothing moved', async () => {
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: /Revert src\/a\.ts/ }))

    expect(octopus().workspaces.diff).toHaveBeenCalledTimes(1)
  })

  // One row, two paths: the far end has to travel with it or the file stays
  // on disk under both names.
  it('carries the old path of a rename', async () => {
    answer(workspaceDiff([fileDiff('moved.ts', { status: 'renamed', oldPath: 'kept.ts' })]))
    const revert = revertController()
    render(
      <DiffPanel
        workspace={anna}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revert}
        onError={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: /Revert moved\.ts/ }))

    expect(revert.revert).toHaveBeenCalledWith('moved.ts', 'kept.ts')
  })
})

/** One conversation in a workspace, as the strip and the marks name them. */
const chat = (id: string, title: string | null = null): WorkspaceChat => ({
  id,
  agent: 'claude',
  title,
  status: 'idle',
  started: true
})

describe('who wrote which file', () => {
  /** A workspace with two conversations, the second having written `src/b.ts`. */
  const shared = workspaceView('anna', {
    chats: [chat('chat-1'), chat('chat-2')],
    writers: { 'src/a.ts': ['chat-1'], 'src/b.ts': ['chat-1', 'chat-2'] }
  })

  const twoFiles = (): ReturnType<typeof workspaceDiff> =>
    workspaceDiff([fileDiff('src/a.ts'), fileDiff('src/b.ts')])

  it('names the conversations that wrote a file, as the tab strip names them', async () => {
    answer(twoFiles())
    renderPanel(shared)

    expect(await screen.findByTitle('Written by Claude 1')).toBeInTheDocument()
    expect(screen.getByTitle('Written by Claude 1, Claude 2')).toBeInTheDocument()
  })

  it('uses the name the reader gave a conversation', async () => {
    answer(twoFiles())
    renderPanel(
      workspaceView('anna', {
        chats: [chat('chat-1', 'Refactor'), chat('chat-2')],
        writers: { 'src/a.ts': ['chat-1'] }
      })
    )

    expect(await screen.findByTitle('Written by Refactor')).toBeInTheDocument()
  })

  /*
   * One conversation per worktree was the whole world until recently, and a
   * mark on every row saying the same name is noise: the question only exists
   * once two of them could have written something.
   */
  it('says nothing where one conversation wrote everything', async () => {
    answer(twoFiles())
    renderPanel(
      workspaceView('anna', { chats: [chat('chat-1')], writers: { 'src/a.ts': ['chat-1'] } })
    )

    expect(await screen.findByRole('button', { name: 'src/a.ts' })).toBeInTheDocument()
    expect(screen.queryByTitle(/Written by/)).not.toBeInTheDocument()
  })

  // The id is what is stored, and an id is not a name.
  it('says nothing for a conversation that has been closed', async () => {
    answer(twoFiles())
    renderPanel(
      workspaceView('anna', {
        chats: [chat('chat-1'), chat('chat-2')],
        writers: { 'src/a.ts': ['chat-gone'] }
      })
    )

    expect(await screen.findByRole('button', { name: 'src/a.ts' })).toBeInTheDocument()
    expect(screen.queryByTitle(/Written by/)).not.toBeInTheDocument()
  })

  it('narrows the list to one conversation, and back', async () => {
    const user = userEvent.setup()
    // A third file nobody here is recorded as having written — edited by hand,
    // or written before any of this was — which is not what was asked for
    // either, so it goes with the rest.
    answer(workspaceDiff([fileDiff('src/a.ts'), fileDiff('src/b.ts'), fileDiff('by-hand.ts')]))
    renderPanel(shared)

    await user.click(await screen.findByRole('button', { name: 'Claude 2' }))

    expect(screen.queryByRole('button', { name: 'src/a.ts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'by-hand.ts' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'src/b.ts' })).toBeInTheDocument()

    // Pressing the chosen one again clears it, which is what makes it a filter
    // rather than a tab.
    await user.click(screen.getByRole('button', { name: 'Claude 2' }))

    expect(screen.getByRole('button', { name: 'src/a.ts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'by-hand.ts' })).toBeInTheDocument()
  })

  it('goes back to everything', async () => {
    const user = userEvent.setup()
    answer(twoFiles())
    renderPanel(shared)

    await user.click(await screen.findByRole('button', { name: 'Claude 2' }))
    await user.click(screen.getByRole('button', { name: 'Everything' }))

    expect(screen.getByRole('button', { name: 'src/a.ts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'src/b.ts' })).toBeInTheDocument()
  })

  /*
   * A filter belongs to the conversation it names. Closing that tab would
   * otherwise leave the list narrowed to an id nothing here has: a short list
   * with no chip pressed to explain it, and nothing to press to get out.
   */
  it('stops narrowing when the conversation it named is closed', async () => {
    const user = userEvent.setup()
    answer(twoFiles())
    const three = {
      chats: [chat('chat-1'), chat('chat-2'), chat('chat-3')],
      writers: { 'src/a.ts': ['chat-1'], 'src/b.ts': ['chat-3'] }
    }
    const { rerender } = render(
      <DiffPanel
        workspace={workspaceView('anna', three)}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Claude 3' }))
    expect(screen.queryByRole('button', { name: 'src/a.ts' })).not.toBeInTheDocument()

    rerender(
      <DiffPanel
        workspace={workspaceView('anna', { ...three, chats: three.chats.slice(0, 2) })}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'src/a.ts' })).toBeInTheDocument()
  })

  // A control that empties the pane whichever chip is pressed.
  it('offers no filter where nothing here is recorded as having written anything', async () => {
    answer(twoFiles())
    renderPanel(workspaceView('anna', { chats: [chat('chat-1'), chat('chat-2')] }))

    expect(await screen.findByRole('button', { name: 'src/a.ts' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Everything' })).not.toBeInTheDocument()
  })
})

/*
 * Where the branch stands against GitHub — the question the pane could not
 * answer at all, because one diff against the merge base folds committed,
 * staged and unstaged work into a single pile.
 */
describe('what has reached GitHub', () => {
  /** A file on each rung, listed in git's order rather than the pane's. */
  function threeRungs(): ReturnType<typeof workspaceDiff> {
    return workspaceDiff(
      [
        fileDiff('src/loose.ts', { publish: 'uncommitted' }),
        fileDiff('src/sent.ts', { publish: 'pushed' }),
        fileDiff('src/held.ts', { publish: 'committed' })
      ],
      { remoteCommit: 'remote01', unpushedCommits: 2 }
    )
  }

  /** The file headers, in the order the column draws them. */
  function order(): string[] {
    return screen
      .getAllByRole('button', { expanded: true })
      .map((button) => button.getAttribute('aria-label') ?? '')
  }

  it('lists what is settled first and what is still in hand last', async () => {
    answer(threeRungs())
    renderPanel()

    await screen.findByRole('button', { name: 'src/sent.ts' })
    expect(order()).toEqual(['src/sent.ts', 'src/held.ts', 'src/loose.ts'])
  })

  /* The assertion that catches an unstable sort: two files on the same rung
     have to come back in the order git listed them, whatever the comparator
     does with a tie. */
  it('keeps git\u2019s own order inside a rung', async () => {
    answer(
      workspaceDiff(
        [
          fileDiff('src/z.ts', { publish: 'committed' }),
          fileDiff('src/sent.ts', { publish: 'pushed' }),
          fileDiff('src/a.ts', { publish: 'committed' })
        ],
        { remoteCommit: 'remote01', unpushedCommits: 1 }
      )
    )
    renderPanel()

    await screen.findByRole('button', { name: 'src/sent.ts' })
    expect(order()).toEqual(['src/sent.ts', 'src/z.ts', 'src/a.ts'])
  })

  it('counts the files on each rung and offers to send what is committed', async () => {
    answer(threeRungs())
    renderPanel()

    expect(await screen.findByText('1 not committed')).toBeInTheDocument()
    expect(screen.getByText('1 committed')).toBeInTheDocument()
    expect(screen.getByText('1 pushed')).toBeInTheDocument()
    expect(screen.getByText('2 commits not pushed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push' })).toBeInTheDocument()
    // And not the sentence for a branch that has no copy on the remote.
    expect(screen.queryByText('This branch is not on GitHub yet.')).not.toBeInTheDocument()
  })

  it('marks each file with how far its change has got', async () => {
    answer(threeRungs())
    renderPanel()

    await screen.findByRole('button', { name: 'src/sent.ts' })
    // Twice each: once on the file's own row, once in the strip above with a
    // count beside it. That is what makes the strip the legend for the rows
    // rather than a second vocabulary to learn.
    expect(screen.getAllByTitle(/Not committed/)).toHaveLength(2)
    expect(screen.getAllByTitle(/not on GitHub yet/)).toHaveLength(2)
    expect(screen.getAllByTitle(/nothing here is newer/)).toHaveLength(2)
  })

  it('warns about a file the request still shows an older version of', async () => {
    answer(
      workspaceDiff([fileDiff('src/a.ts', { publish: 'committed', staleOnRemote: true })], {
        remoteCommit: 'remote01',
        unpushedCommits: 1
      })
    )
    renderPanel()

    expect(await screen.findByText('1 file is out of date in the request')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /older version of this file/ })).toBeInTheDocument()
  })

  it('says a branch is not on GitHub at all, and still offers to send it', async () => {
    answer(
      workspaceDiff([fileDiff('src/a.ts', { publish: 'committed' })], {
        remoteCommit: null,
        unpushedCommits: 1
      })
    )
    renderPanel()

    expect(await screen.findByText(/not on GitHub yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push' })).toBeInTheDocument()
  })

  // Pushing publishes nothing that has not been committed, and choosing a
  // commit message belongs to the pull request pane, which has a field for it.
  it('offers nothing to press when nothing has been committed at all', async () => {
    answer(
      workspaceDiff([fileDiff('src/a.ts', { publish: 'uncommitted' })], {
        remoteCommit: null,
        unpushedCommits: 0
      })
    )
    renderPanel()

    expect(
      await screen.findByText('Nothing is committed yet, so there is nothing to push.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Push' })).not.toBeInTheDocument()
  })

  /* The everyday state a single sentence for zero got wrong: the branch is
     pushed and one file has been edited since, so "nothing is committed yet"
     stood beside a "2 pushed" badge contradicting it. The count means
     different things either side of a remote copy. */
  it('says what a zero means on a branch that has been pushed', async () => {
    answer(
      workspaceDiff(
        [
          fileDiff('src/sent.ts', { publish: 'pushed' }),
          fileDiff('src/also.ts', { publish: 'pushed' }),
          fileDiff('src/loose.ts', { publish: 'uncommitted' })
        ],
        { remoteCommit: 'remote01', unpushedCommits: 0, nothingToSend: false }
      )
    )
    renderPanel()

    expect(
      await screen.findByText('Everything committed is already on GitHub.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/is committed yet/)).not.toBeInTheDocument()
  })

  /* A project needs a repository, a commit and a base branch — never a remote.
     A permanent band about GitHub over a local-only project is one that can
     never come true and cannot be dismissed. */
  it('says nothing about GitHub for a project that has no remote', async () => {
    answer(
      workspaceDiff([fileDiff('src/a.ts', { publish: 'committed' })], {
        remoteCommit: null,
        hasRemote: false,
        unpushedCommits: 2,
        nothingToSend: false
      })
    )
    renderPanel()

    expect(await screen.findByText('1 committed')).toBeInTheDocument()
    expect(screen.queryByText(/GitHub/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Push' })).not.toBeInTheDocument()
  })

  /* Nothing left to send is a fact about the branch, not a count of the rows.
     A commit whose tree matches the remote — an amend — leaves every file on
     the pushed rung with a commit still to go. */
  it('still offers to push when every file is pushed and a commit is not', async () => {
    answer(
      workspaceDiff([fileDiff('src/a.ts', { publish: 'pushed' })], {
        remoteCommit: 'remote01',
        unpushedCommits: 1,
        nothingToSend: false
      })
    )
    renderPanel()

    expect(await screen.findByText('1 commit not pushed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push' })).toBeInTheDocument()
    expect(screen.queryByText('Everything here is on GitHub.')).not.toBeInTheDocument()
  })

  /* Whether anything is left to send is a fact about the branch, not a count
     of the rows. Reverting a pushed file takes it out of the diff entirely —
     the pane's own control does this — while leaving work the remote has not
     got, and counting `pushed` rows called that "everything is on GitHub". */
  it('does not claim everything is sent when a change left the diff', async () => {
    answer(
      workspaceDiff([fileDiff('src/b.ts', { publish: 'pushed' })], {
        remoteCommit: 'remote01',
        unpushedCommits: 0,
        nothingToSend: false
      })
    )
    renderPanel()

    expect(await screen.findByRole('button', { name: 'src/b.ts' })).toBeInTheDocument()
    expect(screen.queryByText('Everything here is on GitHub.')).not.toBeInTheDocument()
    // And the badges stay, since there is still something to tell apart.
    expect(screen.getAllByTitle(/nothing here is newer/).length).toBeGreaterThan(0)
  })

  /* The skew is on purpose. With `unpushedCommits` at zero, removing the
     suppression would take Push away by itself and this would stay green over a
     pane that had gone back to asserting — so the fixture carries the state a
     real workspace on another branch produces: no copy in the comparison, and
     commits since the base on whatever is checked out. */
  it('says nothing about GitHub while HEAD is not on the workspace’s branch', async () => {
    answer(
      workspaceDiff(
        [
          fileDiff('src/a.ts', { publish: 'committed' }),
          fileDiff('src/b.ts', { publish: 'uncommitted' })
        ],
        {
          headOnBranch: false,
          remoteCommit: null,
          unpushedCommits: 2,
          nothingToSend: false
        }
      )
    )
    renderPanel()

    expect(await screen.findByText(/HEAD is not on this workspace’s branch/)).toBeInTheDocument()
    expect(screen.queryByText('This branch is not on GitHub yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('2 commits not pushed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Push' })).not.toBeInTheDocument()
  })

  // A rung is a claim about the branch too, so the rows lose theirs with it.
  it('draws no rung on a row either while HEAD is elsewhere', async () => {
    answer(
      workspaceDiff([fileDiff('src/a.ts', { publish: 'committed' })], {
        headOnBranch: false,
        remoteCommit: null,
        unpushedCommits: 2,
        nothingToSend: false
      })
    )
    renderPanel()

    await screen.findByRole('button', { name: 'src/a.ts' })
    expect(screen.queryByTitle(/not on GitHub yet/)).not.toBeInTheDocument()
    expect(screen.queryByText('1 committed')).not.toBeInTheDocument()
  })

  /* The one state where the strip says everything: a mark on every row would
     repeat it, which is the rule the writers mark already keeps. */
  it('says so once and marks nothing when everything is on GitHub', async () => {
    answer(workspaceDiff([fileDiff('src/a.ts')], { unpushedCommits: 0 }))
    renderPanel()

    expect(await screen.findByText('Everything here is on GitHub.')).toBeInTheDocument()
    expect(screen.queryByTitle(/nothing here is newer/)).not.toBeInTheDocument()
  })

  it('sends the branch and reads the pane again', async () => {
    const user = userEvent.setup()
    answer(threeRungs())
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Push' }))

    expect(octopus().workspaces.push).toHaveBeenCalledWith(anna.id)
    await waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledTimes(2)
    })
  })

  /* The counts answer "where does this branch stand", which a chip does not
     change. Counted over what a chip left on screen instead, pressing the chip
     of a conversation whose files are all pushed emptied the whole feature. */
  it('counts the whole branch, not what a conversation filter left on screen', async () => {
    const user = userEvent.setup()
    answer(
      workspaceDiff(
        [
          fileDiff('src/mine.ts', { publish: 'pushed' }),
          fileDiff('src/theirs.ts', { publish: 'uncommitted' })
        ],
        { remoteCommit: 'remote01', unpushedCommits: 1, nothingToSend: false }
      )
    )
    renderPanel(
      workspaceView('anna', {
        chats: [chat('chat-1'), chat('chat-2')],
        writers: { 'src/mine.ts': ['chat-1'], 'src/theirs.ts': ['chat-2'] }
      })
    )

    await user.click(await screen.findByRole('button', { name: 'Claude 1' }))

    expect(screen.queryByRole('button', { name: 'src/theirs.ts' })).not.toBeInTheDocument()
    expect(screen.getByText('1 pushed')).toBeInTheDocument()
    expect(screen.getByText('1 not committed')).toBeInTheDocument()
  })

  /* This pane is never remounted when the workspace changes, so a push left in
     flight used to disable the next workspace's button and then land that
     workspace's file list in the pane the reader had moved to. */
  it('leaves a workspace the reader has moved on from alone when a push returns', async () => {
    const user = userEvent.setup()
    answer(
      workspaceDiff([fileDiff('src/a.ts', { publish: 'committed' })], {
        remoteCommit: 'remote01',
        unpushedCommits: 1,
        nothingToSend: false
      })
    )

    let release: () => void = vi.fn()
    vi.mocked(octopus().workspaces.push).mockReturnValue(
      new Promise((resolve) => {
        release = () => {
          resolve({ ok: true, value: undefined })
        }
      })
    )

    const { rerender } = render(
      <DiffPanel
        workspace={anna}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Push' }))
    expect(screen.getByRole('button', { name: 'Pushing…' })).toBeDisabled()

    rerender(
      <DiffPanel
        workspace={bob}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={vi.fn()}
      />
    )

    // The second workspace is not the one being pushed, so its own button works.
    expect(await screen.findByRole('button', { name: 'Push' })).toBeEnabled()

    const readsBefore = vi.mocked(octopus().workspaces.diff).mock.calls.length
    await act(async () => {
      release()
      await Promise.resolve()
    })

    // And the first workspace's re-read never lands in the pane showing the second.
    expect(octopus().workspaces.diff).toHaveBeenCalledTimes(readsBefore)
  })

  it('says what went wrong rather than leaving a press that did nothing', async () => {
    const user = userEvent.setup()
    const onError = vi.fn()
    answer(threeRungs())
    vi.mocked(octopus().workspaces.push).mockResolvedValue({
      ok: false,
      code: 'pushFailed',
      params: { branch: 'octopus/anna' },
      error: 'Could not push the branch.'
    })

    render(
      <DiffPanel
        workspace={anna}
        visible
        view="unified"
        onView={vi.fn()}
        width={WIDE}
        comments={commentController()}
        revert={revertController()}
        onError={onError}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Push' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalled()
    })
  })
})
