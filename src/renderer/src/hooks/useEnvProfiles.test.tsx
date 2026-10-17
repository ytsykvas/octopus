import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { octopus } from '../test/octopus.js'
import { useEnvProfiles } from './useEnvProfiles.js'

/** A deferred answer, so a test can decide when the list arrives. */
function later<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('useEnvProfiles', () => {
  it('reads the project’s sets and its default', async () => {
    vi.mocked(octopus().projects.envProfiles).mockResolvedValue({
      ok: true,
      value: { profiles: ['dev', 'prod'], projectDefault: 'prod' }
    })

    const { result } = renderHook(() => useEnvProfiles('planner', 'dev', vi.fn(), vi.fn()))

    // The fallback stands until the list lands, so nothing is drawn blank.
    expect(result.current.projectDefault).toBe('dev')
    await waitFor(() => {
      expect(result.current.profiles).toEqual(['dev', 'prod'])
    })
    expect(result.current.projectDefault).toBe('prod')
  })

  it('reads nothing without a project', () => {
    renderHook(() => useEnvProfiles(null, 'default', vi.fn(), vi.fn()))

    expect(octopus().projects.envProfiles).not.toHaveBeenCalled()
  })

  it('drops the answer for a project that is no longer open', async () => {
    // Switching projects mid-read must not leave the first one's sets on the
    // second one's switch.
    const first = later<{ ok: true; value: { profiles: string[]; projectDefault: string } }>()
    vi.mocked(octopus().projects.envProfiles)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, value: { profiles: ['a', 'b'], projectDefault: 'a' } })

    const { result, rerender } = renderHook(
      ({ project }) => useEnvProfiles(project, 'default', vi.fn(), vi.fn()),
      { initialProps: { project: 'planner' } }
    )
    rerender({ project: 'ledger' })
    await waitFor(() => {
      expect(result.current.profiles).toEqual(['a', 'b'])
    })

    await act(async () => {
      first.resolve({ ok: true, value: { profiles: ['dev', 'prod'], projectDefault: 'dev' } })
      await first.promise
    })

    expect(result.current.profiles).toEqual(['a', 'b'])
  })

  it('moves a workspace and says the list has changed', async () => {
    const onError = vi.fn()
    const onChanged = vi.fn()
    const { result } = renderHook(() => useEnvProfiles('planner', 'dev', onError, onChanged))

    await act(async () => {
      await result.current.setWorkspaceProfile('planner/anna', 'prod')
    })

    expect(octopus().workspaces.setEnvProfile).toHaveBeenCalledWith('planner/anna', 'prod')
    expect(onError).toHaveBeenCalledWith(null)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('says why a workspace could not be moved, and claims no change', async () => {
    vi.mocked(octopus().workspaces.setEnvProfile).mockResolvedValue({ ok: false, error: 'nope' })
    const onError = vi.fn()
    const onChanged = vi.fn()
    const { result } = renderHook(() => useEnvProfiles('planner', 'dev', onError, onChanged))

    await act(async () => {
      await result.current.setWorkspaceProfile('planner/anna', null)
    })

    expect(onError).toHaveBeenLastCalledWith(expect.any(String))
    expect(onError).not.toHaveBeenLastCalledWith(null)
    expect(onChanged).not.toHaveBeenCalled()
  })
})
