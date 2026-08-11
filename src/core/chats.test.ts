import { describe, expect, it } from 'vitest'

import {
  AGENT_KINDS,
  ChatMessageSchema,
  ChatSchema,
  newChat,
  PERMISSION_MODES,
  PermissionAnswerSchema
} from './chats.js'

describe('a new chat', () => {
  const options = {
    id: 'chat-1',
    agent: 'claude' as const,
    permissionMode: 'default' as const,
    createdAt: '2026-08-11T09:00:00.000Z'
  }

  it('starts with no session and no model override', () => {
    const chat = newChat('planner/kyiv', options)

    expect(chat).toEqual({
      id: 'chat-1',
      workspaceId: 'planner/kyiv',
      agent: 'claude',
      sessionId: null,
      model: null,
      permissionMode: 'default',
      createdAt: '2026-08-11T09:00:00.000Z'
    })
  })

  it('is a valid record', () => {
    expect(ChatSchema.safeParse(newChat('planner/kyiv', options)).success).toBe(true)
  })

  it('carries the mode it was created with', () => {
    const planning = newChat('planner/kyiv', { ...options, permissionMode: 'plan' })

    expect(planning.permissionMode).toBe('plan')
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

  // §4 puts transparency above convenience, and a mode where nothing is ever
  // shown is the one setting reading the screen cannot undo.
  it('does not offer bypassing permissions', () => {
    expect(ChatSchema.shape.permissionMode.safeParse('bypassPermissions').success).toBe(false)
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
