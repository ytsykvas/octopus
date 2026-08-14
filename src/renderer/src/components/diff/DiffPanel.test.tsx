import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { octopus } from '../../test/octopus.js'
import { fileDiff, hunk, workspaceDiff } from '../../test/diff.js'
import { workspaceView } from '../../test/workspaces.js'
import { DiffPanel } from './DiffPanel.js'

// The highlighter is exercised by its own tests. Here it would only break every
// assertion about a line's text into the spans shiki splits it into, and slow
// the suite down loading grammars to prove something about shiki.
vi.mock('./highlight.js', () => ({ highlight: () => Promise.resolve(null) }))

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
    />
  )
}

describe('DiffPanel', () => {
  it('asks for nothing until a workspace is chosen', () => {
    render(<DiffPanel workspace={null} visible view="unified" onView={vi.fn()} width={WIDE} />)

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
    render(<DiffPanel workspace={anna} visible view="unified" onView={onView} width={WIDE} />)

    await user.click(await screen.findByRole('button', { name: 'Side by side' }))

    expect(onView).toHaveBeenCalledWith('split')
  })

  it('pairs the removed line with the one that replaced it', async () => {
    withMonospaceCell(64)
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    render(<DiffPanel workspace={anna} visible view="split" onView={vi.fn()} width={WIDE} />)

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
    render(<DiffPanel workspace={anna} visible view="split" onView={onView} width={WIDE} />)

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
    render(<DiffPanel workspace={anna} visible view="split" onView={vi.fn()} width={WIDE} />)

    // Waits for the measurement: the toggle only offers the way back to one
    // column once the pane has worked out that two of them fit.
    await screen.findByRole('button', { name: 'One column' })

    // Once, not twice: a context line occupies both columns, and an addition
    // with nothing opposite it must not be mistaken for one.
    expect(screen.getAllByText('brand new')).toHaveLength(1)
  })

  // The stored preference is not overwritten by the pane being too narrow:
  // dragging it wide again brings the two columns back.
  it('falls back to one column when the pane is too narrow for two', async () => {
    withMonospaceCell(320)
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    render(<DiffPanel workspace={anna} visible view="split" onView={vi.fn()} width={300} />)

    await screen.findByText('is here now')
    expect(screen.getAllByText('kept')).toHaveLength(1)
    expect(screen.getByRole('button', { name: /too narrow/ })).toBeDisabled()
  })

  it('reads nothing while another tab is showing', () => {
    renderPanel(anna, false)

    expect(octopus().workspaces.diff).not.toHaveBeenCalled()
  })

  it('reads when its tab comes back', async () => {
    const { rerender } = render(
      <DiffPanel workspace={anna} visible={false} view="unified" onView={vi.fn()} width={WIDE} />
    )
    rerender(<DiffPanel workspace={anna} visible view="unified" onView={vi.fn()} width={WIDE} />)

    await waitFor(() => {
      expect(octopus().workspaces.diff).toHaveBeenCalledWith(anna.id)
    })
  })

  it('asks again for another workspace', async () => {
    answer(workspaceDiff([fileDiff('src/a.ts')]))
    const { rerender } = render(
      <DiffPanel workspace={anna} visible view="unified" onView={vi.fn()} width={WIDE} />
    )
    await screen.findByText('is here now')

    rerender(<DiffPanel workspace={bob} visible view="unified" onView={vi.fn()} width={WIDE} />)

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
