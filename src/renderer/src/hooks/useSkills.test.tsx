import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Chat } from '@core/chats.js'
import type { SkillListing } from '@core/skills.js'

import { chat as chatRecord } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { useSkills } from './useSkills.js'

const CHAT = 'chat-1'
const WORKSPACE = 'planner/lily'

function listing(overrides: Partial<SkillListing> = {}): SkillListing {
  return {
    key: 'review',
    name: 'review',
    description: 'When reviewing.',
    scope: 'global',
    enabled: true,
    ...overrides
  }
}

const answering = (skills: readonly SkillListing[]): void => {
  vi.mocked(octopus().skills.forChat).mockResolvedValue({ ok: true, value: [...skills] })
  vi.mocked(octopus().skills.forWorkspace).mockResolvedValue({ ok: true, value: [...skills] })
}

/** The record `openChat` would create, or nothing when the call is refused. */
function ensuring(record: Chat | null = chatRecord({ id: CHAT })): () => Promise<Chat | null> {
  return vi.fn(() => Promise.resolve(record))
}

describe('which skills a conversation may reach for', () => {
  it('asks about the conversation once there is one', async () => {
    answering([listing()])

    const { result } = renderHook(() => useSkills(CHAT, WORKSPACE, ensuring()))

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })
    expect(octopus().skills.forChat).toHaveBeenCalledWith(CHAT)
    expect(octopus().skills.forWorkspace).not.toHaveBeenCalled()
  })

  /*
   * `openChat` is lazy, so a workspace nobody has spoken to has no record —
   * and the panel would otherwise be empty in exactly the place somebody opens
   * it first. The defaults are the whole answer at that point.
   */
  it('asks about the workspace before the first message', async () => {
    answering([listing()])

    const { result } = renderHook(() => useSkills(null, WORKSPACE, ensuring()))

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })
    expect(octopus().skills.forWorkspace).toHaveBeenCalledWith(WORKSPACE)
  })

  /*
   * A list belonging to the conversation just left is not stale, it is wrong.
   * Cleared while rendering rather than in an effect, which `react-hooks`
   * refuses here anyway.
   */
  it('drops the list the moment the conversation changes', async () => {
    answering([listing()])
    const { result, rerender } = renderHook(({ id }) => useSkills(id, WORKSPACE, ensuring()), {
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
    const { result } = renderHook(() => useSkills(CHAT, WORKSPACE, ensuring()))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    act(() => {
      result.current.toggle('review', false)
    })

    expect(result.current.skills[0]?.enabled).toBe(false)
    expect(octopus().skills.setForChat).toHaveBeenCalledExactlyOnceWith(CHAT, 'review', false)
  })

  it('moves the one it was asked about and leaves the rest alone', async () => {
    answering([listing(), listing({ key: 'ship', name: 'ship' })])
    const { result } = renderHook(() => useSkills(CHAT, WORKSPACE, ensuring()))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2)
    })

    act(() => {
      result.current.toggle('ship', false)
    })

    expect(result.current.skills.map((skill) => skill.enabled)).toEqual([true, false])
  })

  /*
   * Switching one before the first message is the moment the record is
   * created — the same thing the model and effort pickers beside it do.
   */
  it('creates the conversation it needs to write to', async () => {
    answering([listing()])
    const ensure = ensuring()
    const { result } = renderHook(() => useSkills(null, WORKSPACE, ensure))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    act(() => {
      result.current.toggle('review', false)
    })

    await waitFor(() => {
      expect(octopus().skills.setForChat).toHaveBeenCalledExactlyOnceWith(CHAT, 'review', false)
    })
    expect(ensure).toHaveBeenCalledTimes(1)
  })

  it('writes nothing when the conversation could not be created', async () => {
    answering([listing()])
    const { result } = renderHook(() => useSkills(null, WORKSPACE, ensuring(null)))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    act(() => {
      result.current.toggle('review', false)
    })

    await waitFor(() => {
      expect(octopus().skills.setForChat).not.toHaveBeenCalled()
    })
  })

  // The switch must never show a state the agent is not in, so a write that
  // did not land is followed by the service's own answer rather than left.
  it('puts the switch back when the write is refused', async () => {
    answering([listing()])
    const { result } = renderHook(() => useSkills(CHAT, WORKSPACE, ensuring()))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    vi.mocked(octopus().skills.setForChat).mockResolvedValue({ ok: false, error: 'no' })

    act(() => {
      result.current.toggle('review', false)
    })

    await waitFor(() => {
      expect(result.current.skills[0]?.enabled).toBe(true)
    })
  })

  /*
   * What changes this list happens in another window — a skill written in
   * settings, a project's defaults edited — so there is no event to listen for
   * and opening the panel is the moment worth being right.
   */
  it('re-reads on request', async () => {
    answering([listing()])
    const { result } = renderHook(() => useSkills(CHAT, WORKSPACE, ensuring()))
    await waitFor(() => {
      expect(result.current.skills).toHaveLength(1)
    })

    answering([listing(), listing({ key: 'ship', name: 'ship' })])
    act(() => {
      result.current.refresh()
    })

    await waitFor(() => {
      expect(result.current.skills).toHaveLength(2)
    })
  })

  // "Could not ask" and "there are none" are different statements, and an
  // emptied panel would make the first look like the second.
  it('leaves the last good list standing when a read fails', async () => {
    answering([listing()])
    const { result } = renderHook(() => useSkills(CHAT, WORKSPACE, ensuring()))
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
