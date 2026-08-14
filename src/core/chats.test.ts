import { describe, expect, it } from 'vitest'

import {
  AGENT_KINDS,
  type AgentCommand,
  AgentCommandSchema,
  type AgentModel,
  defaultAgentModel,
  findAgentModel,
  sameModel,
  ChatMessageSchema,
  ChatSchema,
  isClearCommand,
  newChat,
  PERMISSION_MODES,
  PermissionAnswerSchema,
  sessionMode,
  WORKING_MODES
} from './chats.js'

describe('a new chat', () => {
  const options = {
    id: 'chat-1',
    agent: 'claude' as const,
    workingMode: 'default' as const,
    effort: null,
    createdAt: '2026-08-11T09:00:00.000Z'
  }

  it('starts with no session and nothing overridden', () => {
    const chat = newChat('planner/kyiv', options)

    expect(chat).toEqual({
      id: 'chat-1',
      workspaceId: 'planner/kyiv',
      agent: 'claude',
      sessionId: null,
      model: null,
      effort: null,
      workingMode: 'default',
      planMode: false,
      knownCommands: [],
      createdAt: '2026-08-11T09:00:00.000Z'
    })
  })

  it('carries the effort it was created with', () => {
    expect(newChat('planner/kyiv', { ...options, effort: 'max' }).effort).toBe('max')
  })

  // A record written before the field existed has to load, because the reader
  // throws on a mismatch rather than falling back — a missing default would
  // stop the app opening, not lose a value.
  it('reads a record written before effort existed', () => {
    const { effort, ...older } = newChat('planner/kyiv', options)
    void effort

    const parsed = ChatSchema.safeParse(older)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.effort).toBeNull()
  })

  // The same claim for the command list, and it matters more: every chat on
  // disk right now predates the field.
  it('reads a record written before commands were remembered', () => {
    const { knownCommands, ...older } = newChat('planner/kyiv', options)
    void knownCommands

    const parsed = ChatSchema.safeParse(older)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.knownCommands).toEqual([])
  })

  /*
   * The claim that made splitting the field safe without writing a migration,
   * asserted rather than assumed: records on disk right now hold the old
   * three-valued `permissionMode`, and one of them holds `plan`.
   *
   * A plain object schema drops the key it no longer knows and both new fields
   * default, so the conversation that was stuck planning — which was the bug —
   * comes back as an ordinary one that is not.
   */
  it('reads a record written before the mode was split', () => {
    const { workingMode, planMode, ...older } = newChat('planner/kyiv', options)
    void workingMode
    void planMode

    for (const stored of ['default', 'acceptEdits', 'plan']) {
      const parsed = ChatSchema.safeParse({ ...older, permissionMode: stored })

      expect(parsed.success).toBe(true)
      expect(parsed.data?.workingMode).toBe('default')
      expect(parsed.data?.planMode).toBe(false)
      expect(parsed.data).not.toHaveProperty('permissionMode')
    }
  })

  // Two fields, one union: the SDK takes a single mode, and this is the only
  // place that decides which half of the pair wins.
  it('folds the two halves back into the mode a session starts in', () => {
    expect(sessionMode({ planMode: false, workingMode: 'default' })).toBe('default')
    expect(sessionMode({ planMode: false, workingMode: 'acceptEdits' })).toBe('acceptEdits')
    expect(sessionMode({ planMode: true, workingMode: 'default' })).toBe('plan')
    // Planning wins: the agent runs no tools at all, so there is nothing for
    // "accept edits" to accept until the plan is approved.
    expect(sessionMode({ planMode: true, workingMode: 'acceptEdits' })).toBe('plan')
  })

  it('is a valid record', () => {
    expect(ChatSchema.safeParse(newChat('planner/kyiv', options)).success).toBe(true)
  })

  it('carries the mode it was created with', () => {
    const free = newChat('planner/kyiv', { ...options, workingMode: 'acceptEdits' })

    expect(free.workingMode).toBe('acceptEdits')
  })

  // Planning is asked for about a task, not inherited from a setting, so a
  // fresh conversation is never already in it.
  it('never starts out planning', () => {
    expect(newChat('planner/kyiv', { ...options, workingMode: 'acceptEdits' }).planMode).toBe(false)
  })
})

describe('the agent kind', () => {
  // A single-member enum reads like an accident. It is the seam: the value is
  // stored, so a second agent is a widened enum rather than a migration.
  it('is stored, so adding another agent does not rewrite existing records', () => {
    expect(AGENT_KINDS).toEqual(['claude'])
    expect(ChatSchema.shape.agent.safeParse('codex').success).toBe(false)
  })
})

describe('permission modes', () => {
  it('offers asking, planning and accepting edits', () => {
    expect(PERMISSION_MODES).toEqual(['default', 'plan', 'acceptEdits'])
  })

  // The stored half is the SDK's union minus planning, and it has to stay a
  // subset of it: a value here the SDK does not know is a session that never
  // starts, found at runtime rather than at the build.
  it('stores every mode but planning, and nothing the SDK would not take', () => {
    expect(WORKING_MODES).toEqual(['default', 'acceptEdits'])
    for (const mode of WORKING_MODES) expect(PERMISSION_MODES).toContain(mode)
  })

  // §4 puts transparency above convenience, and a mode where nothing is ever
  // shown is the one setting reading the screen cannot undo.
  it('does not offer bypassing permissions', () => {
    expect(ChatSchema.shape.workingMode.safeParse('bypassPermissions').success).toBe(false)
  })
})

describe('what the renderer may send', () => {
  it('rejects an empty message', () => {
    expect(ChatMessageSchema.safeParse('').success).toBe(false)
  })

  // A message past this is a pasted file, which belongs in the workspace where
  // the agent can read it rather than in the conversation.
  it('rejects a message longer than a prompt', () => {
    expect(ChatMessageSchema.safeParse('x'.repeat(100_001)).success).toBe(false)
    expect(ChatMessageSchema.safeParse('x'.repeat(100_000)).success).toBe(true)
  })

  it('accepts only the three answers a permission card offers', () => {
    expect(PermissionAnswerSchema.safeParse('always').success).toBe(true)
    expect(PermissionAnswerSchema.safeParse('maybe').success).toBe(false)
  })
})

describe('a command the agent reported', () => {
  // Half of this list comes from a project's own `.claude/commands/`, where a
  // file is written by hand and may declare nothing but a name.
  it('needs nothing but a name', () => {
    const parsed = AgentCommandSchema.safeParse({ name: 'deploy' })

    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      name: 'deploy',
      description: '',
      argumentHint: '',
      aliases: []
    })
  })

  it('is not a command without one', () => {
    expect(AgentCommandSchema.safeParse({ name: '' }).success).toBe(false)
  })
})

/*
 * Which message means "forget this conversation".
 *
 * Asked before sending rather than read off the reset that comes back, because
 * the SDK sends the same reset when the agent leaves plan mode — and clearing
 * the log on that would erase the conversation every time a plan was approved.
 */
describe('recognising the command that clears', () => {
  const clear: AgentCommand = {
    name: 'clear',
    description: 'Start a new session with empty context',
    argumentHint: '[name]',
    aliases: ['reset', 'new']
  }

  it('knows the command by name, with or without arguments', () => {
    expect(isClearCommand('/clear', [])).toBe(true)
    expect(isClearCommand('  /clear  ', [])).toBe(true)
    expect(isClearCommand('/clear yesterday', [])).toBe(true)
  })

  // `/reset` and `/new` reach the same command, and a log left standing after
  // one of them would claim a history the agent no longer has.
  it('knows it by the aliases the agent reported', () => {
    expect(isClearCommand('/reset', [clear])).toBe(true)
    expect(isClearCommand('/new', [clear])).toBe(true)
  })

  // The SDK writes aliases with a slash in its prose and without one in its
  // examples, so both forms have to mean the same thing.
  it('matches an alias however it was written down', () => {
    expect(isClearCommand('/reset', [{ ...clear, aliases: ['/reset'] }])).toBe(true)
  })

  it('does not mistake an alias of some other command for it', () => {
    expect(isClearCommand('/reset', [{ ...clear, name: 'usage' }])).toBe(false)
  })

  it('is not fooled by a name that merely starts the same way', () => {
    expect(isClearCommand('/cleared', [clear])).toBe(false)
    expect(isClearCommand('/clear-cache', [clear])).toBe(false)
  })

  it('leaves ordinary messages alone', () => {
    expect(isClearCommand('clear the build directory', [clear])).toBe(false)
    expect(isClearCommand('', [clear])).toBe(false)
    expect(isClearCommand('   ', [clear])).toBe(false)
  })
})

/*
 * Two names for one model.
 *
 * The catalogue may offer a short name while a running session reports itself
 * in full, so `sonnet` and `claude-sonnet-5` have to be recognised as the same
 * thing — otherwise the picker draws a second row for a model already in it and
 * offers effort levels the real one does not take.
 */
/**
 * A live catalogue, copied from one the CLI actually sent.
 *
 * `Default (recommended)` is kept in it deliberately: it is what arrives, and
 * every test that never sees that string is only worth something because the
 * fixture contains it.
 */
const CATALOGUE: AgentModel[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: '',
    supportedEffortLevels: null,
    supportsEffort: null
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    description: '',
    supportedEffortLevels: null,
    supportsEffort: null
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: '',
    supportedEffortLevels: null,
    supportsEffort: null
  }
]

describe('matching a model by either of its names', () => {
  it('finds an entry by the name it goes by', () => {
    expect(findAgentModel(CATALOGUE, 'sonnet')?.displayName).toBe('Sonnet')
  })

  it('finds it by the full name that one stands for', () => {
    expect(findAgentModel(CATALOGUE, 'claude-sonnet-5')?.displayName).toBe('Sonnet')
  })

  /*
   * Taken from a live catalogue, where `default` and `opus[1m]` both resolve to
   * `claude-opus-5[1m]`. Asking for one of them by its own name has to answer
   * that one, or choosing "Opus (1M context)" in the picker would tick
   * "Default" instead.
   */
  it('prefers the entry called that over one that merely resolves to it', () => {
    expect(findAgentModel(CATALOGUE, 'opus[1m]')?.displayName).toBe('Opus (1M context)')
  })

  it('finds nothing for a model the catalogue does not have', () => {
    expect(findAgentModel(CATALOGUE, 'claude-retired-3')).toBeUndefined()
    expect(findAgentModel([], 'sonnet')).toBeUndefined()
  })

  it('reads two names of one model as the same model', () => {
    expect(sameModel('sonnet', 'claude-sonnet-5', CATALOGUE)).toBe(true)
    expect(sameModel('claude-sonnet-5', 'sonnet', CATALOGUE)).toBe(true)
    expect(sameModel('sonnet', 'sonnet', CATALOGUE)).toBe(true)
  })

  it('keeps two different models apart', () => {
    expect(sameModel('sonnet', 'opus[1m]', CATALOGUE)).toBe(false)
  })

  // With nothing to resolve through, only an exact match can be trusted —
  // guessing would be worse than admitting the catalogue has not arrived.
  it('will not guess when the catalogue is empty', () => {
    expect(sameModel('sonnet', 'claude-sonnet-5', [])).toBe(false)
    expect(sameModel('sonnet', 'sonnet', [])).toBe(true)
  })
})

/*
 * Naming the row that names nothing.
 *
 * "Default (recommended)" tells a reader which model they are about to talk to
 * exactly as well as a blank line would. The catalogue does know — it just says
 * it in another row — and this is the lookup that fetches it.
 */
describe('the model the default stands for', () => {
  it('answers with the row that shares its full name', () => {
    expect(defaultAgentModel(CATALOGUE)?.displayName).toBe('Opus (1M context)')
  })

  // The row called `default` resolves to the same name as `opus[1m]` and comes
  // first, so a search that left it in would find it and answer with the very
  // string this function exists to avoid.
  it('never answers with the default row itself', () => {
    const alone: AgentModel[] = [
      {
        value: 'default',
        resolvedModel: 'claude-opus-5[1m]',
        displayName: 'Default (recommended)',
        description: '',
        supportedEffortLevels: null,
        supportsEffort: null
      }
    ]

    expect(defaultAgentModel(alone)).toBeUndefined()
  })

  it('prefers a row named in full over one that merely resolves to it', () => {
    const spelled: AgentModel[] = [
      ...CATALOGUE,
      {
        value: 'claude-opus-5[1m]',
        resolvedModel: null,
        displayName: 'Opus, spelled out',
        description: '',
        supportedEffortLevels: null,
        supportsEffort: null
      }
    ]

    expect(defaultAgentModel(spelled)?.displayName).toBe('Opus, spelled out')
  })

  it('answers with nothing when the default says nothing about what it runs', () => {
    const silent = CATALOGUE.map((model) =>
      model.value === 'default' ? { ...model, resolvedModel: null } : model
    )

    expect(defaultAgentModel(silent)).toBeUndefined()
  })

  it('answers with nothing when there is no default row, or no catalogue at all', () => {
    expect(
      defaultAgentModel(CATALOGUE.filter((model) => model.value !== 'default'))
    ).toBeUndefined()
    expect(defaultAgentModel([])).toBeUndefined()
  })
})
