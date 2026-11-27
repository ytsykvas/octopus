import { describe, expect, it } from 'vitest'

import { columnsOnScreen, foldsFor, sidebarCeiling, windowFloor } from './layout.js'

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

describe('foldsFor', () => {
  const room = { listShown: true, rightFloor: 300, columns: 2 }

  it('folds nothing while the window holds the panes and every column', () => {
    expect(foldsFor(1600, room)).toEqual({ right: false, list: false })
    expect(foldsFor(1420, room)).toEqual({ right: false, list: false })
  })

  it('folds the right pane first', () => {
    expect(foldsFor(1300, room)).toEqual({ right: true, list: false })
  })

  it('folds the list as well when the right pane’s room is not enough', () => {
    expect(foldsFor(1000, room)).toEqual({ right: true, list: true })
  })

  it('folds no right pane that is already folded', () => {
    expect(foldsFor(1000, { ...room, rightFloor: null })).toEqual({ right: false, list: true })
  })

  it('folds no list that is already folded', () => {
    expect(foldsFor(900, { ...room, listShown: false })).toEqual({ right: true, list: false })
  })
})

describe('columnsOnScreen', () => {
  const shown = ['first', 'chat-2', 'chat-3']

  it('draws every column before anything is measured', () => {
    expect(columnsOnScreen(shown, 'chat-3', null)).toEqual(shown)
  })

  it('draws every column the width holds', () => {
    expect(columnsOnScreen(shown, 'chat-3', 1320)).toEqual(shown)
  })

  it('drops columns from the end, keeping the one in front', () => {
    expect(columnsOnScreen(shown, 'chat-3', 900)).toEqual(['first', 'chat-3'])
  })

  it('keeps the one in front alone where even one hardly fits', () => {
    expect(columnsOnScreen(shown, 'chat-2', 300)).toEqual(['chat-2'])
  })
})
