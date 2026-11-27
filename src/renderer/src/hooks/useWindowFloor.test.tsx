import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { octopus } from '../test/octopus.js'
import { useWindowFloor } from './useWindowFloor.js'

beforeEach(() => {
  octopus()
})

describe('useWindowFloor', () => {
  it('holds the window to the floor, and again whenever it moves', async () => {
    const { rerender } = renderHook(
      ({ floor }) => {
        useWindowFloor(floor, vi.fn())
      },
      {
        initialProps: { floor: 960 }
      }
    )

    rerender({ floor: 1400 })

    await waitFor(() => {
      expect(octopus().frame.fit).toHaveBeenLastCalledWith(1400)
    })
    expect(octopus().frame.fit).toHaveBeenCalledWith(960)
  })

  it('says so when the window could not be held', async () => {
    vi.mocked(octopus().frame.fit).mockResolvedValue({ ok: false, error: 'no window' })
    const onError = vi.fn()

    renderHook(() => {
      useWindowFloor(960, onError)
    })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Something went wrong: no window')
    })
  })

  it('stays quiet when it was', async () => {
    const onError = vi.fn()

    renderHook(() => {
      useWindowFloor(960, onError)
    })

    await waitFor(() => {
      expect(octopus().frame.fit).toHaveBeenCalled()
    })
    await Promise.resolve()
    expect(onError).not.toHaveBeenCalled()
  })
})
