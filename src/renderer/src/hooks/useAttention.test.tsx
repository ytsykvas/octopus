import { type RenderHookResult, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { Project } from '@core/store.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { emitAgentEvent } from '../test/chat.js'
import { workspaceView } from '../test/workspaces.js'
import { type Attention, useAttention } from './useAttention.js'

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
}

function render(
  open: string | null,
  workspaces: readonly WorkspaceView[] = [ANNA, BEN]
): RenderHookResult<Attention, Props> {
  return renderHook(({ openId, list }: Props) => useAttention([PLANNER], list, openId), {
    initialProps: { openId: open, list: workspaces }
  })
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
})
