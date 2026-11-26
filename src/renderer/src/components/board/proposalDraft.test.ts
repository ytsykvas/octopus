import { describe, expect, it } from 'vitest'

import { cardDraftsOf, type DraftTask, draftTasks, proposedOf, withTask } from './proposalDraft.js'

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
