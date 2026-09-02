import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PullRequestView } from '@core/pullRequests.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { usePullRequest } from './usePullRequest.js'

const VIEW: PullRequestView = {
  request: null,
  pushed: true,
  dirty: false,
  ahead: 1,
  base: 'main'
}

const DRAFT = { title: 'Rename', body: '', draft: false, commitMessage: null }

describe('the pull request of a workspace', () => {
  // Nothing to ask about, so nothing is asked — and `create` has nowhere to
  // send a request either. The panel guards this too; the hook is what would
  // be reached by anything else that used it.
  it('asks nothing and creates nothing without a workspace', async () => {
    const { result } = renderHook(() => usePullRequest(null, true))

    await expect(result.current.create(DRAFT)).resolves.toBeNull()
    // The agent is not asked either: describing a branch there is no workspace
    // for would be a question with no subject.
    await expect(result.current.draft()).resolves.toBeNull()
    expect(octopus().workspaces.pullRequest).not.toHaveBeenCalled()
    expect(octopus().workspaces.createPullRequest).not.toHaveBeenCalled()
    expect(octopus().workspaces.draftPullRequest).not.toHaveBeenCalled()
  })

  /*
   * A reply that arrives after the workspace changed under it belongs to a
   * branch nobody is looking at any more. Writing it now would name the last
   * workspace's pull request on this one's pane — which is the same race the
   * diff guards, and the same generation counter guards it here.
   */
  it('drops a reply that arrived after the workspace changed', async () => {
    const slow = held<{ ok: true; value: PullRequestView }>()
    vi.mocked(octopus().workspaces.pullRequest).mockReturnValueOnce(slow.promise)

    const { result, rerender } = renderHook(({ id }) => usePullRequest(id, true), {
      initialProps: { id: 'anna' }
    })

    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({
      ok: true,
      value: { ...VIEW, ahead: 9 }
    })
    rerender({ id: 'bob' })

    // Anna's answer, arriving after Bob's pane is the one on screen.
    await act(async () => {
      slow.resolve({ ok: true, value: { ...VIEW, ahead: 1 } })
      await slow.promise
    })

    await waitFor(() => {
      expect(result.current.view?.ahead).toBe(9)
    })
  })

  /*
   * The other half of the same race, and the one the abort in the effect cannot
   * catch. A create answers, and the read that follows it is still in flight
   * when another workspace is opened — so its reply describes a branch that is
   * no longer on screen, and writing it would name the wrong one.
   */
  it('drops the read that follows a create when the workspace has moved on', async () => {
    const created = held<{ ok: true; value: string }>()
    const afterCreate = held<{ ok: true; value: PullRequestView }>()

    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({ ok: true, value: VIEW })
    vi.mocked(octopus().workspaces.createPullRequest).mockReturnValue(created.promise)

    const { result, rerender } = renderHook(({ id }) => usePullRequest(id, true), {
      initialProps: { id: 'anna' }
    })
    await waitFor(() => {
      expect(result.current.view).not.toBeNull()
    })

    // The read a create makes on its way back, held open.
    vi.mocked(octopus().workspaces.pullRequest).mockReturnValueOnce(afterCreate.promise)

    let opening: Promise<string | null> = Promise.resolve(null)
    act(() => {
      opening = result.current.create(DRAFT)
    })
    await act(async () => {
      created.resolve({ ok: true, value: 'https://github.com/o/p/pull/1' })
      await created.promise
    })

    // Bob is opened while Anna's follow-up read is still out.
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({
      ok: true,
      value: { ...VIEW, ahead: 9 }
    })
    rerender({ id: 'bob' })

    await act(async () => {
      afterCreate.resolve({ ok: true, value: { ...VIEW, ahead: 1 } })
      await opening
    })

    await waitFor(() => {
      expect(result.current.view?.ahead).toBe(9)
    })
  })

  /*
   * The half the test above cannot reach, and the one that mattered.
   *
   * That one lets the create resolve *before* the switch, so the generation is
   * claimed first and the guard works. Switch while `createPullRequest` is
   * still out and the order reverses: Bob's effect claims a number, and then
   * the create claims one past it and writes Anna's request into a pane
   * showing Bob's branch.
   *
   * Not a cosmetic mismatch. `PullRequestPanel` sends the workspace on screen
   * together with the number it is drawing, so Merge would have run
   * `gh pr merge <Anna's number>` in Bob's worktree, and merging is not
   * something GitHub undoes.
   */
  it('drops a create whose workspace changed while it was still out', async () => {
    const created = held<{ ok: true; value: string }>()

    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({ ok: true, value: VIEW })
    vi.mocked(octopus().workspaces.createPullRequest).mockReturnValue(created.promise)

    const { result, rerender } = renderHook(({ id }) => usePullRequest(id, true), {
      initialProps: { id: 'anna' }
    })
    await waitFor(() => {
      expect(result.current.view).not.toBeNull()
    })

    let opening: Promise<string | null> = Promise.resolve(null)
    act(() => {
      opening = result.current.create(DRAFT)
    })

    // Bob is opened while the create itself is still out, before anything on
    // the way back has had a chance to claim a generation.
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({
      ok: true,
      value: { ...VIEW, ahead: 9 }
    })
    rerender({ id: 'bob' })
    await waitFor(() => {
      expect(result.current.view?.ahead).toBe(9)
    })

    // Anna's follow-up read, told apart from Bob's by its own number — with
    // both answering alike the stale write is invisible, which is how this
    // went unnoticed.
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValueOnce({
      ok: true,
      value: { ...VIEW, ahead: 1 }
    })

    await act(async () => {
      created.resolve({ ok: true, value: 'https://github.com/o/p/pull/1' })
      await opening
    })

    expect(result.current.view?.ahead).toBe(9)
  })

  /*
   * Asking the agent to describe a branch takes a turn, which is long enough to
   * open another workspace in. The description that comes back is about the
   * branch that was left, and it had no check at all before this.
   */
  it('drops a description whose workspace changed while it was being written', async () => {
    const slow = held<{ ok: false; error: string }>()
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({ ok: true, value: VIEW })
    vi.mocked(octopus().workspaces.draftPullRequest).mockReturnValue(slow.promise)

    const { result, rerender } = renderHook(({ id }) => usePullRequest(id, true), {
      initialProps: { id: 'anna' }
    })
    await waitFor(() => {
      expect(result.current.view).not.toBeNull()
    })

    let drafting: Promise<unknown> = Promise.resolve(null)
    act(() => {
      drafting = result.current.draft()
    })
    expect(result.current.drafting).toBe(true)

    rerender({ id: 'bob' })
    expect(result.current.drafting).toBe(false)

    await act(async () => {
      slow.resolve({ ok: false, error: 'the agent is busy' })
      await drafting
    })

    expect(result.current.actionError).toBeNull()
  })

  // The same staleness one field over: a refusal belonging to the workspace
  // that has just been left is a refusal about a branch nobody is looking at.
  it('drops what it was doing when the workspace changes', async () => {
    const slow = held<{ ok: false; error: string }>()
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({ ok: true, value: VIEW })
    vi.mocked(octopus().workspaces.createPullRequest).mockReturnValue(slow.promise)

    const { result, rerender } = renderHook(({ id }) => usePullRequest(id, true), {
      initialProps: { id: 'anna' }
    })
    await waitFor(() => {
      expect(result.current.view).not.toBeNull()
    })

    let opening: Promise<string | null> = Promise.resolve(null)
    act(() => {
      opening = result.current.create(DRAFT)
    })
    expect(result.current.creating).toBe(true)

    rerender({ id: 'bob' })
    expect(result.current.creating).toBe(false)

    await act(async () => {
      slow.resolve({ ok: false, error: 'no remote' })
      await opening
    })

    expect(result.current.actionError).toBeNull()
  })

  it('reports what it is doing while it opens one', async () => {
    const slow = held<{ ok: true; value: string }>()
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({ ok: true, value: VIEW })
    vi.mocked(octopus().workspaces.createPullRequest).mockReturnValueOnce(slow.promise)

    const { result } = renderHook(() => usePullRequest('anna', true))
    await waitFor(() => {
      expect(result.current.view).not.toBeNull()
    })

    let created: Promise<string | null> = Promise.resolve(null)
    act(() => {
      created = result.current.create(DRAFT)
    })

    await waitFor(() => {
      expect(result.current.creating).toBe(true)
    })

    await act(async () => {
      slow.resolve({ ok: true, value: 'https://github.com/o/p/pull/1' })
      await created
    })

    expect(result.current.creating).toBe(false)
  })
})
