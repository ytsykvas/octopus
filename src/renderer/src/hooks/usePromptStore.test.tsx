import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Prompt, PromptDraft } from '@core/promptSchema.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { usePromptStore } from './usePromptStore.js'

const A: Prompt = {
  id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
  title: 'Review',
  text: 'Look it over.',
  forPlan: false
}
const B: Prompt = { ...A, id: '8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d', title: 'Tests' }
const DRAFT: PromptDraft = { title: 'Review', text: 'Look it over.', forPlan: false }
const GLOBAL = { kind: 'global' } as const

const refused = { ok: false, error: 'It is gone.', code: 'promptMissing' } as const

describe('usePromptStore', () => {
  it('reads the store when it mounts', async () => {
    vi.mocked(octopus().prompts.list).mockResolvedValue({ ok: true, value: [A, B] })

    const { result } = renderHook(() => usePromptStore(GLOBAL))

    await waitFor(() => {
      expect(result.current.prompts).toEqual([A, B])
    })
    expect(octopus().prompts.list).toHaveBeenCalledWith(GLOBAL)
  })

  it('says why a read failed, in the reader’s language', async () => {
    vi.mocked(octopus().prompts.list).mockResolvedValue(refused)

    const { result } = renderHook(() => usePromptStore(GLOBAL))

    await waitFor(() => {
      expect(result.current.error).toBe('That prompt is not there any more.')
    })
  })

  // The caller builds the store inline on every render; an identity check would
  // read the list again on each one.
  it('reads once for a project store rebuilt with the same id', async () => {
    const { rerender } = renderHook(
      () => usePromptStore({ kind: 'project', projectId: 'planner' }),
      {}
    )
    await waitFor(() => {
      expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
    })

    rerender()
    rerender()

    expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
    expect(octopus().prompts.list).toHaveBeenCalledWith({ kind: 'project', projectId: 'planner' })
  })

  it('reads again for another project', async () => {
    const { rerender } = renderHook(
      ({ projectId }) => usePromptStore({ kind: 'project', projectId }),
      { initialProps: { projectId: 'planner' } }
    )
    await waitFor(() => {
      expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
    })

    rerender({ projectId: 'site' })

    await waitFor(() => {
      expect(octopus().prompts.list).toHaveBeenLastCalledWith({
        kind: 'project',
        projectId: 'site'
      })
    })
  })

  describe('a write', () => {
    it('creates, then reads the list again rather than patching it', async () => {
      const { result } = renderHook(() => usePromptStore(GLOBAL))
      await waitFor(() => {
        expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
      })
      vi.mocked(octopus().prompts.list).mockResolvedValue({ ok: true, value: [A] })

      let saved = false
      await act(async () => {
        saved = await result.current.create(DRAFT)
      })

      expect(saved).toBe(true)
      expect(octopus().prompts.create).toHaveBeenCalledWith(GLOBAL, DRAFT)
      expect(result.current.prompts).toEqual([A])
      expect(result.current.error).toBeNull()
    })

    it('updates, removes and reorders through the bridge', async () => {
      const { result } = renderHook(() => usePromptStore(GLOBAL))
      await waitFor(() => {
        expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
      })

      await act(async () => {
        await result.current.update(A.id, DRAFT)
        await result.current.remove(B.id)
        await result.current.reorder([B.id, A.id])
      })

      expect(octopus().prompts.update).toHaveBeenCalledWith(GLOBAL, A.id, DRAFT)
      expect(octopus().prompts.remove).toHaveBeenCalledWith(GLOBAL, B.id)
      expect(octopus().prompts.reorder).toHaveBeenCalledWith(GLOBAL, [B.id, A.id])
      expect(octopus().prompts.list).toHaveBeenCalledTimes(4)
    })

    it('reports a refused write as false with the reason, and reads the list again anyway', async () => {
      vi.mocked(octopus().prompts.update).mockResolvedValue(refused)
      const { result } = renderHook(() => usePromptStore(GLOBAL))
      await waitFor(() => {
        expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
      })

      let saved = true
      await act(async () => {
        saved = await result.current.update(A.id, DRAFT)
      })

      // The prompt was likely removed elsewhere, and the list should say so.
      expect(saved).toBe(false)
      expect(result.current.error).toBe('That prompt is not there any more.')
      expect(octopus().prompts.list).toHaveBeenCalledTimes(2)
    })

    it('forgets the reason once the next write works', async () => {
      vi.mocked(octopus().prompts.create).mockResolvedValueOnce(refused)
      const { result } = renderHook(() => usePromptStore(GLOBAL))
      await waitFor(() => {
        expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
      })

      await act(async () => {
        await result.current.create(DRAFT)
      })
      expect(result.current.error).not.toBeNull()

      await act(async () => {
        await result.current.create(DRAFT)
      })
      expect(result.current.error).toBeNull()
    })

    // The write landed and the list could not be read back: what is on screen
    // is stale, and the reader should be told rather than left with it.
    it('says so when the list cannot be read again after a write that worked', async () => {
      const { result } = renderHook(() => usePromptStore(GLOBAL))
      await waitFor(() => {
        expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
      })
      vi.mocked(octopus().prompts.list).mockResolvedValue(refused)

      let saved = false
      await act(async () => {
        saved = await result.current.create(DRAFT)
      })

      expect(saved).toBe(true)
      expect(result.current.error).toBe('That prompt is not there any more.')
    })

    it('says so when a removal or a reorder is refused', async () => {
      vi.mocked(octopus().prompts.remove).mockResolvedValue(refused)
      vi.mocked(octopus().prompts.reorder).mockResolvedValue(refused)
      const { result } = renderHook(() => usePromptStore(GLOBAL))
      await waitFor(() => {
        expect(octopus().prompts.list).toHaveBeenCalledTimes(1)
      })

      await act(async () => {
        await result.current.remove(A.id)
      })
      expect(result.current.error).toBe('That prompt is not there any more.')

      await act(async () => {
        await result.current.reorder([A.id])
      })
      expect(result.current.error).toBe('That prompt is not there any more.')
    })
  })

  describe('a read the hook has already abandoned', () => {
    // Mounted, torn down and mounted again under `StrictMode`, as the app runs
    // in development: the first read is still in flight, and its answer
    // describes a store nobody is looking at any more.
    it('is dropped rather than drawn', async () => {
      const abandoned = held<{ ok: true; value: Prompt[] }>()
      vi.mocked(octopus().prompts.list)
        .mockReturnValueOnce(abandoned.promise)
        .mockResolvedValue({ ok: true, value: [B] })

      const { result } = renderHook(() => usePromptStore(GLOBAL), { wrapper: StrictMode })
      await waitFor(() => {
        expect(result.current.prompts).toEqual([B])
      })

      await act(async () => {
        abandoned.resolve({ ok: true, value: [A] })
        await abandoned.promise
      })

      expect(result.current.prompts).toEqual([B])
    })
  })
})
