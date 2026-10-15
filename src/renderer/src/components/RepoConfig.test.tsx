import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RepoConfigItem, RepoConfigView, RepoItemId } from '@core/repoConfig.js'

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
  it('exports what the app holds, and never asks for an export of nothing', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })

    render(<RepoConfig projectId="planner" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))
    expect(octopus().projects.exportRepoConfig).toHaveBeenCalledWith('planner', ['project'])
  })

  it('unticks and reticks a file on the way out', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })

    render(<RepoConfig projectId="planner" />)

    const box = await screen.findByRole('checkbox', { name: PROJECT })
    await userEvent.click(box)
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()

    await userEvent.click(box)
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  // Only what the app holds can go out, so a file the repository alone has is
  // not offered for writing.
  it('lists only what the app holds', async () => {
    offer({
      items: [
        item('project', PROJECT, null, '{"baseBranch":"main"}'),
        item('script.run', RUN, 'npm run dev\n', null)
      ]
    })

    render(<RepoConfig projectId="planner" />)

    expect(await screen.findByRole('checkbox', { name: PROJECT })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: RUN })).toBeNull()
  })

  /*
   * A file the repository already holds with other contents is the team's
   * setup, so writing over it is asked about first — and keeping it writes
   * nothing at all.
   */
  it('asks before writing over what the repository already holds', async () => {
    offer({
      items: [
        item('script.setup', SETUP, 'npm ci\n', 'npm install\n'),
        item('carry', CARRY, null, '.env\n')
      ]
    })

    render(<RepoConfig projectId="planner" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/already has this file/i)
    expect(alert).toHaveTextContent(SETUP)
    expect(octopus().projects.exportRepoConfig).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Keep the repository/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(octopus().projects.exportRepoConfig).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await userEvent.click(screen.getByRole('button', { name: 'Write over' }))
    expect(octopus().projects.exportRepoConfig).toHaveBeenCalledWith('planner', [
      'script.setup',
      'carry'
    ])
  })

  it('writes without asking when nothing would be written over', async () => {
    offer({ items: [item('script.setup', SETUP, 'npm ci\n', 'npm ci\n')] })

    render(<RepoConfig projectId="planner" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(octopus().projects.exportRepoConfig).toHaveBeenCalledWith('planner', ['script.setup'])
  })

  /*
   * A class assertion, for the reason `PullRequestPanel.test.tsx` gives beside
   * its own: the class is what makes the control exist. Without `.choice` the
   * platform paints it — `accent-color` alone leaves the **unchecked** box a
   * white square on the dark canvas, because there is no `color-scheme` opt-in
   * anywhere, and it fixes neither the size nor the corner. jsdom computes no
   * layout, so nothing else here could catch it.
   */
  it('paints its checkbox from the theme rather than leaving it to the platform', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })

    render(<RepoConfig projectId="planner" />)

    expect(await screen.findByRole('checkbox', { name: PROJECT })).toHaveClass('choice')
  })

  // Both lists are read again afterwards, so a file that has just been written
  // stops claiming the two sides differ.
  it('reads both sides again once something has moved', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })

    render(<RepoConfig projectId="planner" />)
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))

    await waitFor(() => {
      expect(octopus().projects.repoConfig).toHaveBeenCalledTimes(2)
    })
  })

  // An ignored folder makes exporting into it a change nobody will ever
  // receive, which is worth saying before somebody exports twice.
  it('warns when git ignores the folder', async () => {
    offer({ ignored: true, items: [] })

    render(<RepoConfig projectId="planner" />)

    expect(await screen.findByText(/git ignores/i)).toBeInTheDocument()
  })

  it('reports a repository it could not read', async () => {
    vi.mocked(octopus().projects.repoConfig).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'repoConfigSymlink',
      params: { path: '.octopus' }
    })

    render(<RepoConfig projectId="planner" />)

    expect(await screen.findByText(/symbolic link/i)).toBeInTheDocument()
  })

  // A link in the folder refuses the write, and the panel has to say so.
  it('reports a refused export', async () => {
    offer({ items: [item('project', PROJECT, null, '{"baseBranch":"main"}')] })
    vi.mocked(octopus().projects.exportRepoConfig).mockResolvedValue({
      ok: false,
      error: 'raw',
      code: 'repoConfigSymlink',
      params: { path: '.octopus/scripts' }
    })

    render(<RepoConfig projectId="planner" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))

    expect(await screen.findByText(/symbolic link/i)).toBeInTheDocument()
  })

  it('shows that it is still reading before anything has arrived', () => {
    vi.mocked(octopus().projects.repoConfig).mockReturnValue(new Promise(() => undefined))

    render(<RepoConfig projectId="planner" />)

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

    const { rerender } = render(<RepoConfig projectId="planner" />)
    rerender(<RepoConfig projectId="ledger" />)

    ledger.settle({
      ok: true,
      value: view({ present: true, items: [item('carry', CARRY, null, '.env\n')] })
    })
    expect(await screen.findByText(CARRY)).toBeInTheDocument()

    planner.settle({
      ok: true,
      value: view({ present: true, items: [item('script.setup', SETUP, null, 'npm ci\n')] })
    })

    await waitFor(() => {
      expect(screen.queryByText(SETUP)).not.toBeInTheDocument()
    })
    expect(screen.getByText(CARRY)).toBeInTheDocument()
  })
})
