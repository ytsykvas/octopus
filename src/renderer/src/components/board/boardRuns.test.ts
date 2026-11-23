import { describe, expect, it } from 'vitest'

import type { CardRunEntry } from '@core/boardSchema.js'

import { boardCard } from '../../test/board.js'
import { workspaceView } from '../../test/workspaces.js'
import { linkedByCard, linkedTo, openRunElsewhere } from './boardRuns.js'

const ID = '2f1c0b6e-5f0e-4d6e-9c55-0d6c1c2a7a11'
const ELSEWHERE: CardRunEntry = {
  started: '2026-11-21T12:00:00.000Z',
  device: 'device-two',
  machine: 'Mac-Two',
  branch: 'octopus/feature/anna'
}

describe('linkedByCard', () => {
  it('maps each workspace by the card it was started from', () => {
    const anna = workspaceView('anna', { card: ID })

    expect([...linkedByCard([anna, workspaceView('bob')])]).toEqual([[ID, anna]])
  })
})

describe('linkedTo', () => {
  it('finds the workspace started from the card', () => {
    const anna = workspaceView('anna', { card: ID })

    expect(
      linkedTo(boardCard({ meta: { id: ID, links: [], runs: [] } }), linkedByCard([anna]))
    ).toBe(anna)
  })

  it('finds nothing for a card with no id', () => {
    expect(linkedTo(boardCard(), linkedByCard([workspaceView('anna', { card: ID })]))).toBeNull()
  })

  it('finds nothing for a card no workspace here was started from', () => {
    expect(linkedTo(boardCard({ meta: { id: ID, links: [], runs: [] } }), new Map())).toBeNull()
  })
})

describe('openRunElsewhere', () => {
  it('finds a run another device left open', () => {
    expect(openRunElsewhere([ELSEWHERE], 'device-one')).toBe(ELSEWHERE)
  })

  it('ignores an open run of this device', () => {
    expect(openRunElsewhere([{ ...ELSEWHERE, device: 'device-one' }], 'device-one')).toBeUndefined()
  })

  it('ignores a run that has ended', () => {
    expect(
      openRunElsewhere([{ ...ELSEWHERE, ended: '2026-11-21T13:00:00.000Z' }], 'device-one')
    ).toBeUndefined()
  })

  it('takes the latest of several', () => {
    const later = {
      ...ELSEWHERE,
      started: '2026-11-22T12:00:00.000Z',
      machine: 'Mac-Three',
      device: 'device-three'
    }

    expect(openRunElsewhere([ELSEWHERE, later], 'device-one')?.machine).toBe('Mac-Three')
  })
})
