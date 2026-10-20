import type {
  AgentInfo,
  ModelInfo,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage,
  SlashCommand
} from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import {
  type AgentSession,
  DENIED,
  mapMessage,
  type ElicitationAnswer,
  type ElicitationAsk,
  type PermissionAsk,
  type PermissionOutcome,
  READ_ONLY_TOOLS,
  GUARD_FAILED,
  publishLocked,
  toolGuards,
  type SessionOptions,
  promptTokens,
  readContextUsage,
  readUsageReport,
  startSession,
  toAgentCommands,
  toAgentModels,
  toIsoTimestamp
} from './agent.js'
import type { AgentEvent } from './events.js'
import { agentEnv, PUBLISH_DENY_RULES, PUBLISH_REFUSAL } from './publishGuard.js'
import type { SkillVisibility } from './skills.js'

/**
 * A stand-in for `query()`.
 *
 * The SDK is never started: it spawns a child process and talks to a model,
 * neither of which belongs in a unit test. What the fake preserves is the
 * shape the session depends on — an async iterable with control methods —
 * which is the whole reason `query` is injected.
 */
interface FakeQuery {
  readonly session: AgentSession
  /** Pushes a message as though the agent had emitted it. */
  readonly emit: (message: SDKMessage) => void
  /** Ends the stream, as the SDK does when the process exits. */
  readonly finish: (error?: Error) => void
  /** Whatever the session read from the prompt stream. */
  readonly received: SDKUserMessage[]
  readonly options: () => Record<string, unknown>
  readonly interrupted: () => number
  readonly modes: () => string[]
  /** Settings pushed onto a running session — where effort changes land. */
  readonly flagSettings: () => Record<string, unknown>[]
  readonly skillReloads: () => number
  readonly pluginReloads: () => number
  /** Models asked for mid-session; `undefined` is "back to the default". */
  readonly requestedModels: () => (string | undefined)[]
  /** Every `rewindFiles` the session issued, with the `dryRun` it passed. */
  readonly rewinds: () => { messageId: string; dryRun: boolean | undefined }[]
  readonly closed: () => number
}

function fakeAgent(
  overrides: Partial<SessionOptions> = {},
  hooks: {
    /* The whole ask, not just the tool name. Narrowing it here is what let
       the third argument to `canUseTool` go unnoticed: a double that drops a
       field cannot fail when the code drops it too. */
    askPermission?: (ask: PermissionAsk) => Promise<PermissionOutcome>
    askElicitation?: (ask: ElicitationAsk) => Promise<ElicitationAnswer>
    models?: ModelInfo[]
    /** What the session answers when asked; an error is a request it refuses. */
    commands?: SlashCommand[] | Error
    agents?: AgentInfo[] | Error
    /** What the agent answers when asked to rewind files. */
    rewind?: Record<string, unknown>
    /** What the session's settings files say about skills; left out, it reads none. */
    skillsInFiles?: () => Promise<ReadonlyMap<string, SkillVisibility>>
    refuseCommand?: (command: string) => string | null
  } = {}
): { agent: FakeQuery; events: AgentEvent[] } {
  const queued: SDKMessage[] = []
  let deliver: (() => void) | null = null
  let done = false
  let failure: Error | null = null

  const events: AgentEvent[] = []
  const received: SDKUserMessage[] = []
  const modes: string[] = []
  const flagSettings: Record<string, unknown>[] = []
  let skillReloads = 0
  let pluginReloads = 0
  const requestedModels: (string | undefined)[] = []
  const rewinds: { messageId: string; dryRun: boolean | undefined }[] = []
  const offeredModels = hooks.models ?? []
  const offeredCommands = hooks.commands ?? []
  const offeredAgents = hooks.agents ?? []
  let interrupted = 0
  let closed = 0
  let transportClosed = false
  let captured: Record<string, unknown> = {}

  async function* stream(): AsyncGenerator<SDKMessage> {
    try {
      yield* messages()
    } finally {
      // A consumer that leaves the loop early runs this. The real SDK closes
      // its transport at the same moment, and every control request after it
      // fails — so the fake refuses them too, or a `break` added to
      // `startSession` would go unnoticed.
      if (!done) transportClosed = true
    }
  }

  async function* messages(): AsyncGenerator<SDKMessage> {
    while (!done || queued.length > 0) {
      const next = queued.shift()
      if (next) {
        yield next
        continue
      }
      if (failure) throw failure

      await new Promise<void>((resolve) => {
        deliver = resolve
      })
    }

    if (failure) throw failure
  }

  /** What a control request answers: the value, or the real error verbatim. */
  const whileOpen = <T>(value: T): Promise<T> =>
    transportClosed
      ? Promise.reject(new Error('ProcessTransport is not ready for writing'))
      : Promise.resolve(value)

  const conversation = Object.assign(stream(), {
    interrupt: () => {
      interrupted++
      return Promise.resolve(undefined)
    },
    setPermissionMode: (mode: string) => {
      modes.push(mode)
      return Promise.resolve()
    },
    reloadSkills: () => {
      skillReloads += 1
      return Promise.resolve({ skills: [] })
    },
    reloadPlugins: () => {
      pluginReloads += 1
      return Promise.resolve({
        commands: [],
        agents: [],
        plugins: [],
        mcpServers: [],
        error_count: 0
      })
    },
    applyFlagSettings: (settings: Record<string, unknown>) => {
      flagSettings.push(settings)
      return Promise.resolve()
    },
    setModel: (model: string | undefined) => {
      requestedModels.push(model)
      return Promise.resolve()
    },
    rewindFiles: (messageId: string, rewindOptions?: { dryRun?: boolean }) => {
      rewinds.push({ messageId, dryRun: rewindOptions?.dryRun })
      return whileOpen(hooks.rewind ?? { canRewind: true })
    },
    supportedModels: () => whileOpen(offeredModels),
    supportedCommands: () =>
      offeredCommands instanceof Error
        ? Promise.reject(offeredCommands)
        : whileOpen(offeredCommands),
    supportedAgents: () =>
      offeredAgents instanceof Error ? Promise.reject(offeredAgents) : whileOpen(offeredAgents),
    getContextUsage: () => whileOpen(CONTEXT_RESPONSE),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => whileOpen(USAGE_RESPONSE),
    close: () => {
      closed++
    }
  }) as unknown as Query

  const session = startSession(
    {
      cwd: '/ws/kyiv',
      resume: null,
      resumeAt: null,
      settingSources: [],
      permissionMode: 'default',
      model: null,
      effort: 'medium',
      allowedTools: [...READ_ONLY_TOOLS],
      additionalDirectories: [],
      pushTargets: [],
      skillOverrides: {},
      autoCompactWindow: null,
      ...overrides
    },
    {
      query: (params) => {
        captured = params.options ?? {}

        // Drained in the background, exactly as the SDK would.
        void (async () => {
          for await (const message of params.prompt) received.push(message)
        })()

        return conversation
      },
      onEvent: (event) => events.push(event),
      askPermission: (ask) =>
        hooks.askPermission?.(ask) ?? Promise.resolve({ allow: true } as const),
      askElicitation: (ask) =>
        hooks.askElicitation?.(ask) ?? Promise.resolve({ action: 'decline' } as const),
      ...(hooks.skillsInFiles && { skillsInFiles: hooks.skillsInFiles }),
      ...(hooks.refuseCommand && { refuseCommand: hooks.refuseCommand })
    }
  )

  const wake = (): void => {
    const pending = deliver
    deliver = null
    pending?.()
  }

  return {
    events,
    agent: {
      session,
      received,
      emit: (message) => {
        queued.push(message)
        wake()
      },
      finish: (error) => {
        failure = error ?? null
        done = true
        wake()
      },
      options: () => captured,
      interrupted: () => interrupted,
      modes: () => modes,
      flagSettings: () => flagSettings,
      skillReloads: () => skillReloads,
      pluginReloads: () => pluginReloads,
      requestedModels: () => requestedModels,
      rewinds: () => rewinds,
      closed: () => closed
    }
  }
}

/** A session that ends without ever saying anything. */
async function* silence(): AsyncGenerator<SDKMessage> {
  await Promise.resolve()
  yield* []
}

/** Lets the microtask queue drain, so pushed messages reach the handler. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

function assistant(content: unknown[]): SDKMessage {
  return {
    type: 'assistant',
    message: { content },
    parent_tool_use_id: null,
    uuid: 'u-1',
    session_id: 's-1'
  } as unknown as SDKMessage
}

describe('mapping SDK messages', () => {
  /*
   * The CLI's own frames for a message's place in its queue, as a live session
   * (SDK 0.3.299) sent them: not in the typed union, so cast through `unknown`
   * exactly as they arrive.
   */
  const lifecycle = (state: string, extra: Record<string, unknown> = {}): SDKMessage =>
    ({
      type: 'command_lifecycle',
      command_uuid: 'msg-1',
      state,
      uuid: 'frame-1',
      session_id: 'sess-1',
      ...extra
    }) as unknown as SDKMessage

  it.each([
    ['queued', 'queued'],
    ['started', 'started'],
    // Both arrive after the turn's result, and neither starts anything.
    ['completed', 'finished'],
    ['cancelled', 'finished']
  ])('says a message the CLI calls %s is %s', (state, said) => {
    expect(mapMessage(lifecycle(state))).toEqual([
      { type: 'message_queue', messageId: 'msg-1', state: said }
    ])
  })

  // A state added upstream, or a frame missing its message, says nothing
  // rather than something guessed.
  it('says nothing for a lifecycle frame it cannot read', () => {
    expect(mapMessage(lifecycle('paused'))).toEqual([])
    expect(mapMessage(lifecycle('queued', { command_uuid: 7 }))).toEqual([])
  })

  // And the mode it actually started in, which is the only sign that a
  // request for auto mode was quietly turned down.
  it('reports the session id and the mode from the init message', () => {
    const message = {
      type: 'system',
      subtype: 'init',
      session_id: 'sess-42',
      permissionMode: 'default'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'session_started', sessionId: 'sess-42' },
      { type: 'mode_reported', mode: 'default' }
    ])
  })

  it('reports the mode a status message carries', () => {
    const message = {
      type: 'system',
      subtype: 'status',
      status: null,
      permissionMode: 'default'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([{ type: 'mode_reported', mode: 'default' }])
  })

  // Most status messages are about compacting or a request, not the mode.
  it('says nothing for a status message without a mode', () => {
    const message = {
      type: 'system',
      subtype: 'status',
      status: 'requesting'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([])
  })

  // A call blocked by auto mode's classifier would otherwise show only as a
  // tool that failed.
  it('reports a call the classifier refused, with its reason', () => {
    const message = {
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Bash',
      tool_use_id: 'tool-1',
      decision_reason_type: 'classifier',
      decision_reason: 'Downloads and runs a remote script',
      message: 'Permission for this action was denied'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'permission_denied',
        toolName: 'Bash',
        byClassifier: true,
        reason: 'Downloads and runs a remote script'
      }
    ])
  })

  it('reports a call a rule refused, with no reason when it gave none', () => {
    const message = {
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Write',
      tool_use_id: 'tool-2',
      decision_reason_type: 'rule',
      message: 'Denied by a rule'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'permission_denied', toolName: 'Write', byClassifier: false, reason: null }
    ])
  })

  /*
   * Background tasks, in the shapes a live session sent (SDK 0.3.299): two
   * agents, one nested, a background command and a workflow.
   */
  describe('background tasks', () => {
    it('reports a subagent starting, with what started it', () => {
      const message = {
        type: 'system',
        subtype: 'task_started',
        task_id: 'a0e3',
        tool_use_id: 'toolu_1',
        description: 'List src/a and explore',
        subagent_type: 'general-purpose',
        is_backgrounded: true,
        spawn_depth: 2,
        parent_task_id: 'a9',
        task_type: 'local_agent',
        prompt: 'List the files'
      } as unknown as SDKMessage

      expect(mapMessage(message)).toEqual([
        {
          type: 'task_started',
          taskId: 'a0e3',
          toolUseId: 'toolu_1',
          kind: 'agent',
          description: 'List src/a and explore',
          subagentType: 'general-purpose',
          parentTaskId: 'a9',
          backgrounded: true,
          ambient: false
        }
      ])
    })

    it('tells a command, a workflow and anything else apart', () => {
      const kind = (task_type?: string, extra: Record<string, unknown> = {}): unknown =>
        mapMessage({
          type: 'system',
          subtype: 'task_started',
          task_id: 't',
          description: 'd',
          ...(task_type !== undefined && { task_type }),
          ...extra
        } as unknown as SDKMessage)[0]

      expect(kind('local_bash')).toMatchObject({ kind: 'shell', backgrounded: false })
      // Measured: a workflow comes with no flag, and its call returns at once.
      expect(kind('local_workflow', { workflow_name: 'audit' })).toMatchObject({
        kind: 'workflow',
        workflowName: 'audit',
        backgrounded: true
      })
      expect(kind('remote_agent')).toMatchObject({ kind: 'other' })
      expect(kind()).toMatchObject({ kind: 'other' })
      expect(kind('local_agent', { ambient: true })).toMatchObject({ ambient: true })
      expect(kind('local_agent', { skip_transcript: true })).toMatchObject({ ambient: true })
    })

    // The frame's description is the step under way, not the task's.
    it("reports a task's progress with the step under way", () => {
      const message = {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'a1',
        description: 'Reading src/b/index.ts',
        usage: { total_tokens: 14328, tool_uses: 1, duration_ms: 1478 },
        last_tool_name: 'Read',
        summary: 'Reading the module'
      } as unknown as SDKMessage

      expect(mapMessage(message)).toEqual([
        {
          type: 'task_progress',
          taskId: 'a1',
          activity: 'Reading src/b/index.ts',
          summary: 'Reading the module',
          tokens: 14328,
          toolUses: 1,
          durationMs: 1478
        }
      ])
    })

    it('leaves out an empty step and an empty summary', () => {
      const message = {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'a1',
        description: '',
        summary: '',
        usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 }
      } as unknown as SDKMessage

      expect(mapMessage(message)).toEqual([
        { type: 'task_progress', taskId: 'a1', tokens: 0, toolUses: 0, durationMs: 0 }
      ])
    })

    /*
     * Workflow agents raise no task events of their own; this untyped array on
     * the workflow's progress is the only place they appear.
     */
    it("reads a workflow's phases and agents, skipping what it cannot", () => {
      const message = {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'w1',
        description: 'read: src/a/index.ts',
        usage: { total_tokens: 29268, tool_uses: 2, duration_ms: 2945 },
        workflow_progress: [
          { type: 'workflow_phase', index: 1, title: 'read' },
          {
            type: 'workflow_agent',
            index: 1,
            label: 'src/a/index.ts',
            phaseIndex: 1,
            phaseTitle: 'read',
            agentId: 'aabe',
            model: 'claude-haiku-5-5',
            state: 'done',
            lastToolName: 'Read',
            tokens: 15366,
            toolCalls: 1,
            durationMs: 2917
          },
          { type: 'workflow_agent', index: 2, label: 'src/b/index.ts', state: 'start' },
          { type: 'workflow_note', text: 'unknown' },
          'not even an object'
        ]
      } as unknown as SDKMessage

      expect(mapMessage(message)[0]).toMatchObject({
        workflow: {
          phases: [{ index: 1, title: 'read' }],
          agents: [
            {
              index: 1,
              label: 'src/a/index.ts',
              phase: 1,
              state: 'done',
              model: 'claude-haiku-5-5',
              tokens: 15366,
              toolCalls: 1,
              durationMs: 2917,
              lastTool: 'Read'
            },
            {
              index: 2,
              label: 'src/b/index.ts',
              phase: null,
              state: 'start',
              model: null,
              tokens: null,
              toolCalls: null,
              durationMs: null,
              lastTool: null
            }
          ]
        }
      })
    })

    it('has no workflow for progress with nothing readable in it', () => {
      const frame = (workflow_progress: unknown): unknown =>
        mapMessage({
          type: 'system',
          subtype: 'task_progress',
          task_id: 'w1',
          description: 'x',
          usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 },
          workflow_progress
        } as unknown as SDKMessage)[0]

      expect(frame([{ type: 'workflow_note' }])).not.toHaveProperty('workflow')
      expect(frame('nonsense')).not.toHaveProperty('workflow')
    })

    it('reports an end with its totals and report', () => {
      const message = {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'a1',
        status: 'completed',
        output_file: '/tmp/a1.output',
        summary: 'The file is two lines long.',
        usage: { total_tokens: 4800, tool_uses: 5, duration_ms: 3100 }
      } as unknown as SDKMessage

      expect(mapMessage(message)).toEqual([
        {
          type: 'task_ended',
          taskId: 'a1',
          status: 'completed',
          summary: 'The file is two lines long.',
          tokens: 4800,
          toolUses: 5,
          durationMs: 3100
        }
      ])
    })

    it('reports an end with nothing more to say', () => {
      const message = {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'b1',
        status: 'failed',
        output_file: '/tmp/b1.output',
        summary: ''
      } as unknown as SDKMessage

      expect(mapMessage(message)).toEqual([{ type: 'task_ended', taskId: 'b1', status: 'failed' }])
    })

    // Not every task sends a notification; a terminal patch is an end too.
    it('reads a patch as an end only when it is one', () => {
      const patch = (status?: string): AgentEvent[] =>
        mapMessage({
          type: 'system',
          subtype: 'task_updated',
          task_id: 'a1',
          patch: status === undefined ? { description: 'x' } : { status }
        } as unknown as SDKMessage)

      expect(patch('completed')).toEqual([
        { type: 'task_ended', taskId: 'a1', status: 'completed' }
      ])
      expect(patch('failed')).toEqual([{ type: 'task_ended', taskId: 'a1', status: 'failed' }])
      expect(patch('killed')).toEqual([{ type: 'task_ended', taskId: 'a1', status: 'stopped' }])
      expect(patch('running')).toEqual([])
      expect(patch('paused')).toEqual([])
      expect(patch()).toEqual([])
    })

    // A resumed task keeps its id; the run is what tells a late frame apart.
    it('carries the run every frame belongs to', () => {
      const frame = (subtype: string, extra: Record<string, unknown>): AgentEvent | undefined =>
        mapMessage({
          type: 'system',
          subtype,
          task_id: 'a1',
          run_id: 'r2',
          description: 'd',
          ...extra
        } as unknown as SDKMessage)[0]

      expect(frame('task_started', {})).toMatchObject({ runId: 'r2' })
      expect(
        frame('task_progress', { usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 } })
      ).toMatchObject({ runId: 'r2' })
      expect(frame('task_notification', { status: 'completed', summary: '' })).toMatchObject({
        runId: 'r2'
      })
      expect(frame('task_updated', { patch: { status: 'killed' } })).toMatchObject({
        runId: 'r2'
      })
    })

    it('reports the set of tasks still alive', () => {
      const message = {
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [
          { task_id: 'a0', task_type: 'local_agent', description: 'x' },
          { task_id: 'b1', task_type: 'local_bash', description: 'y' }
        ]
      } as unknown as SDKMessage

      expect(mapMessage(message)).toEqual([{ type: 'background_tasks', taskIds: ['a0', 'b1'] }])
    })
  })

  /*
   * A compaction, in the shape a live session actually sends.
   *
   * `sdk.d.ts` declares `compact_metadata` with `pre_tokens` and `post_tokens`;
   * the wire carries `compactMetadata` with `preTokens` and `postTokens`, plus
   * fields the type does not mention. Reading the declared shape gives
   * `undefined` and an event of nulls that looks like it worked, so this is
   * parsed rather than read — and the camelCase spelling is the one measured
   * against CLI 2.1.224.
   */
  /*
   * The one change of model that is neither the user's decision nor the
   * agent's. Without the event the reader sees the composer's chip name a
   * different model mid-conversation with nothing accounting for it — or a turn
   * that reads as ordinary with an odd answer.
   */
  it('maps a refusal that swapped the model for the session', () => {
    const message = {
      type: 'system',
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      scope: 'session',
      original_model: 'claude-opus-5',
      fallback_model: 'claude-sonnet-5',
      api_refusal_category: 'cyber',
      api_refusal_explanation: 'The request looked like credential harvesting.',
      request_id: null,
      content: '',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'model_refusal_fallback',
        originalModel: 'claude-opus-5',
        fallbackModel: 'claude-sonnet-5',
        scope: 'session',
        category: 'cyber',
        explanation: 'The request looked like credential harvesting.'
      }
    ])
  })

  /* A subagent, a side question or a background fork. The session model is
     unchanged there, so the chip has not moved and the two do not want the
     same sentence. */
  it('keeps a local swap apart from one that outlives the turn', () => {
    const message = {
      type: 'system',
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      scope: 'local',
      original_model: 'claude-opus-5',
      fallback_model: 'claude-sonnet-5',
      request_id: null,
      content: '',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'model_refusal_fallback',
        originalModel: 'claude-opus-5',
        fallbackModel: 'claude-sonnet-5',
        scope: 'local',
        category: null,
        explanation: null
      }
    ])
  })

  /* An older CLI sends no scope, and the SDK says to read that as `session`.
     It is also the conservative reading: the other way round would describe a
     swap that outlives the turn as a local one. */
  /* The other half of the pair, and the one that was falling past every arm
     into `default: return []` — so a refusal nothing was retried after produced
     no line at all, which is the silence the fallback line exists to end.

     A hand-built message, because this has never been seen in this repository:
     putting the arm back verifies the fixture rather than the wire, and that is
     worth knowing about this test rather than assuming otherwise. */
  it('maps a refusal that nothing was retried after', () => {
    const message = {
      type: 'system',
      subtype: 'model_refusal_no_fallback',
      original_model: 'claude-opus-5',
      api_refusal_category: 'cyber',
      api_refusal_explanation: 'The request looked like credential harvesting.',
      request_id: null,
      content: '',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'model_refusal_no_fallback',
        originalModel: 'claude-opus-5',
        category: 'cyber',
        explanation: 'The request looked like credential harvesting.'
      }
    ])
  })

  // Both are absent from older CLIs, and a refusal with no reason attached is
  // still a refusal worth a line.
  it('draws the same line where the refusal gave no reason', () => {
    const message = {
      type: 'system',
      subtype: 'model_refusal_no_fallback',
      original_model: 'claude-opus-5',
      request_id: null,
      content: '',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'model_refusal_no_fallback',
        originalModel: 'claude-opus-5',
        category: null,
        explanation: null
      }
    ])
  })

  it('reads a missing scope as one that outlives the turn', () => {
    const message = {
      type: 'system',
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      original_model: 'claude-opus-5',
      fallback_model: 'claude-sonnet-5',
      request_id: null,
      content: '',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      expect.objectContaining({ type: 'model_refusal_fallback', scope: 'session' })
    ])
  })

  it('maps a compaction sent under the names the wire uses', () => {
    const message = {
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 'sess-42',
      compactMetadata: {
        trigger: 'manual',
        preTokens: 73984,
        postTokens: 16023,
        cumulativeDroppedTokens: 57961,
        durationMs: 65548
      }
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'conversation_compacted', trigger: 'manual', preTokens: 73984, postTokens: 16023 }
    ])
  })

  // And under the names the type declares, so an SDK that starts sending what
  // it says it sends is not a regression.
  it('maps a compaction sent under the names the type declares', () => {
    const message = {
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 'sess-42',
      compact_metadata: { trigger: 'auto', pre_tokens: 800, post_tokens: 120 }
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'conversation_compacted', trigger: 'auto', preTokens: 800, postTokens: 120 }
    ])
  })

  /*
   * The boundary is worth drawing on its own. The reader's question is whether
   * this conversation was compacted, not by how much — so metadata in a shape
   * nothing here recognises degrades the row rather than losing it.
   */
  /*
   * The shape this is built to survive: metadata that arrives and names none of
   * the fields either spelling expects, which is what a third rename would look
   * like. The parse succeeds and every figure falls through to null, so the row
   * still says the conversation was compacted.
   */
  it('keeps the compaction when its metadata is a shape neither spelling fits', () => {
    const message = {
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 'sess-42',
      compactMetadata: { durationMs: 65548, cumulativeDroppedTokens: 57961 }
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'conversation_compacted', trigger: null, preTokens: null, postTokens: null }
    ])
  })

  it('keeps the compaction when its metadata says nothing it understands', () => {
    const message = {
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'conversation_compacted', trigger: null, preTokens: null, postTokens: null }
    ])
  })

  it('ignores system messages it has no use for', () => {
    const message = {
      type: 'system',
      subtype: 'hook_started',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([])
  })

  /*
   * The mistake this guards against, written down as a test because it is
   * invisible in the types and expensive in practice.
   *
   * A reset carries two ids: `new_conversation_id`, which reads like the thing
   * to resume from, and `session_id`, which is the conversation just left
   * behind. Neither is the answer — resuming with the first fails outright
   * ("No conversation found with session ID"), and the id that works arrives a
   * moment later in an `init` of its own. So this event carries no id at all,
   * and `session_started` goes on being the only thing that records one.
   */
  it('takes no session id from a reset, because neither of its ids is the one', () => {
    const message = {
      type: 'conversation_reset',
      new_conversation_id: 'conv-new',
      session_id: 'sess-old'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([{ type: 'conversation_reset', cleared: false }])
  })

  // An older CLI does not say what caused the reset, and the same message
  // arrives when the agent leaves plan mode — so the mapping reports the form
  // that changes nothing, and the service, which sent the message, decides.
  it('does not claim a reset was asked for when the message does not say', () => {
    const message = { type: 'conversation_reset' } as unknown as SDKMessage
    const [event] = mapMessage(message)

    expect(event).toEqual({ type: 'conversation_reset', cleared: false })
  })

  it('reads a reset the CLI says came from /clear as asked for', () => {
    const message = { type: 'conversation_reset', trigger: 'clear' } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'conversation_reset', cleared: true, trigger: 'clear' }
    ])
  })

  it('passes on what else caused a reset, without reading it as asked for', () => {
    const message = {
      type: 'conversation_reset',
      trigger: 'plan_mode_exit'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'conversation_reset', cleared: false, trigger: 'plan_mode_exit' }
    ])
  })

  // The SDK's own advice: an unrecognised value is an unspecified reset.
  it('reads a cause it does not know as no cause at all', () => {
    const message = { type: 'conversation_reset', trigger: 'teleport' } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([{ type: 'conversation_reset', cleared: false }])
  })

  it('passes on a new command list, translated', () => {
    const message = {
      type: 'system',
      subtype: 'commands_changed',
      commands: [{ name: 'deploy', description: 'Ship it', argumentHint: '<env>' }]
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'commands_changed',
        commands: [
          {
            name: 'deploy',
            description: 'Ship it',
            argumentHint: '<env>',
            aliases: [],
            skill: false
          }
        ]
      }
    ])
  })

  // The skills come from the session's `init`, which `startSession` hands in.
  it('marks the commands that are skills in a new command list', () => {
    const message = {
      type: 'system',
      subtype: 'commands_changed',
      commands: [
        { name: 'review', description: '', argumentHint: '' },
        { name: 'clear', description: '', argumentHint: '' }
      ]
    } as unknown as SDKMessage

    const [event] = mapMessage(message, new Set(['review']))

    expect(event).toEqual({
      type: 'commands_changed',
      commands: [
        expect.objectContaining({ name: 'review', skill: true }),
        expect.objectContaining({ name: 'clear', skill: false })
      ]
    })
  })

  // One assistant message carries several blocks, and each is an event: the
  // log has to show the reasoning, the prose and the tool call separately.
  it('splits an assistant message into one event per block', () => {
    const events = mapMessage(
      assistant([
        { type: 'thinking', thinking: 'weighing it up' },
        { type: 'text', text: 'Looking at auth.rb' },
        { type: 'tool_use', id: 'call-1', name: 'Read', input: { file_path: '/a.rb' } },
        { type: 'redacted_thinking', data: 'opaque' }
      ])
    )

    // The message's own wire id on each, so a retraction naming it has
    // something to point at.
    expect(events).toEqual([
      { type: 'thinking', text: 'weighing it up', uuid: 'u-1' },
      { type: 'text', text: 'Looking at auth.rb', uuid: 'u-1' },
      {
        type: 'tool_use',
        toolUseId: 'call-1',
        name: 'Read',
        input: { file_path: '/a.rb' },
        uuid: 'u-1'
      }
    ])
  })

  // Measured, not supposed: a real transcript held three thinking events whose
  // text was the empty string. The SDK can be asked to summarise reasoning or
  // omit it, and an omitted one still sends the block — for the signature —
  // with nothing in it. Left through, each drew a disclosure with nothing
  // behind it and stayed in the transcript forever.
  it('drops a block that carries no content', () => {
    const events = mapMessage(
      assistant([
        { type: 'thinking', thinking: '' },
        { type: 'text', text: '' },
        { type: 'thinking', thinking: '   \n  ' },
        { type: 'text', text: 'Looking at auth.rb' }
      ])
    )

    expect(events).toEqual([{ type: 'text', text: 'Looking at auth.rb', uuid: 'u-1' }])
  })

  /*
   * A model refused, the CLI retried on another one, and what the first had
   * already said is taken back. The replacement names it on arrival; without
   * this the transcript keeps the abandoned half-answer for ever and a reopened
   * conversation shows it above its own replacement.
   *
   * The ids are opaque here on purpose. The CLI derives a per-block one for a
   * message it split, and computing that ourselves would be encoding an
   * implementation — an id that matches nothing is a no-op, which is what the
   * SDK promises and what its own reader does.
   */
  it('takes back what a replacement message says it supersedes', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Here instead.' }] },
      parent_tool_use_id: null,
      uuid: 'u-2',
      supersedes: ['u-1', 'u-1-tool'],
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'retracted', uuids: ['u-1', 'u-1-tool'] },
      { type: 'text', text: 'Here instead.', uuid: 'u-2' }
    ])
  })

  // A message naming itself would strike out the replacement, which is what the
  // SDK's own reader drops it for.
  it('never lets a message take itself back', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Here instead.' }] },
      parent_tool_use_id: null,
      uuid: 'u-2',
      supersedes: ['u-2'],
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([{ type: 'text', text: 'Here instead.', uuid: 'u-2' }])
  })

  /* The end-of-turn notice says the same thing again, and the SDK calls the two
     idempotent — it is kept because it is the complete audit record, carrying
     tool results that no replacement frame was attached to. */
  it('takes back what the end-of-turn notice names as well', () => {
    const message = {
      type: 'system',
      subtype: 'model_refusal_fallback',
      trigger: 'refusal',
      direction: 'retry',
      scope: 'session',
      original_model: 'claude-opus-5',
      fallback_model: 'claude-sonnet-5',
      retracted_message_uuids: ['u-1'],
      request_id: null,
      content: '',
      uuid: 'u-9',
      session_id: 'sess-42'
    } as unknown as SDKMessage

    expect(mapMessage(message)[0]).toEqual({ type: 'retracted', uuids: ['u-1'] })
  })

  /*
   * A subagent's messages arrive on the conversation's own stream, told apart
   * only by the call that started it. Without that, a delegated task is a
   * scatter of tool rows that nothing says belong together.
   */
  describe('what a subagent says', () => {
    const SUBAGENT = 'toolu_task_1'

    it('names the call it belongs to on text, thinking and tool calls', () => {
      const message = {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Looking' },
            { type: 'text', text: 'Found it.' },
            { type: 'tool_use', id: 'c-1', name: 'Read', input: { file_path: 'a.ts' } }
          ]
        },
        parent_tool_use_id: SUBAGENT,
        uuid: 'u-5',
        session_id: 's-1'
      } as unknown as SDKMessage

      expect(mapMessage(message)).toEqual([
        { type: 'thinking', text: 'Looking', uuid: 'u-5', parentToolUseId: SUBAGENT },
        { type: 'text', text: 'Found it.', uuid: 'u-5', parentToolUseId: SUBAGENT },
        {
          type: 'tool_use',
          toolUseId: 'c-1',
          name: 'Read',
          input: { file_path: 'a.ts' },
          uuid: 'u-5',
          parentToolUseId: SUBAGENT
        }
      ])
    })

    it('names it on a tool result as well', () => {
      const message = {
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'c-1', content: 'ok' }]
        },
        parent_tool_use_id: SUBAGENT,
        session_id: 's-1'
      } as unknown as SDKMessage

      expect(mapMessage(message)).toEqual([
        {
          type: 'tool_result',
          toolUseId: 'c-1',
          ok: true,
          content: 'ok',
          parentToolUseId: SUBAGENT
        }
      ])
    })

    // The conversation's own events carry nothing, so a transcript written
    // before this existed reads the same as one written after.
    it('leaves the conversation’s own events without one', () => {
      expect(mapMessage(assistant([{ type: 'text', text: 'Hello' }]))).toEqual([
        { type: 'text', text: 'Hello', uuid: 'u-1' }
      ])
    })
  })

  it('reads a tool result out of the user message that carries it', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'done' }]
      },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'tool_result', toolUseId: 'call-1', ok: true, content: 'done' }
    ])
  })

  it('marks a failed tool result as failed', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call-1', is_error: true, content: 'no such file' },
          { type: 'text', text: 'ignored' }
        ]
      },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'tool_result', toolUseId: 'call-1', ok: false, content: 'no such file' }
    ])
  })

  // A plain string is what a user's own message looks like; only the ones
  // carrying blocks hold tool results.
  it('ignores a user message whose content is plain text', () => {
    const message = {
      type: 'user',
      message: { role: 'user', content: 'hello' },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([])
  })

  it('flattens a block-shaped tool result and drops what cannot be shown', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'call-1',
            content: [
              { type: 'text', text: 'first' },
              { type: 'image', source: {} },
              { type: 'text', text: 'second' }
            ]
          }
        ]
      },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'tool_result', toolUseId: 'call-1', ok: true, content: 'first\nsecond' }
    ])
  })

  it('treats a tool result with no content as empty', () => {
    const message = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1' }]
      },
      parent_tool_use_id: null,
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'tool_result', toolUseId: 'call-1', ok: true, content: '' }
    ])
  })

  describe('the id of a task a result made', () => {
    // As measured on CLI 2.1.299: the id is only in the structured output, and
    // the text beside it is prose.
    function results(blocks: string[], output: unknown): SDKMessage {
      return {
        type: 'user',
        message: {
          role: 'user',
          content: blocks.map((id) => ({
            type: 'tool_result',
            tool_use_id: id,
            content: 'Task #1 created successfully: Alpha'
          }))
        },
        parent_tool_use_id: null,
        session_id: 's-1',
        tool_use_result: output
      } as unknown as SDKMessage
    }

    it('is read off the structured output', () => {
      expect(mapMessage(results(['call-1'], { task: { id: '1', subject: 'Alpha' } }))).toEqual([
        {
          type: 'tool_result',
          toolUseId: 'call-1',
          ok: true,
          content: 'Task #1 created successfully: Alpha',
          taskId: '1'
        }
      ])
    })

    // One output per message: with two results it belongs to neither for sure.
    it('is left off when the message carries more than one result', () => {
      const events = mapMessage(results(['call-1', 'call-2'], { task: { id: '1' } }))

      expect(events).toHaveLength(2)
      expect(events.some((event) => 'taskId' in event)).toBe(false)
    })

    // Counts and the report come off the same output, by the same rule: one
    // result to a message, or nothing.
    it('carries the counts and the report of a single result', () => {
      const done = {
        status: 'completed',
        content: [{ type: 'text', text: 'All clear.' }],
        totalToolUseCount: 4,
        totalTokens: 1200,
        totalDurationMs: 900
      }

      expect(mapMessage(results(['call-1'], done))[0]).toMatchObject({
        report: 'All clear.',
        stats: { toolUses: 4, tokens: 1200, durationMs: 900 }
      })
      expect(mapMessage(results(['call-1', 'call-2'], done))[0]).not.toHaveProperty('stats')
    })

    it('is left off an output that names no task', () => {
      expect(mapMessage(results(['call-1'], { success: true, taskId: '1' }))[0]).not.toHaveProperty(
        'taskId'
      )
      expect(mapMessage(results(['call-1'], undefined))[0]).not.toHaveProperty('taskId')
    })
  })

  it('turns streamed text and thinking into deltas', () => {
    const text = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Loo' } },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    const thinking = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'hmm' }
      },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(text)).toEqual([{ type: 'text_delta', text: 'Loo' }])
    expect(mapMessage(thinking)).toEqual([{ type: 'thinking_delta', text: 'hmm' }])
  })

  // Tool arguments stream in as JSON fragments, which read as nothing until
  // complete — and arrive complete in the assistant message that follows.
  it('ignores stream events that carry no readable text', () => {
    const partialJson = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"fi' }
      },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    const blockStart = {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(partialJson)).toEqual([])
    expect(mapMessage(blockStart)).toEqual([])
  })

  it('reports what a turn used and why it ended', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.0421,
      duration_ms: 3200,
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 40_000,
        cache_creation_input_tokens: 8118,
        output_tokens: 1180
      },
      terminal_reason: 'max_turns',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'result',
        ok: true,
        costUsd: 0.0421,
        durationMs: 3200,
        inputTokens: 48_120, // 2 + 40_000 + 8_118, all three parts of the prompt
        outputTokens: 1180,
        terminalReason: 'max_turns'
      }
    ])
  })

  // Older CLIs do not send one, and the field is optional in the SDK's types.
  it('accepts a result that does not say why it ended', () => {
    const message = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 10,
      usage: {
        input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0
      },
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)[0]).toMatchObject({ terminalReason: null })
  })

  // The one figure here that is about the subscription rather than about an
  // API bill — which is what makes it worth showing at all.
  it('reports how much of the subscription window is gone', () => {
    const message = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 62,
        resetsAt: 1_786_000_000_000
      },
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'rate_limit',
        status: 'allowed_warning',
        window: 'five_hour',
        utilization: 62,
        resetsAt: new Date(1_786_000_000_000).toISOString()
      }
    ])
  })

  // Copied verbatim from a live session rather than composed here. The shape
  // the types allow and the shape that arrives are not the same: `utilization`
  // is absent, `resetsAt` is in seconds, and fields the types never mention
  // ride along. A fixture written from the declaration alone would have tested
  // a message the SDK does not send.
  it('reads the payload a live session actually sends', () => {
    const message = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed',
        resetsAt: 1_786_468_800,
        rateLimitType: 'five_hour',
        overageStatus: 'rejected',
        overageDisabledReason: 'org_level_disabled',
        isUsingOverage: false
      },
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      {
        type: 'rate_limit',
        status: 'allowed',
        window: 'five_hour',
        // Seconds, read as seconds: the same number taken for milliseconds
        // would put the reset in January 1970.
        resetsAt: '2026-08-11T17:20:00.000Z',
        utilization: null
      }
    ])
  })

  it('accepts a rate limit that reports only its status', () => {
    const message = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed' },
      uuid: 'u-1',
      session_id: 's-1'
    } as unknown as SDKMessage

    expect(mapMessage(message)).toEqual([
      { type: 'rate_limit', status: 'allowed', window: null, utilization: null, resetsAt: null }
    ])
  })

  // The SDK union has some forty variants and grows between releases; the ones
  // we do not draw have to map to nothing rather than to a placeholder row.
  it('ignores message kinds the UI does not render', () => {
    expect(mapMessage({ type: 'compact_boundary' } as unknown as SDKMessage)).toEqual([])
  })
})

describe('a session', () => {
  it('passes the workspace and the transparency switch to the SDK', () => {
    const { agent } = fakeAgent({ cwd: '/ws/anna', settingSources: ['project'] })

    expect(agent.options()).toMatchObject({
      cwd: '/ws/anna',
      settingSources: ['project'],
      permissionMode: 'default',
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code' }
    })
  })

  // A resume of nothing is not the same as no resume: the SDK reads a present
  // `resume` as a session to go looking for.
  it('omits resume and model when there is nothing to continue', () => {
    const { agent } = fakeAgent()

    expect(agent.options()).not.toHaveProperty('resume')
    expect(agent.options()).not.toHaveProperty('model')
  })

  it('continues a stored session when given one', () => {
    const { agent } = fakeAgent({ resume: 'sess-9', model: 'claude-opus-5' })

    expect(agent.options()).toMatchObject({ resume: 'sess-9', model: 'claude-opus-5' })
  })

  // A rewound conversation picks the session up where it was cut, not at its
  // end — that is the whole of what the agent forgets.
  it('picks a stored session up at the cut, when there is one', () => {
    const { agent } = fakeAgent({ resume: 'sess-9', resumeAt: 'entry-4' })

    expect(agent.options()).toMatchObject({ resume: 'sess-9', resumeSessionAt: 'entry-4' })
  })

  it('continues from the end when there is no cut', () => {
    const { agent } = fakeAgent({ resume: 'sess-9' })

    expect(agent.options()).not.toHaveProperty('resumeSessionAt')
  })

  // The CLI refuses the flag without a session to resume.
  it('drops a cut that has no session to apply to', () => {
    const { agent } = fakeAgent({ resume: null, resumeAt: 'entry-4' })

    expect(agent.options()).not.toHaveProperty('resumeSessionAt')
  })

  // The id is the only handle there is on a point in the conversation: it is
  // what the files are rewound to, and nothing in the stream says it back.
  it('stamps the id it was given on the message', async () => {
    const { agent } = fakeAgent()

    agent.session.send('rename it', '11111111-1111-4111-8111-111111111111')
    await settle()

    expect(agent.received[0]).toMatchObject({ uuid: '11111111-1111-4111-8111-111111111111' })
  })

  it('leaves the id for the agent to assign when none was given', async () => {
    const { agent } = fakeAgent()

    agent.session.send('rename it')
    await settle()

    expect(agent.received[0]).not.toHaveProperty('uuid')
  })

  describe('putting the files back', () => {
    it('is asked with the checkpointing the session was started with', () => {
      const { agent } = fakeAgent()

      // Without it there is nothing to put back: a checkpoint cannot be taken
      // for work already done.
      expect(agent.options()).toMatchObject({ enableFileCheckpointing: true })
    })

    it('answers what the agent said, in our own shape', async () => {
      const { agent } = fakeAgent(
        {},
        {
          rewind: {
            canRewind: true,
            filesChanged: ['a.ts', 'b.ts'],
            insertions: 12,
            deletions: 4,
            skippedLinks: 1
          }
        }
      )

      await expect(agent.session.rewindFiles('msg-1', false)).resolves.toEqual({
        canRewind: true,
        error: null,
        filesChanged: ['a.ts', 'b.ts'],
        insertions: 12,
        deletions: 4,
        skippedLinks: 1
      })
      expect(agent.rewinds()).toEqual([{ messageId: 'msg-1', dryRun: false }])
    })

    // A dry run says less, and an older agent says less still.
    it('fills in what the agent left out', async () => {
      const { agent } = fakeAgent({}, { rewind: { canRewind: false, error: 'no checkpoint' } })

      await expect(agent.session.rewindFiles('msg-1', true)).resolves.toEqual({
        canRewind: false,
        error: 'no checkpoint',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
        skippedLinks: 0
      })
      expect(agent.rewinds()).toEqual([{ messageId: 'msg-1', dryRun: true }])
    })
  })

  it('sends a message down the prompt stream', async () => {
    const { agent } = fakeAgent()

    agent.session.send('add a test')
    await settle()

    expect(agent.received).toHaveLength(1)
    expect(agent.received[0]?.message.content).toBe('add a test')
  })

  // The two ends run on different clocks: the SDK may not be reading yet when
  // the user presses enter.
  it('holds messages queued before the SDK started reading', async () => {
    const { agent } = fakeAgent()

    agent.session.send('first')
    agent.session.send('second')
    await settle()

    expect(agent.received.map((message) => message.message.content)).toEqual(['first', 'second'])
  })

  // Closing must not swallow what the user already typed: the message is on
  // its way to a session that is still there to read it.
  it('delivers what was queued before the close', async () => {
    const { agent } = fakeAgent()

    agent.session.send('first')
    agent.session.send('second')
    await agent.session.close()
    await settle()

    expect(agent.received.map((message) => message.message.content)).toEqual(['first', 'second'])
  })

  it('drops a message sent to a session that is closing', async () => {
    const { agent } = fakeAgent()
    agent.finish()

    await agent.session.close()
    agent.session.send('too late')
    await settle()

    expect(agent.received).toHaveLength(0)
  })

  it('turns the agent stream into events', async () => {
    const { agent, events } = fakeAgent()

    agent.emit(assistant([{ type: 'text', text: 'done' }]))
    await settle()

    expect(events).toEqual([{ type: 'text', text: 'done', uuid: 'u-1' }])
  })

  // Whatever the SDK failed at — a spawn, a lost subscription — the chat is
  // the only place the user is looking.
  it('reports a stream failure as an error event', async () => {
    const { agent, events } = fakeAgent()

    agent.finish(new Error('claude exited with code 1'))
    await settle()

    expect(events).toEqual([{ type: 'error', message: 'claude exited with code 1' }])
  })

  /*
   * A session closed on purpose ends its process with SIGTERM, and the SDK
   * reports that as a failure: "exited with code 143". Choosing a compaction
   * window closes one to start it again, and the chat showed the restart as an
   * error, under a session that went on to answer perfectly well.
   */
  it('says nothing when the stream fails because it was closed', async () => {
    const { agent, events } = fakeAgent()

    await agent.session.close()
    agent.finish(new Error('Claude Code process exited with code 143'))
    await settle()

    expect(events).toEqual([])
  })

  it('changes the model of a running session', async () => {
    const { agent } = fakeAgent()

    await agent.session.setModel('claude-opus-5')

    expect(agent.requestedModels()).toEqual(['claude-opus-5'])
  })

  // Null is our word for "no override". The SDK's is `undefined`; asking it for
  // a model called null would be asking for a model that does not exist.
  it('hands the choice back to the agent as nothing rather than as null', async () => {
    const { agent } = fakeAgent()

    await agent.session.setModel(null)

    expect(agent.requestedModels()).toEqual([undefined])
  })

  // The SDK has no `setEffort`: `effort` is a start-time option, and flag
  // settings are the only way to move it on a session already running.
  it('moves the effort of a running session through its flag settings', async () => {
    const { agent } = fakeAgent()

    await agent.session.setEffort('max')

    expect(agent.flagSettings()).toEqual([
      { effortLevel: 'max', ultracode: false, enableWorkflows: false, skillOverrides: {} }
    ])
  })

  // One call rather than three: `applyFlagSettings` shallow-merges top-level
  // keys, so an `ultracode` sent after the level would replace it rather than
  // join it, and the session would run the orchestration at whatever effort it
  // was already on.
  it('asks for ultracode and the effort it runs at in a single call', async () => {
    const { agent } = fakeAgent()

    await agent.session.setEffort('ultracode')

    expect(agent.flagSettings()).toEqual([
      { effortLevel: 'xhigh', ultracode: true, enableWorkflows: true, skillOverrides: {} }
    ])
  })

  // Leaving it has to say so. Nothing else is loaded that would turn it off —
  // `settingSources` is empty — so an unsaid `ultracode` is one still running.
  it('turns ultracode off explicitly when the level moves off it', async () => {
    const { agent } = fakeAgent()

    await agent.session.setEffort('ultracode')
    await agent.session.setEffort('high')

    expect(agent.flagSettings()[1]).toEqual({
      effortLevel: 'high',
      ultracode: false,
      enableWorkflows: false,
      skillOverrides: {}
    })
  })

  it('asks for the chosen compaction window at start-up, in the flag layer', () => {
    const { agent } = fakeAgent({ autoCompactWindow: 500_000 })

    expect(agent.options().settings).toMatchObject({ autoCompactWindow: 500_000 })
  })

  // Null defers to the agent, and the flag layer outranks the user's own
  // files: anything said here, null included, would override `/autocompact`.
  it('says nothing about the window when none is chosen', () => {
    const { agent } = fakeAgent()

    expect(agent.options().settings).not.toHaveProperty('autoCompactWindow')
  })

  /*
   * Measured: a window pushed onto a running session is accepted and ignored,
   * so pushing it would only look like it did something. The service starts
   * the session again instead, and every flag push leaves the key out.
   */
  it('leaves the window out of what it pushes onto a running session', async () => {
    const { agent } = fakeAgent({ autoCompactWindow: 500_000 })

    await agent.session.setEffort('max')

    expect(agent.flagSettings()[0]).not.toHaveProperty('autoCompactWindow')
  })

  it('names the withheld skills at start-up, in the flag layer', () => {
    const { agent } = fakeAgent({ skillOverrides: { 'octopus:review': 'off' } })

    expect(agent.options().settings).toEqual({
      ultracode: false,
      enableWorkflows: false,
      skillOverrides: { 'octopus:review': 'off' }
    })
  })

  it('leaves the extra roots unsaid when there are none to hand over', () => {
    expect(fakeAgent().agent.options().additionalDirectories).toBeUndefined()
  })

  /*
   * A root rather than a local plugin, which was tried first: a plugin's
   * skills load and then cannot be switched off under any spelling of the
   * override key, while a root's obey it like the checkout's own.
   */
  it('hands over the stores as extra working-directory roots', () => {
    const additionalDirectories = ['/data/skills']

    expect(fakeAgent({ additionalDirectories }).agent.options().additionalDirectories).toEqual(
      additionalDirectories
    )
  })

  it('moves the withheld skills of a running session', async () => {
    const { agent } = fakeAgent()

    await agent.session.setSkills({ 'octopus:review': 'off' })

    expect(agent.flagSettings()).toEqual([
      {
        effortLevel: 'medium',
        ultracode: false,
        enableWorkflows: false,
        skillOverrides: { 'octopus:review': 'off' }
      }
    ])
  })

  /*
   * The two halves of the flag layer travel together because
   * `applyFlagSettings` replaces a top-level key rather than merging into it.
   * Sent separately, switching a skill would put the effort back to whatever
   * the session started on — silently, and a turn later.
   */
  it('keeps the effort while the skills move, and the skills while the effort does', async () => {
    const { agent } = fakeAgent()

    await agent.session.setEffort('max')
    await agent.session.setSkills({ 'octopus:review': 'off' })
    await agent.session.setEffort('low')

    expect(agent.flagSettings()[1]).toMatchObject({ effortLevel: 'max' })
    expect(agent.flagSettings()[2]).toMatchObject({
      effortLevel: 'low',
      skillOverrides: { 'octopus:review': 'off' }
    })
  })

  /*
   * A key left out does not undo a withhold — the flag layer keeps a skill
   * withheld at start until it hears `'on'` — so the session says it for
   * every key the new map dropped. Sending `{}` was the first version, and the
   * skill stayed withheld while the panel showed it on.
   */
  it('puts a skill back by saying it is on when the map no longer names it', async () => {
    const { agent } = fakeAgent()

    await agent.session.setSkills({ 'octopus:review': 'off' })
    await agent.session.setSkills({})

    expect(agent.flagSettings()[1]).toMatchObject({ skillOverrides: { 'octopus:review': 'on' } })
  })

  /*
   * Measured (SDK 0.3.299): the flag layer outranks the settings files, so an
   * `'on'` for a skill the user's own file switches off brought it back for
   * the rest of the session. A key octopus stops naming goes back to what the
   * files say, and only to `'on'` where they say nothing.
   */
  it("puts a dropped skill back as the user's settings files say it", async () => {
    const files = new Map<string, SkillVisibility>([
      ['octopus:review', 'off'],
      ['octopus:ship', 'name-only']
    ])
    const { agent } = fakeAgent(
      { skillOverrides: { 'octopus:review': 'on', 'octopus:ship': 'off', 'octopus:plan': 'off' } },
      { skillsInFiles: () => Promise.resolve(files) }
    )

    await agent.session.setSkills({})

    expect(agent.flagSettings()).toEqual([
      expect.objectContaining({
        skillOverrides: {
          'octopus:review': 'off',
          'octopus:ship': 'name-only',
          'octopus:plan': 'on'
        }
      })
    ])
  })

  /*
   * Two pushes overlapping while the first waits on the files — a default list
   * changed, then a chat's own switch. Run side by side, both started from the
   * same map and the slower read sent the older record last.
   */
  it('lets a later push land after an earlier one still reading the files', async () => {
    let release: (files: ReadonlyMap<string, SkillVisibility>) => void = () => undefined
    let reading = false
    const { agent } = fakeAgent(
      { skillOverrides: { 'octopus:review': 'off' } },
      {
        skillsInFiles: () =>
          new Promise((resolve) => {
            reading = true
            release = resolve
          })
      }
    )

    const first = agent.session.setSkills({})
    const second = agent.session.setSkills({ 'octopus:review': 'off', 'octopus:ship': 'off' })
    // Until the first push is holding its read open.
    await vi.waitFor(() => {
      expect(reading).toBe(true)
    })
    release(new Map())
    await Promise.all([first, second])

    expect(agent.flagSettings().at(-1)).toMatchObject({
      skillOverrides: { 'octopus:review': 'off', 'octopus:ship': 'off' }
    })
  })

  it('keeps pushing after one that failed', async () => {
    const { agent } = fakeAgent(
      { skillOverrides: { 'octopus:review': 'off' } },
      { skillsInFiles: () => Promise.reject(new Error('unreadable')) }
    )

    await expect(agent.session.setSkills({})).rejects.toThrow('unreadable')
    await agent.session.setSkills({ 'octopus:ship': 'off', 'octopus:review': 'off' })

    expect(agent.flagSettings().at(-1)).toMatchObject({
      skillOverrides: { 'octopus:review': 'off', 'octopus:ship': 'off' }
    })
  })

  // A skill may be called `constructor`, which every object answers for.
  it('puts back a skill named like a property every object has', async () => {
    const { agent } = fakeAgent({ skillOverrides: { constructor: 'off' as const } })

    await agent.session.setSkills({})

    expect(agent.flagSettings().at(-1)).toMatchObject({ skillOverrides: { constructor: 'on' } })
  })

  // A push that drops nothing has no use for the files, and pushes follow
  // every config write. A key once dropped stays in the map, though, so this
  // holds only until the first one.
  it('reads the settings files only when a skill drops off the map', async () => {
    const read = vi.fn(() => Promise.resolve(new Map<string, SkillVisibility>()))
    const { agent } = fakeAgent(
      { skillOverrides: { 'octopus:review': 'off' } },
      { skillsInFiles: read }
    )

    await agent.session.setSkills({ 'octopus:review': 'on' })

    expect(read).not.toHaveBeenCalled()
  })

  it('says a skill is on when the session started withholding it', async () => {
    const { agent } = fakeAgent({ skillOverrides: { 'octopus:review': 'off' } })

    await agent.session.setSkills({})

    expect(agent.flagSettings()).toEqual([
      expect.objectContaining({ skillOverrides: { 'octopus:review': 'on' } })
    ])
  })

  it('keeps the value a new map gives a key the old one also named', async () => {
    const { agent } = fakeAgent()

    await agent.session.setSkills({ 'octopus:review': 'on' })
    await agent.session.setSkills({ 'octopus:review': 'off' })

    expect(agent.flagSettings()[1]).toMatchObject({ skillOverrides: { 'octopus:review': 'off' } })
  })

  // The flags carry the effort as well, and a push that moves no skill would
  // put back an effort the session was told in between.
  it('sends nothing when the map would not move a skill', async () => {
    const { agent } = fakeAgent({ skillOverrides: { 'octopus:review': 'off' } })

    await agent.session.setSkills({ 'octopus:review': 'off' })

    expect(agent.flagSettings()).toEqual([])
  })

  it('sends a map that names a skill the old one did not', async () => {
    const { agent } = fakeAgent({ skillOverrides: { 'octopus:review': 'off' } })

    await agent.session.setSkills({ 'octopus:review': 'off', 'octopus:ship': 'off' })

    expect(agent.flagSettings()).toEqual([
      expect.objectContaining({
        skillOverrides: { 'octopus:review': 'off', 'octopus:ship': 'off' }
      })
    ])
  })

  it('re-reads the skill directories on request', async () => {
    const { agent } = fakeAgent()

    await agent.session.refreshSkills()

    expect(agent.skillReloads()).toBe(1)
  })

  it('re-reads the plugins on request', async () => {
    const { agent } = fakeAgent()

    await agent.session.reloadPlugins()

    expect(agent.pluginReloads()).toBe(1)
  })

  it('asks for an effort at start-up when the chat has one', () => {
    const { agent } = fakeAgent({ effort: 'xhigh' })

    expect(agent.options().effort).toBe('xhigh')
  })

  // Always sent, unlike `resume` and `model`, which are spread in only when
  // there is one: a chat always holds a level, so there is no absence to
  // express — and the composer names the level on the promise that it goes.
  it('always asks for a level, since the chat always has one', () => {
    const { agent } = fakeAgent()

    expect(agent.options().effort).toBe('medium')
  })

  // `ultracode` is not a level the SDK takes, so what goes out is the pair it
  // stands for: the effort it runs at, and the flag that turns the fleet on.
  it('starts ultracode as xhigh with the workflow flags set', () => {
    const { agent } = fakeAgent({ effort: 'ultracode' })

    expect(agent.options().effort).toBe('xhigh')
    expect(agent.options().settings).toEqual({
      ultracode: true,
      enableWorkflows: true,
      skillOverrides: {}
    })
  })

  // Said rather than left out. Nothing else is loaded that could say otherwise
  // — `settingSources` is empty — so silence here would be a session inheriting
  // whatever the last one was started with.
  it('says so at start-up when the level is an ordinary one', () => {
    const { agent } = fakeAgent({ effort: 'high' })

    expect(agent.options().settings).toEqual({
      ultracode: false,
      enableWorkflows: false,
      skillOverrides: {}
    })
  })

  it('forwards interrupt and mode changes to the SDK', async () => {
    const { agent } = fakeAgent()

    await agent.session.interrupt()
    await agent.session.setPermissionMode('plan')

    expect(agent.interrupted()).toBe(1)
    expect(agent.modes()).toEqual(['plan'])
  })

  // Closing runs from two places — the workspace being removed and the app
  // quitting — and the second must not fall over the first.
  it('is safe to close twice', async () => {
    const { agent } = fakeAgent()
    agent.finish()

    await agent.session.close()
    await expect(agent.session.close()).resolves.toBeUndefined()
  })

  it('closes the SDK session and waits for the stream to end', async () => {
    const { agent } = fakeAgent()
    agent.finish()

    await agent.session.close()

    expect(agent.closed()).toBe(1)
  })
})

describe('a session that will not close', () => {
  // The SDK's `close` is synchronous, so without wrapping it a failure would
  // throw out of the call rather than reject — and the caller removing a
  // workspace catches a rejection.
  it('rejects rather than throwing at the caller', async () => {
    const conversation = Object.assign(silence(), {
      interrupt: () => Promise.resolve(undefined),
      setPermissionMode: () => Promise.resolve(),
      applyFlagSettings: () => Promise.resolve(),
      setModel: () => Promise.resolve(),
      supportedModels: () => Promise.resolve([]),
      close: () => {
        throw new Error('the process would not die')
      }
    }) as unknown as Query

    const session = startSession(
      {
        cwd: '/ws/kyiv',
        resume: null,
        resumeAt: null,
        settingSources: [],
        permissionMode: 'default',
        model: null,
        effort: 'medium',
        allowedTools: [],
        additionalDirectories: [],
        pushTargets: [],
        skillOverrides: {},
        autoCompactWindow: null
      },
      {
        query: () => conversation,
        onEvent: () => undefined,
        askPermission: () => Promise.resolve({ allow: true } as const),
        askElicitation: () => Promise.resolve({ action: 'decline' } as const)
      }
    )

    await expect(session.close()).rejects.toThrow('the process would not die')
  })
})

describe('toolGuards', () => {
  const refuse = (command: string): string | null =>
    command.startsWith('git checkout -b') ? 'Stay on the branch.' : null

  /** Runs the hook registered under `matcher` on a call, as the SDK would. */
  async function decide(
    hooks: ReturnType<typeof toolGuards>,
    matcher: string,
    input: unknown
  ): Promise<unknown> {
    const [hook] = hooks.PreToolUse?.find((entry) => entry.matcher === matcher)?.hooks ?? []
    if (!hook) throw new Error(`no hook for ${matcher}`)
    return hook(input as never, 'tool-1', { signal: new AbortController().signal })
  }

  const shell = (command: string, tool = 'Bash'): unknown => ({
    tool_name: tool,
    tool_input: { command }
  })

  const denied = (reason: string): unknown => ({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  })

  it('refuses a push before the branch guard is asked, and with no branch guard at all', async () => {
    const SHELL = 'Bash|Monitor|PowerShell'
    await expect(decide(toolGuards(refuse), SHELL, shell('git push'))).resolves.toEqual(
      denied(PUBLISH_REFUSAL)
    )
    await expect(decide(toolGuards(), SHELL, shell('git push'))).resolves.toEqual(
      denied(PUBLISH_REFUSAL)
    )
    await expect(decide(toolGuards(), SHELL, shell('git checkout -b x'))).resolves.toEqual({})
  })

  it('reads a PowerShell command with its backtick escapes taken out', async () => {
    const hooks = toolGuards()
    await expect(
      decide(hooks, 'Bash|Monitor|PowerShell', shell('g`h pr create', 'PowerShell'))
    ).resolves.toEqual(denied(PUBLISH_REFUSAL))
  })

  it('denies a command the branch guard refuses, with its reason', async () => {
    await expect(
      decide(toolGuards(refuse), 'Bash|Monitor|PowerShell', shell('git checkout -b x'))
    ).resolves.toEqual(denied('Stay on the branch.'))
  })

  it('says nothing about a command it lets through, or a call that carries none', async () => {
    const hooks = toolGuards(refuse)
    await expect(decide(hooks, 'Bash|Monitor|PowerShell', shell('git status'))).resolves.toEqual({})
    await expect(decide(hooks, 'Bash|Monitor|PowerShell', { tool_input: {} })).resolves.toEqual({})
  })

  it('refuses when the guard itself throws, rather than letting the call through', async () => {
    const broken = (): string | null => {
      throw new Error('broken')
    }
    await expect(
      decide(toolGuards(broken), 'Bash|Monitor|PowerShell', shell('ls'))
    ).resolves.toEqual(denied(GUARD_FAILED))
  })

  it('refuses an MCP tool that would open a pull request, and lets one that reads', async () => {
    const hooks = toolGuards()
    await expect(
      decide(hooks, '^mcp__', { tool_name: 'mcp__github__create_pull_request' })
    ).resolves.toEqual(denied(PUBLISH_REFUSAL))
    await expect(decide(hooks, '^mcp__', { tool_name: 'mcp__github__get_issue' })).resolves.toEqual(
      {}
    )
    await expect(decide(hooks, '^mcp__', {})).resolves.toEqual({})
  })

  it('refuses a subagent in the cloud, and lets one that runs here', async () => {
    const hooks = toolGuards()
    await expect(
      decide(hooks, 'Agent', { tool_input: { prompt: 'x', isolation: 'remote' } })
    ).resolves.toEqual(denied(PUBLISH_REFUSAL))
    await expect(
      decide(hooks, 'Agent', { tool_input: { prompt: 'x', isolation: 'worktree' } })
    ).resolves.toEqual({})
    await expect(decide(hooks, 'Agent', { tool_input: { prompt: 'x' } })).resolves.toEqual({})
    await expect(decide(hooks, 'Agent', {})).resolves.toEqual({})
  })
})

describe('publishLocked', () => {
  it('builds the environment from the base it is given, with the push targets rewritten', () => {
    const { env, disallowedTools } = publishLocked(undefined, ['git@work:o/r.git'], {
      PATH: '/bin'
    })
    expect(env).toEqual(agentEnv({ PATH: '/bin' }, ['git@work:o/r.git']))
    expect(disallowedTools).toEqual([...PUBLISH_DENY_RULES])
  })

  it('starts from the app’s own environment when given none', () => {
    expect(publishLocked(undefined, []).env).toEqual(agentEnv(process.env, []))
  })

  it('reaches every session, with its push targets, with or without a branch guard', () => {
    for (const options of [
      fakeAgent({ pushTargets: ['git@work:o/r.git'] }).agent.options(),
      fakeAgent(
        { pushTargets: ['git@work:o/r.git'] },
        { refuseCommand: () => null }
      ).agent.options()
    ]) {
      const hooks = options.hooks as ReturnType<typeof toolGuards>
      expect(hooks.PreToolUse?.map((entry) => entry.matcher)).toEqual([
        'Bash|Monitor|PowerShell',
        '^mcp__',
        'Agent'
      ])
      expect(options.disallowedTools).toEqual([...PUBLISH_DENY_RULES])
      expect(options.env).toEqual(agentEnv(process.env, ['git@work:o/r.git']))
    }
  })
})

describe('permissions', () => {
  /**
   * Calls the SDK's `canUseTool` the way the SDK does — with all three
   * arguments.
   *
   * The third is the one this used to leave out on both sides, which is how a
   * field the bridge sends went unread for as long as it did.
   */
  function permissionCall(agent: FakeQuery): (
    name: string,
    input: Record<string, unknown>,
    options?: {
      decisionReason?: string
      suggestions?: readonly PermissionUpdate[]
      suppressAlwaysAllowRule?: boolean
    }
  ) => Promise<unknown> {
    const canUseTool = agent.options().canUseTool
    if (typeof canUseTool !== 'function') throw new Error('canUseTool was not passed to the SDK')

    const call = canUseTool as (
      name: string,
      input: Record<string, unknown>,
      options: {
        signal: AbortSignal
        decisionReason?: string
        suggestions?: readonly PermissionUpdate[]
        suppressAlwaysAllowRule?: boolean
      }
    ) => Promise<unknown>

    return (name, input, options = {}) =>
      call(name, input, { signal: new AbortController().signal, ...options })
  }

  /*
   * The whole of the first half of the finding.
   *
   * Measured against a live session: 59 edits under `acceptEdits` went through
   * without a word, and the sixtieth — `.claude/skills/…/SKILL.md` — was asked
   * about, because the CLI guards the agent's own instructions separately. It
   * says exactly that in this field, which nothing read, so the mode looked
   * broken and nothing on screen could say otherwise.
   */
  it('passes the bridge\u2019s explanation on to whoever answers', async () => {
    const asked: unknown[] = []
    const { agent } = fakeAgent(
      {},
      {
        askPermission: (ask) => {
          asked.push(ask)
          return Promise.resolve({ allow: true })
        }
      }
    )

    await permissionCall(agent)(
      'Edit',
      { file_path: '/w/.claude/skills/demo/SKILL.md' },
      { decisionReason: 'Claude requested permissions to write to it.' }
    )

    expect(asked).toEqual([
      {
        toolName: 'Edit',
        input: { file_path: '/w/.claude/skills/demo/SKILL.md' },
        reason: 'Claude requested permissions to write to it.',
        signal: expect.any(AbortSignal)
      }
    ])
  })

  /* Absent rather than `undefined`: `exactOptionalPropertyTypes` tells the two
     apart, and most requests come with nothing to explain. */
  it('carries no reason where the bridge sent none', async () => {
    const asked: unknown[] = []
    const { agent } = fakeAgent(
      {},
      {
        askPermission: (ask) => {
          asked.push(ask)
          return Promise.resolve({ allow: true })
        }
      }
    )

    await permissionCall(agent)('Edit', { file_path: '/a.rb' })

    expect(asked).toEqual([
      { toolName: 'Edit', input: { file_path: '/a.rb' }, signal: expect.any(AbortSignal) }
    ])
  })

  /* The narrow rule the bridge named, handed straight back: without it the very
     next call asks the same question, since the SDK knows nothing about the
     list octopus keeps itself. */
  it('sends a standing rule back on the reply that releases the call', async () => {
    const rule = {
      type: 'addRules' as const,
      behavior: 'allow' as const,
      destination: 'session' as const,
      rules: [{ toolName: 'Edit', ruleContent: '/w/docs/**' }]
    }
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: true, standing: [rule] }) }
    )

    await expect(permissionCall(agent)('Edit', { file_path: '/w/docs/a.md' })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/w/docs/a.md' },
      updatedPermissions: [rule]
    })
  })

  /* Both on one reply, because a turn can approve a plan and answer "always"
     and the reply is the only thing that releases the tool call. */
  it('sends a mode and a rule together', async () => {
    const rule = {
      type: 'addRules' as const,
      behavior: 'allow' as const,
      destination: 'session' as const,
      rules: [{ toolName: 'Edit' }]
    }
    const { agent } = fakeAgent(
      {},
      {
        askPermission: () =>
          Promise.resolve({ allow: true, setMode: 'acceptEdits' as const, standing: [rule] })
      }
    )

    const answer = await permissionCall(agent)('Edit', {})

    expect(answer).toMatchObject({
      updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }, rule]
    })
  })

  it('passes the suggestion on to whoever answers', async () => {
    const asked: unknown[] = []
    const rule = {
      type: 'addRules' as const,
      behavior: 'allow' as const,
      destination: 'session' as const,
      rules: [{ toolName: 'Edit', ruleContent: '/w/docs/**' }]
    }
    const { agent } = fakeAgent(
      {},
      {
        askPermission: (ask) => {
          asked.push(ask)
          return Promise.resolve({ allow: true })
        }
      }
    )

    await permissionCall(agent)('Edit', { file_path: '/w/docs/a.md' }, { suggestions: [rule] })

    expect(asked).toEqual([
      {
        toolName: 'Edit',
        input: { file_path: '/w/docs/a.md' },
        suggestions: [rule],
        signal: expect.any(AbortSignal)
      }
    ])
  })

  /* The bridge's word that "always" would grant more than this question: on
     exactly those asks the suggestion names no narrow rule, so the fallback
     would store the whole tool. Passed on only when set. */
  it('passes on that a standing answer must not be offered', async () => {
    const asked: { suppressAlways?: boolean }[] = []
    const { agent } = fakeAgent(
      {},
      {
        askPermission: (ask) => {
          asked.push(ask)
          return Promise.resolve({ allow: true })
        }
      }
    )

    await permissionCall(agent)('Bash', { command: 'ls' }, { suppressAlwaysAllowRule: true })
    await permissionCall(agent)('Bash', { command: 'ls' }, { suppressAlwaysAllowRule: false })

    expect(asked[0]?.suppressAlways).toBe(true)
    expect(asked[1]).not.toHaveProperty('suppressAlways')
  })

  /* The signal is what tells the service the question was taken back, so it
     is the SDK's own one that has to arrive, not a copy. */
  it('hands over the signal the bridge withdraws a question with', async () => {
    const asked: { signal: AbortSignal }[] = []
    const { agent } = fakeAgent(
      {},
      {
        askPermission: (ask) => {
          asked.push(ask)
          return Promise.resolve({ allow: true })
        }
      }
    )
    const canUseTool = agent.options().canUseTool as (
      name: string,
      input: Record<string, unknown>,
      options: { signal: AbortSignal }
    ) => Promise<unknown>
    const withdraw = new AbortController()

    await canUseTool('Bash', {}, { signal: withdraw.signal })

    expect(asked[0]?.signal).toBe(withdraw.signal)
  })

  it('allows a tool the user approved, keeping the arguments', async () => {
    const { agent } = fakeAgent({}, { askPermission: () => Promise.resolve({ allow: true }) })

    await expect(permissionCall(agent)('Edit', { file_path: '/a.rb' })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/a.rb' }
    })
  })

  /*
   * How an answer reaches a tool that asked a question.
   *
   * `AskUserQuestion` reads the user's choices off its own input, so the reply
   * releasing the tool call carries a modified copy of the arguments. There is
   * no message to send back and no other way in — get this wrong and the tool
   * runs with nothing in it, which reads to the agent as "nobody answered".
   */
  it('hands a tool the arguments the answer changed', async () => {
    const answered = { questions: [], answers: { 'Which one?': 'the first' } }
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: true, updatedInput: answered }) }
    )

    await expect(
      permissionCall(agent)('AskUserQuestion', { questions: [] })
    ).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: answered
    })
  })

  // Arguments that are not an object at all would be a bug in whoever answered,
  // and one a session cannot fix. The agent's own arguments are the safe thing
  // to fall back to: that is what approving a tool means.
  it('falls back to what the agent asked with when the answer is not arguments', async () => {
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: true, updatedInput: 'yes please' }) }
    )

    await expect(permissionCall(agent)('Edit', { file_path: '/a.rb' })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { file_path: '/a.rb' }
    })
  })

  // The SDK's own way to change mode on an approval, and the reason approving
  // a plan can hand the session to the mode chosen for the work that follows.
  // Verified against a live session before being written down: without this
  // field the very next edit asks again.
  it('carries a mode change on an approval that asks for one', async () => {
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: true, setMode: 'acceptEdits' }) }
    )

    await expect(permissionCall(agent)('ExitPlanMode', { plan: 'do it' })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { plan: 'do it' },
      updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
    })
  })

  // Absent rather than present and empty: the SDK reads the key as a set of
  // updates to apply, and every ordinary approval would otherwise carry one.
  it('says nothing about permissions on an ordinary approval', async () => {
    const { agent } = fakeAgent({}, { askPermission: () => Promise.resolve({ allow: true }) })

    const result = await permissionCall(agent)('Edit', { file_path: '/a.rb' })

    expect(result).not.toHaveProperty('updatedPermissions')
  })

  it('denies with a message the agent can read', async () => {
    const { agent } = fakeAgent(
      {},
      { askPermission: () => Promise.resolve({ allow: false, message: DENIED }) }
    )

    await expect(permissionCall(agent)('Bash', { command: 'rm -rf /' })).resolves.toEqual({
      behavior: 'deny',
      message: DENIED
    })
  })

  // The refusal's message is instruction, not an apology: this is how "not
  // quite, do this instead" reaches the agent without costing a turn.
  it('sends the words the user wrote when a refusal carries them', async () => {
    const { agent } = fakeAgent(
      {},
      {
        askPermission: () => Promise.resolve({ allow: false, message: 'Add a step for the tests' })
      }
    )

    await expect(permissionCall(agent)('ExitPlanMode', { plan: 'do it' })).resolves.toEqual({
      behavior: 'deny',
      message: 'Add a step for the tests'
    })
  })

  // Without this the dialog would fire for every file the agent opens, which
  // is most of what it does — and a prompt that constant stops being read.
  it('pre-approves the read-only tools rather than asking about each read', () => {
    const { agent } = fakeAgent()

    expect(agent.options().allowedTools).toEqual([...READ_ONLY_TOOLS])
    expect(READ_ONLY_TOOLS).toContain('Read')
    expect(READ_ONLY_TOOLS).not.toContain('Bash')
  })

  it('asks about a tool through the hook it was given', async () => {
    const asked = vi.fn(() => Promise.resolve<PermissionOutcome>({ allow: true }))
    const { agent } = fakeAgent({}, { askPermission: asked })

    await permissionCall(agent)('Write', { file_path: '/b.rb' })

    expect(asked).toHaveBeenCalledWith({
      toolName: 'Write',
      input: { file_path: '/b.rb' },
      signal: expect.any(AbortSignal)
    })
  })
})

describe('an epoch reading with no unit given', () => {
  // `resetsAt` is typed as a bare number. Seconds and milliseconds for any
  // date this side of 1973 differ by three orders of magnitude, so telling
  // them apart is a check rather than a guess.
  it('reads seconds and milliseconds as the same moment', () => {
    const moment = '2026-08-11T09:00:00.000Z'
    const milliseconds = Date.parse(moment)

    expect(toIsoTimestamp(milliseconds)).toBe(moment)
    expect(toIsoTimestamp(milliseconds / 1000)).toBe(moment)
  })

  it('says nothing rather than inventing a date', () => {
    expect(toIsoTimestamp(undefined)).toBeNull()
    expect(toIsoTimestamp(0)).toBeNull()
    expect(toIsoTimestamp(-1)).toBeNull()
    expect(toIsoTimestamp(Number.NaN)).toBeNull()
  })
})

describe('how large the prompt was', () => {
  // Measured on a real turn: 2 input tokens beside 17,392 read from cache and
  // 7,825 written to it. The bare field understates the prompt by four orders
  // of magnitude, which on screen would read as a broken number.
  it('counts what was cached as well as what was not', () => {
    expect(
      promptTokens({
        input_tokens: 2,
        cache_read_input_tokens: 17_392,
        cache_creation_input_tokens: 7825
      })
    ).toBe(25_219)
  })

  it('is zero for a turn that sent nothing', () => {
    expect(
      promptTokens({
        input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      })
    ).toBe(0)
  })
})

describe('the lists a session announces', () => {
  /** The message every turn opens with, naming the skills the session holds. */
  const init = (skills: string[]): SDKMessage =>
    ({
      type: 'system',
      subtype: 'init',
      session_id: 'sess-1',
      permissionMode: 'default',
      skills
    }) as unknown as SDKMessage

  const announced = (events: AgentEvent[], type: string): AgentEvent[] =>
    events.filter((event) => event.type === type)

  // Nothing asks for the lists: the session says them once it has started,
  // which is when it can say which commands are skills.
  it('announces its commands once the first init has said which are skills', async () => {
    const { agent, events } = fakeAgent(
      {},
      {
        commands: [
          { name: 'review', description: 'Review it', argumentHint: '' },
          { name: 'clear', description: '', argumentHint: '[name]', aliases: ['reset'] }
        ]
      }
    )
    await settle()
    expect(announced(events, 'commands_changed')).toEqual([])

    agent.emit(init(['review']))
    await settle()

    expect(announced(events, 'commands_changed')).toEqual([
      {
        type: 'commands_changed',
        commands: [
          { name: 'review', description: 'Review it', argumentHint: '', aliases: [], skill: true },
          {
            name: 'clear',
            description: '',
            argumentHint: '[name]',
            aliases: ['reset'],
            skill: false
          }
        ]
      }
    ])
  })

  // Only what the `@` list shows: the model an agent runs on is its own
  // business, and keeping it would be a stored field nothing reads.
  it('announces its subagents with their names and descriptions', async () => {
    const { agent, events } = fakeAgent(
      {},
      {
        agents: [
          { name: 'Explore', description: 'Searches the code', model: 'haiku' },
          { name: 'my-plugin:review', description: 'Reviews a change' }
        ]
      }
    )

    agent.emit(init([]))
    await settle()

    expect(announced(events, 'agents_changed')).toEqual([
      {
        type: 'agents_changed',
        agents: [
          { name: 'Explore', description: 'Searches the code' },
          { name: 'my-plugin:review', description: 'Reviews a change' }
        ]
      }
    ])
  })

  // Every slash command brings a fresh init; the lists are said once, and a
  // change after that arrives as the SDK's own `commands_changed`.
  it('announces them once, however many inits follow', async () => {
    const { agent, events } = fakeAgent()

    agent.emit(init([]))
    agent.emit(init([]))
    await settle()

    expect(announced(events, 'commands_changed')).toHaveLength(1)
    expect(announced(events, 'agents_changed')).toHaveLength(1)
  })

  // A synced skill is typed by its short name and listed by it, while its
  // qualified name rides along as an alias — and either is the same skill.
  it('recognises a skill the init names by one of its aliases', async () => {
    const { agent, events } = fakeAgent(
      {},
      {
        commands: [
          {
            name: 'xibo-hylab-support',
            description: '',
            argumentHint: '',
            aliases: ['anthropic-skills:xibo-hylab-support']
          }
        ]
      }
    )

    agent.emit(init(['anthropic-skills:xibo-hylab-support']))
    await settle()

    expect(announced(events, 'commands_changed')).toEqual([
      { type: 'commands_changed', commands: [expect.objectContaining({ skill: true })] }
    ])
  })

  // One list that cannot be read must not take the other with it, and neither
  // is an error in the chat: the list is a convenience.
  it('announces the list it could read when the other fails', async () => {
    const { agent, events } = fakeAgent({}, { agents: new Error('no such control request') })

    agent.emit(init([]))
    await settle()

    expect(announced(events, 'commands_changed')).toHaveLength(1)
    expect(announced(events, 'agents_changed')).toEqual([])
    expect(announced(events, 'error')).toEqual([])
  })

  it('announces the agents when the commands cannot be read', async () => {
    const { agent, events } = fakeAgent({}, { commands: new Error('no such control request') })

    agent.emit(init([]))
    await settle()

    expect(announced(events, 'commands_changed')).toEqual([])
    expect(announced(events, 'agents_changed')).toHaveLength(1)
  })

  // A list announced mid-session is marked against the latest init: a skill
  // written while the session was open joins at the next turn.
  it('marks the skills in a list the session announces later', async () => {
    const { agent, events } = fakeAgent()
    agent.emit(init([]))
    agent.emit(init(['review']))
    agent.emit({
      type: 'system',
      subtype: 'commands_changed',
      commands: [{ name: 'review', description: '', argumentHint: '' }]
    } as unknown as SDKMessage)
    await settle()

    expect(announced(events, 'commands_changed').at(-1)).toEqual({
      type: 'commands_changed',
      commands: [expect.objectContaining({ name: 'review', skill: true })]
    })
  })

  // Most commands have no other name, and the SDK simply leaves the field out.
  // A list rather than nothing, because every caller searches it — and one that
  // had to guard for absence would forget.
  it('gives a command with no other name an empty list of them', () => {
    const [command] = toAgentCommands([
      { name: 'usage', description: 'What you have spent', argumentHint: '' }
    ])

    expect(command?.aliases).toEqual([])
  })

  // The SDK's own array, handed straight through, would be shared with whatever
  // else holds it — and this one gets written to disk.
  it('copies the aliases rather than sharing the array the SDK handed over', () => {
    const aliases = ['reset']
    const [command] = toAgentCommands([
      { name: 'clear', description: '', argumentHint: '', aliases }
    ])

    aliases.push('new')
    expect(command?.aliases).toEqual(['reset'])
  })
})

describe('the models the account may use', () => {
  it('asks the running session, since that is the only thing that knows', async () => {
    const { agent } = fakeAgent(
      {},
      {
        models: [
          {
            value: 'claude-opus-5',
            displayName: 'Opus 5',
            description: 'The capable one',
            supportsEffort: true,
            supportedEffortLevels: ['high', 'max']
          }
        ]
      }
    )

    await expect(agent.session.models()).resolves.toEqual([
      {
        value: 'claude-opus-5',
        resolvedModel: null,
        displayName: 'Opus 5',
        description: 'The capable one',
        supportsEffort: true,
        supportedEffortLevels: ['high', 'max']
      }
    ])
  })

  // "Did not say" and "says no" lead to different pickers: the first offers
  // every level, the second offers none. Collapsing both to false would quietly
  // grey out the control for every model that simply stayed quiet.
  it('keeps silence about effort apart from a refusal', () => {
    const [quiet, refusing] = toAgentModels([
      { value: 'a', displayName: 'A', description: '' },
      { value: 'b', displayName: 'B', description: '', supportsEffort: false }
    ])

    expect(quiet?.supportsEffort).toBeNull()
    expect(quiet?.supportedEffortLevels).toBeNull()
    expect(refusing?.supportsEffort).toBe(false)
  })

  // The SDK reports more about a model than a picker has any use for, and
  // letting those fields through would put an SDK shape in the window. The one
  // exception is the name this entry resolves to — see below.
  it('drops what the interface does not need', () => {
    const [model] = toAgentModels([
      {
        value: 'a',
        displayName: 'A',
        description: '',
        supportsFastMode: true,
        supportsAutoMode: true,
        supportsAdaptiveThinking: true
      }
    ])

    expect(model).toEqual({
      value: 'a',
      resolvedModel: null,
      displayName: 'A',
      description: '',
      supportsEffort: null,
      supportedEffortLevels: null
    })
  })

  /*
   * The one SDK field about a model that is kept, because two names for one
   * model reach us from different directions: the catalogue offers the short
   * one, a running session reports itself in full. Without this they read as
   * different models — a second row in the picker for a model already in it.
   */
  it('keeps the full name a short one stands for', () => {
    const [model] = toAgentModels([
      { value: 'sonnet', displayName: 'Sonnet', description: '', resolvedModel: 'claude-sonnet-5' }
    ])

    expect(model?.resolvedModel).toBe('claude-sonnet-5')
  })

  // An entry already spelled out in full has nothing to resolve to.
  it('says nothing where the agent said nothing', () => {
    const [model] = toAgentModels([{ value: 'a', displayName: 'A', description: '' }])

    expect(model?.resolvedModel).toBeNull()
  })
})

/**
 * Both responses as a live CLI actually sent them, trimmed of what we drop.
 *
 * Copied from one throwaway session against build 2.1.228 rather than written
 * from the type declarations. This SDK has already cost three bugs on that
 * difference, and it cost a fourth here: the payload carries nine windows the
 * declaration never mentions — `seven_day_cowork`, `tangelo`, `iguana_necktie`,
 * `nimbus_quill` and more — plus dollar fields on every one of them.
 */
const CONTEXT_RESPONSE = {
  totalTokens: 23_921,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  percentage: 2,
  autoCompactThreshold: 967_000,
  isAutoCompactEnabled: true,
  categories: [{ name: 'System prompt', tokens: 3313, color: 'promptBorder' }],
  gridRows: [],
  model: 'claude-opus-5[1m]',
  memoryFiles: [],
  mcpTools: [],
  apiUsage: null
} as unknown as Awaited<ReturnType<Query['getContextUsage']>>

const USAGE_RESPONSE = {
  // A session that has not run a turn reports an empty map rather than zeros,
  // which is what a `/usage` typed as a conversation's first message hits.
  // What the mapping does with the rest of this is `usage.test.ts`'s subject.
  session: {
    total_cost_usd: 0,
    total_api_duration_ms: 0,
    total_duration_ms: 695,
    total_lines_added: 0,
    total_lines_removed: 0,
    model_usage: {}
  },
  subscription_type: 'max',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 18, resets_at: '2026-08-12T19:50:00.149775+00:00' },
    seven_day: { utilization: 84, resets_at: '2026-08-12T22:00:00.149796+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: null,
    nimbus_quill: { utilization: 0, resets_at: null },
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null }
  }
} as unknown as Awaited<
  ReturnType<Query['usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET']>
>

/** A `Query` that answers control requests however the test says. */
function queryAnswering(overrides: Record<string, unknown>): Query {
  return overrides as unknown as Query
}

/*
 * The model's own limit is only in a turn's result. `maxTokens` shrinks with a
 * chosen window and `rawMaxTokens` measured the same, so neither says which
 * choices would be cut down to the model.
 */
describe('what a model holds', () => {
  const result = (modelUsage: unknown): SDKMessage =>
    ({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 10,
      usage: { input_tokens: 0, output_tokens: 0 },
      modelUsage,
      session_id: 's-1'
    }) as unknown as SDKMessage

  it('learns it from a finished turn', async () => {
    const { agent, events } = fakeAgent()
    agent.emit(result({ 'claude-opus-5[1m]': { contextWindow: 1_000_000, costUSD: 0 } }))
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({ type: 'result' }))
    })

    await expect(agent.session.contextUsage()).resolves.toMatchObject({ modelWindow: 1_000_000 })
  })

  // The binary is versioned apart from this package: a result without the
  // field, or with it in another shape, costs the hint and nothing else.
  it('knows nothing from a result that does not say, and still ends the turn', async () => {
    const { agent, events } = fakeAgent()
    agent.emit(result({ 'claude-opus-5[1m]': { contextWindow: 'lots' } }))
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({ type: 'result', ok: true }))
    })

    await expect(agent.session.contextUsage()).resolves.toMatchObject({ modelWindow: null })
  })
})

describe('reading how full the context window is', () => {
  it('takes the figures worth showing and leaves the rest', async () => {
    const usage = await readContextUsage(
      queryAnswering({ getContextUsage: () => Promise.resolve(CONTEXT_RESPONSE) })
    )

    expect(usage).toEqual({
      percentage: 2,
      usedTokens: 23_921,
      maxTokens: 1_000_000,
      model: 'claude-opus-5[1m]',
      // Nothing to go on before a turn has said what the model holds.
      modelWindow: null
    })
  })

  /*
   * The model rides along because this is the one call that already asks and
   * whose answer is current: measured against a live session, the init that
   * follows a `/model` command still names the *old* model, while this answers
   * correctly the moment the turn ends.
   */
  it('names the model the session is actually running', async () => {
    const usage = await readContextUsage(
      queryAnswering({
        getContextUsage: () =>
          Promise.resolve({ ...CONTEXT_RESPONSE, model: 'claude-haiku-4-5-20251001' })
      })
    )

    expect(usage?.model).toBe('claude-haiku-4-5-20251001')
  })

  // The field arrived later than the rest of the response, so a CLI a few
  // versions back answers without it — and an empty string is not a model.
  it('says nothing about the model when the CLI does not', async () => {
    const { model, ...older } = CONTEXT_RESPONSE
    void model

    await expect(
      readContextUsage(queryAnswering({ getContextUsage: () => Promise.resolve(older) }))
    ).resolves.toMatchObject({ model: null })

    await expect(
      readContextUsage(
        queryAnswering({
          getContextUsage: () => Promise.resolve({ ...CONTEXT_RESPONSE, model: '' })
        })
      )
    ).resolves.toMatchObject({ model: null })
  })

  // The typed package and the CLI binary are versioned separately, so a method
  // the types promise can simply not be there.
  it('says nothing when the CLI has no such control request', async () => {
    await expect(readContextUsage(queryAnswering({}))).resolves.toBeNull()
  })

  it('says nothing when the request is refused', async () => {
    const refusing = queryAnswering({
      getContextUsage: () => Promise.reject(new Error('not ready for writing'))
    })

    await expect(readContextUsage(refusing)).resolves.toBeNull()
  })
})

describe('reading everything /usage answers', () => {
  const asking = (response: unknown): Query =>
    queryAnswering({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => Promise.resolve(response)
    })

  it('takes the whole report, not just the two windows the strip wants', async () => {
    const report = await readUsageReport(asking(USAGE_RESPONSE))

    expect(report?.subscriptionType).toBe('max')
    expect(report?.session.wallDurationMs).toBe(695)
    expect(report?.limits.map((limit) => limit.key)).toEqual(['five_hour', 'seven_day'])
  })

  /*
   * The sidebar asks every few minutes and draws none of the transcript scan, so
   * it says so. What matters here is that the request actually carries it: a
   * flag taken and dropped would leave the scan running on every read with
   * nothing to show for it.
   */
  it('passes on what the caller wants left out', async () => {
    const received: unknown[] = []
    const recording = queryAnswering({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: (options?: unknown) => {
        received.push(options)
        return Promise.resolve(USAGE_RESPONSE)
      }
    })

    await readUsageReport(recording, { skipBehaviors: true })
    await readUsageReport(recording)

    expect(received).toEqual([{ skipBehaviors: true }, undefined])
  })

  it('says nothing when the CLI has no such control request', async () => {
    await expect(readUsageReport(queryAnswering({}))).resolves.toBeNull()
  })

  it('says nothing when the request is refused', async () => {
    const refusing = queryAnswering({
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
        Promise.reject(new Error('unknown control request'))
    })

    await expect(readUsageReport(refusing)).resolves.toBeNull()
  })

  // The one failure this reading has that the others do not. The SDK says of
  // this API that its shape "may change or be removed in any release without
  // notice", so a response it no longer recognises is a case to expect.
  it('says nothing when the response is in a shape it does not know', async () => {
    await expect(readUsageReport(asking({ session: 'moved elsewhere' }))).resolves.toBeNull()
  })
})

describe('the session, asked about usage', () => {
  it('answers every question from the conversation it holds', async () => {
    const { agent } = fakeAgent()

    await expect(agent.session.contextUsage()).resolves.toMatchObject({ percentage: 2 })
    await expect(agent.session.usageReport()).resolves.toMatchObject({ subscriptionType: 'max' })
  })
})

// The read loop must run to the end of the stream. Leaving it early — after a
// `result`, which looks like the end of the work — closes the transport, and
// every control request afterwards fails. Walked into while probing the usage
// calls; this is what would notice it being walked into again.
describe('the stream the session reads', () => {
  it('still answers control requests after a turn has ended', async () => {
    const { agent } = fakeAgent()

    agent.emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 10,
      total_cost_usd: 0,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0
      },
      session_id: 's-1'
    } as unknown as SDKMessage)
    await settle()

    await expect(agent.session.contextUsage()).resolves.toMatchObject({ percentage: 2 })
    await expect(agent.session.models()).resolves.toEqual([])
  })
})

describe("an MCP server's question", () => {
  /** Calls the SDK's `onElicitation` the way the SDK does. */
  function elicitationCall(
    agent: FakeQuery
  ): (request: Record<string, unknown>) => Promise<{ action: string; content?: unknown }> {
    const onElicitation = agent.options().onElicitation
    if (typeof onElicitation !== 'function') {
      throw new Error('onElicitation was not passed to the SDK')
    }

    const call = onElicitation as (
      request: Record<string, unknown>,
      options: { signal: AbortSignal }
    ) => Promise<{ action: string; content?: unknown }>

    return (request) => call(request, { signal: new AbortController().signal })
  }

  const FORM = {
    type: 'object',
    properties: { token: { type: 'string', title: 'Token' } },
    required: ['token']
  }

  /*
   * Declared at all because the SDK **declines automatically** when it is not:
   * the server is refused, the agent carries on as though an answer had been
   * given, and nobody sees anything.
   */
  it('is declared, so the SDK stops declining it on its own', () => {
    const { agent } = fakeAgent()

    expect(typeof agent.options().onElicitation).toBe('function')
  })

  it('reaches whoever answers, with the form already read', async () => {
    const asked: unknown[] = []
    const { agent } = fakeAgent(
      {},
      {
        askElicitation: (ask) => {
          asked.push(ask)
          return Promise.resolve({ action: 'accept', content: { token: 'abc' } })
        }
      }
    )

    const answer = await elicitationCall(agent)({
      serverName: 'ledger',
      message: 'Which token should I use?',
      requestedSchema: FORM
    })

    expect(asked).toEqual([
      {
        serverName: 'ledger',
        message: 'Which token should I use?',
        title: '',
        fields: [
          {
            kind: 'text',
            name: 'token',
            label: 'Token',
            description: '',
            required: true,
            value: ''
          }
        ]
      }
    ])
    expect(answer).toEqual({ action: 'accept', content: { token: 'abc' } })
  })

  it('carries a heading the server offered', async () => {
    const asked: { title: string }[] = []
    const { agent } = fakeAgent(
      {},
      {
        askElicitation: (ask) => {
          asked.push({ title: ask.title })
          return Promise.resolve({ action: 'decline' })
        }
      }
    )

    await elicitationCall(agent)({
      serverName: 'ledger',
      message: 'x',
      title: 'Credentials',
      requestedSchema: FORM
    })

    expect(asked).toEqual([{ title: 'Credentials' }])
  })

  /*
   * A `url` mode asks the host to send somebody to an address a repository
   * chose. That is an outward-facing act, and it is not taken on a server's
   * say-so — so it is refused here rather than shown.
   */
  it('refuses to send anybody to an address a server chose', async () => {
    const asked: unknown[] = []
    const { agent } = fakeAgent(
      {},
      {
        askElicitation: (ask) => {
          asked.push(ask)
          return Promise.resolve({ action: 'accept', content: {} })
        }
      }
    )

    // With a form beside it that **could** be drawn, so the refusal can only be
    // about the mode: without one, declining because there is nothing to draw
    // would look exactly the same.
    const answer = await elicitationCall(agent)({
      serverName: 'ledger',
      message: 'Sign in',
      mode: 'url',
      url: 'https://example.test/auth',
      requestedSchema: FORM
    })

    expect(answer.action).toBe('decline')
    expect(asked).toEqual([])
  })

  /*
   * A half-drawn form collects an answer the server then refuses, and the user
   * has typed it for nothing. Declined with a reason instead, which costs the
   * same turn and says something true.
   */
  it('declines a form it cannot draw, rather than drawing part of one', async () => {
    const asked: unknown[] = []
    const { agent } = fakeAgent(
      {},
      {
        askElicitation: (ask) => {
          asked.push(ask)
          return Promise.resolve({ action: 'accept', content: {} })
        }
      }
    )

    const answer = await elicitationCall(agent)({
      serverName: 'ledger',
      message: 'x',
      requestedSchema: { type: 'object', properties: { nested: { type: 'object' } } }
    })

    expect(answer.action).toBe('decline')
    expect(asked).toEqual([])
  })
})
