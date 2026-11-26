import { describe, expect, it } from 'vitest'

import {
  cardDraftsOf,
  type DraftTask,
  draftTasks,
  proposedOf,
  swapped,
  withTask
} from './proposalDraft.js'

const A: DraftTask = {
  key: 0,
  title: 'A',
  description: 'Why A.',
  priority: 'high',
  tag: null,
  status: 'backlog'
}
const B: DraftTask = {
  key: 1,
  title: 'B',
  description: '',
  priority: null,
  tag: 'docs',
  status: 'backlog'
}
const C: DraftTask = { ...B, key: 2, title: 'C' }

describe('draftTasks', () => {
  it('puts every task in the column the brainstorm was opened from', () => {
    expect(
      draftTasks(
        {
          summary: 'x',
          tasks: [
            { title: 'A', description: 'Why A.', priority: 'high' },
            { title: 'B', description: '', tag: 'docs' }
          ]
        },
        'backlog'
      )
    ).toEqual([A, B])
  })
})

describe('proposedOf and cardDraftsOf', () => {
  it('leave out what a task does not have, and only the card keeps its column', () => {
    expect(proposedOf([A, B])).toEqual([
      { title: 'A', description: 'Why A.', priority: 'high' },
      { title: 'B', description: '', tag: 'docs' }
    ])
    expect(cardDraftsOf([{ ...A, status: 'testing' }])).toEqual([
      { title: 'A', description: 'Why A.', priority: 'high', status: 'testing' }
    ])
  })
})

describe('withTask', () => {
  it('changes the one task asked', () => {
    expect(withTask([A, B], 1, { title: 'B2', tag: null })).toEqual([
      A,
      { ...B, title: 'B2', tag: null }
    ])
  })
})

describe('swapped', () => {
  it('moves a task one place up or down', () => {
    expect(swapped([A, B, C], 1, -1)).toEqual([B, A, C])
    expect(swapped([A, B, C], 1, 1)).toEqual([A, C, B])
  })

  it('leaves the list as it is at either end', () => {
    expect(swapped([A, B], 0, -1)).toEqual([A, B])
    expect(swapped([A, B], 1, 1)).toEqual([A, B])
  })
})
