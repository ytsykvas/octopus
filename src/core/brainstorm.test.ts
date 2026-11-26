import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { ABANDONED, type QueryFn, READ_ONLY_TOOLS } from './agent.js'
import {
  type BrainstormEntry,
  brainstormMessage,
  type BrainstormStart,
  cardEditMessage,
  createBrainstorms,
  PROPOSAL_SHOWN,
  proposeEdit,
  proposeTasks,
  READ_ONLY
} from './brainstorm.js'
import {
  EDIT_PROPOSAL_SHAPE,
  PROPOSE_EDIT_TOOL,
  PROPOSE_TASKS_TOOL,
  TASK_PROPOSAL_SHAPE
} from './taskProposal.js'

const AT = '2026-11-26T10:00:00.000Z'
const QUESTIONS = {
  questions: [
    {
      question: 'Which way?',
      header: 'Way',
      multiSelect: false,
      options: [
        { label: 'In', description: 'Import only' },
        { label: 'Both', description: 'Both ways' }
      ]
    }
  ]
}

const START: BrainstormStart = {
  purpose: 'tasks',
  cwd: '/repo/planner',
  settingSources: ['user', 'project'],
  additionalDirectories: ['/board/planner'],
  model: 'opus',
  effort: 'high',
  message: 'Plan this.'
}

type CanUseTool = (
  name: string,
  input: Record<string, unknown>,
  options: { signal: AbortSignal }
) => Promise<{ behavior: string; message?: string; updatedInput?: unknown }>

interface FakeSession {
  readonly options: Record<string, unknown>
  readonly sent: string[]
  emit: (message: unknown) => void
  // `die` ends the stream quietly; `crash` throws from it, as the SDK does on a failed spawn.
  die: () => void
  crash: (error: Error) => void
  ask: (name: string, input: unknown, signal?: AbortSignal) => ReturnType<CanUseTool>
  interrupted: () => number
  closed: () => number
}

function fakeQuery(): { query: QueryFn; sessions: FakeSession[] } {
  const sessions: FakeSession[] = []
  const query: QueryFn = (params) => {
    const queued: unknown[] = []
    let wake: (() => void) | null = null
    let done = false
    let failure: Error | null = null
    let interrupted = 0
    let closed = 0
    const sent: string[] = []
    const options = (params.options ?? {}) as Record<string, unknown>
    void (async () => {
      for await (const message of params.prompt) {
        const { content } = message.message
        if (typeof content === 'string') sent.push(content)
      }
    })()
    const push = (): void => {
      const waiting = wake
      wake = null
      waiting?.()
    }
    async function* stream(): AsyncGenerator<SDKMessage> {
      while (!done || queued.length > 0) {
        if (failure !== null && queued.length === 0) throw failure
        const next = queued.shift()
        if (next !== undefined) {
          yield next as SDKMessage
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    }
    sessions.push({
      options,
      sent,
      emit: (message) => {
        queued.push(message)
        push()
      },
      die: () => {
        done = true
        push()
      },
      crash: (error) => {
        failure = error
        push()
      },
      ask: (name, input, signal = new AbortController().signal) =>
        (options.canUseTool as CanUseTool)(name, input as Record<string, unknown>, { signal }),
      interrupted: () => interrupted,
      closed: () => closed
    })
    return Object.assign(stream(), {
      interrupt: () => {
        interrupted += 1
        return Promise.resolve()
      },
      close: () => {
        closed += 1
        done = true
        push()
      }
    }) as unknown as Query
  }
  return { query, sessions }
}

function started(): {
  brainstorms: ReturnType<typeof createBrainstorms>
  sessions: FakeSession[]
  entries: BrainstormEntry[]
} {
  const { query, sessions } = fakeQuery()
  const entries: BrainstormEntry[] = []
  const brainstorms = createBrainstorms({
    query,
    now: () => AT,
    onEntry: (entry) => entries.push(entry),
    onDiagnostic: () => undefined
  })
  return { brainstorms, sessions, entries }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function only<T>(items: readonly T[]): T {
  expect(items).toHaveLength(1)
  return items[0] as T
}

describe('brainstormMessage', () => {
  const FACTS = {
    project: 'planner',
    boardDir: '/board/planner',
    convention: '# Task cards\n\nSay why.\n',
    idea: '  Export the board as CSV  '
  }

  it('says what the conversation is for, then the convention, the board and the idea', () => {
    expect(brainstormMessage(FACTS)).toBe(
      [
        'I want to turn an idea into tasks on the board of planner. This conversation only reads: you can read the code in this checkout and the tasks already on the board, ask me questions and propose tasks. You cannot change a file, and no task is written until I create it.',
        "1. Read the code the idea touches, and the board's tasks in /board/planner. If one already covers the idea, say so rather than proposing it again.\n2. Where a decision is mine, ask with AskUserQuestion: several questions at once, each with options.\n3. When you are ready, call propose_tasks with the tasks and a short summary of why they are split this way, then stop. I may edit the proposal, ask for changes or create the tasks.",
        '# How this project wants tasks written\n\n# Task cards\n\nSay why.',
        '# The board\n\n- Priorities: urgent, high, medium, low\n- Tags: feature, fix, bug, research, tests, refactor, docs, chore, perf, design, security, review',
        '# The idea\n\nExport the board as CSV'
      ].join('\n\n')
    )
  })

  it('names no tasks to read on a board that holds none yet', () => {
    const message = brainstormMessage({ ...FACTS, boardDir: null })

    expect(message).toContain('you can read the code in this checkout, ask me questions')
    expect(message).toContain('1. Read the code the idea touches.\n2.')
  })

  it('leaves the convention out when the project wrote an empty one', () => {
    expect(brainstormMessage({ ...FACTS, convention: ' \n' })).not.toContain(
      'How this project wants tasks written'
    )
  })
})

describe('cardEditMessage', () => {
  const FACTS = {
    project: 'planner',
    file: '/board/planner/backlog/Export.md',
    convention: 'Say why.',
    card: {
      description: '# Export\n\nAs CSV.\n',
      meta: { priority: 'high' as const, tag: 'feature' as const },
      thread: [{ at: '2026-11-20T10:00:00.000Z', text: 'Also JSON? \n' }]
    },
    request: ' Split out the JSON part '
  }

  it('gives the card as it stands, its comments and what should change', () => {
    expect(cardEditMessage(FACTS)).toBe(
      [
        "I want to rework one task on the board of planner: /board/planner/backlog/Export.md. This conversation only reads: you can read the code in this checkout and the tasks on the board, ask me questions and propose the task's new version. You cannot change a file, and the task is not rewritten until I apply it.",
        '1. Read the task below and the code it touches.\n2. Where a decision is mine, ask with AskUserQuestion: several questions at once, each with options.\n3. When you are ready, call propose_edit with the whole new version of the task and a short summary of what changed, then stop. I may edit it, ask for changes or apply it.',
        '# How this project wants tasks written\n\nSay why.',
        '# The board\n\n- Priorities: urgent, high, medium, low\n- Tags: feature, fix, bug, research, tests, refactor, docs, chore, perf, design, security, review',
        '# The task as it stands\n\n- Priority: high\n- Tag: feature\n\n# Export\n\nAs CSV.',
        '# Its comments\n\n### 2026-11-20T10:00:00.000Z\n\nAlso JSON?',
        '# What I want changed\n\nSplit out the JSON part'
      ].join('\n\n')
    )
  })

  it('says none for what the card lacks, and leaves out comments it has none of', () => {
    const message = cardEditMessage({
      ...FACTS,
      convention: '',
      card: { ...FACTS.card, meta: {}, thread: [] }
    })

    expect(message).toContain('- Priority: none\n- Tag: none')
    expect(message).not.toContain('# Its comments')
    expect(message).not.toContain('How this project wants tasks written')
  })
})

describe('proposeEdit', () => {
  it('takes the edit shape and answers that it is shown', async () => {
    expect(proposeEdit.name).toBe('propose_edit')
    expect(proposeEdit.inputSchema).toBe(EDIT_PROPOSAL_SHAPE)
    await expect(
      proposeEdit.handler({ summary: 'x', task: { title: 'A', description: '' } }, {})
    ).resolves.toEqual({ content: [{ type: 'text', text: PROPOSAL_SHOWN }] })
  })
})

describe('proposeTasks', () => {
  it('takes the proposal shape and answers that it is shown', async () => {
    expect(proposeTasks.name).toBe('propose_tasks')
    expect(proposeTasks.inputSchema).toBe(TASK_PROPOSAL_SHAPE)
    await expect(proposeTasks.handler({ summary: 'x', tasks: [] }, {})).resolves.toEqual({
      content: [{ type: 'text', text: PROPOSAL_SHOWN }]
    })
  })
})

describe('createBrainstorms', () => {
  it('starts a session shut in to reading, asking and proposing, and sends the first message', async () => {
    const { brainstorms, sessions, entries } = started()

    const id = await brainstorms.start(START)
    await tick()

    const session = only(sessions)
    expect(session.options).toMatchObject({
      cwd: '/repo/planner',
      settingSources: ['user', 'project'],
      additionalDirectories: ['/board/planner'],
      model: 'opus',
      permissionMode: 'default',
      allowedTools: [...READ_ONLY_TOOLS, PROPOSE_TASKS_TOOL],
      tools: [...READ_ONLY_TOOLS, 'AskUserQuestion'],
      mcpServers: { octopus: { type: 'sdk', name: 'octopus' } },
      strictMcpConfig: true,
      persistSession: false
    })
    expect(session.sent).toEqual(['Plan this.'])
    expect(entries).toEqual([
      { brainstormId: id, entry: { role: 'user', at: AT, text: 'Plan this.' } }
    ])
  })

  it('gives an edit its own tool and none of the other', async () => {
    const { brainstorms, sessions } = started()

    await brainstorms.start({ ...START, purpose: 'edit' })

    expect(only(sessions).options.allowedTools).toEqual([...READ_ONLY_TOOLS, PROPOSE_EDIT_TOOL])
  })

  it('passes on what the agent does, and not what is only streamed', async () => {
    const { brainstorms, sessions, entries } = started()
    const id = await brainstorms.start(START)
    const session = only(sessions)

    session.emit({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Lo' } },
      parent_tool_use_id: null,
      uuid: 'u-0',
      session_id: 's-1'
    })
    session.emit({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Looking.' }] },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    })
    await tick()

    expect(entries.slice(1)).toEqual([
      {
        brainstormId: id,
        entry: {
          role: 'agent',
          at: AT,
          event: expect.objectContaining({ type: 'text', text: 'Looking.' })
        }
      }
    ])
  })

  it('refuses every tool but the questions, without asking anyone', async () => {
    const { brainstorms, sessions, entries } = started()
    await brainstorms.start(START)

    await expect(only(sessions).ask('Bash', { command: 'ls' })).resolves.toMatchObject({
      behavior: 'deny',
      message: READ_ONLY
    })
    expect(entries).toHaveLength(1)
  })

  it('asks the person and hands the answer back as the tool reads it', async () => {
    const { brainstorms, sessions, entries } = started()
    const id = await brainstorms.start(START)

    const asked = only(sessions).ask('AskUserQuestion', QUESTIONS)
    const request = entries.at(-1)?.entry
    if (request?.role !== 'agent' || request.event.type !== 'permission_request')
      throw new Error('no question was drawn')
    expect(request.event).toEqual({
      type: 'permission_request',
      requestId: request.event.requestId,
      toolName: 'AskUserQuestion',
      input: QUESTIONS
    })

    const answers = [{ question: 'Which way?', selected: ['Both'], other: null }]
    brainstorms.answer(id, request.event.requestId, answers)

    await expect(asked).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { ...QUESTIONS, answers: { 'Which way?': 'Both' } }
    })
    expect(entries.at(-1)).toEqual({
      brainstormId: id,
      entry: {
        role: 'agent',
        at: AT,
        event: { type: 'question_answered', requestId: request.event.requestId, answers }
      }
    })
    const heard = entries.length
    brainstorms.answer(id, request.event.requestId, answers)
    expect(entries).toHaveLength(heard)
  })

  it('declines a form a server asks for', async () => {
    const { brainstorms, sessions } = started()
    await brainstorms.start(START)
    const onElicitation = only(sessions).options.onElicitation as (
      request: unknown,
      options: { signal: AbortSignal }
    ) => Promise<unknown>

    await expect(
      onElicitation(
        {
          serverName: 'octopus',
          message: 'Name?',
          mode: 'form',
          requestedSchema: { type: 'object', properties: { name: { type: 'string' } } }
        },
        { signal: new AbortController().signal }
      )
    ).resolves.toEqual({ action: 'decline' })
  })

  it('drops an answer to a question that is no longer open', async () => {
    const { brainstorms, entries } = started()
    const id = await brainstorms.start(START)

    brainstorms.answer(id, 'gone', [])

    expect(entries).toHaveLength(1)
  })

  it('takes a question back when the agent withdraws it', async () => {
    const { brainstorms, sessions, entries } = started()
    const id = await brainstorms.start(START)
    const withdrawn = new AbortController()

    const asked = only(sessions).ask('AskUserQuestion', QUESTIONS, withdrawn.signal)
    const request = entries.at(-1)?.entry
    if (request?.role !== 'agent' || request.event.type !== 'permission_request')
      throw new Error('no question was drawn')
    withdrawn.abort()
    // Answered after the question went: nothing reaches the agent twice.
    brainstorms.answer(id, request.event.requestId, [])

    await expect(asked).resolves.toMatchObject({ behavior: 'deny', message: ABANDONED })
    expect(entries.at(-1)?.entry).toEqual({
      role: 'agent',
      at: AT,
      event: { type: 'permission_withdrawn', requestId: request.event.requestId }
    })
  })

  it('says nothing when a question it already let go is withdrawn', async () => {
    const { brainstorms, sessions, entries } = started()
    const id = await brainstorms.start(START)
    const withdrawn = new AbortController()

    const asked = only(sessions).ask('AskUserQuestion', QUESTIONS, withdrawn.signal)
    await brainstorms.close(id)
    const before = entries.length
    withdrawn.abort()

    await expect(asked).resolves.toMatchObject({ behavior: 'deny', message: ABANDONED })
    expect(entries).toHaveLength(before)
  })

  it('stops the turn without ending the conversation', async () => {
    const { brainstorms, sessions } = started()
    const id = await brainstorms.start(START)

    await brainstorms.stop(id)
    brainstorms.send(id, 'Go on.')
    await tick()

    expect(only(sessions).interrupted()).toBe(1)
    expect(only(sessions).sent).toEqual(['Plan this.', 'Go on.'])
  })

  it('closes the session and refuses what comes after', async () => {
    const { brainstorms, sessions } = started()
    const id = await brainstorms.start(START)

    await brainstorms.close(id)
    await brainstorms.close(id)

    expect(only(sessions).closed()).toBe(1)
    expect(() => {
      brainstorms.send(id, 'Hello?')
    }).toThrow(expect.objectContaining({ code: 'brainstormGone' }))
    expect(() => {
      brainstorms.answer(id, 'r', [])
    }).toThrow(expect.objectContaining({ code: 'brainstormGone' }))
    await expect(brainstorms.stop(id)).rejects.toMatchObject({ code: 'brainstormGone' })
  })

  it('closes the one before when another starts', async () => {
    const { brainstorms, sessions } = started()
    await brainstorms.start(START)

    await brainstorms.start(START)

    expect(sessions.map((session) => session.closed())).toEqual([1, 0])
  })

  it('closes every one at once', async () => {
    const { brainstorms, sessions } = started()
    const id = await brainstorms.start(START)

    await brainstorms.closeAll()

    expect(only(sessions).closed()).toBe(1)
    expect(() => {
      brainstorms.send(id, 'x')
    }).toThrow(expect.objectContaining({ code: 'brainstormGone' }))
  })

  it('says so when the agent ends by itself, and lets its questions go', async () => {
    const { brainstorms, sessions, entries } = started()
    const id = await brainstorms.start(START)
    const asked = only(sessions).ask('AskUserQuestion', QUESTIONS)

    only(sessions).die()
    await tick()

    await expect(asked).resolves.toMatchObject({ behavior: 'deny', message: ABANDONED })
    expect(entries.at(-1)).toEqual({
      brainstormId: id,
      entry: {
        role: 'agent',
        at: AT,
        event: {
          type: 'error',
          message: 'Claude Code ended without a result or an error',
          code: 'endedQuietly'
        }
      }
    })
    expect(() => {
      brainstorms.send(id, 'x')
    }).toThrow(expect.objectContaining({ code: 'brainstormGone' }))
  })

  it('says nothing more when the agent ended between turns', async () => {
    const { brainstorms, sessions, entries } = started()
    await brainstorms.start(START)
    only(sessions).emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 5,
      usage: { input_tokens: 1 },
      session_id: 's-1'
    })
    await tick()
    const before = entries.length

    only(sessions).die()
    await tick()

    expect(entries).toHaveLength(before)
  })

  it('says only the error when the agent failed mid-turn', async () => {
    const { brainstorms, sessions, entries } = started()
    await brainstorms.start(START)

    only(sessions).crash(new Error('spawn failed'))
    await tick()

    expect(
      entries.map(({ entry }) => (entry.role === 'agent' ? entry.event.type : 'user'))
    ).toEqual(['user', 'error'])
  })
})
