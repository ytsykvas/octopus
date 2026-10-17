import { describe, expect, it } from 'vitest'

import { cutBefore, rewindsConversation, rewindsFiles } from './rewind.js'

/** A chain as the SDK hands it back: the ids, and fields the cut ignores. */
const chain = [
  { type: 'user', uuid: 'u1', message: {} },
  { type: 'assistant', uuid: 'a1', message: {} },
  { type: 'user', uuid: 'u2', message: {} },
  { type: 'assistant', uuid: 'a2', message: {} }
]

describe('where the agent’s memory is cut', () => {
  // The last thing it keeps is whatever came just before the message — here
  // its own answer to the turn before.
  it('falls on the entry just before the message', () => {
    expect(cutBefore(chain, 'u2')).toEqual({ kind: 'at', uuid: 'a1' })
  })

  it('keeps nothing when the message opened the conversation', () => {
    expect(cutBefore(chain, 'u1')).toEqual({ kind: 'fresh' })
  })

  // Compacted away, or renamed by a fork.
  it('cannot be found for a message the chain does not hold', () => {
    expect(cutBefore(chain, 'gone')).toEqual({ kind: 'missing' })
  })

  // What came back from the SDK is not what it promised.
  it('cannot be found in a chain it cannot read', () => {
    expect(cutBefore([{ type: 'user' }], 'u1')).toEqual({ kind: 'missing' })
    expect(cutBefore(null, 'u1')).toEqual({ kind: 'missing' })
  })
})

describe('what each choice puts back', () => {
  it('takes both halves for both, and one for each of the others', () => {
    expect([rewindsConversation('both'), rewindsFiles('both')]).toEqual([true, true])
    expect([rewindsConversation('conversation'), rewindsFiles('conversation')]).toEqual([
      true,
      false
    ])
    expect([rewindsConversation('files'), rewindsFiles('files')]).toEqual([false, true])
  })
})
