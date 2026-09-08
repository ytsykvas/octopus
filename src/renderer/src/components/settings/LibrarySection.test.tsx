import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LibraryEntry } from '@core/library.js'
import type { LibraryKind } from '@core/libraryNames.js'

import { stubDialogElement } from '../../test/dialog.js'
import { octopus } from '../../test/octopus.js'
import { LibrarySection } from './LibrarySection.js'

// The editor, the import and the removal question are all `Modal`s.
beforeAll(stubDialogElement)

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    kind: 'command',
    name: 'ship',
    description: 'Commits and pushes.',
    path: '/data/skills/.claude/commands/ship.md',
    ...overrides
  }
}

const holding = (entries: readonly LibraryEntry[]): void => {
  vi.mocked(octopus().library.list).mockResolvedValue({ ok: true, value: [...entries] })
}

async function renderSection(
  options: { readonly kind?: LibraryKind; readonly project?: boolean } = {}
): Promise<void> {
  render(
    <LibrarySection
      store={
        options.project === true ? { kind: 'project', projectId: 'planner' } : { kind: 'global' }
      }
      kind={options.kind ?? 'command'}
    />
  )

  await waitFor(() => {
    expect(octopus().library.list).toHaveBeenCalled()
  })
}

beforeEach(() => {
  holding([])
})

describe('the commands one store holds', () => {
  it('names what the store reaches, so the two sections are not read as one', async () => {
    await renderSection()

    expect(screen.getByText(/Typed after a slash in any conversation/)).toBeInTheDocument()
  })

  it('says so differently for a project of its own', async () => {
    await renderSection({ project: true })

    expect(
      screen.getByText(/Typed after a slash in this project\u2019s conversations/)
    ).toBeInTheDocument()
  })

  it('says so differently for a project of its own, whichever kind', async () => {
    await renderSection({ kind: 'subagent', project: true })

    expect(screen.getByText(/Helpers the agent reaches for in this project/)).toBeInTheDocument()
  })

  it('names the subagents of the installation as reaching everywhere', async () => {
    await renderSection({ kind: 'subagent' })

    expect(screen.getByText(/Helpers the agent reaches for on its own/)).toBeInTheDocument()
  })

  it('reads the store it was given', async () => {
    await renderSection({ project: true })

    expect(octopus().library.list).toHaveBeenCalledWith(
      { kind: 'project', projectId: 'planner' },
      'command'
    )
  })

  /*
   * The slash is drawn rather than stored: the file is `ship.md` and the name
   * is `ship`, but what the reader types is `/ship`, and a list of bare words
   * says nothing about how to use them.
   */
  it('draws a command as it is typed', async () => {
    holding([entry()])
    await renderSection()

    expect(await screen.findByText('/ship')).toBeInTheDocument()
    expect(screen.getByText('Commits and pushes.')).toBeInTheDocument()
  })

  // A subagent is never typed, so a slash in front of one would be a lie.
  it('draws a subagent by its bare name', async () => {
    holding([entry({ kind: 'subagent', name: 'reviewer' })])
    await renderSection({ kind: 'subagent' })

    expect(await screen.findByText('reviewer')).toBeInTheDocument()
    expect(screen.queryByText('/reviewer')).not.toBeInTheDocument()
  })

  it('says so when there is nothing here', async () => {
    await renderSection({ kind: 'subagent' })

    expect(screen.getByText('No subagents here yet.')).toBeInTheDocument()
  })

  /*
   * The visible difference from the skills beside them. A skill can be turned
   * off for one conversation because the SDK takes an override for it; neither
   * of these has one, so a switch here would be a control that did nothing.
   */
  it('offers no switch, because there is nothing to switch', async () => {
    holding([entry()])
    await renderSection()

    await screen.findByText('/ship')
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('reports a failure to read', async () => {
    vi.mocked(octopus().library.list).mockResolvedValue({
      ok: false,
      error: 'nope',
      code: 'libraryMissing'
    })
    await renderSection()

    expect(await screen.findByText('That file is not there any more.')).toBeInTheDocument()
  })
})

describe('editing one', () => {
  it('opens the document that is on disk, not the row', async () => {
    const user = userEvent.setup()
    holding([entry()])
    vi.mocked(octopus().library.read).mockResolvedValue({
      ok: true,
      value: {
        kind: 'command',
        name: 'ship',
        description: '',
        body: 'Commit and push.',
        raw: 'Commit and push.',
        path: '/x/ship.md'
      }
    })
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

    expect(octopus().library.read).toHaveBeenCalledWith({ kind: 'global' }, 'command', 'ship')
    expect(await screen.findByDisplayValue('Commit and push.')).toBeInTheDocument()
  })

  it('saves over what is there', async () => {
    const user = userEvent.setup()
    holding([entry()])
    vi.mocked(octopus().library.read).mockResolvedValue({
      ok: true,
      value: {
        kind: 'command',
        name: 'ship',
        description: '',
        body: 'Commit.',
        raw: 'Commit.',
        path: '/x/ship.md'
      }
    })
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const field = await screen.findByDisplayValue('Commit.')
    await user.clear(field)
    await user.type(field, 'Commit and push.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(octopus().library.save).toHaveBeenCalledWith(
        { kind: 'global' },
        'command',
        'ship',
        'Commit and push.'
      )
    })
  })

  // Creating writes through a different call, and it is the one that refuses a
  // name already taken.
  it('creates through the call that refuses a name already here', async () => {
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: /New command/ }))
    await user.type(screen.getByLabelText('Name'), 'gate')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(octopus().library.create).toHaveBeenCalledWith(
        { kind: 'global' },
        'command',
        'gate',
        expect.stringContaining('$ARGUMENTS')
      )
    })
    expect(octopus().library.save).not.toHaveBeenCalled()
  })

  /*
   * A subagent's template carries frontmatter and a command's does not, and
   * that is deliberate: a command is its prompt, and inventing YAML for it
   * would teach a shape Claude Code never asks for.
   */
  it('starts a subagent with the frontmatter it cannot work without', async () => {
    const user = userEvent.setup()
    await renderSection({ kind: 'subagent' })

    await user.click(screen.getByRole('button', { name: /New subagent/ }))

    expect(screen.getByLabelText('Document')).toHaveDisplayValue(/description:/)
  })

  it('refuses a name that cannot be a file, before anything is sent', async () => {
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: /New command/ }))
    await user.type(screen.getByLabelText('Name'), 'Ship It')

    expect(
      screen.getByText('Use lowercase letters, digits, dashes and underscores.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('refuses a name already on the list', async () => {
    const user = userEvent.setup()
    holding([entry()])
    await renderSection()

    await screen.findByText('/ship')
    await user.click(screen.getByRole('button', { name: /New command/ }))
    await user.type(screen.getByLabelText('Name'), 'ship')

    expect(screen.getByText('Something of this name is already here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('renaming one', () => {
  it('asks for the new name and moves it', async () => {
    const user = userEvent.setup()
    holding([entry()])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const field = await screen.findByLabelText(/New name/)
    await user.clear(field)
    await user.type(field, 'gate')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(octopus().library.rename).toHaveBeenCalledWith(
        { kind: 'global' },
        'command',
        'ship',
        'gate'
      )
    })
  })

  // The rule core applies, asked as it is typed: a round trip spent on a name
  // it will refuse says nothing that could not be said here.
  it('refuses a name that cannot be a file without asking core', async () => {
    const user = userEvent.setup()
    holding([entry()])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))

    const field = await screen.findByLabelText(/New name/)
    await user.clear(field)
    await user.type(field, 'Ship It')

    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
    expect(octopus().library.rename).not.toHaveBeenCalled()
  })

  it('does nothing when the name comes back unchanged', async () => {
    const user = userEvent.setup()
    holding([entry()])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.click(await screen.findByRole('button', { name: 'Rename' }))

    expect(octopus().library.rename).not.toHaveBeenCalled()
  })

  it('does nothing when the question is cancelled', async () => {
    const user = userEvent.setup()
    holding([entry()])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(octopus().library.rename).not.toHaveBeenCalled()
  })
})

describe('removing one', () => {
  it('asks first, and removes when the answer is yes', async () => {
    const user = userEvent.setup()
    holding([entry()])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(octopus().library.remove).toHaveBeenCalledWith({ kind: 'global' }, 'command', 'ship')
    })
  })

  it('removes nothing when the answer is no', async () => {
    const user = userEvent.setup()
    holding([entry()])
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(octopus().library.remove).not.toHaveBeenCalled()
  })
})

/** Every write refused with the same coded failure, to read it back in words. */
const refused = {
  ok: false as const,
  error: 'no',
  code: 'libraryExists',
  params: { name: 'ship' }
}
const REFUSAL = 'Something called \u201cship\u201d is already here, or in the store beside it.'

describe('a refusal from the store', () => {
  it('keeps the editor open and says why', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().library.create).mockResolvedValue(refused)
    await renderSection()

    await user.click(screen.getByRole('button', { name: /New command/ }))
    await user.type(screen.getByLabelText('Name'), 'ship')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Still open: a dialog that closed on a refusal would take the text with it.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    })
  })

  it('is drawn once the editor is out of the way', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().library.create).mockResolvedValue(refused)
    await renderSection()

    await user.click(screen.getByRole('button', { name: /New command/ }))
    await user.type(screen.getByLabelText('Name'), 'ship')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument()
  })

  it('is drawn when a save is refused', async () => {
    const user = userEvent.setup()
    holding([entry()])
    vi.mocked(octopus().library.read).mockResolvedValue({
      ok: true,
      value: {
        kind: 'command',
        name: 'ship',
        description: '',
        body: 'Commit.',
        raw: 'Commit.',
        path: '/x/ship.md'
      }
    })
    vi.mocked(octopus().library.save).mockResolvedValue(refused)
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument()
  })

  it('is drawn when a rename is refused', async () => {
    const user = userEvent.setup()
    holding([entry()])
    vi.mocked(octopus().library.rename).mockResolvedValue(refused)
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const field = await screen.findByLabelText(/New name/)
    await user.clear(field)
    await user.type(field, 'gate')
    await user.click(screen.getByRole('button', { name: 'Rename' }))

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument()
  })

  it('is drawn when a removal is refused', async () => {
    const user = userEvent.setup()
    holding([entry()])
    vi.mocked(octopus().library.remove).mockResolvedValue(refused)
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(await screen.findByText(REFUSAL)).toBeInTheDocument()
  })

  it('leaves the row alone when the document cannot be opened', async () => {
    const user = userEvent.setup()
    holding([entry()])
    vi.mocked(octopus().library.read).mockResolvedValue(refused)
    await renderSection()

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

    expect(screen.queryByLabelText('Document')).not.toBeInTheDocument()
  })
})

describe('the import dialog', () => {
  it('opens, reads and writes through the call that refuses a name in use', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().library.inspect).mockResolvedValue({
      ok: true,
      value: { name: 'ship', description: 'Commits.', text: 'Commit and push.' }
    })
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Import…' }))
    await user.click(screen.getByRole('radio', { name: 'Paste' }))
    await user.type(screen.getByLabelText('Paste'), 'Commit and push.')
    await user.click(screen.getByRole('button', { name: 'Read it' }))
    await user.click(await screen.findByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(octopus().library.create).toHaveBeenCalledWith(
        { kind: 'global' },
        'command',
        'ship',
        'Commit and push.'
      )
    })
  })

  it('reads through the kind it belongs to', async () => {
    const user = userEvent.setup()
    await renderSection({ kind: 'subagent' })

    await user.click(screen.getByRole('button', { name: 'Import…' }))
    await user.click(screen.getByRole('radio', { name: 'Paste' }))
    await user.type(screen.getByLabelText('Paste'), 'x')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    expect(octopus().library.inspect).toHaveBeenCalledWith('subagent', { kind: 'text', text: 'x' })
  })

  it('closes without writing anything', async () => {
    const user = userEvent.setup()
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Import…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('button', { name: 'Read it' })).not.toBeInTheDocument()
    expect(octopus().library.create).not.toHaveBeenCalled()
  })

  it('says why a read failed, in the dialog rather than behind it', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().library.inspect).mockResolvedValue({
      ok: false,
      error: 'no',
      code: 'libraryUrlRefused',
      params: { url: 'https://e.test/x.md' }
    })
    await renderSection()

    await user.click(screen.getByRole('button', { name: 'Import…' }))
    await user.click(screen.getByRole('radio', { name: 'From a link' }))
    await user.type(screen.getByLabelText('Address'), 'https://e.test/x.md')
    await user.click(screen.getByRole('button', { name: 'Read it' }))

    expect(await screen.findByText(/could not be read/)).toBeInTheDocument()
  })
})

/*
 * The list is re-read after every write rather than patched from the answer,
 * because disk is the thing being edited. So the re-read can fail on its own,
 * after a write that worked.
 */
describe('a re-read that fails after a write that did not', () => {
  it('says why, rather than leaving the old list looking current', async () => {
    const user = userEvent.setup()
    vi.mocked(octopus().library.list)
      .mockResolvedValueOnce({ ok: true, value: [entry()] })
      .mockResolvedValue({ ok: false, error: 'no', code: 'libraryMissing' })
    render(<LibrarySection store={{ kind: 'global' }} kind="command" />)

    await user.click(await screen.findByRole('button', { name: 'What to do with ship' }))
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('That file is not there any more.')).toBeInTheDocument()
  })
})
