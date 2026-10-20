import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import { promptOf, stepsOf } from './agentSteps.js'

const AT = '2026-10-20T10:00:00.000Z'
const agent = (event: AgentEvent): ChatEntry => ({ role: 'agent', at: AT, event })

const entries: readonly ChatEntry[] = [
  { role: 'user', at: AT, text: 'look around' },
  agent({ type: 'text', text: 'Sending one off.' }),
  agent({
    type: 'tool_use',
    toolUseId: 'call-1',
    name: 'Agent',
    input: { description: 'Look', prompt: 'Read every route.' }
  }),
  agent({ type: 'tool_use', toolUseId: 'odd', name: 'Agent', input: { description: 'x' } }),
  ...['a', 'b', 'c'].map((name) =>
    agent({
      type: 'tool_use',
      toolUseId: `step-${name}`,
      name: 'Read',
      input: { file_path: `${name}.ts` },
      parentToolUseId: 'call-1'
    })
  ),
  agent({ type: 'tool_use', toolUseId: 'main', name: 'Read', input: { file_path: 'x.ts' } })
]

describe('what the log says about one agent', () => {
  it('finds the task it was given', () => {
    expect(promptOf(entries, 'call-1')).toBe('Read every route.')
  })

  it('has no task for a call that carried none, or one it never saw', () => {
    expect(promptOf(entries, 'odd')).toBeNull()
    expect(promptOf(entries, 'gone')).toBeNull()
  })

  it('lists its last steps, oldest first, and none of anyone else’s', () => {
    expect(stepsOf(entries, 'call-1', 2).map((step) => step.toolUseId)).toEqual([
      'step-b',
      'step-c'
    ])
    expect(stepsOf(entries, 'call-1', 8)).toHaveLength(3)
    expect(stepsOf(entries, 'gone', 8)).toEqual([])
  })
})
