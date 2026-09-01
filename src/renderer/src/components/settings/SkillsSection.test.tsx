import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SkillEntry } from '@core/skills.js'

import { stubDialogElement } from '../../test/dialog.js'
import { held } from '../../test/held.js'
import { octopus } from '../../test/octopus.js'
import { SkillsSection } from './SkillsSection.js'

// The editor, the import and the removal question are all `Modal`s.
beforeAll(stubDialogElement)

function entry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    name: 'review',
    description: 'When reviewing.',
    path: '/data/skills/skills/review',
    ...overrides
  }
}

const holding = (skills: readonly SkillEntry[]): void => {
  vi.mocked(octopus().skills.list).mockResolvedValue({ ok: true, value: [...skills] })
}

interface Rendered {
  readonly onDefaults: ReturnType<typeof vi.fn>
  readonly onCopyToGlobal: ReturnType<typeof vi.fn>
}

async function renderSection(
  options: {
    readonly project?: boolean
    readonly disabled?: readonly string[]
    readonly workspaceId?: string | null
  } = {}
): Promise<Rendered> {
  const onDefaults = vi.fn()
  const onCopyToGlobal = vi.fn().mockResolvedValue(true)

  render(
    <SkillsSection
      store={
        options.project === true ? { kind: 'project', projectId: 'planner' } : { kind: 'global' }
      }
      disabledDefaults={options.disabled ?? []}
      onDefaults={onDefaults}
      workspaceId={options.workspaceId ?? null}
      onCopyToGlobal={onCopyToGlobal}
    />
  )

  await waitFor(() => {
    expect(octopus().skills.list).toHaveBeenCalled()
  })

  return { onDefaults, onCopyToGlobal }
}

beforeEach(() => {
  holding([])
})

describe('the skills one store holds', () => {
  it('names what the store reaches, so the two sections are not read as one', async () => {
    await renderSection()
    expect(screen.getByText('Skills everywhere')).toBeInTheDocument()

    vi.mocked(octopus().skills.list).mockClear()
    await renderSection({ project: true })
    expect(screen.getByText('Skills for this project')).toBeInTheDocument()
  })

  it('says a store is empty rather than showing an empty box', async () => {
    await renderSection()

    expect(screen.getByText('No skills here yet.')).toBeInTheDocument()
  })

  it('lists what is there', async () => {
    holding([entry(), entry({ name: 'ship', description: 'When shipping.' })])

    await renderSection()

    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.getByText('When shipping.')).toBeInTheDocument()
  })

  it('leaves out a description a skill does not have', async () => {
    holding([entry({ description: '' })])

    await renderSection()

    expect(screen.queryByText('When reviewing.')).not.toBeInTheDocument()
  })

  /*
   * The switch is about **new** conversations: this decides what one begins as,
   * the panel in the composer decides what it is. Stored as the keys that are
   * off, so an empty list means every skill is on — which is how Claude Code
   * treats one it discovers.
   */
  it('takes a skill out of the default list, and puts it back', async () => {
    holding([entry()])
    const { onDefaults } = await renderSection()

    await userEvent.click(screen.getByRole('switch', { name: 'On by default' }))

    expect(onDefaults).toHaveBeenCalledExactlyOnceWith(['octopus:review'])
  })

  it('keys the default by the plugin the skill arrives in', async () => {
    holding([entry()])
    const { onDefaults } = await renderSection({ project: true })

    await userEvent.click(screen.getByRole('switch', { name: 'On by default' }))

    expect(onDefaults).toHaveBeenCalledExactlyOnceWith(['octopus-project:review'])
  })

  it('shows a skill already off as off, and turns it back on', async () => {
    holding([entry()])
    const { onDefaults } = await renderSection({ disabled: ['octopus:review'] })

    const control = screen.getByRole('switch', { name: 'On by default' })
    expect(control).not.toBeChecked()

    await userEvent.click(control)

    expect(onDefaults).toHaveBeenCalledExactlyOnceWith([])
  })
})

describe('writing a skill', () => {
  it('creates one, and refuses a name that could not be a folder', async () => {
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'New skill' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Code Review')

    expect(screen.getByText(/lowercase letters/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  // A name already in the store is refused before the write rather than by it:
  // the answer is known here, and a round trip to be told so reads as a fault.
  it('refuses a name the store already holds', async () => {
    holding([entry()])
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'New skill' }))
    await userEvent.type(screen.getByLabelText('Name'), 'review')

    expect(screen.getByText(/already here/)).toBeInTheDocument()
  })

  it('carries the instructions into the write', async () => {
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'New skill' }))
    await userEvent.type(screen.getByLabelText('Name'), 'review')
    await userEvent.clear(screen.getByRole('textbox', { name: 'Instructions' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Instructions' }), '# Steps')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(octopus().skills.save).toHaveBeenCalledWith({ kind: 'global' }, 'review', {
        kind: 'form',
        content: { description: '', body: '# Steps' }
      })
    })
  })

  it('writes the form as a skill and closes', async () => {
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'New skill' }))
    await userEvent.type(screen.getByLabelText('Name'), 'review')
    await userEvent.type(screen.getByLabelText('When to use it'), 'When reviewing.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(octopus().skills.save).toHaveBeenCalledWith(
        { kind: 'global' },
        'review',
        expect.objectContaining({ kind: 'form' })
      )
    })
  })

  it('says why a save was refused, and keeps the editor open', async () => {
    vi.mocked(octopus().skills.save).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'skillExists',
      params: { name: 'review' }
    })
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'New skill' }))
    await userEvent.type(screen.getByLabelText('Name'), 'review')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(/already here/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  /*
   * The raw mode is not an escape hatch bolted on: `allowed-tools` and
   * `when_to_use` live in that frontmatter, and the form edits two fields. It
   * is offered only for a skill that has a document — a new one has none until
   * the save composes it.
   */
  it('offers the document itself for a skill that has one', async () => {
    holding([entry()])
    vi.mocked(octopus().skills.read).mockResolvedValue({
      ok: true,
      value: {
        name: 'review',
        description: 'When reviewing.',
        path: '/data/skills/skills/review',
        body: '# Review\n',
        raw: '---\nname: review\nallowed-tools: Read\n---\n\n# Review\n'
      }
    })
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'What to do with review' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show SKILL.md' }))

    expect(screen.getByRole('textbox', { name: 'Instructions' })).toHaveValue(
      '---\nname: review\nallowed-tools: Read\n---\n\n# Review\n'
    )

    await userEvent.type(screen.getByRole('textbox', { name: 'Instructions' }), 'more')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(octopus().skills.save).toHaveBeenCalledWith({ kind: 'global' }, 'review', {
        kind: 'raw',
        text: '---\nname: review\nallowed-tools: Read\n---\n\n# Review\nmore'
      })
    })
  })

  it('offers no raw mode for a skill that does not exist yet', async () => {
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'New skill' }))

    expect(screen.queryByRole('button', { name: 'Show SKILL.md' })).not.toBeInTheDocument()
  })

  it('goes back to the form from the document', async () => {
    holding([entry()])
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'What to do with review' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show SKILL.md' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back to the form' }))

    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  // The name is the folder and the key every stored answer uses, so renaming is
  // a migration rather than an edit.
  it('will not rename a skill that already exists', async () => {
    holding([entry()])
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'What to do with review' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))

    expect(screen.getByLabelText('Name')).toBeDisabled()
  })

  // A skill deleted from outside the app between the list and the click. No
  // editor rather than an editor full of nothing.
  it('opens no editor for a skill that cannot be read', async () => {
    holding([entry()])
    vi.mocked(octopus().skills.read).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'skillMissing'
    })
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'What to do with review' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))

    await waitFor(() => {
      expect(octopus().skills.read).toHaveBeenCalled()
    })
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('closes the editor without writing anything', async () => {
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'New skill' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(octopus().skills.save).not.toHaveBeenCalled()
  })
})

describe('removing a skill', () => {
  it('asks first, then removes', async () => {
    holding([entry()])
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'What to do with review' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(octopus().skills.remove).toHaveBeenCalledWith({ kind: 'global' }, 'review')
    })
  })

  it('removes nothing when the question is answered no', async () => {
    holding([entry()])
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'What to do with review' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(octopus().skills.remove).not.toHaveBeenCalled()
  })

  it('says why a removal failed', async () => {
    holding([entry()])
    vi.mocked(octopus().skills.remove).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'skillMissing'
    })
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'What to do with review' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    await waitFor(() => {
      expect(screen.getByText(/no longer there/)).toBeInTheDocument()
    })
  })
})

describe('bringing one in', () => {
  it('takes a folder chosen on disk', async () => {
    vi.mocked(octopus().dialog.pickSkill).mockResolvedValue({ ok: true, value: '/tmp/pdf' })
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'Import…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(octopus().skills.import).toHaveBeenCalledWith(
        { kind: 'global' },
        { kind: 'path', path: '/tmp/pdf' }
      )
    })
  })

  it('leaves the path alone when the picker is cancelled', async () => {
    vi.mocked(octopus().dialog.pickSkill).mockResolvedValue({ ok: true, value: null })
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'Import…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose…' }))

    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  })

  it('takes a pasted document', async () => {
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'Import…' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Paste' }))
    await userEvent.type(screen.getByRole('textbox'), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(octopus().skills.import).toHaveBeenCalledWith(
        { kind: 'global' },
        { kind: 'text', text: 'hello' }
      )
    })
  })

  it('takes a link', async () => {
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'Import…' }))
    await userEvent.click(screen.getByRole('radio', { name: 'From a link' }))
    await userEvent.type(screen.getByRole('textbox'), 'https://example.test/SKILL.md')
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(octopus().skills.import).toHaveBeenCalledWith(
        { kind: 'global' },
        { kind: 'url', url: 'https://example.test/SKILL.md' }
      )
    })
  })

  it('says why an import was refused, and stays open', async () => {
    vi.mocked(octopus().skills.import).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'skillFrontmatterMissing'
    })
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'Import…' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Paste' }))
    await userEvent.type(screen.getByRole('textbox'), 'no frontmatter')
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => {
      expect(screen.getByText(/needs frontmatter/)).toBeInTheDocument()
    })
  })

  it('closes without importing anything', async () => {
    await renderSection()

    await userEvent.click(screen.getByRole('button', { name: 'Import…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(octopus().skills.import).not.toHaveBeenCalled()
  })
})

describe("the checkout's own skills", () => {
  /*
   * Read-only here on purpose: they belong to the repository, and editing them
   * from a settings dialog would be octopus writing inside somebody's checkout.
   * Copying is the one thing offered.
   */
  it('lists them, and copies one out', async () => {
    vi.mocked(octopus().skills.inRepository).mockResolvedValue({
      ok: true,
      value: [entry({ name: 'core-module', description: 'From the checkout.', path: '/ws/x' })]
    })
    const { onCopyToGlobal } = await renderSection({ project: true, workspaceId: 'planner/kyiv' })

    await waitFor(() => {
      expect(screen.getByText('core-module')).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Copy to all projects' }))

    expect(onCopyToGlobal).toHaveBeenCalledExactlyOnceWith('/ws/x')
  })

  it('asks nothing of a project with no workspace to read from', async () => {
    await renderSection({ project: true })

    expect(octopus().skills.inRepository).not.toHaveBeenCalled()
    expect(screen.queryByText('In this repository')).not.toBeInTheDocument()
  })

  it('draws no section when the checkout carries none', async () => {
    await renderSection({ project: true, workspaceId: 'planner/kyiv' })

    await waitFor(() => {
      expect(octopus().skills.inRepository).toHaveBeenCalled()
    })
    expect(screen.queryByText('In this repository')).not.toBeInTheDocument()
  })
})

describe('an answer that arrives too late', () => {
  /*
   * The section is torn down while the list is still in flight — closing the
   * dialog does exactly this. Setting state on what came back afterwards is a
   * warning at best and the wrong list at worst.
   */
  it('is dropped rather than shown', async () => {
    const pending = held<{ ok: true; value: SkillEntry[] }>()
    vi.mocked(octopus().skills.list).mockReturnValue(pending.promise)

    const view = render(
      <SkillsSection store={{ kind: 'global' }} disabledDefaults={[]} onDefaults={vi.fn()} />
    )
    view.unmount()
    pending.resolve({ ok: true, value: [entry()] })

    await waitFor(() => {
      expect(screen.queryByText('review')).not.toBeInTheDocument()
    })
  })
})

describe('a repository answer that arrives too late', () => {
  it('is dropped rather than shown', async () => {
    const pending = held<{ ok: true; value: SkillEntry[] }>()
    vi.mocked(octopus().skills.inRepository).mockReturnValue(pending.promise)

    const view = render(
      <SkillsSection
        store={{ kind: 'project', projectId: 'planner' }}
        disabledDefaults={[]}
        onDefaults={vi.fn()}
        workspaceId="planner/kyiv"
        onCopyToGlobal={vi.fn()}
      />
    )
    view.unmount()
    pending.resolve({ ok: true, value: [entry({ name: 'core-module' })] })

    await waitFor(() => {
      expect(screen.queryByText('core-module')).not.toBeInTheDocument()
    })
  })
})

describe('when the store cannot be read', () => {
  // The write landed; the list that follows it did not. Saying nothing would
  // leave a section showing what the store held a moment ago.
  it('says so when the list after a write fails', async () => {
    holding([])
    await renderSection()

    vi.mocked(octopus().skills.list).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'skillMissing'
    })

    await userEvent.click(screen.getByRole('button', { name: 'New skill' }))
    await userEvent.type(screen.getByLabelText('Name'), 'review')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(/no longer there/)).toBeInTheDocument()
    })
  })

  it("says nothing when the checkout's own list cannot be read", async () => {
    vi.mocked(octopus().skills.inRepository).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'worktreeMissing'
    })

    await renderSection({ project: true, workspaceId: 'planner/kyiv' })

    await waitFor(() => {
      expect(octopus().skills.inRepository).toHaveBeenCalled()
    })
    expect(screen.queryByText('In this repository')).not.toBeInTheDocument()
  })

  it('says so rather than showing an empty list', async () => {
    vi.mocked(octopus().skills.list).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'skillMissing'
    })

    render(<SkillsSection store={{ kind: 'global' }} disabledDefaults={[]} onDefaults={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/no longer there/)).toBeInTheDocument()
    })
  })
})
