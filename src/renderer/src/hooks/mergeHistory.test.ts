import { describe, expect, it } from 'vitest'

import type { ChatEntry } from '@core/transcript.js'

import { type Heard, mergeHistory } from './mergeHistory.js'

const AT = '2026-08-11T09:00:00.000Z'
const look: ChatEntry = { role: 'user', at: AT, text: 'look' }

function heard(seq: number, text: string): Heard {
  return { seq, at: AT, event: { type: 'text', text } }
}

function line(text: string): ChatEntry {
  return { role: 'agent', at: AT, event: { type: 'text', text } }
}

describe('mergeHistory', () => {
  it('adds only what was heard after the last event the history holds', () => {
    expect(
      mergeHistory({ entries: [look], seq: 3 }, [heard(3, 'three'), heard(4, 'four')])
    ).toEqual([look, line('four')])
  })

  it('is the history alone when nothing was heard', () => {
    expect(mergeHistory({ entries: [look], seq: 3 }, [])).toEqual([look])
  })

  it('adds everything heard to a history that holds no event', () => {
    expect(mergeHistory({ entries: [], seq: 0 }, [heard(1, 'one'), heard(2, 'two')])).toEqual([
      line('one'),
      line('two')
    ])
  })

  it('lets a clear heard after the history empty it', () => {
    const cleared: Heard = { seq: 5, at: AT, event: { type: 'conversation_reset', cleared: true } }
    expect(mergeHistory({ entries: [look], seq: 4 }, [cleared, heard(6, 'fresh')])).toEqual([
      line('fresh')
    ])
  })

  it('leaves a clear the history already reflects alone', () => {
    const cleared: Heard = { seq: 2, at: AT, event: { type: 'conversation_reset', cleared: true } }
    expect(mergeHistory({ entries: [look], seq: 2 }, [cleared])).toEqual([look])
  })

  it('draws a conversation compacted rather than cleared as a line', () => {
    const compacted: Heard = {
      seq: 1,
      at: AT,
      event: { type: 'conversation_reset', cleared: false }
    }
    expect(mergeHistory({ entries: [look], seq: 0 }, [compacted])).toEqual([
      look,
      { role: 'agent', at: AT, event: compacted.event }
    ])
  })
})
