import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { LibraryEntry } from '@core/library.js'

import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useLibraryStore } from './useLibraryStore.js'

interface Listing {
  ok: true
  value: LibraryEntry[]
}

const SHIP: LibraryEntry = {
  kind: 'command',
  name: 'ship',
  description: '',
  path: '/x/ship.md'
}

const GATE: LibraryEntry = { ...SHIP, name: 'gate', path: '/x/gate.md' }

describe('a read the hook has already abandoned', () => {
  /*
   * The window mounts the hook, tears it down and mounts it again under
   * `StrictMode`, which is how the application runs in development. The first
   * read is still in flight when that happens, and its answer describes a store
   * nobody is looking at any more.
   */
  it('is dropped rather than drawn', async () => {
    const abandoned = held<Listing>()
    vi.mocked(octopus().library.list)
      .mockReturnValueOnce(abandoned.promise)
      .mockResolvedValue({ ok: true, value: [GATE] })

    const { result } = renderHook(() => useLibraryStore({ kind: 'global' }, 'command'), {
      wrapper: StrictMode
    })
    await waitFor(() => {
      expect(result.current.entries).toEqual([GATE])
    })

    await act(async () => {
      abandoned.resolve({ ok: true, value: [SHIP] })
      await abandoned.promise
    })

    expect(result.current.entries).toEqual([GATE])
  })
})
