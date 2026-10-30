import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Prompt } from '@core/promptSchema.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { usePrompts } from './usePrompts.js'

const HERE: Prompt = {
  id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
  title: 'Here',
  text: 'In this project.',
  forPlan: false
}
const EVERYWHERE: Prompt = {
  ...HERE,
  id: '8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  title: 'Everywhere'
}

const failed = { ok: false, error: 'No.' } as const

/** Answers by the store asked about, as the real bridge does. */
function answering(options: {
  readonly project: Prompt[] | typeof failed
  readonly global: Prompt[] | typeof failed
}): void {
  vi.mocked(octopus().prompts.list).mockImplementation((store) => {
    const answer = store.kind === 'global' ? options.global : options.project

    return Promise.resolve(Array.isArray(answer) ? { ok: true, value: answer } : answer)
  })
}

describe('usePrompts', () => {
  it('reads the project’s prompts and the installation’s, each from its own store', async () => {
    answering({ project: [HERE], global: [EVERYWHERE] })

    const { result } = renderHook(() => usePrompts('planner'))

    await waitFor(() => {
      expect(result.current.project).toEqual([HERE])
    })
    expect(result.current.global).toEqual([EVERYWHERE])
    expect(octopus().prompts.list).toHaveBeenCalledWith({ kind: 'project', projectId: 'planner' })
    expect(octopus().prompts.list).toHaveBeenCalledWith({ kind: 'global' })
  })

  it('starts with nothing rather than with a guess', () => {
    answering({ project: [HERE], global: [EVERYWHERE] })

    const { result } = renderHook(() => usePrompts('planner'))

    expect(result.current.project).toEqual([])
    expect(result.current.global).toEqual([])
  })

  it('reads both again when asked, which is how a prompt just saved shows up', async () => {
    answering({ project: [], global: [] })
    const { result } = renderHook(() => usePrompts('planner'))
    await waitFor(() => {
      expect(octopus().prompts.list).toHaveBeenCalledTimes(2)
    })

    answering({ project: [HERE], global: [EVERYWHERE] })
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.project).toEqual([HERE])
    expect(result.current.global).toEqual([EVERYWHERE])
  })

  it('reads again for another project', async () => {
    answering({ project: [], global: [] })
    const { rerender } = renderHook(({ id }) => usePrompts(id), {
      initialProps: { id: 'planner' }
    })
    await waitFor(() => {
      expect(octopus().prompts.list).toHaveBeenCalledTimes(2)
    })

    rerender({ id: 'site' })

    await waitFor(() => {
      expect(octopus().prompts.list).toHaveBeenCalledWith({ kind: 'project', projectId: 'site' })
    })
  })

  // A picker that throws would take the composer with it, and the composer is
  // where the user is typing.
  describe('when one of the two cannot be read', () => {
    it('keeps the project’s own and shows no installation-wide ones', async () => {
      answering({ project: [HERE], global: failed })

      const { result } = renderHook(() => usePrompts('planner'))

      await waitFor(() => {
        expect(result.current.project).toEqual([HERE])
      })
      expect(result.current.global).toEqual([])
    })

    it('keeps the installation’s and shows no project ones', async () => {
      answering({ project: failed, global: [EVERYWHERE] })

      const { result } = renderHook(() => usePrompts('planner'))

      await waitFor(() => {
        expect(result.current.global).toEqual([EVERYWHERE])
      })
      expect(result.current.project).toEqual([])
    })
  })

  describe('a read the hook has already abandoned', () => {
    // Mounted, torn down and mounted again under `StrictMode`, as the app runs
    // in development: the first read is still in flight when that happens.
    it('is dropped rather than drawn', async () => {
      const abandoned = held<{ ok: true; value: Prompt[] }>()
      vi.mocked(octopus().prompts.list).mockReturnValueOnce(abandoned.promise)
      answering({ project: [HERE], global: [EVERYWHERE] })

      const { result } = renderHook(() => usePrompts('planner'), { wrapper: StrictMode })
      await waitFor(() => {
        expect(result.current.project).toEqual([HERE])
      })

      await act(async () => {
        abandoned.resolve({ ok: true, value: [EVERYWHERE] })
        await abandoned.promise
      })

      expect(result.current.project).toEqual([HERE])
    })
  })
})
