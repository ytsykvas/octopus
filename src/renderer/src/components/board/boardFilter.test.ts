import { describe, expect, it } from 'vitest'

import type { WorkspaceKind } from '@core/workspaceKinds.js'

import { boardCard } from '../../test/board.js'
import type { BoardColumns } from './boardDrop.js'
import {
  type BoardFilter,
  EMPTY_BOARD_FILTER,
  filterColumns,
  isFilterActive,
  matchesFilter,
  queryWords
} from './boardFilter.js'

const A = boardCard({
  ref: 'backlog/a.md',
  title: 'Fix login',
  meta: { links: [], runs: [], priority: 'high', tag: 'fix' }
})
const B = boardCard({
  ref: 'backlog/b.md',
  title: 'Підтримка bar-екранів',
  meta: { links: [], runs: [], tag: 'feature' }
})
const C = boardCard({
  ref: 'done/c.md',
  status: 'done',
  title: 'Gro\u0308\u00dfe a\u0308ndern',
  meta: { links: [], runs: [], priority: 'low' }
})
const LABELS: Partial<Record<WorkspaceKind, string>> = { fix: 'Fix', feature: 'Feature' }
const tagLabel = (tag: WorkspaceKind): string => LABELS[tag] ?? tag

describe('matchesFilter', () => {
  it.each<[string, Partial<BoardFilter>, readonly [boolean, boolean, boolean]]>([
    ['no filter', {}, [true, true, true]],
    ['a word of the title', { query: 'login' }, [true, false, false]],
    ['words of the title and the tag, in any case', { query: 'LOGIN fix' }, [true, false, false]],
    ['parts of words', { query: 'bar екран' }, [false, true, false]],
    ["the tag's label", { query: 'feature' }, [false, true, false]],
    [
      'a composed word against a decomposed title',
      { query: 'gr\u00f6\u00dfe' },
      [false, false, true]
    ],
    ['a word across the title and the tag', { query: 'loginfix' }, [false, false, false]],
    ['only spaces', { query: '   ' }, [true, true, true]],
    ['a priority', { priorities: ['high'] }, [true, false, false]],
    ['no priority', { priorities: ['none'] }, [false, true, false]],
    ['no tag', { tags: ['none'] }, [false, false, true]],
    ['either of two tags', { tags: ['fix', 'feature'] }, [true, true, false]],
    [
      'a word and a tag of different cards',
      { query: 'fix', tags: ['feature'] },
      [false, false, false]
    ]
  ])('matches %s', (_, fields, expected) => {
    const filter: BoardFilter = { ...EMPTY_BOARD_FILTER, ...fields }

    expect([A, B, C].map((card) => matchesFilter(card, filter, tagLabel))).toEqual(expected)
  })
})

describe('isFilterActive', () => {
  it.each<[Partial<BoardFilter>, boolean]>([
    [{}, false],
    [{ query: '  ' }, false],
    [{ query: 'a' }, true],
    [{ priorities: ['low'] }, true],
    [{ tags: ['none'] }, true]
  ])('%o is active: %s', (fields, expected) => {
    expect(isFilterActive({ ...EMPTY_BOARD_FILTER, ...fields })).toBe(expected)
  })
})

describe('queryWords', () => {
  it.each<[string, string[]]>([
    ['  Fix   LOGIN ', ['fix', 'login']],
    ['', []],
    ['Gro\u0308\u00dfe', ['gr\u00f6\u00dfe']]
  ])('splits %j', (query, expected) => {
    expect(queryWords(query)).toEqual(expected)
  })
})

describe('filterColumns', () => {
  const columns: BoardColumns = new Map([
    ['backlog', [A, B]],
    ['in progress', []],
    ['done', [C]]
  ])

  it('hands back the same columns without a filter', () => {
    expect(filterColumns(columns, EMPTY_BOARD_FILTER, tagLabel)).toBe(columns)
  })

  it('keeps only what matches, in every column', () => {
    const shown = filterColumns(columns, { ...EMPTY_BOARD_FILTER, query: 'login' }, tagLabel)

    expect(shown.get('backlog')).toEqual([A])
    expect(shown.get('done')).toEqual([])
    expect([...shown.keys()]).toEqual(['backlog', 'in progress', 'done'])
  })
})
