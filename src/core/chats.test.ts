import { describe, expect, it } from 'vitest'

import {
  AGENT_KINDS,
  type AgentCommand,
  AgentCommandSchema,
  type AgentModel,
  type Chat,
  ChatError,
  DEFAULT_MODEL,
  defaultAgentModel,
  EffortChoiceSchema,
  EffortSchema,
  findAgentModel,
  forkChat,
  sameModel,
  ChatMessageSchema,
  ChatSchema,
  isClearCommand,
  isUsageCommand,
  MAX_CHATS_PER_WORKSPACE,
  newChat,
  PERMISSION_MODES,
  PermissionAnswerSchema,
  sessionEffort,
  sessionMode,
  sessionModel,
  WORKING_MODES
} from './chats.js'

describe('a new chat', () => {
  const options = {
    id: 'chat-1',
    agent: 'claude' as const,
    workingMode: 'default' as const,
    effort: 'medium' as const,
    model: null,
    planModel: null,
    createdAt: '2026-08-11T09:00:00.000Z'
  }

  it('starts with no session and nothing overridden', () => {
    const chat = newChat('planner/kyiv', options)

    expect(chat).toEqual({
      id: 'chat-1',
      workspaceId: 'planner/kyiv',
      agent: 'claude',
      status: 'idle',
      title: null,
      sessionId: null,
      model: null,
      planModel: null,
      effort: 'medium',
      workingMode: 'default',
      planMode: false,
      knownCommands: [],
      skillOverrides: {},
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
    expect(parsed.data?.effort).toBe('medium')
  })

  /*
   * The other half of the same problem, and the one a default cannot answer:
   * the field is there, holding the null that "the agent decides" was stored
   * as. Nothing offers that choice any more, so it has to arrive as a level.
   */
  it('reads a record written while nothing was a choice', () => {
    const stored = { ...newChat('planner/kyiv', options), effort: null }

    const parsed = ChatSchema.safeParse(stored)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.effort).toBe('medium')
  })

  // Normalising the two absences must not turn into normalising everything: a
  // level nobody recognises is a corrupt record, and saying so is the point.
  it('still refuses a level that is not one', () => {
    const stored = { ...newChat('planner/kyiv', options), effort: 'ludicrous' }

    expect(ChatSchema.safeParse(stored).success).toBe(false)
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

  /*
   * The model's twin, and the case worth spelling out is the third one: the
   * plan side names the agent's own default with a word, because null is
   * already spoken for there — it means the two jobs share one model.
   */
  it('folds the two models back into the one a session runs', () => {
    const chat = { model: 'opus', planModel: null, planMode: false }

    expect(sessionModel(chat)).toBe('opus')
    expect(sessionModel({ ...chat, planMode: true })).toBe('opus')
    expect(sessionModel({ ...chat, planModel: 'sonnet' })).toBe('opus')
    expect(sessionModel({ ...chat, planModel: 'sonnet', planMode: true })).toBe('sonnet')
    expect(sessionModel({ ...chat, planModel: DEFAULT_MODEL, planMode: true })).toBeNull()
    expect(sessionModel({ model: null, planModel: null, planMode: true })).toBeNull()
  })

  /*
   * The third fold, and the one whose two answers are not two fields. The SDK
   * asks for a level and for the flag separately, and `ultracode` is the single
   * choice that sets both — which is why it is stored as a choice rather than
   * as a level plus a boolean nothing stops from disagreeing with it.
   */
  it('folds a choice into the level a session runs and the flag beside it', () => {
    expect(sessionEffort('low')).toEqual({ effort: 'low', ultracode: false })
    expect(sessionEffort('max')).toEqual({ effort: 'max', ultracode: false })
    expect(sessionEffort('ultracode')).toEqual({ effort: 'xhigh', ultracode: true })
  })

  it('stores ultracode as the level a conversation is set to', () => {
    const chat = newChat('planner/kyiv', options)

    const parsed = ChatSchema.safeParse({ ...chat, effort: 'ultracode' })
    expect(parsed.data?.effort).toBe('ultracode')
  })

  // The settings' own field stays five levels wide — `ultracode` is a decision
  // about one task — so the two schemas have to disagree, and this is the half
  // that says which one is wider.
  it('refuses ultracode where a plain level is expected', () => {
    expect(EffortSchema.safeParse('ultracode').success).toBe(false)
    expect(EffortChoiceSchema.safeParse('ultracode').success).toBe(true)
  })

  it('carries the models it was created with', () => {
    const chat = newChat('planner/kyiv', { ...options, model: 'opus', planModel: 'sonnet' })

    expect(chat.model).toBe('opus')
    expect(chat.planModel).toBe('sonnet')
  })

  // Defaulted rather than migrated: every record on disk right now predates
  // the field, and the reader throws on a mismatch rather than falling back.
  it('reads a record written before the plan model existed', () => {
    const { planModel, ...older } = newChat('planner/kyiv', options)
    void planModel

    const parsed = ChatSchema.safeParse(older)
    expect(parsed.success).toBe(true)
    // Null, which is "no split" — so the conversation runs one model, exactly
    // as it did before there could be two.
    expect(parsed.data?.planModel).toBeNull()
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

describe('recognising the command that reports usage', () => {
  const usage: AgentCommand = {
    name: 'usage',
    description: 'Show plan usage limits',
    argumentHint: '',
    aliases: ['cost', 'stats']
  }

  it('knows the command by name', () => {
    expect(isUsageCommand('/usage', [])).toBe(true)
    expect(isUsageCommand('  /usage  ', [])).toBe(true)
  })

  // The CLI declares no arguments for it, which is not the same as nobody
  // typing any. Whatever follows the word, the word is still the command, and
  // forwarding it on that account would print the prose under the card.
  it('knows it however it was typed', () => {
    expect(isUsageCommand('/usage today', [usage])).toBe(true)
  })

  // `/cost` and `/stats` reach the same command. Missed, one of them would
  // reach the CLI and print the prose the card exists to replace.
  it('knows it by the aliases the agent reported', () => {
    expect(isUsageCommand('/cost', [usage])).toBe(true)
    expect(isUsageCommand('/stats', [usage])).toBe(true)
  })

  it('does not mistake an alias of some other command for it', () => {
    expect(isUsageCommand('/cost', [{ ...usage, name: 'clear' }])).toBe(false)
  })

  it('leaves ordinary messages alone', () => {
    expect(isUsageCommand('/usages', [usage])).toBe(false)
    expect(isUsageCommand('what is my usage', [usage])).toBe(false)
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

  /*
   * The collision this was written for, and the one it used to get wrong.
   *
   * `default` and `opus[1m]` both resolve to `claude-opus-5[1m]`, so the row
   * that answers depends on the name asked: `opus[1m]` finds itself and
   * `claude-opus-5[1m]` finds `default`. Compared as rows those differ, and a
   * caller would have announced a model change every time the account default
   * was in play.
   */
  it('reads a short name and a full one as the same model through the default row', () => {
    expect(sameModel('opus[1m]', 'claude-opus-5[1m]', CATALOGUE)).toBe(true)
    expect(sameModel('claude-opus-5[1m]', 'opus[1m]', CATALOGUE)).toBe(true)
    expect(sameModel('default', 'claude-opus-5[1m]', CATALOGUE)).toBe(true)
    expect(sameModel('default', 'opus[1m]', CATALOGUE)).toBe(true)
  })

  /*
   * A catalogue that resolves nothing, which is what the CLI in hand sends:
   * every row comes back with `resolvedModel` null. There is nothing linking
   * two names then, and only the entry's own name can be compared — so a name
   * the catalogue does not carry is not the same as one it does.
   */
  it('falls back to the entry’s own name when nothing resolves', () => {
    const unresolved = CATALOGUE.map((model) => ({ ...model, resolvedModel: null }))

    expect(sameModel('sonnet', 'claude-sonnet-5', unresolved)).toBe(false)
    expect(sameModel('sonnet', 'opus[1m]', unresolved)).toBe(false)
    expect(sameModel('opus[1m]', 'opus[1m]', unresolved)).toBe(true)
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

  /*
   * The catalogue as the CLI in hand actually sends it: `resolvedModel` is
   * optional in the SDK's type and this version fills it in for nothing. What
   * it does copy onto both rows is the description, because the default row is
   * built from the row it points at — so that is the link left to follow.
   *
   * Taken verbatim from `~/.octopus/state.json` on a real account.
   */
  const AS_SENT: AgentModel[] = [
    {
      value: 'default',
      resolvedModel: null,
      displayName: 'Default (recommended)',
      description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
      supportedEffortLevels: null,
      supportsEffort: true
    },
    {
      value: 'opus[1m]',
      resolvedModel: null,
      displayName: 'Opus (1M context)',
      description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
      supportedEffortLevels: null,
      supportsEffort: true
    },
    {
      value: 'sonnet',
      resolvedModel: null,
      displayName: 'Sonnet',
      description: 'Sonnet 5 · Efficient for routine tasks',
      supportedEffortLevels: null,
      supportsEffort: true
    }
  ]

  it('follows the description when the catalogue resolves nothing', () => {
    expect(defaultAgentModel(AS_SENT)?.displayName).toBe('Opus (1M context)')
  })

  // Every row describing itself as nothing would otherwise all match each
  // other, which is a coincidence rather than an answer.
  it('will not pair two rows on an empty description', () => {
    const blank = AS_SENT.map((model) => ({ ...model, description: '' }))

    expect(defaultAgentModel(blank)).toBeUndefined()
  })

  it('answers with nothing when no other row shares the description', () => {
    const lonely = AS_SENT.filter((model) => model.value !== 'opus[1m]')

    expect(defaultAgentModel(lonely)).toBeUndefined()
  })

  it('answers with nothing when there is no default row, or no catalogue at all', () => {
    expect(
      defaultAgentModel(CATALOGUE.filter((model) => model.value !== 'default'))
    ).toBeUndefined()
    expect(defaultAgentModel([])).toBeUndefined()
  })
})

describe('what a conversation may be doing', () => {
  const record = {
    id: 'chat-1',
    workspaceId: 'planner/kyiv',
    agent: 'claude',
    sessionId: null,
    model: null,
    effort: 'medium',
    workingMode: 'default',
    planMode: false,
    knownCommands: [],
    skillOverrides: {},
    createdAt: '2026-08-11T09:00:00.000Z'
  }

  it('reads a record written before the field existed as idle', () => {
    expect(ChatSchema.parse(record).status).toBe('idle')
  })

  it('keeps a status it was given', () => {
    expect(ChatSchema.parse({ ...record, status: 'waiting_permission' }).status).toBe(
      'waiting_permission'
    )
  })

  /*
   * The status is what the sidebar's dot is derived from, so a value nothing
   * here knows would be drawn as whatever the fallback happens to be. A record
   * carrying one was written by something other than this application, and
   * refusing it is what makes that visible instead of silent.
   */
  it('refuses a status it does not know', () => {
    expect(ChatSchema.safeParse({ ...record, status: 'archived' }).success).toBe(false)
  })

  it('reads a record written before names existed as unnamed', () => {
    expect(ChatSchema.parse(record).title).toBeNull()
  })

  it('starts a new conversation idle', () => {
    expect(
      newChat('planner/kyiv', {
        id: 'chat-2',
        agent: 'claude',
        workingMode: 'default',
        effort: 'medium',
        model: null,
        planModel: null,
        createdAt: '2026-08-11T09:00:00.000Z'
      }).status
    ).toBe('idle')
  })
})

describe('a conversation continuing another', () => {
  const source: Chat = {
    id: 'chat-1',
    workspaceId: 'planner/kyiv',
    agent: 'claude',
    status: 'running',
    title: null,
    sessionId: 'session-old',
    model: 'opus',
    planModel: 'sonnet',
    effort: 'high',
    workingMode: 'acceptEdits',
    planMode: true,
    knownCommands: [{ name: 'deploy', description: '', argumentHint: '', aliases: [] }],
    skillOverrides: {},
    createdAt: '2026-08-11T09:00:00.000Z'
  }

  const forked = forkChat(source, {
    id: 'chat-2',
    sessionId: 'session-new',
    createdAt: '2026-08-11T10:00:00.000Z'
  })

  it('is its own record in the same workspace', () => {
    expect(forked.id).toBe('chat-2')
    expect(forked.workspaceId).toBe('planner/kyiv')
    expect(forked.createdAt).toBe('2026-08-11T10:00:00.000Z')
  })

  /*
   * Never the source's. Resuming a session continues it in place and keeps its
   * id, so two records holding one would be two agent processes writing one
   * transcript — each reading the other's turns as part of its own.
   */
  it('carries the forked session, not the one it came from', () => {
    expect(forked.sessionId).toBe('session-new')
  })

  it('keeps how the conversation is run', () => {
    expect(forked.agent).toBe('claude')
    expect(forked.model).toBe('opus')
    // Which model would plan is a setting like the rest; that the source was
    // planning is a state, and the test below says it stays behind.
    expect(forked.planModel).toBe('sonnet')
    expect(forked.effort).toBe('high')
    expect(forked.workingMode).toBe('acceptEdits')
    expect(forked.knownCommands).toEqual(source.knownCommands)
  })

  /*
   * Planning is a decision about a particular task, and forking out of a
   * settled plan to try the other approach is the likeliest reason to fork at
   * all — inheriting it would start the new conversation planning the old
   * one's task.
   */
  it('does not inherit planning, nor a turn in flight', () => {
    expect(forked.planMode).toBe(false)
    expect(forked.status).toBe('idle')
  })

  // Two tabs called "auth refactor" is a strip that cannot be read.
  it('does not inherit the name it was given either', () => {
    expect(
      forkChat(
        { ...source, title: 'auth refactor' },
        {
          id: 'chat-3',
          sessionId: 'session-new',
          createdAt: '2026-08-11T10:00:00.000Z'
        }
      ).title
    ).toBeNull()
  })
})

describe('a refused operation on a conversation', () => {
  it('carries a code and the values its message needs', () => {
    const error = new ChatError(
      'tooManyChats',
      { limit: String(MAX_CHATS_PER_WORKSPACE) },
      'A workspace holds at most three chats.'
    )

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ChatError')
    expect(error.code).toBe('tooManyChats')
    expect(error.params).toEqual({ limit: '3' })
  })
})
