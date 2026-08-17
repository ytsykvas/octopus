import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PullRequestView } from '@core/pullRequests.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { usePullRequest } from './usePullRequest.js'

const VIEW: PullRequestView = { request: null, pushed: true, dirty: false, ahead: 1 }

const DRAFT = { title: 'Rename', body: '', draft: false }

describe('the pull request of a workspace', () => {
  // Nothing to ask about, so nothing is asked — and `create` has nowhere to
  // send a request either. The panel guards this too; the hook is what would
  // be reached by anything else that used it.
  it('asks nothing and creates nothing without a workspace', async () => {
    const { result } = renderHook(() => usePullRequest(null, true))

    await expect(result.current.create(DRAFT)).resolves.toBeNull()
    expect(octopus().workspaces.pullRequest).not.toHaveBeenCalled()
    expect(octopus().workspaces.createPullRequest).not.toHaveBeenCalled()
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
