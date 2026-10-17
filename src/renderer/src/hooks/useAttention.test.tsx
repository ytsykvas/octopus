import { act, type RenderHookResult, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { emitAgentEvent } from '../test/chat.js'
import { workspaceView } from '../test/workspaces.js'
import { chime } from '../sound.js'
import { type Attention, TOAST_LIMIT, useAttention } from './useAttention.js'

vi.mock('../sound.js', () => ({ chime: vi.fn() }))

afterEach(() => {
  vi.mocked(chime).mockClear()
  vi.restoreAllMocks()
})

const PLANNER = { id: 'planner' } as Project
const ANNA = workspaceView('anna')
const BEN = workspaceView('ben')

const DONE: AgentEvent = {
  type: 'result',
  ok: true,
  costUsd: null,
  durationMs: 1,
  inputTokens: null,
  outputTokens: null,
  terminalReason: null
}

interface Props {
  readonly openId: string | null
  readonly list: readonly WorkspaceView[]
  readonly sound?: boolean
}

function render(
  open: string | null,
  workspaces: readonly WorkspaceView[] = [ANNA, BEN],
  sound = false
): RenderHookResult<Attention, Props> {
  return renderHook(
    ({ openId, list, sound: audible }: Props) =>
      useAttention([PLANNER], list, openId, audible ?? sound),
    { initialProps: { openId: open, list: workspaces } }
  )
}

/** The window in front of the user, or behind another application. */
function focused(inFront: boolean): void {
  vi.spyOn(document, 'hasFocus').mockReturnValue(inFront)
}

describe('useAttention', () => {
  it('marks the project when an agent finishes in a workspace nobody is looking at', () => {
    const { result } = render(BEN.id)

    emitAgentEvent(DONE, 'c-1', ANNA.id)

    expect(result.current.notices).toMatchObject([{ workspaceId: ANNA.id, kind: 'done' }])
    expect(result.current.marks.get('planner')).toBe('done')
  })

  // A streamed word is not news; only the end of a turn or a question is.
  it('records nothing for an event that is not news', () => {
    const { result } = render(BEN.id)

    emitAgentEvent({ type: 'text', text: 'Looking…' }, 'c-1', ANNA.id)

    expect(result.current.notices).toEqual([])
  })

  // The user is already there; telling them would be noise.
  it('records nothing for the workspace on screen', () => {
    const { result } = render(ANNA.id)

    emitAgentEvent(DONE, 'c-1', ANNA.id)

    expect(result.current.notices).toEqual([])
    expect(result.current.marks.size).toBe(0)
  })

  it('forgets a workspace the moment it is opened', () => {
    const { result, rerender } = render(BEN.id)
    emitAgentEvent(DONE, 'c-1', ANNA.id)

    rerender({ openId: ANNA.id, list: [ANNA, BEN] })

    expect(result.current.notices).toEqual([])
    expect(result.current.marks.size).toBe(0)
  })

  // Opening something else must not clear what it did not show.
  it('keeps the news of a workspace that was not the one opened', () => {
    const { result, rerender } = render(null)
    emitAgentEvent(DONE, 'c-1', ANNA.id)

    rerender({ openId: BEN.id, list: [ANNA, BEN] })
    rerender({ openId: null, list: [ANNA, BEN] })

    expect(result.current.notices).toMatchObject([{ workspaceId: ANNA.id }])
  })

  // The listener is subscribed once and reads the open workspace through a ref
  // — so it must see a change of workspace that happened after it subscribed.
  it('follows the open workspace after subscribing', () => {
    const { result, rerender } = render(BEN.id)

    rerender({ openId: ANNA.id, list: [ANNA, BEN] })
    emitAgentEvent(DONE, 'c-1', ANNA.id)
    emitAgentEvent(DONE, 'c-2', BEN.id)

    expect(result.current.notices).toMatchObject([{ workspaceId: BEN.id }])
  })

  it('shows a wait through the live status, until it is answered', () => {
    const waiting = {
      ...ANNA,
      status: 'waiting_permission' as const,
      chats: [
        {
          id: 'c-1',
          agent: 'claude' as const,
          title: null,
          status: 'waiting_permission' as const,
          started: true
        }
      ]
    }
    const { result, rerender } = render(BEN.id, [waiting, BEN])
    emitAgentEvent(
      { type: 'permission_request', requestId: 'r', toolName: 'Bash', input: {} },
      'c-1',
      ANNA.id
    )

    expect(result.current.marks.get('planner')).toBe('waiting')
    expect(result.current.notices).toMatchObject([{ kind: 'permission' }])

    rerender({ openId: BEN.id, list: [ANNA, BEN] })

    expect(result.current.marks.size).toBe(0)
    expect(result.current.notices).toEqual([])
  })

  describe('the sound', () => {
    it('chimes for news from a workspace out of sight', () => {
      focused(true)
      render(BEN.id, [ANNA, BEN], true)

      emitAgentEvent(DONE, 'c-1', ANNA.id)

      expect(chime).toHaveBeenCalledWith('done')
    })

    it('stays quiet when the switch is off', () => {
      focused(false)
      render(BEN.id, [ANNA, BEN], false)

      emitAgentEvent(DONE, 'c-1', ANNA.id)

      expect(chime).not.toHaveBeenCalled()
    })

    // The workspace on screen is not news while somebody is looking at it —
    // but somebody in another application is not looking at it either.
    it('chimes for the workspace on screen only while the window is behind another', () => {
      const { result } = render(ANNA.id, [ANNA, BEN], true)

      focused(true)
      emitAgentEvent(DONE, 'c-1', ANNA.id)
      expect(chime).not.toHaveBeenCalled()

      focused(false)
      emitAgentEvent(DONE, 'c-1', ANNA.id)
      expect(chime).toHaveBeenCalledWith('done')
      // A sound only: no toast and no mark for the workspace already open.
      expect(result.current.notices).toEqual([])
    })

    it('follows the switch after subscribing', () => {
      focused(true)
      const { rerender } = render(BEN.id, [ANNA, BEN], false)

      rerender({ openId: BEN.id, list: [ANNA, BEN], sound: true })
      emitAgentEvent(DONE, 'c-1', ANNA.id)

      expect(chime).toHaveBeenCalledOnce()
    })
  })

  describe('the toasts', () => {
    it('draws the newest first, no more than the limit', () => {
      const many = Array.from({ length: TOAST_LIMIT + 1 }, (_, index) =>
        workspaceView(`w${String(index)}`)
      )
      const { result } = render(BEN.id, [...many, BEN])

      for (const [index, workspace] of many.entries()) {
        emitAgentEvent(DONE, `c-${String(index)}`, workspace.id)
      }

      expect(result.current.toasts.map((toast) => toast.chatId)).toEqual(['c-3', 'c-2', 'c-1'])
    })

    // A toast closed by hand is gone; the news itself is not — the tab keeps
    // its mark until the workspace is opened.
    it('takes a dismissed toast down and leaves the mark', () => {
      const { result } = render(BEN.id)
      emitAgentEvent(DONE, 'c-1', ANNA.id)

      act(() => {
        const [toast] = result.current.toasts
        if (toast) result.current.dismiss(toast)
      })

      expect(result.current.toasts).toEqual([])
      expect(result.current.marks.get('planner')).toBe('done')
    })

    it('shows the next news from a conversation whose toast was dismissed', () => {
      const { result } = render(BEN.id)
      emitAgentEvent(DONE, 'c-1', ANNA.id)
      act(() => {
        const [toast] = result.current.toasts
        if (toast) result.current.dismiss(toast)
      })

      emitAgentEvent({ type: 'error', message: 'failed' }, 'c-1', ANNA.id)

      expect(result.current.toasts).toMatchObject([{ chatId: 'c-1', kind: 'error' }])
    })
  })
})
