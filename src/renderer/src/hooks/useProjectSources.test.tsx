import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SourceView } from '@core/sourceItems.js'

import type { Result } from '../../../preload/index.js'
import { octopus } from '../test/octopus.js'
import { useProjectSources } from './useProjectSources.js'

beforeEach(() => {
  octopus()
})

function view(id: SourceView['id']): SourceView {
  return { id, layers: [], effective: null, preferLocal: false, warning: null }
}

describe('useProjectSources', () => {
  it('asks nothing until the dialog shows something that needs it', () => {
    renderHook(() => useProjectSources('planner', null, false))

    expect(octopus().projects.sources).not.toHaveBeenCalled()
  })

  it('keys the answer by item, and asks again on reload', async () => {
    vi.mocked(octopus().projects.sources).mockResolvedValue({
      ok: true,
      value: [view('script.setup')]
    })
    const { result } = renderHook(() => useProjectSources('planner', 'planner/thea', true))

    await waitFor(() => {
      expect(result.current.sources.get('script.setup')).toBeDefined()
    })

    act(() => {
      result.current.reload()
    })

    await waitFor(() => {
      expect(octopus().projects.sources).toHaveBeenCalledTimes(2)
    })
  })

  /*
   * Two projects answering out of order: the slower, older answer must not
   * land on top of the newer one — a badge naming another project's source is
   * worse than none.
   */
  it('drops an answer that arrives after the project has changed', async () => {
    let settlePlanner: ((value: Result<SourceView[]>) => void) | undefined
    vi.mocked(octopus().projects.sources)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          settlePlanner = resolve
        })
      )
      .mockResolvedValueOnce({ ok: true, value: [view('script.run')] })

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useProjectSources(id, null, true),
      { initialProps: { id: 'planner' } }
    )
    rerender({ id: 'ledger' })
    await waitFor(() => {
      expect(result.current.sources.get('script.run')).toBeDefined()
    })

    await act(async () => {
      settlePlanner?.({ ok: true, value: [view('script.setup')] })
      await Promise.resolve()
    })

    expect(result.current.sources.get('script.setup')).toBeUndefined()
  })
})
