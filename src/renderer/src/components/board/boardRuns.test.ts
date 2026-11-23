import { describe, expect, it } from 'vitest'

import type { BoardCard, CardRunEntry } from '@core/boardSchema.js'

import { boardCard, BRANCH_REQUEST } from '../../test/board.js'
import { workspaceView } from '../../test/workspaces.js'
import { cardMark, linkedByCard, linkedTo, openRunElsewhere } from './boardRuns.js'

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

describe('cardMark', () => {
  const RUN: CardRunEntry = {
    ...ELSEWHERE,
    device: 'device-one',
    machine: 'Mac-One',
    branch: 'ytsykvas/anna'
  }
  const ENDED = '2026-11-22T12:10:00.000Z'
  const anna = workspaceView('anna', { card: ID })
  const linked = linkedByCard([anna])
  const none = new Map<string, never>()
  const withRuns = (runs: CardRunEntry[], id?: string): BoardCard =>
    boardCard({ meta: { ...(id === undefined ? {} : { id }), links: [], runs } })

  it('follows the live workspace started from the card', () => {
    expect(cardMark(withRuns([], ID), linked, none, 'device-one')).toEqual({
      kind: 'live',
      workspace: anna,
      request: null
    })
  })

  it('brings the pull request of that workspace', () => {
    const requests = new Map([['ytsykvas/anna', BRANCH_REQUEST]])

    expect(cardMark(withRuns([], ID), linked, requests, 'device-one')).toEqual({
      kind: 'live',
      workspace: anna,
      request: BRANCH_REQUEST
    })
  })

  it('prefers the live workspace over a merged run', () => {
    const card = withRuns([{ ...RUN, merged: ENDED, ended: ENDED }], ID)

    expect(cardMark(card, linked, none, 'device-one')?.kind).toBe('live')
  })

  it('marks a task in work on another Mac', () => {
    expect(cardMark(withRuns([ELSEWHERE]), none, none, 'device-one')).toEqual({
      kind: 'elsewhere',
      machine: 'Mac-Two'
    })
  })

  it("sees another Mac's open run behind a later merged one", () => {
    const later = { ...RUN, started: '2026-11-22T08:00:00.000Z', ended: ENDED, merged: ENDED }

    expect(cardMark(withRuns([ELSEWHERE, later]), none, none, 'device-one')).toEqual({
      kind: 'elsewhere',
      machine: 'Mac-Two'
    })
  })

  it('marks a merged run', () => {
    const card = withRuns([{ ...RUN, merged: ENDED, ended: ENDED }])

    expect(cardMark(card, none, none, 'device-one')).toEqual({ kind: 'merged' })
  })

  it('marks a removed workspace', () => {
    const card = withRuns([{ ...RUN, ended: ENDED }])

    expect(cardMark(card, none, none, 'device-one')).toEqual({ kind: 'removed' })
  })

  it('marks as removed a run of this Mac with no workspace and no summary', () => {
    expect(cardMark(withRuns([RUN], ID), none, none, 'device-one')).toEqual({ kind: 'removed' })
  })

  it('marks nothing on a card never run', () => {
    expect(cardMark(withRuns([]), none, none, 'device-one')).toBeNull()
  })
})
