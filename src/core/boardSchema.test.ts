import { describe, expect, it } from 'vitest'

import {
  BoardError,
  CardDraftSchema,
  CardMetaSchema,
  CardMoveSchema,
  CardPatchSchema,
  CardRefSchema,
  CardTitleSchema,
  CommentTextSchema,
  DescriptionSaveSchema,
  isCardRef,
  isCardUrl
} from './boardSchema.js'
import { CodedError, isCoded } from './codedError.js'

const S = '2026-11-21T10:00:00.000Z'
const DEVICE = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f' // the shape config.deviceId has

describe('isCardRef', () => {
  it.each([
    ['backlog/Fix login.md', true],
    ['in progress/Виправити логін.md', true],
    ['нотатки.md', true],
    ['Notes.MD', true],
    ['ideas/x.md', true],
    ['x'.repeat(397) + '.md', true],
    ['x'.repeat(398) + '.md', false],
    ['', false],
    ['../a.md', false],
    ['./a.md', false],
    ['_attachments/a.md', false],
    ['backlog/_a.md', false],
    ['.hidden.md', false],
    ['backlog/.a.md', false],
    ['a/b/c.md', false],
    ['/abs.md', false],
    ['a//b.md', false],
    ['backlog/', false],
    ['backlog/a.txt', false],
    ['back\\log/a.md', false],
    ['a\u0000.md', false]
  ])('%j → %s', (ref, expected) => {
    expect(isCardRef(ref)).toBe(expected)
  })
})

describe('isCardUrl', () => {
  const at = (length: number): string => 'https://a.example/' + 'x'.repeat(length - 18)

  it.each([
    [at(2000), true],
    [at(2001), false],
    ['https://user@a.example/', false],
    ['javascript:alert(1)', false]
  ])('%j → %s', (url, expected) => {
    expect(isCardUrl(url)).toBe(expected)
  })
})

describe('CardRefSchema', () => {
  it('refuses what is not a card path', () => {
    expect(CardRefSchema.safeParse('../a.md').success).toBe(false)
    expect(CardRefSchema.safeParse(5).success).toBe(false)
    expect(CardRefSchema.parse('backlog/a.md')).toBe('backlog/a.md')
  })
})

describe('CardMetaSchema', () => {
  const base = { started: S, device: DEVICE, machine: 'm', branch: 'b' }

  it('reads a file with no header as no fields at all', () => {
    expect(CardMetaSchema.parse({})).toEqual({ links: [], runs: [] })
  })

  it('drops a bad priority and keeps the order beside it', () => {
    expect(CardMetaSchema.parse({ priority: 'p1', order: 2 })).toEqual({
      order: 2,
      links: [],
      runs: []
    })
  })

  it('keeps every field written well', () => {
    const written = {
      id: '0b9e2c1a-3f4d-4c5e-8a7b-1c2d3e4f5a6b',
      priority: 'urgent',
      tag: 'fix',
      order: -1.5
    }
    expect(CardMetaSchema.parse(written)).toEqual({ ...written, links: [], runs: [] })
  })

  it('drops an id that is not a uuid', () => {
    expect(CardMetaSchema.parse({ id: 'card-1' }).id).toBeUndefined()
  })

  it('drops a tag that is not a workspace kind', () => {
    expect(CardMetaSchema.parse({ tag: 'epic' }).tag).toBeUndefined()
  })

  it('reads an infinite order as no order', () => {
    expect(CardMetaSchema.parse({ order: Infinity }).order).toBeUndefined()
  })

  it('reads a quoted number as no order', () => {
    expect(CardMetaSchema.parse({ order: '3' }).order).toBeUndefined()
  })

  it('keeps only links the system may open', () => {
    const links = ['https://a.example/x', 'javascript:alert(1)', 'file:///etc/hosts', 5]
    expect(CardMetaSchema.parse({ links }).links).toEqual(['https://a.example/x'])
  })

  it('reads links that are not a list as none', () => {
    expect(CardMetaSchema.parse({ links: 'https://a.example' }).links).toEqual([])
  })

  it('reads runs that are not a list as none', () => {
    expect(CardMetaSchema.parse({ runs: 'text' }).runs).toEqual([])
  })

  it('drops a run it cannot read and keeps unknown keys on one it can', () => {
    const run = {
      started: S,
      device: DEVICE,
      machine: 'MacBook-Pro',
      branch: 'tsykvas/fix/login',
      note: 'kept'
    }
    expect(CardMetaSchema.parse({ runs: [run, { started: 'yesterday' }, 'text'] }).runs).toEqual([
      run
    ])
  })

  it('drops a run that names no device', () => {
    const runs = [{ started: S, machine: 'm', branch: 'b' }]
    expect(CardMetaSchema.parse({ runs }).runs).toEqual([])
  })

  it('drops a run whose figures are not what they claim', () => {
    const runs = [
      { ...base, turns: -1 },
      { ...base, ended: 'soon' },
      { ...base, machine: '' },
      { ...base, device: '' }
    ]
    expect(CardMetaSchema.parse({ runs }).runs).toEqual([])
  })

  it('drops a pull request link it may not open and keeps the run', () => {
    const [run] = CardMetaSchema.parse({ runs: [{ ...base, pr: 'file:///x', turns: 3 }] }).runs
    expect(run).toMatchObject({ turns: 3 })
    expect(run?.pr).toBeUndefined()
  })
})

describe('CardDraftSchema', () => {
  it('trims the title', () => {
    expect(CardDraftSchema.parse({ status: 'backlog', title: '  Fix login  ' }).title).toBe(
      'Fix login'
    )
  })

  it.each([
    { status: 'backlog', title: '   ' },
    { status: 'backlog', title: 'x'.repeat(201) },
    { status: 'backlog', title: 'A\nB' },
    { status: 'backlog', title: 'A\rB' },
    { status: 'todo', title: 'A' },
    { status: 'backlog', title: 'A', order: 1 }
  ])('refuses %j', (draft) => {
    expect(CardDraftSchema.safeParse(draft).success).toBe(false)
  })
})

describe('CardTitleSchema', () => {
  it('trims a title and refuses a second line', () => {
    expect(CardTitleSchema.parse('  Нова назва ')).toBe('Нова назва')
    expect(CardTitleSchema.safeParse('a\nb').success).toBe(false)
  })
})

describe('CardPatchSchema', () => {
  it('takes null as removing a field', () => {
    expect(CardPatchSchema.parse({ priority: null, tag: null })).toEqual({
      priority: null,
      tag: null
    })
  })

  it('takes an empty patch', () => {
    expect(CardPatchSchema.parse({})).toEqual({})
  })

  it.each([
    { priority: undefined },
    { status: 'done' },
    { links: ['javascript:alert(1)'] },
    { links: Array.from({ length: 21 }, (_, i) => 'https://a.example/' + String(i)) }
  ])('refuses %j', (patch) => {
    expect(CardPatchSchema.safeParse(patch).success).toBe(false)
  })
})

describe('CardMoveSchema', () => {
  it.each([
    { status: 'done', index: -1 },
    { status: 'done', index: 1.5 },
    { status: 'done', index: 10_001 }
  ])('refuses %j', (move) => {
    expect(CardMoveSchema.safeParse(move).success).toBe(false)
  })

  it('takes a move to the top of a column', () => {
    expect(CardMoveSchema.parse({ status: 'in progress', index: 0 })).toEqual({
      status: 'in progress',
      index: 0
    })
  })
})

describe('DescriptionSaveSchema', () => {
  it('takes a description up to the composer limit and no longer', () => {
    expect(DescriptionSaveSchema.parse({ text: '# A\n', base: null })).toEqual({
      text: '# A\n',
      base: null
    })
    expect(DescriptionSaveSchema.safeParse({ text: 'x'.repeat(100_000), base: null }).success).toBe(
      true
    )
    expect(DescriptionSaveSchema.safeParse({ text: 'x'.repeat(100_001), base: null }).success).toBe(
      false
    )
  })
})

describe('CommentTextSchema', () => {
  it('trims a comment and refuses a blank one', () => {
    expect(CommentTextSchema.parse('  hi  ')).toBe('hi')
    expect(CommentTextSchema.safeParse('   ').success).toBe(false)
  })
})

describe('BoardError', () => {
  it('carries its code and parameters under its own name', () => {
    const error = new BoardError('cardMissing', { name: 'a.md' }, 'gone')
    expect(error.code).toBe('cardMissing')
    expect(error.params).toEqual({ name: 'a.md' })
    expect(error.name).toBe('BoardError')
    expect(error).toBeInstanceOf(CodedError)
    expect(isCoded(error)).toBe(true)
  })

  it('refuses a code outside its list at compile time', () => {
    // @ts-expect-error a code outside BoardErrorCode does not compile
    const error = new BoardError('notACode', {}, 'x')
    expect(error.code).toBe('notACode')
  })
})
