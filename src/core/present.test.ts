import { describe, expect, it } from 'vitest'

import { present } from './present.js'

describe('present', () => {
  it('hands back a value that is there, a falsy one included', () => {
    expect(present('anna', 'a name')).toBe('anna')
    expect(present('', 'a name')).toBe('')
    expect(present(0, 'a count')).toBe(0)
    expect(present(false, 'a flag')).toBe(false)
  })

  it('throws on null, naming what was missing', () => {
    expect(() => {
      present(null, 'the workspace on screen')
    }).toThrow('Expected the workspace on screen, found null.')
  })

  it('throws on undefined, naming what was missing', () => {
    expect(() => {
      present(undefined, 'a tab on the strip')
    }).toThrow('Expected a tab on the strip, found undefined.')
  })
})
