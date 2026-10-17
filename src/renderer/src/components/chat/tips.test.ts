import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '@core/events.js'
import type { ChatEntry } from '@core/transcript.js'

import { currentTip } from './tips.js'

const AT = '2026-08-13T09:00:00.000Z'

const agent = (event: AgentEvent): ChatEntry => ({ role: 'agent', at: AT, event })

const call = (name: string, parentToolUseId?: string): ChatEntry =>
  agent({
    type: 'tool_use',
    toolUseId: `c-${name}`,
    name,
    input: { command: 'ls' },
    ...(parentToolUseId === undefined ? {} : { parentToolUseId })
  })

const NONE = new Set<string>()

describe('which heads-up is due', () => {
  it('offers the rewind caveat once the agent has run a command', () => {
    expect(currentTip([call('Read'), call('Bash')], NONE)).toBe('rewindSkipsCommands')
  })

  it('counts a command a subagent ran, which the checkpoints miss just the same', () => {
    expect(currentTip([call('Task'), call('Bash', 'c-Task')], NONE)).toBe('rewindSkipsCommands')
  })

  it('offers nothing while the agent has only read and edited', () => {
    expect(currentTip([call('Read'), call('Edit'), call('Write')], NONE)).toBeNull()
  })

  it('does not mistake a message that mentions Bash for a command', () => {
    const said: ChatEntry = { role: 'user', at: AT, text: 'Bash' }
    expect(currentTip([said, agent({ type: 'text', text: 'Bash' })], NONE)).toBeNull()
  })

  it('offers nothing it was told to keep hidden', () => {
    expect(currentTip([call('Bash')], new Set(['rewindSkipsCommands']))).toBeNull()
  })
})
