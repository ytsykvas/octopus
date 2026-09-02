import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FileEditor } from './FileEditor.js'

type EditorProps = React.ComponentProps<typeof FileEditor>

/**
 * A `read` the test settles by hand, standing in for slow IPC.
 *
 * Every call gets the same promise, so an effect that runs twice still leaves
 * nothing pending once the test settles it.
 */
function deferredRead(): {
  read: EditorProps['read']
  /** Answers the pending read, and returns once the editor has taken it in. */
  settle: (contents: string | null) => Promise<void>
} {
  let land: (contents: string | null) => void = () => undefined
  const answer = new Promise<string | null>((resolve) => {
    land = resolve
  })

  return {
    read: () => answer,
    settle: async (contents) => {
      land(contents)
      // Awaiting the very promise the editor is awaiting lands this after its
      // own continuation, so whatever it decided to do has already happened.
      await answer
    }
  }
}

function renderEditor(overrides: Partial<EditorProps> = {}): {
  read: EditorProps['read']
  save: EditorProps['save']
} {
  const props: EditorProps = {
    label: 'Setup script',
    hint: 'Runs once, when the workspace is created',
    placeholder: '#!/bin/sh',
    read: vi.fn(() => Promise.resolve('template')),
    save: vi.fn(() => Promise.resolve({ ok: true as const, value: undefined })),
    ...overrides
  }

  render(<FileEditor {...props} />)
  return { read: props.read, save: props.save }
}

describe('FileEditor', () => {
  it('shows the contents the read callback returns, down to the trailing newline', async () => {
    renderEditor({ read: () => Promise.resolve('#!/bin/sh\nnpm install\n') })

    const field = screen.getByRole('textbox')
    await waitFor(() => {
      expect(field).toHaveValue('#!/bin/sh\nnpm install\n')
    })
  })

  it('saves the edited text when the field loses focus', async () => {
    const user = userEvent.setup()
    const { save } = renderEditor()

    const field = await screen.findByDisplayValue('template')
    await user.clear(field)
    await user.type(field, 'npm ci')
    await user.tab()

    expect(save).toHaveBeenCalledExactlyOnceWith('npm ci')
  })

  // A file that exists is one the app treats as configured, so a template
  // someone only looked at must not be written to disk.
  it('writes nothing when the template is left untouched', async () => {
    const user = userEvent.setup()
    const { save } = renderEditor()

    const field = await screen.findByDisplayValue('template')
    await user.click(field)
    await user.tab()

    expect(save).not.toHaveBeenCalled()
  })

  it('writes nothing when the text is edited back to what was loaded', async () => {
    const user = userEvent.setup()
    const { save } = renderEditor()

    const field = await screen.findByDisplayValue('template')
    await user.clear(field)
    await user.type(field, 'template')
    await user.tab()

    expect(save).not.toHaveBeenCalled()
  })

  it('writes once when the field is left and re-entered without further edits', async () => {
    const user = userEvent.setup()
    const { save } = renderEditor()

    const field = await screen.findByDisplayValue('template')
    await user.clear(field)
    await user.type(field, 'npm ci')
    await user.tab()

    await user.click(field)
    await user.tab()

    expect(save).toHaveBeenCalledExactlyOnceWith('npm ci')
  })

  it('saves again once the text changes after a save', async () => {
    const user = userEvent.setup()
    const { save } = renderEditor()

    const field = await screen.findByDisplayValue('template')
    await user.clear(field)
    await user.type(field, 'npm ci')
    await user.tab()

    await user.click(field)
    await user.type(field, ' --silent')
    await user.tab()

    expect(save).toHaveBeenLastCalledWith('npm ci --silent')
    expect(save).toHaveBeenCalledTimes(2)
  })

  /*
   * A refusal used to look exactly like a success. The prop returned `void`,
   * so the `Result` main had already built — with a code and the reason in it —
   * had nowhere to go, and `commit` marked the body saved before calling it.
   * No error, no warning, and the field stopped offering to try again.
   */
  it('says why a save was refused, and stays dirty so the next blur retries', async () => {
    const user = userEvent.setup()
    const save = vi.fn(() => Promise.resolve({ ok: false as const, error: 'too long' }))
    renderEditor({ save })

    const field = await screen.findByDisplayValue('template')
    await user.clear(field)
    await user.type(field, 'npm ci')
    await user.tab()

    expect(await screen.findByText(/too long/)).toBeInTheDocument()

    await user.click(field)
    await user.tab()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('clears the complaint once a save goes through', async () => {
    const user = userEvent.setup()
    const save = vi
      .fn<(contents: string) => Promise<{ ok: boolean; error?: string; value?: undefined }>>()
      .mockResolvedValueOnce({ ok: false, error: 'too long' })
      .mockResolvedValue({ ok: true, value: undefined })
    renderEditor({ save: save as unknown as EditorProps['save'] })

    const field = await screen.findByDisplayValue('template')
    await user.clear(field)
    await user.type(field, 'npm ci')
    await user.tab()
    expect(await screen.findByText(/too long/)).toBeInTheDocument()

    await user.click(field)
    await user.type(field, ' --silent')
    await user.tab()

    await waitFor(() => {
      expect(screen.queryByText(/too long/)).not.toBeInTheDocument()
    })
  })

  // A read that yields nothing means the file could not be read at all;
  // treating that as an empty file would offer to overwrite it with nothing.
  it('leaves the field empty and saves nothing when the file cannot be read', async () => {
    const user = userEvent.setup()
    const { read, save } = renderEditor({ read: vi.fn(() => Promise.resolve(null)) })

    await waitFor(() => {
      expect(read).toHaveBeenCalled()
    })

    const field = screen.getByRole('textbox')
    expect(field).toHaveValue('')

    await user.click(field)
    await user.tab()
    expect(save).not.toHaveBeenCalled()
  })

  // The same read, only slow: by the time it answers there is typing to protect,
  // and emptying the field would throw away work the user can no longer recover.
  it('keeps what was typed while a read that yields nothing was in flight', async () => {
    const user = userEvent.setup()
    const pending = deferredRead()
    const { save } = renderEditor({ read: pending.read })

    const field = screen.getByRole('textbox')
    await user.click(field)
    await user.type(field, 'npm ci')

    await act(() => pending.settle(null))

    expect(field).toHaveValue('npm ci')

    await user.tab()
    expect(save).toHaveBeenCalledExactlyOnceWith('npm ci')
  })

  it('ignores a read that lands after the editor moved on to another file', async () => {
    const stale = deferredRead()
    const save = vi.fn()

    const { rerender } = render(
      <FileEditor label="Setup script" hint="Runs once" read={stale.read} save={save} />
    )
    rerender(
      <FileEditor
        label="Run script"
        hint="Starts the dev server"
        read={() => Promise.resolve('run body')}
        save={save}
      />
    )
    expect(await screen.findByDisplayValue('run body')).toBeInTheDocument()

    // The first file finally answers, long after the editor stopped showing it.
    await act(() => stale.settle('setup body'))

    expect(screen.getByRole('textbox')).toHaveValue('run body')
  })

  it('suggests the shape of the file through a placeholder while it is empty', async () => {
    renderEditor({ read: () => Promise.resolve(null), placeholder: '#!/bin/sh' })

    expect(await screen.findByPlaceholderText('#!/bin/sh')).toBeInTheDocument()
  })

  it('loads the other file when the editor is pointed at a different one', async () => {
    const save = vi.fn()
    const { rerender } = render(
      <FileEditor
        label="Setup script"
        hint="Runs once"
        read={() => Promise.resolve('setup body')}
        save={save}
      />
    )
    expect(await screen.findByDisplayValue('setup body')).toBeInTheDocument()

    rerender(
      <FileEditor
        label="Run script"
        hint="Starts the dev server"
        read={() => Promise.resolve('run body')}
        save={save}
      />
    )

    expect(await screen.findByDisplayValue('run body')).toBeInTheDocument()
  })

  it('shows the label and the hint it was given', async () => {
    renderEditor()

    expect(await screen.findByText('Setup script')).toBeInTheDocument()
    expect(screen.getByText('Runs once, when the workspace is created')).toBeInTheDocument()
  })
})
