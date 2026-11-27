import { describe, expect, it } from 'vitest'

import { sidebarCeiling, windowFloor } from './layout.js'

describe('windowFloor', () => {
  it('counts the strip, each pane on screen at its narrowest and every conversation', () => {
    expect(windowFloor({ listShown: true, rightFloor: 300, columns: 2 })).toBe(60 + 180 + 300 + 880)
  })

  it('counts nothing for a pane that is folded', () => {
    expect(windowFloor({ listShown: false, rightFloor: null, columns: 1 })).toBe(60 + 440)
  })
})

describe('sidebarCeiling', () => {
  it('leaves the right pane its floor and the centre its conversation', () => {
    expect(sidebarCeiling(1100, 300, 1)).toBe(1100 - 60 - 300 - 440)
  })

  it('hands the folded right pane’s room to the list', () => {
    expect(sidebarCeiling(1000, null, 1)).toBe(1000 - 60 - 440)
  })

  it('makes room for every conversation shown side by side', () => {
    expect(sidebarCeiling(1600, 300, 2)).toBe(1600 - 60 - 300 - 880)
  })

  it('never goes past the list’s widest', () => {
    expect(sidebarCeiling(3440, 300, 1)).toBe(560)
  })

  it('never below the list’s narrowest', () => {
    expect(sidebarCeiling(940, 300, 1)).toBe(180)
  })
})
