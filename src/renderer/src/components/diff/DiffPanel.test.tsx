import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { highlight } from './highlight.js'
import { octopus } from '../../test/octopus.js'
import { fileDiff, hunk, workspaceDiff } from '../../test/diff.js'
import { commentController } from '../../test/comments.js'
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
          onError={vi.fn()}
        />
      )
      return comments
    }

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
      await user.type(screen.getByRole('textbox'), 'call this something else')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith({
        path: 'src/a.ts',
        side: 'new',
        line: 2,
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
      await user.type(screen.getByRole('textbox'), 'why was this dropped?')
      await user.click(screen.getByRole('button', { name: 'Add' }))

      expect(comments.add).toHaveBeenCalledWith({
        path: 'src/a.ts',
        side: 'old',
        line: 2,
        code: 'was here',
        text: 'why was this dropped?'
      })
    })

    it('keeps the line as it was when the note is abandoned', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(screen.getByRole('textbox'), 'never mind')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(comments.add).not.toHaveBeenCalled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
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
          { path: 'src/a.ts', side: 'new', line: 2, code: 'is here now', text: 'rename this' }
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
      await user.type(screen.getByRole('textbox'), 'shorter{Meta>}{Enter}{/Meta}')

      expect(comments.add).toHaveBeenCalledWith(expect.objectContaining({ text: 'shorter' }))
    })

    // Ctrl as well as Command: the same chord on a keyboard that has no Meta.
    it('saves a note with Ctrl and Enter too', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(screen.getByRole('textbox'), 'shorter{Control>}{Enter}{/Control}')

      expect(comments.add).toHaveBeenCalledWith(expect.objectContaining({ text: 'shorter' }))
    })

    // The chord does not consult the button, so the emptiness is checked twice.
    it('sends nothing when the keyboard saves an empty note', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(screen.getByRole('textbox'), '  {Meta>}{Enter}{/Meta}')

      expect(comments.add).not.toHaveBeenCalled()
    })

    it('abandons a note with Escape', async () => {
      const user = userEvent.setup()
      answer(workspaceDiff([fileDiff('src/a.ts')]))
      const comments = renderWithComments()

      await user.click(await screen.findByRole('button', { name: 'Comment on line 2' }))
      await user.type(screen.getByRole('textbox'), 'never mind{Escape}')

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
          onError={vi.fn()}
        />
      )

      // Waits for the measurement: until it lands the pane is still drawing one
      // column, and the row clicked would be unmounted mid-click.
      await screen.findByRole('button', { name: 'One column' })

      await user.click(
        screen.getByRole('button', { name: 'Comment on line 7 of the file as it was' })
      )
      await user.type(screen.getByRole('textbox'), 'why?')
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
