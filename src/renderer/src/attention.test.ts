import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { type Notice, noticeFrom, projectMark, seen, settle, withNotice } from './attention.js'
import { workspaceView } from './test/workspaces.js'

const ANNA = workspaceView('anna')
const BEN = workspaceView('ben')
const OTHER = workspaceView('cleo', { id: 'tracker/cleo', projectId: 'tracker' })
const ALL = [ANNA, BEN, OTHER]

function from(event: AgentEvent, workspaceId = ANNA.id, chatId = 'c-1'): Notice | null {
  return noticeFrom({ chatId, workspaceId, event }, ALL, 7)
}

function notice(overrides: Partial<Notice> = {}): Notice {
  return {
    chatId: 'c-1',
    workspaceId: ANNA.id,
    projectId: 'planner',
    kind: 'done',
    toolName: '',
    at: 1,
    ...overrides
  }
}

function waitingIn(workspace: WorkspaceView, chatId: string): WorkspaceView {
  return {
    ...workspace,
    status: 'waiting_permission',
    chats: [
      {
        id: chatId,
        agent: 'claude',
        title: null,
        status: 'waiting_permission',
        started: true,
        interrupted: false,
        turnStartedAt: null
      }
    ]
  }
}

const RESULT = {
  type: 'result',
  ok: true,
  costUsd: null,
  durationMs: 1,
  inputTokens: null,
  outputTokens: null,
  terminalReason: null
} satisfies AgentEvent

describe('the notice an event amounts to', () => {
  it('reads the conversation coming to rest as done and a failed turn as an error', () => {
    expect(from({ type: 'finished' })).toEqual(notice({ at: 7 }))
    expect(from({ ...RESULT, ok: false })?.kind).toBe('error')
    expect(from({ type: 'error', message: 'gone' })?.kind).toBe('error')
  })

  // The CLI opens a turn of its own to hand over each finished agent's report:
  // a turn ending is not the work being done.
  it('is nothing for a turn that ended well', () => {
    expect(from(RESULT)).toBeNull()
  })

  it('names the project from the workspace it happened in', () => {
    expect(from({ type: 'finished' }, OTHER.id)?.projectId).toBe('tracker')
  })

  // A question and a plan come as permission requests, and are asked about
  // differently.
  it('tells a question and a plan from a permission, which names its tool', () => {
    const request = { type: 'permission_request', requestId: 'r' } as const

    expect(
      from({
        ...request,
        toolName: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Which?',
              header: 'Pick',
              multiSelect: false,
              options: [
                { label: 'A', description: '' },
                { label: 'B', description: '' }
              ]
            }
          ]
        }
      })?.kind
    ).toBe('question')
    expect(from({ ...request, toolName: 'ExitPlanMode', input: {} })?.kind).toBe('plan')
    expect(from({ ...request, toolName: 'Bash', input: {} })).toMatchObject({
      kind: 'permission',
      toolName: 'Bash'
    })
  })

  // A form holds the turn as a question does, and is put to the user as one.
  it("reads an MCP server's form as a question", () => {
    expect(
      from({
        type: 'elicitation_request',
        requestId: 'f',
        serverName: 'ledger',
        message: 'Which token?',
        title: '',
        fields: []
      })?.kind
    ).toBe('question')
  })

  it('is nothing for an event that is not news', () => {
    expect(from({ type: 'text', text: 'hi' })).toBeNull()
  })

  it('is nothing for a workspace the window does not know', () => {
    expect(from(RESULT, 'gone/workspace')).toBeNull()
  })
})

describe('the list of notices', () => {
  // One per conversation: keyed by workspace, a chat that finished would wipe
  // out another that was still waiting on an answer.
  it('keeps one notice per conversation, the newest', () => {
    const waiting = notice({ chatId: 'c-1', kind: 'permission' })
    const finished = notice({ chatId: 'c-2', kind: 'done' })

    const list = withNotice(withNotice([], waiting), finished)

    expect(list).toEqual([waiting, finished])
    expect(withNotice(list, notice({ chatId: 'c-1', kind: 'error' }))).toEqual([
      finished,
      notice({ chatId: 'c-1', kind: 'error' })
    ])
  })

  it('forgets a workspace once it has been looked at', () => {
    const list = [notice(), notice({ chatId: 'c-2', workspaceId: BEN.id })]

    expect(seen(list, ANNA.id)).toEqual([list[1]])
  })

  // Answered in another window, or the turn stopped: the wait is over.
  it('drops a wait whose conversation is no longer waiting', () => {
    const asking = notice({ chatId: 'c-1', kind: 'question' })
    const finished = notice({ chatId: 'c-2', kind: 'done' })

    expect(settle([asking, finished], [waitingIn(ANNA, 'c-1')])).toEqual([asking, finished])
    expect(settle([asking, finished], ALL)).toEqual([finished])
  })

  /*
   * A message left in the agent's queue runs as a turn of its own once this one
   * has ended — after a Stop, always — and the conversation is running again.
   * "Done" over a tab that is working is the one thing the notice must not say.
   */
  it('drops a finished turn whose conversation is running again', () => {
    const finished = notice({ chatId: 'c-1', kind: 'done' })
    const failed = notice({ chatId: 'c-2', kind: 'error' })
    const running: WorkspaceView = {
      ...ANNA,
      status: 'running',
      chats: [
        {
          id: 'c-1',
          agent: 'claude',
          title: null,
          status: 'running',
          started: true,
          interrupted: false,
          turnStartedAt: null
        },
        {
          id: 'c-2',
          agent: 'claude',
          title: null,
          status: 'running',
          started: true,
          interrupted: false,
          turnStartedAt: null
        }
      ]
    }

    // A failure stays: it is still news while the next turn runs.
    expect(settle([finished, failed], [running])).toEqual([failed])
    expect(settle([finished, failed], ALL)).toEqual([finished, failed])
  })

  it('hands back the same list when nothing changed', () => {
    const list = [notice()]

    expect(settle(list, ALL)).toBe(list)
  })
})

describe("a project's mark", () => {
  it('says waiting while any of its workspaces waits, whatever else is news', () => {
    expect(projectMark('planner', [waitingIn(ANNA, 'c-1'), BEN], [notice({ kind: 'error' })])).toBe(
      'waiting'
    )
  })

  it('puts an error before a finished turn', () => {
    const list = [notice({ kind: 'done' }), notice({ chatId: 'c-2', kind: 'error' })]

    expect(projectMark('planner', ALL, list)).toBe('error')
    expect(projectMark('planner', ALL, [notice({ kind: 'done' })])).toBe('done')
  })

  it('is nothing when the news is about another project, or there is none', () => {
    expect(projectMark('tracker', [waitingIn(ANNA, 'c-1')], [notice()])).toBeNull()
    expect(projectMark('planner', ALL, [])).toBeNull()
  })

  // A wait shows through the live status; its notice is for saying what about.
  it('does not read a waiting notice as a finished turn', () => {
    expect(projectMark('planner', ALL, [notice({ kind: 'permission' })])).toBeNull()
  })
})
