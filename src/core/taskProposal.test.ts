import { describe, expect, it } from 'vitest'

import { CARDS_PER_BATCH } from './boardSchema.js'
import { COMMENTS_MARKER } from './boardText.js'
import {
  PROPOSE_EDIT_TOOL,
  PROPOSE_TASKS_TOOL,
  readProposal,
  TaskProposalSchema,
  withEditedTasks
} from './taskProposal.js'

const TASK = { title: 'Export the board', description: '## Context\n\nWhy.' }

describe('readProposal', () => {
  it('reads the proposal out of the tool call', () => {
    const input = { summary: ' One task. ', tasks: [{ ...TASK, priority: 'high', tag: 'feature' }] }

    expect(readProposal(PROPOSE_TASKS_TOOL, input)).toEqual({
      summary: 'One task.',
      tasks: [{ ...TASK, priority: 'high', tag: 'feature' }]
    })
  })

  it('reads an edit as a list of the one task', () => {
    expect(readProposal(PROPOSE_EDIT_TOOL, { summary: 'Sharper.', task: TASK })).toEqual({
      summary: 'Sharper.',
      tasks: [TASK]
    })
  })

  it.each([
    { summary: 'x', tasks: [TASK] },
    { summary: 'x', task: { ...TASK, title: '' } },
    { summary: 'x', task: TASK, extra: true }
  ])('reads no edit the tool would have refused: %j', (input) => {
    expect(readProposal(PROPOSE_EDIT_TOOL, input)).toBeNull()
  })

  it('reads nothing from another tool', () => {
    expect(readProposal('mcp__other__propose_tasks', { summary: 'x', tasks: [TASK] })).toBeNull()
  })

  it.each([
    { summary: '', tasks: [TASK] },
    { summary: 'x', tasks: [] },
    { summary: 'x', tasks: Array.from({ length: CARDS_PER_BATCH + 1 }, () => TASK) },
    { summary: 'x', tasks: [{ ...TASK, title: 'A\nB' }] },
    { summary: 'x', tasks: [{ ...TASK, description: `x\n${COMMENTS_MARKER}\ny` }] },
    { summary: 'x', tasks: [{ ...TASK, tag: 'idea' }] },
    { summary: 'x', tasks: [{ ...TASK, status: 'done' }] }
  ])('reads nothing the tool would have refused: %j', (input) => {
    expect(readProposal(PROPOSE_TASKS_TOOL, input)).toBeNull()
  })
})

describe('TaskProposalSchema', () => {
  it('needs a description for every task', () => {
    expect(TaskProposalSchema.safeParse({ summary: 'x', tasks: [{ title: 'A' }] }).success).toBe(
      false
    )
  })
})

describe('withEditedTasks', () => {
  it('puts the tasks as they stand under what was written', () => {
    expect(withEditedTasks('Merge the two.', [{ ...TASK, priority: 'low' }])).toBe(
      'Merge the two.\n\nI edited your proposal by hand. These are the tasks as they stand now:\n\n```json\n[\n  {\n    "title": "Export the board",\n    "description": "## Context\\n\\nWhy.",\n    "priority": "low"\n  }\n]\n```'
    )
  })
})
