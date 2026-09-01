import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SkillListing } from '@core/skills.js'

import { octopus } from '../test/octopus.js'
import { useSkills } from './useSkills.js'

const CHAT = 'chat-1'

function listing(overrides: Partial<SkillListing> = {}): SkillListing {
  return {
    key: 'octopus:review',
    name: 'review',
    description: 'When reviewing.',
    path: '/skills/review',
    scope: 'global',
    enabled: true,
    ...overrides
  }
}

const answering = (skills: readonly SkillListing[]): void => {
  vi.mocked(octopus().skills.forChat).mockResolvedValue({ ok: true, value: [...skills] })
}

describe('which skills a conversation may reach for', () => {
  it('asks as soon as there is a conversation to ask about', async () => {
    answering([listing()])

    const { result } = renderHook(() => useSkills(CHAT))

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })
  })

  // A workspace nobody has spoken to has no record, so there is nothing to ask
  // about — and asking anyway would create one.
  it('asks nothing before the conversation exists', () => {
    renderHook(() => useSkills(null))

    expect(octopus().skills.forChat).not.toHaveBeenCalled()
  })

  /*
   * A list belonging to the conversation just left is not stale, it is wrong.
   * Cleared while rendering rather than in an effect, which `react-hooks`
   * refuses here anyway.
   */
  it('drops the list the moment the conversation changes', async () => {
    answering([listing()])
    const { result, rerender } = renderHook(({ id }) => useSkills(id), {
      initialProps: { id: CHAT }
    })
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    answering([])
    rerender({ id: 'chat-2' })

    expect(result.current.skills).toEqual([])
  })

  it('switches one, and shows the answer without waiting for the round trip', async () => {
    answering([listing()])
    const { result } = renderHook(() => useSkills(CHAT))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    act(() => {
      result.current.toggle('octopus:review', false)
    })

    expect(result.current.skills[0]?.enabled).toBe(false)
    expect(octopus().skills.setForChat).toHaveBeenCalledExactlyOnceWith(
      CHAT,
      'octopus:review',
      false
    )
  })

  // The switch must never show a state the agent is not in, so a write that
  // did not land is followed by the service's own answer rather than left.
  it('puts the switch back when the write is refused', async () => {
    answering([listing()])
    const { result } = renderHook(() => useSkills(CHAT))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    vi.mocked(octopus().skills.setForChat).mockResolvedValue({ ok: false, error: 'no' })

    act(() => {
      result.current.toggle('octopus:review', false)
    })

    await waitFor(() => {
      expect(result.current.skills[0]?.enabled).toBe(true)
    })
  })

  it('moves the one it was asked about and leaves the rest alone', async () => {
    answering([listing(), listing({ key: 'octopus:ship', name: 'ship' })])
    const { result } = renderHook(() => useSkills(CHAT))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2)
    })

    act(() => {
      result.current.toggle('octopus:ship', false)
    })

    expect(result.current.skills.map((skill) => skill.enabled)).toEqual([true, false])
  })

  it('switches nothing when there is no conversation', () => {
    const { result } = renderHook(() => useSkills(null))

    act(() => {
      result.current.toggle('octopus:review', false)
    })

    expect(octopus().skills.setForChat).not.toHaveBeenCalled()
  })

  /*
   * What changes this list happens in another window — a skill written in
   * settings, a project's defaults edited — so there is no event to listen for
   * and opening the panel is the moment worth being right.
   */
  it('re-reads on request, and asks nothing when there is nothing to ask about', async () => {
    answering([listing()])
    const { result } = renderHook(() => useSkills(CHAT))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    answering([listing(), listing({ key: 'octopus:ship', name: 'ship' })])
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2)
    })

    const { result: empty } = renderHook(() => useSkills(null))
    vi.mocked(octopus().skills.forChat).mockClear()
    act(() => {
      empty.current.refresh()
    })
    expect(octopus().skills.forChat).not.toHaveBeenCalled()
  })

  // "Could not ask" and "there are none" are different statements, and an
  // emptied panel would make the first look like the second.
  it('leaves the last good list standing when a read fails', async () => {
    answering([listing()])
    const { result } = renderHook(() => useSkills(CHAT))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    vi.mocked(octopus().skills.forChat).mockResolvedValue({ ok: false, error: 'no' })
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })
  })
})
