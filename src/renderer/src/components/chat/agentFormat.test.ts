import { describe, expect, it } from 'vitest'

import i18n from '../../i18n/index.js'
import { NOW, task } from '../../test/tasks.js'
import {
  activityOf,
  elapsedOf,
  formatElapsed,
  kindLabel,
  nameOf,
  shortModel
} from './agentFormat.js'

const t = i18n.t.bind(i18n)

describe('an agent’s time', () => {
  it('reads as a clock', () => {
    expect(formatElapsed(7_000)).toBe('0:07')
    expect(formatElapsed(102_000)).toBe('1:42')
    expect(formatElapsed(3_903_000)).toBe('1:05:03')
    expect(formatElapsed(-5)).toBe('0:00')
  })

  it('counts a running one on the window’s clock', () => {
    expect(elapsedOf(task(), NOW)).toBe(102_000)
  })

  // The CLI's figure leaves out time spent paused, so it wins where there is one.
  it('takes an ended one’s own figure, or its start and end', () => {
    const ended = task({ status: 'completed', endedAt: '2026-10-20T10:00:30.000Z' })

    expect(elapsedOf({ ...ended, durationMs: 12_000 }, NOW)).toBe(12_000)
    expect(elapsedOf(ended, NOW)).toBe(30_000)
    expect(elapsedOf({ ...ended, endedAt: null }, NOW)).toBe(0)
  })
})

describe('a model’s name', () => {
  it('is the family and version a person would say', () => {
    expect(shortModel('claude-haiku-5-5')).toBe('Haiku 5.5')
    expect(shortModel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
    expect(shortModel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
    expect(shortModel('claude-sonnet-5')).toBe('Sonnet 5')
  })

  it('is left as it came when it is not shaped like one', () => {
    expect(shortModel('haiku')).toBe('haiku')
    expect(shortModel('us.anthropic.claude-x')).toBe('us.anthropic.claude-x')
  })
})

describe('what kind of worker it is', () => {
  it('is the subagent’s type where it has one, and its kind otherwise', () => {
    expect(kindLabel(task(), t)).toBe('Explore')
    const plain = { subagentType: null }
    expect(kindLabel(task({ ...plain, kind: 'agent' }), t)).toBe('Task')
    expect(kindLabel(task({ ...plain, kind: 'shell' }), t)).toBe('Command')
    expect(kindLabel(task({ ...plain, kind: 'workflow' }), t)).toBe('Workflow')
    expect(kindLabel(task({ ...plain, kind: 'other' }), t)).toBe('Task')
  })
})

describe('an agent’s name and what it is doing', () => {
  it('is its description, or a workflow’s name, or its id', () => {
    expect(nameOf(task())).toBe('Audit route handlers')
    expect(nameOf(task({ description: '', workflowName: 'audit' }))).toBe('audit')
    expect(nameOf(task({ description: '' }))).toBe('t-1')
  })

  it('prefers the model’s summary to the step under way', () => {
    expect(activityOf(task())).toBe('Reading src/routes/auth.ts')
    expect(activityOf(task({ summary: 'Checking token expiry' }))).toBe('Checking token expiry')
    expect(activityOf(task({ activity: null }))).toBeNull()
  })
})
