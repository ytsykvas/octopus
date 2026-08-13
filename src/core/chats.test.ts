import { describe, expect, it } from 'vitest'

import {
  AGENT_KINDS,
  ChatMessageSchema,
  ChatSchema,
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
