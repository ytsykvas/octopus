import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NOTES_LIMIT } from '@core/notes.js'

import { octopus } from '../test/octopus.js'
import { NotesPanel } from './NotesPanel.js'

function renderNotes(
  options: { readonly workspaceId?: string | null; readonly notes?: string } = {}
): ReturnType<typeof render> {
  return render(
    <NotesPanel
      workspaceId={options.workspaceId === undefined ? 'planner/anna' : options.workspaceId}
      notes={options.notes ?? ''}
    />
  )
}

const field = (): HTMLElement => screen.getByLabelText('Notes')

describe('a note about one workspace', () => {
  it('shows what is stored', () => {
    renderNotes({ notes: 'check the migration' })

    expect(field()).toHaveValue('check the migration')
  })

  it('says what it is for, and that the agent is not reading it', () => {
    renderNotes()

    expect(field()).toHaveAttribute(
      'placeholder',
      'A line to yourself about this workspace. The agent never reads it.'
    )
  })

  it('asks for a workspace when none is chosen', () => {
    renderNotes({ workspaceId: null })

    expect(screen.getByText('Choose a workspace to write a note about it.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument()
  })
})

describe('saving itself', () => {
  /*
   * A note headed "so I do not forget" behind a Save button somebody forgets to
   * press is a note that was not written. Once per pause, not once per
   * keystroke: `commit` rewrites the whole state file on every call.
   */
  it('writes once after the typing stops, not once per letter', async () => {
    const user = userEvent.setup()
    renderNotes()

    await user.type(field(), 'abcd')
    // Four keystrokes in, and nothing written: the pause has not passed.
    expect(octopus().workspaces.setNotes).not.toHaveBeenCalled()

    await waitFor(
      () => {
        expect(octopus().workspaces.setNotes).toHaveBeenCalledExactlyOnceWith(
          'planner/anna',
          'abcd'
        )
      },
      { timeout: 2_000 }
    )
  })

  // Leaving the field is as clear a "that is what I meant" as stopping typing.
  it('writes at once when the field is left', async () => {
    const user = userEvent.setup()
    renderNotes()

    await user.type(field(), 'quick')
    await user.tab()

    await waitFor(() => {
      expect(octopus().workspaces.setNotes).toHaveBeenCalledWith('planner/anna', 'quick')
    })
  })

  // Writing an unchanged note would rewrite the whole state file to store what
  // it already holds.
  it('writes nothing when the note has not changed', async () => {
    const user = userEvent.setup()
    renderNotes({ notes: 'as it was' })

    await user.click(field())
    await user.tab()

    expect(octopus().workspaces.setNotes).not.toHaveBeenCalled()
  })

  /*
   * The test worth having most. The panel is remounted per workspace by its
   * caller's key, and the flush on the way out is what makes a debounce still
   * counting down safe — an editor that loads against one target and saves a
   * moment later writes the old text into the newly chosen one, which is the
   * trap this repository already recorded once in the env editor.
   */
  it('writes what was typed against the workspace it was typed in', async () => {
    const user = userEvent.setup()
    const { unmount } = renderNotes({ workspaceId: 'planner/anna' })

    await user.type(field(), 'about anna')
    // Mid-pause, exactly as switching workspace would arrive.
    unmount()

    /*
     * Inside a window far shorter than the pause, which is what makes this
     * about the flush rather than about the timer. Left to run out, the
     * debounce would write the same thing and the test would pass with the
     * flush deleted — it did, until this timeout was put on it.
     */
    await waitFor(
      () => {
        expect(octopus().workspaces.setNotes).toHaveBeenCalledExactlyOnceWith(
          'planner/anna',
          'about anna'
        )
      },
      { timeout: 100 }
    )
  })

  it('says why a note could not be written, and tries again next time', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().workspaces.setNotes).mockResolvedValue({
      ok: false,
      error: 'no',
      code: 'libraryMissing'
    })
    renderNotes()

    await user.type(field(), 'first')
    await user.tab()

    expect(await screen.findByText('That file is not there any more.')).toBeInTheDocument()

    // Put back rather than believed stored: the same text saves again rather
    // than being skipped as unchanged.
    await user.click(field())
    await user.tab()

    await waitFor(() => {
      expect(octopus().workspaces.setNotes).toHaveBeenCalledTimes(2)
    })
  })
})

describe('the ceiling', () => {
  /*
   * The field refuses the character rather than the save refusing the message.
   * Without this somebody types on into a note that will not be kept and finds
   * out from a red line afterwards — the boundary parse still refuses it, but a
   * boundary is not a place to learn.
   */
  it('will not take a character past the limit', () => {
    renderNotes()

    expect(field()).toHaveAttribute('maxlength', String(NOTES_LIMIT))
  })

  // A count standing over a scratchpad all day is noise about a limit almost
  // nobody meets.
  it('says nothing about the limit while it is far away', () => {
    renderNotes({ notes: 'short' })

    expect(screen.queryByText(/characters left/)).not.toBeInTheDocument()
  })

  it('counts down as the limit comes close', () => {
    renderNotes({ notes: 'x'.repeat(NOTES_LIMIT - 12) })

    expect(screen.getByText('12 characters left')).toBeInTheDocument()
  })
})
