import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { PROJECT_COLORS } from '@core/colors.js'
import { PROJECT_ICONS } from '@core/icons.js'
import type { Project } from '@core/store.js'

import type { Result } from '../../../preload/index.js'
import { stubDialogElement } from '../test/dialog.js'
import { ProjectSettings } from './ProjectSettings.js'

type ProjectSettingsProps = React.ComponentProps<typeof ProjectSettings>

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'planner',
    name: 'planner',
    repoPath: '/Users/someone/code/planner',
    baseBranch: 'origin/main',
    branchPrefix: 'ytsykvas',
    envFile: '.env',
    approvedSettings: [],
    color: 'blue',
    ...overrides
  }
}

async function renderDialog(
  overrides: Partial<ProjectSettingsProps> = {}
): Promise<ProjectSettingsProps> {
  const props: ProjectSettingsProps = {
    project: project(),
    onUpdate: vi.fn(() => Promise.resolve(true)),
    onRemove: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  }

  render(<ProjectSettings {...props} />)
  // The branch list is read on mount. Settling it here keeps that update inside
  // the test instead of landing after it has finished.
  await screen.findByRole('dialog')
  return props
}

async function openSection(user: UserEvent, label: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: label }))
}

function nameField(): HTMLElement {
  return screen.getByRole('textbox')
}

/** The two pickers both mark a chosen cell, so a query has to say which row. */
function palette(): HTMLElement {
  return screen.getByRole('group', { name: 'Colour' })
}

function iconRow(): HTMLElement {
  return screen.getByRole('group', { name: 'Icon' })
}

/** A call the test answers when it chooses, standing in for slow IPC. */
function pending<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((capture) => {
    resolve = capture
  })

  return {
    promise,
    settle: (value) => {
      resolve?.(value)
    }
  }
}

/** A repository whose three scripts differ, so the editors can be told apart. */
function offerScripts(): void {
  const bodies = { setup: 'npm install', run: 'npm run dev', archive: 'dropdb mine' }
  vi.mocked(window.octopus.projects.readScript).mockImplementation((_projectId, kind) =>
    Promise.resolve({ ok: true, value: bodies[kind] })
  )
}

beforeAll(stubDialogElement)

beforeEach(() => {
  // jsdom does no layout and has no scrollIntoView, which the branch list calls
  // to keep the highlighted row visible.
  Element.prototype.scrollIntoView = vi.fn()
})

describe('ProjectSettings', () => {
  it('opens on the general section, showing the name, the palette and the repository', async () => {
    await renderDialog()

    expect(nameField()).toHaveValue('planner')
    expect(screen.getByRole('button', { name: 'blue' })).toBeInTheDocument()
    expect(screen.getByText('/Users/someone/code/planner')).toBeInTheDocument()
  })

  it('saves the name when the field loses focus', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.clear(nameField())
    await user.type(nameField(), 'ledger')
    await user.tab()

    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ name: 'ledger' })
  })

  it('saves the name when Enter is pressed', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.type(nameField(), '-web{Enter}')

    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ name: 'planner-web' })
  })

  it('drops the spaces around the name before saving it', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.clear(nameField())
    await user.type(nameField(), '  ledger  ')
    await user.tab()

    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ name: 'ledger' })
  })

  // An empty field is a slip, not an instruction to erase the project's name.
  it('restores the stored name when the field is left empty', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.clear(nameField())
    await user.tab()

    expect(nameField()).toHaveValue('planner')
    expect(props.onUpdate).not.toHaveBeenCalled()
  })

  it('restores the stored name when a field holding only spaces is left', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.clear(nameField())
    await user.type(nameField(), '   ')
    await user.tab()

    expect(nameField()).toHaveValue('planner')
    expect(props.onUpdate).not.toHaveBeenCalled()
  })

  it('saves nothing when the name is left as it was', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.click(nameField())
    await user.tab()

    expect(props.onUpdate).not.toHaveBeenCalled()
  })

  it('abandons the edit when Escape is pressed', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.type(nameField(), '-web{Escape}')

    expect(nameField()).toHaveValue('planner')
    expect(props.onUpdate).not.toHaveBeenCalled()
  })

  it('applies the colour whose swatch is chosen', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.click(screen.getByRole('button', { name: 'rose' }))

    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ color: 'rose' })
  })

  it('marks the colour the project already carries', async () => {
    await renderDialog({ project: project({ color: 'amber' }) })

    expect(within(palette()).getByRole('button', { pressed: true })).toHaveAccessibleName('amber')
  })

  it('offers the whole palette to choose from', async () => {
    await renderDialog()

    // Every swatch but the project's own is on offer.
    expect(within(palette()).getAllByRole('button', { pressed: false })).toHaveLength(
      PROJECT_COLORS.length - 1
    )
  })

  it('offers every icon, plus the initials that stand in for none', async () => {
    await renderDialog()

    expect(within(iconRow()).getAllByRole('button')).toHaveLength(PROJECT_ICONS.length + 1)
  })

  it('marks the project with the icon that was clicked', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.click(within(iconRow()).getByRole('button', { name: 'rocket' }))

    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ icon: 'rocket' })
  })

  // Without this the icon could be swapped but never taken off again.
  it('puts the initials back when they are chosen', async () => {
    const user = userEvent.setup()
    const props = await renderDialog({ project: project({ icon: 'rocket' }) })

    await user.click(within(iconRow()).getByRole('button', { name: 'Initials' }))

    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ icon: null })
  })

  // The cell is a preview of the tab it turns back into, so it has to show the
  // project's own letters rather than a generic label.
  it('previews the initials the tab falls back to', async () => {
    await renderDialog({ project: project({ name: 'tsykvas-rails-template' }) })

    expect(within(iconRow()).getByText('TR')).toBeInTheDocument()
  })

  it('marks the icon the project already carries', async () => {
    await renderDialog({ project: project({ icon: 'flame' }) })

    expect(within(iconRow()).getByRole('button', { pressed: true })).toHaveAccessibleName('flame')
  })

  // A project with no icon shows its initials on the tab, so that is what the
  // row has to report as chosen.
  it('marks the initials as chosen while no icon is set', async () => {
    await renderDialog()

    expect(within(iconRow()).getByRole('button', { pressed: true })).toHaveAccessibleName(
      'Initials'
    )
  })

  it('shows the base branch under Git, and nothing from General', async () => {
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Git')

    expect(screen.getByText('Base branch')).toBeInTheDocument()
    expect(screen.queryByText('/Users/someone/code/planner')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'rose' })).not.toBeInTheDocument()
  })

  it('offers the branches the repository reports', async () => {
    vi.mocked(window.octopus.projects.branches).mockResolvedValue({
      ok: true,
      value: ['origin/main', 'origin/next']
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Git')
    await user.click(screen.getByRole('button', { name: 'main' }))

    expect(screen.getByRole('button', { name: 'next' })).toBeInTheDocument()
    expect(window.octopus.projects.branches).toHaveBeenCalledWith('planner')
  })

  it('changes the base branch to the one chosen', async () => {
    vi.mocked(window.octopus.projects.branches).mockResolvedValue({
      ok: true,
      value: ['origin/main', 'origin/next']
    })
    const user = userEvent.setup()
    const props = await renderDialog()

    await openSection(user, 'Git')
    await user.click(screen.getByRole('button', { name: 'main' }))
    await user.click(screen.getByRole('button', { name: 'next' }))

    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith({ baseBranch: 'origin/next' })
  })

  // A branch can be deleted between the list being read and the click on it.
  it('says so when the branch could not be set', async () => {
    vi.mocked(window.octopus.projects.branches).mockResolvedValue({
      ok: true,
      value: ['origin/main', 'origin/next']
    })
    const user = userEvent.setup()
    await renderDialog({ onUpdate: vi.fn(() => Promise.resolve(false)) })

    await openSection(user, 'Git')
    await user.click(screen.getByRole('button', { name: 'main' }))
    await user.click(screen.getByRole('button', { name: 'next' }))

    expect(
      await screen.findByText(
        'That branch could not be set. It may have been deleted since this list was read.'
      )
    ).toBeInTheDocument()
  })

  it('reports why the branch list could not be read', async () => {
    vi.mocked(window.octopus.projects.branches).mockResolvedValue({
      ok: false,
      error: 'not a repository',
      code: 'notARepository',
      params: { path: '/Users/someone/code/planner' }
    })

    await renderDialog()

    expect(
      await screen.findByText('/Users/someone/code/planner is not a git repository.')
    ).toBeInTheDocument()
  })

  it('offers every script under Scripts', async () => {
    offerScripts()
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Scripts')

    expect(await screen.findByDisplayValue('npm install')).toBeInTheDocument()
    expect(screen.getByDisplayValue('npm run dev')).toBeInTheDocument()
    // The one that takes back what the build gave out.
    expect(screen.getByDisplayValue('dropdb mine')).toBeInTheDocument()
  })

  it('saves an edited setup script against the project it belongs to', async () => {
    offerScripts()
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Scripts')
    const script = await screen.findByDisplayValue('npm install')
    await user.clear(script)
    await user.type(script, 'npm ci')
    await user.tab()

    expect(window.octopus.projects.saveScript).toHaveBeenCalledExactlyOnceWith(
      'planner',
      'setup',
      'npm ci'
    )
  })

  // The editors differ only in the file they carry, which is exactly the thing
  // a copy of one of them would get wrong.
  it('saves an edited cleanup script as the cleanup script', async () => {
    offerScripts()
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Scripts')
    const script = await screen.findByDisplayValue('dropdb mine')
    await user.clear(script)
    await user.type(script, 'dropdb yours')
    await user.tab()

    expect(window.octopus.projects.saveScript).toHaveBeenCalledExactlyOnceWith(
      'planner',
      'archive',
      'dropdb yours'
    )
  })

  // The two editors differ only in the file they carry, which is exactly the
  // thing a copy of the first one would get wrong.
  it('saves an edited run script as the run script', async () => {
    offerScripts()
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Scripts')
    const script = await screen.findByDisplayValue('npm run dev')
    await user.clear(script)
    await user.type(script, 'npm start')
    await user.tab()

    expect(window.octopus.projects.saveScript).toHaveBeenCalledExactlyOnceWith(
      'planner',
      'run',
      'npm start'
    )
  })

  // Its own section rather than a third editor under Scripts: the Build header
  // has a button for each, and two of them opening one panel would be two names
  // for one action.
  it('offers the carried files in a section of their own', async () => {
    vi.mocked(window.octopus.projects.readCarryList).mockResolvedValue({
      ok: true,
      value: 'API_KEY=secret'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Files')

    expect(await screen.findByDisplayValue('API_KEY=secret')).toBeInTheDocument()
  })

  it('saves an edited file list against the project it belongs to', async () => {
    vi.mocked(window.octopus.projects.readCarryList).mockResolvedValue({
      ok: true,
      value: 'API_KEY=secret'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Files')
    const env = await screen.findByDisplayValue('API_KEY=secret')
    await user.clear(env)
    await user.type(env, 'API_KEY=rotated')
    await user.tab()

    expect(window.octopus.projects.saveCarryList).toHaveBeenCalledExactlyOnceWith(
      'planner',
      'API_KEY=rotated'
    )
  })

  it('saves the env file a project names', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await openSection(user, 'Env')
    const field = screen.getByDisplayValue('.env')
    await user.clear(field)
    await user.type(field, '.env.local')
    await user.tab()

    expect(props.onUpdate).toHaveBeenCalledWith({ envFile: '.env.local' })
  })

  it('puts the stored name back when the field is left empty', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await openSection(user, 'Env')
    const field = screen.getByDisplayValue('.env')
    await user.clear(field)
    await user.tab()

    expect(field).toHaveValue('.env')
    expect(props.onUpdate).not.toHaveBeenCalled()
  })

  // The core refuses a path that climbs out of the worktree, and the field
  // cannot go on showing something that was not saved.
  it('puts the stored name back when the core refuses the one typed', async () => {
    const user = userEvent.setup()
    const props = await renderDialog({ onUpdate: vi.fn().mockResolvedValue(false) })

    await openSection(user, 'Env')
    const field = screen.getByDisplayValue('.env')
    await user.clear(field)
    await user.type(field, '../.env')
    await user.tab()

    await waitFor(() => {
      expect(field).toHaveValue('.env')
    })
    expect(props.onUpdate).toHaveBeenCalledWith({ envFile: '../.env' })
  })

  it('leaves the field on Enter and puts it back on Escape', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await openSection(user, 'Env')
    const field = screen.getByDisplayValue('.env')
    await user.click(field)
    await user.type(field, '.local{Enter}')

    expect(props.onUpdate).toHaveBeenCalledWith({ envFile: '.env.local' })

    await user.click(field)
    await user.type(field, 'x{Escape}')
    expect(field).toHaveValue('.env')
  })

  /*
   * Warnings while it is typed, never a refusal to save: the file is read by
   * somebody else's parser, and ours cannot be the authority on what that one
   * accepts. Told on blur they would arrive after the attention that could act
   * on them.
   */
  it('says what is wrong with the block as it is typed', async () => {
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')
    const editor = await screen.findByPlaceholderText(/MYSQL_HOST/)
    await user.type(editor, 'MYSQL_HOST dev.example')

    expect(await screen.findByText(/is not KEY=value/)).toBeInTheDocument()
  })

  it('says nothing about a block that is fine', async () => {
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')
    const editor = await screen.findByPlaceholderText(/MYSQL_HOST/)
    await user.type(editor, 'MYSQL_HOST=dev.example')

    expect(screen.queryByText(/is not KEY=value/)).toBeNull()
  })

  /*
   * octopus writes credentials into that file, inside a directory the agent
   * commits from freely. A repository that does not ignore it turns the block
   * into a change waiting to be committed.
   */
  it('warns when git does not ignore the file the block goes into', async () => {
    vi.mocked(window.octopus.projects.isEnvIgnored).mockResolvedValue({ ok: true, value: false })
    vi.mocked(window.octopus.projects.readEnv).mockResolvedValue({ ok: true, value: 'A=1' })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')

    expect(await screen.findByText(/does not ignore/)).toBeInTheDocument()
  })

  // A warning about nothing. There is no secret in an empty block.
  it('says nothing about an unignored file while the block is empty', async () => {
    vi.mocked(window.octopus.projects.isEnvIgnored).mockResolvedValue({ ok: true, value: false })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')

    expect(screen.queryByText(/does not ignore/)).toBeNull()
  })

  /*
   * An answer landing after the reader has moved on belongs to a question
   * nobody is watching, and writing state then is React's "update on an
   * unmounted component".
   */
  it('drops a gitignore answer that arrives after the section has changed', async () => {
    const gate: { land: (() => void) | null } = { land: null }
    vi.mocked(window.octopus.projects.isEnvIgnored).mockImplementation(
      () =>
        new Promise((resolve) => {
          gate.land = () => {
            resolve({ ok: true, value: false })
          }
        })
    )
    vi.mocked(window.octopus.projects.readEnv).mockResolvedValue({ ok: true, value: 'A=1' })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')
    await openSection(user, 'General')
    gate.land?.()
    await openSection(user, 'Env')

    expect(await screen.findByDisplayValue('A=1')).toBeInTheDocument()
    expect(screen.queryByText(/does not ignore/)).toBeNull()
  })

  // Git failing to answer is not evidence of exposure.
  it('says nothing when git could not answer', async () => {
    vi.mocked(window.octopus.projects.isEnvIgnored).mockResolvedValue({
      ok: false,
      error: 'not a git repository'
    })
    vi.mocked(window.octopus.projects.readEnv).mockResolvedValue({ ok: true, value: 'A=1' })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')

    expect(await screen.findByDisplayValue('A=1')).toBeInTheDocument()
    expect(screen.queryByText(/does not ignore/)).toBeNull()
  })

  /*
   * Where a project cloned from GitHub gets its `.env` at all: the checkout is
   * a fresh clone, so there was never a gitignored file to carry, and these are
   * typed rather than copied.
   */
  it('offers the env overrides in a section of their own', async () => {
    vi.mocked(window.octopus.projects.readEnv).mockResolvedValue({
      ok: true,
      value: 'MYSQL_HOST=dev.example'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')

    expect(await screen.findByDisplayValue('MYSQL_HOST=dev.example')).toBeInTheDocument()
  })

  it('saves edited env overrides against the project they belong to', async () => {
    vi.mocked(window.octopus.projects.readEnv).mockResolvedValue({
      ok: true,
      value: 'MYSQL_HOST=dev.example'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')
    const env = await screen.findByDisplayValue('MYSQL_HOST=dev.example')
    await user.clear(env)
    await user.type(env, 'MYSQL_HOST=other.example')
    await user.tab()

    expect(window.octopus.projects.saveEnv).toHaveBeenCalledExactlyOnceWith(
      'planner',
      'MYSQL_HOST=other.example'
    )
  })

  /*
   * Opened where the caller already knows the question — the pull request tab
   * asks for the instructions section rather than dropping the reader on
   * General to find it. Read once, on mount, which is correct only because the
   * dialog is rendered conditionally.
   */
  it('opens on the section it was asked for', async () => {
    vi.mocked(window.octopus.projects.readInstruction).mockResolvedValue({
      ok: true,
      value: 'Lead with the why.'
    })
    await renderDialog({ initialSection: 'instructions' })

    expect(await screen.findByDisplayValue('Lead with the why.')).toBeInTheDocument()
  })

  /*
   * octopus loads the same settings Claude Code does in a terminal, so the
   * agent arrives carrying whatever the repository wrote for it — and this is
   * the only place the app can say what that turned out to be.
   */
  it('lists what the agent picks up on its own', async () => {
    vi.mocked(window.octopus.projects.instructionSources).mockResolvedValue({
      ok: true,
      value: [
        { id: 'projectMemory', path: '/repo/CLAUDE.md', present: true, loaded: true, count: null },
        {
          id: 'projectSettings',
          path: '/repo/.claude/settings.json',
          present: false,
          loaded: false,
          count: null
        },
        { id: 'commands', path: '/repo/.claude/commands', present: true, loaded: true, count: 3 }
      ]
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Instructions')

    expect(await screen.findByText('CLAUDE.md in this repository')).toBeInTheDocument()
    expect(screen.getByText('3 loaded')).toBeInTheDocument()
    expect(screen.getByText('none')).toBeInTheDocument()
  })

  /*
   * "On disk" is a stat and "read" is a claim about what the agent was started
   * with. Saying the first under the second's name made this panel wrong in
   * every mode at once — it read "loaded" for seven rows while the agent had
   * been given no settings sources at all.
   */
  it('separates a file that is there from one the agent will read', async () => {
    vi.mocked(window.octopus.projects.instructionSources).mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'localSettings',
          path: '/repo/.claude/settings.local.json',
          present: true,
          loaded: false,
          count: null
        },
        { id: 'skills', path: '/repo/.claude/skills', present: true, loaded: true, count: 8 }
      ]
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Instructions')

    expect(await screen.findByText('on disk, not read')).toBeInTheDocument()
    expect(screen.getByText('8 loaded')).toBeInTheDocument()
  })

  // A list that could not be read is not an empty project; it says nothing
  // rather than claiming the agent picks up nothing.
  it('lists nothing when the sources could not be read', async () => {
    vi.mocked(window.octopus.projects.instructionSources).mockResolvedValue({
      ok: false,
      error: 'EACCES'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Instructions')

    expect(await screen.findByText('What the agent picks up on its own')).toBeInTheDocument()
    expect(screen.queryByText('loaded')).toBeNull()
  })

  it('shows the pull request instructions under Instructions', async () => {
    vi.mocked(window.octopus.projects.readInstruction).mockResolvedValue({
      ok: true,
      value: 'Open with a one-line summary.'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Instructions')

    expect(await screen.findByDisplayValue('Open with a one-line summary.')).toBeInTheDocument()
    expect(window.octopus.projects.readInstruction).toHaveBeenCalledWith('planner', 'pullRequest')
  })

  it('removes the project from the danger section', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await openSection(user, 'Danger zone')
    await user.click(screen.getByRole('button', { name: 'Remove project' }))

    expect(props.onRemove).toHaveBeenCalledTimes(1)
  })

  // Reaching removal takes choosing the section it lives in — a step further
  // from a mis-click than a scroll was.
  it('keeps removal out of every other section', async () => {
    const user = userEvent.setup()
    await renderDialog()

    expect(screen.queryByRole('button', { name: 'Remove project' })).not.toBeInTheDocument()

    await openSection(user, 'Git')
    expect(screen.queryByRole('button', { name: 'Remove project' })).not.toBeInTheDocument()
  })

  it('closes when the dialog is done with', async () => {
    const user = userEvent.setup()
    const props = await renderDialog()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  // The dialog stays mounted while the project under it changes, and the branch
  // list is read per project. A listing that arrives after the switch describes
  // a repository nobody is looking at, and offering it would let a project be
  // pointed at a branch its own repository has never heard of.
  it('drops a branch listing that arrives after the project has changed', async () => {
    const planner = pending<Result<string[]>>()
    const ledger = pending<Result<string[]>>()
    vi.mocked(window.octopus.projects.branches)
      .mockReturnValueOnce(planner.promise)
      .mockReturnValueOnce(ledger.promise)
    const props: ProjectSettingsProps = {
      project: project(),
      onUpdate: vi.fn(() => Promise.resolve(true)),
      onRemove: vi.fn(),
      onClose: vi.fn()
    }
    const user = userEvent.setup()
    const view = render(<ProjectSettings {...props} />)
    await screen.findByRole('dialog')

    view.rerender(
      <ProjectSettings {...props} project={project({ id: 'ledger', name: 'ledger' })} />
    )
    ledger.settle({ ok: true, value: ['origin/main', 'origin/next'] })
    planner.settle({ ok: true, value: ['origin/legacy'] })

    await openSection(user, 'Git')
    await user.click(await screen.findByRole('button', { name: 'main' }))

    expect(screen.getByRole('button', { name: 'next' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'legacy' })).toBeNull()
  })

  it('saves the edited pull request instructions', async () => {
    vi.mocked(window.octopus.projects.readInstruction).mockResolvedValue({
      ok: true,
      value: 'Open with a one-line summary.'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Instructions')
    const instructions = await screen.findByDisplayValue('Open with a one-line summary.')
    await user.clear(instructions)
    await user.type(instructions, 'Lead with the why.')
    await user.tab()

    expect(window.octopus.projects.saveInstruction).toHaveBeenCalledExactlyOnceWith(
      'planner',
      'pullRequest',
      'Lead with the why.'
    )
  })

  // A file that cannot be read leaves an empty editor rather than one holding
  // the error: whatever sits in the box is what gets written back to the file.
  it('leaves every script editor empty when the files cannot be read', async () => {
    vi.mocked(window.octopus.projects.readScript).mockResolvedValue({
      ok: false,
      error: 'EACCES: permission denied'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Scripts')

    const editors = await screen.findAllByRole('textbox')
    expect(editors).toHaveLength(3)
    for (const editor of editors) expect(editor).toHaveValue('')
    expect(screen.queryByText(/permission denied/)).toBeNull()
  })

  it('leaves the file list empty when it cannot be read', async () => {
    vi.mocked(window.octopus.projects.readCarryList).mockResolvedValue({
      ok: false,
      error: 'EACCES: permission denied'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Files')

    expect(await screen.findByRole('textbox')).toHaveValue('')
    expect(screen.queryByText(/permission denied/)).toBeNull()
  })

  it('leaves the env editor empty when the file cannot be read', async () => {
    vi.mocked(window.octopus.projects.readEnv).mockResolvedValue({
      ok: false,
      error: 'EACCES: permission denied'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Env')

    // Two boxes in this section now — the file it goes into, and the block.
    const editors = await screen.findAllByRole('textbox')
    expect(editors.filter((editor) => editor.tagName === 'TEXTAREA')).toHaveLength(1)
    for (const editor of editors) {
      if (editor.tagName === 'TEXTAREA') expect(editor).toHaveValue('')
    }
    expect(screen.queryByText(/permission denied/)).toBeNull()
  })

  it('leaves the instruction editor empty when the file cannot be read', async () => {
    vi.mocked(window.octopus.projects.readInstruction).mockResolvedValue({
      ok: false,
      error: 'EACCES: permission denied'
    })
    const user = userEvent.setup()
    await renderDialog()

    await openSection(user, 'Instructions')

    expect(await screen.findByRole('textbox')).toHaveValue('')
    expect(screen.queryByText(/permission denied/)).toBeNull()
  })
})
