import { describe, expect, it } from 'vitest'

import {
  descriptionOf,
  newCard,
  parseCard,
  readMeta,
  setMeta,
  splitCard,
  upsertRun,
  withComment,
  withDescription,
  withTitle
} from './boardCard.js'
import { BoardError } from './boardSchema.js'
import { splitBody } from './boardText.js'

const BOM = '\uFEFF'
const M = '<!-- octopus:comments -->'
const S = '2026-11-21T10:00:00.000Z'
const D = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f'

/** The error a call throws; fails the test when it does not throw. */
function refusal(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('did not throw')
}

function expectRefused(error: unknown): void {
  expect(error).toBeInstanceOf(BoardError)
  expect(error).toMatchObject({ code: 'cardFrontmatterUnreadable', params: { name: 'a.md' } })
}

const CARDS = [
  ['no header', '# A\n', '', null, '# A\n'],
  [
    'header',
    '---\npriority: high\n---\n# A\n',
    '---\npriority: high\n---\n',
    'priority: high\n',
    '# A\n'
  ],
  [
    'CRLF',
    '---\r\npriority: high\r\n---\r\n# A\r\n',
    '---\r\npriority: high\r\n---\r\n',
    'priority: high\r\n',
    '# A\r\n'
  ],
  ['BOM', `${BOM}---\na: 1\n---\nx`, `${BOM}---\na: 1\n---\n`, 'a: 1\n', 'x'],
  ['BOM, no header', `${BOM}# A`, BOM, null, '# A'],
  ['empty header', '---\n---\n# A\n', '---\n---\n', '', '# A\n'],
  ['unclosed', '---\npriority: high\n# A\n', '', null, '---\npriority: high\n# A\n'],
  ['closing at end of file', '---\na: 1\n---', '---\na: 1\n---', 'a: 1\n', ''],
  [
    'rule, not a map',
    '---\nЦитата дня\n---\n# Задача\n',
    '',
    null,
    '---\nЦитата дня\n---\n# Задача\n'
  ],
  [
    'broken YAML',
    '---\npriority: high\ntag: [feature\n---\n# A\n',
    '',
    null,
    '---\npriority: high\ntag: [feature\n---\n# A\n'
  ],
  ['unresolved alias', '---\nx: *nope\n---\nA', '', null, '---\nx: *nope\n---\nA'],
  ['four dashes are not a closing', '---\na: 1\n----\nb', '', null, '---\na: 1\n----\nb'],
  ['text after the closing dashes', '---\na: 1\n--- rest\n', '', null, '---\na: 1\n--- rest\n'],
  [
    'a lone carriage return after the closing dashes',
    '---\na: 1\n---\r',
    '',
    null,
    '---\na: 1\n---\r'
  ]
] as const

describe('splitCard', () => {
  it.each(CARDS)('%s', (_name, raw, head, front, body) => {
    expect(splitCard(raw)).toEqual({ head, front, body })
    expect(head + body).toBe(raw)
  })
})

describe('readMeta', () => {
  it('reads a file with no header as no fields', () => {
    expect(readMeta('# A\n')).toEqual({ meta: { links: [], runs: [] }, malformed: false })
  })

  it('reads an empty header as no fields', () => {
    expect(readMeta('---\n---\n# A\n')).toEqual({ meta: { links: [], runs: [] }, malformed: false })
  })

  it('reads the fields of a header', () => {
    expect(readMeta('---\npriority: high\ntag: fix\norder: 3\n---\n# A\n')).toEqual({
      meta: { priority: 'high', tag: 'fix', order: 3, links: [], runs: [] },
      malformed: false
    })
  })

  it('reads a timestamp as the text it is', () => {
    const raw = `---\nruns:\n  - started: ${S}\n    device: ${D}\n    machine: m\n    branch: b\n---\n`
    expect(readMeta(raw).meta.runs[0]?.started).toBe(S)
  })

  it.each([
    ['a broken header', '---\npriority: high\ntag: [feature\n---\n# A\n', true],
    ['duplicate keys', '---\na: 1\na: 2\n---\n', true],
    ['a broken header that opens with a comment', '---\n# c\npriority: [x\n---\n', true],
    ['a broken header with a quoted key', '---\n"priority": [x\n---\n', true],
    ['a broken header with a Ukrainian key', '---\nпріоритет: [x\n---\n', true],
    ['prose between two rules', '---\nЦитата дня\n---\n# A\n', false],
    ['an unclosed rule', '---\npriority: high\n# A\n', false],
    ['a blank header', '---\n \n---\n# A\n', false]
  ])('marks %s: %s', (_name, raw, malformed) => {
    expect(readMeta(raw).malformed).toBe(malformed)
  })
})

describe('setMeta', () => {
  it('adds a header to a file that had none and leaves the body byte for byte', () => {
    expect(setMeta('# Підтримка\n\n> Стан\n', { priority: 'high' }, 'a.md')).toBe(
      '---\npriority: high\n---\n# Підтримка\n\n> Стан\n'
    )
  })

  it('changes one value and keeps unknown keys and comments', () => {
    expect(
      setMeta(
        '---\n# my notes\nauthor: me\npriority: low\n---\nText',
        { priority: 'urgent' },
        'a.md'
      )
    ).toBe('---\n# my notes\nauthor: me\npriority: urgent\n---\nText')
  })

  it('removes a key given undefined', () => {
    expect(setMeta('---\npriority: high\ntag: fix\n---\nx', { priority: undefined }, 'a.md')).toBe(
      '---\ntag: fix\n---\nx'
    )
  })

  it('drops the header once nothing is left in it', () => {
    expect(setMeta('---\npriority: high\n---\nx', { priority: undefined }, 'a.md')).toBe('x')
  })

  it('keeps a long value on one line', () => {
    const note = 'word '.repeat(30).trim()
    expect(setMeta('x', { note }, 'a.md')).toBe(`---\nnote: ${note}\n---\nx`)
  })

  it('writes a list', () => {
    expect(setMeta('x', { links: ['https://a.example', 'https://b.example'] }, 'a.md')).toBe(
      '---\nlinks:\n  - https://a.example\n  - https://b.example\n---\nx'
    )
  })

  it('keeps the body of a CRLF file byte for byte', () => {
    expect(setMeta('---\r\na: 1\r\n---\r\n# A\r\nline\r\n', { a: 2 }, 'a.md')).toBe(
      '---\na: 2\n---\n# A\r\nline\r\n'
    )
  })

  it('keeps a byte order mark in front', () => {
    expect(setMeta(`${BOM}# A`, { order: 1 }, 'a.md')).toBe(`${BOM}---\norder: 1\n---\n# A`)
  })

  it('puts a new header above prose between two rules', () => {
    expect(setMeta('---\nЦитата дня\n---\n# Задача\n', { priority: 'high' }, 'a.md')).toBe(
      '---\npriority: high\n---\n---\nЦитата дня\n---\n# Задача\n'
    )
  })

  it('fills an empty header', () => {
    expect(setMeta('---\n---\n# A\n', { priority: 'high' }, 'a.md')).toBe(
      '---\npriority: high\n---\n# A\n'
    )
  })

  it('adds a key under a header that holds only a comment', () => {
    // `yaml` puts the blank line after the comment itself.
    expect(setMeta('---\n# note\n---\nx', { priority: 'high' }, 'a.md')).toBe(
      '---\n# note\n\npriority: high\n---\nx'
    )
  })

  // The names are spelled out: `%j` prints `{ priority: undefined }` as `{}`.
  it.each([
    ['no header, empty patch', '# A\n', {}],
    ['no header, absent key removed', '# A\n', { priority: undefined }],
    ['CRLF header, empty patch', '---\r\na: 1\r\n---\r\nx', {}],
    ['CRLF header, absent key removed', '---\r\na: 1\r\n---\r\nx', { priority: undefined }],
    ['empty header, empty patch', '---\n---\n# A\n', {}],
    ['empty header, absent key removed', '---\n---\n# A\n', { priority: undefined }],
    ['comment-only header, empty patch', '---\n# note\n---\nx', {}],
    ['comment-only header, absent key removed', '---\n# note\n---\nx', { priority: undefined }],
    [
      'header without that key, absent key removed',
      '---\ntag: fix\n---\nx',
      { priority: undefined }
    ]
  ])('leaves the file as it is: %s', (_name, raw, changes) => {
    expect(setMeta(raw, changes, 'a.md')).toBe(raw)
  })

  it.each(['---\npriority: high\ntag: [feature\n---\n# A\n', '---\n# c\npriority: [x\n---\nB'])(
    'refuses to write over a header it cannot read: %j',
    (raw) => {
      expectRefused(refusal(() => setMeta(raw, { priority: 'low' }, 'a.md')))
    }
  )
})

describe('upsertRun', () => {
  const first = `---\nruns:\n  - started: ${S}\n    device: ${D}\n    machine: MacBook-Pro\n    branch: tsykvas/fix/login\n    accounts:\n      - a@x\n---\n# A\n`
  const plain = `---\nruns:\n  - started: ${S}\n    device: ${D}\n    machine: m\n    branch: b\n---\n`

  it('adds the first run to a file with no header', () => {
    expect(
      upsertRun(
        '# A\n',
        S,
        { device: D, machine: 'MacBook-Pro', branch: 'tsykvas/fix/login', accounts: ['a@x'] },
        'a.md'
      )
    ).toBe(first)
  })

  it('fills in the run that started at the same moment', () => {
    expect(upsertRun(first, S, { ended: '2026-11-22T12:10:00.000Z', turns: 14 }, 'a.md')).toBe(
      first.replace(
        '      - a@x\n',
        '      - a@x\n    ended: 2026-11-22T12:10:00.000Z\n    turns: 14\n'
      )
    )
  })

  it('joins accounts instead of replacing them', () => {
    const raw = upsertRun(first, S, { accounts: ['b@y', 'a@x'] }, 'a.md')
    expect(readMeta(raw).meta.runs[0]?.accounts).toEqual(['a@x', 'b@y'])
  })

  it('gives accounts to a run that had none', () => {
    expect(upsertRun(plain, S, { accounts: ['a@x'] }, 'a.md')).toBe(
      `${plain.slice(0, -'---\n'.length)}    accounts:\n      - a@x\n---\n`
    )
  })

  it('keeps only the names among old accounts', () => {
    const raw = plain.replace('    branch: b\n', '    branch: b\n    accounts: [a@x, 5]\n')
    expect(
      readMeta(upsertRun(raw, S, { accounts: ['a@x'] }, 'a.md')).meta.runs[0]?.accounts
    ).toEqual(['a@x'])
  })

  it('does not repeat an account in a new run', () => {
    const raw = upsertRun(
      '',
      S,
      { device: D, machine: 'm', branch: 'b', accounts: ['a@x', 'a@x'] },
      'a.md'
    )
    expect(readMeta(raw).meta.runs[0]?.accounts).toEqual(['a@x'])
  })

  it('writes no accounts key for an empty list', () => {
    expect(
      upsertRun('# A\n', S, { device: D, machine: 'm', branch: 'b', accounts: [] }, 'a.md')
    ).toBe(plain + '# A\n')
  })

  it('leaves the accounts of a run alone given an empty list', () => {
    expect(upsertRun(first, S, { accounts: [] }, 'a.md')).toBe(first)
  })

  it('adds a second run that started at another moment', () => {
    const once = upsertRun('', S, { device: D, machine: 'm', branch: 'b' }, 'a.md')
    const twice = upsertRun(
      once,
      '2026-11-22T08:00:00.000Z',
      { device: D, machine: 'm2', branch: 'b2' },
      'a.md'
    )
    expect(readMeta(twice).meta.runs.map((run) => run.machine)).toEqual(['m', 'm2'])
  })

  it('keeps a run it cannot read and unknown keys in the one it fills', () => {
    const raw = `---\nruns:\n  - text\n  - started: ${S}\n    device: ${D}\n    machine: m\n    branch: b\n    note: kept\n---\n`
    expect(upsertRun(raw, S, { turns: 1 }, 'a.md')).toBe(
      raw.replace('    note: kept\n', '    note: kept\n    turns: 1\n')
    )
  })

  it('replaces runs that are not a list', () => {
    expect(
      upsertRun('---\nruns: text\n---\n', S, { device: D, machine: 'm', branch: 'b' }, 'a.md')
    ).toBe(plain)
  })

  it('ignores fields given as undefined', () => {
    expect(
      upsertRun('# A\n', S, { device: D, machine: 'm', branch: 'b', pr: undefined }, 'a.md')
    ).toBe(plain + '# A\n')
  })

  it('refuses a header it cannot read', () => {
    expectRefused(
      refusal(() =>
        upsertRun('---\npriority: high\ntag: [feature\n---\n# A\n', S, { turns: 1 }, 'a.md')
      )
    )
  })
})

describe('withTitle', () => {
  it('rewrites the title line under a header', () => {
    expect(withTitle('---\na: 1\n---\n# Old\n\ntext\n', 'New')).toBe(
      '---\na: 1\n---\n# New\n\ntext\n'
    )
  })

  it('leaves a heading among the comments alone', () => {
    const tail = `${M}\n\n### 2026-01-02T03:04:05.000Z\n\n# not a title\n`
    expect(withTitle(`# Old\n\n${tail}`, 'New')).toBe(`# New\n\n${tail}`)
  })
})

describe('withDescription', () => {
  it.each([
    ['---\na: 1\n---\nold\n', 'new text', '---\na: 1\n---\nnew text\n'],
    [
      `old\n\n${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`,
      'new',
      `new\n\n${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`
    ],
    ['old\n', '', ''],
    [`old\n\n${M}\n`, '  ', `${M}\n`]
  ])('%j with %j', (raw, text, expected) => {
    expect(withDescription(raw, text)).toBe(expected)
  })

  it('closes a code block the text leaves open, so the comments after it stay comments', () => {
    const raw = withDescription(
      `# A\n\n${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`,
      '# A\n\n````sh\nls\n'
    )

    expect(raw).toBe(
      `# A\n\n${'`'.repeat(4)}sh\nls\n${'`'.repeat(4)}\n\n${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`
    )
    expect(parseCard(raw, 'A.md').thread).toHaveLength(1)
  })
})

describe('withComment', () => {
  const once = `# A\n\n${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`

  it.each([
    ['# A\n', '2026-01-02T03:04:05.000Z', 'hi', once],
    [
      once,
      '2026-01-03T00:00:00.000Z',
      '  second  ',
      `${once}\n### 2026-01-03T00:00:00.000Z\n\nsecond\n`
    ],
    ['', '2026-01-02T03:04:05.000Z', 'hi', `${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`],
    ['---\na: 1\n---\n# A\n', '2026-01-02T03:04:05.000Z', 'hi', `---\na: 1\n---\n${once}`]
  ])('%j at %s', (raw, at, text, expected) => {
    expect(withComment(raw, at, text)).toBe(expected)
  })

  it('closes a code block the description leaves open before the first comment', () => {
    const raw = withComment('# A\n\n~~~\ncode\n', '2026-01-02T03:04:05.000Z', 'hi')

    expect(raw).toBe(`# A\n\n~~~\ncode\n~~~\n\n${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`)
    expect(parseCard(raw, 'A.md').thread).toEqual([{ at: '2026-01-02T03:04:05.000Z', text: 'hi' }])
  })
})

describe('descriptionOf', () => {
  it('reads the text between the header and the marker', () => {
    expect(descriptionOf(`---\na: 1\n---\n# A\n\n${M}\n`)).toBe('# A\n\n')
  })
})

describe('newCard', () => {
  it.each([
    ['Fix login', 0, '---\norder: 0\n---\n# Fix login\n'],
    ['Виправити', -1.5, '---\norder: -1.5\n---\n# Виправити\n']
  ])('%s at %d', (title, order, expected) => {
    expect(newCard({ title }, order)).toBe(expected)
  })

  it('reads back its own order', () => {
    expect(parseCard(newCard({ title: 'X' }, 2), 'X.md').meta.order).toBe(2)
  })

  it('writes the priority, the tag and the description it is given', () => {
    const raw = newCard(
      { title: 'X', description: '\n\nWhy.\n\n- [ ] Done\n\n', priority: 'high', tag: 'fix' },
      3
    )

    expect(raw).toBe('---\norder: 3\npriority: high\ntag: fix\n---\n# X\n\nWhy.\n\n- [ ] Done\n')
    expect(parseCard(raw, 'X.md')).toMatchObject({
      title: 'X',
      meta: { order: 3, priority: 'high', tag: 'fix' }
    })
  })

  it('writes no body for a description of blanks', () => {
    expect(newCard({ title: 'X', description: ' \n ' }, 0)).toBe('---\norder: 0\n---\n# X\n')
  })
})

describe('parseCard', () => {
  it('reads every part of a card', () => {
    const raw = `---\npriority: high\n---\n# A\n\ntext\n\n${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`
    expect(parseCard(raw, 'A.md')).toEqual({
      title: 'A',
      meta: { priority: 'high', links: [], runs: [] },
      malformed: false,
      description: '# A\n\ntext\n\n',
      thread: [{ at: '2026-01-02T03:04:05.000Z', text: 'hi' }]
    })
  })

  it.each(CARDS)('reads %s', (name, raw, _head, _front, body) => {
    const card = parseCard(raw, 'x.md')
    expect(card.description).toBe(body)
    expect(card.malformed).toBe(name === 'broken YAML' || name === 'unresolved alias')
  })
})

describe('the examples in the format spec', () => {
  it('gives a file with no header one when its priority changes', () => {
    expect(
      setMeta('# Підтримка bar-екранів\n\n> Стан на 2026-11-16 …\n', { priority: 'high' }, 'a.md')
    ).toBe('---\npriority: high\n---\n# Підтримка bar-екранів\n\n> Стан на 2026-11-16 …\n')
  })

  it('keeps a header written by someone else', () => {
    expect(
      setMeta(
        '---\n# my notes\nauthor: me\npriority: low\n---\nText',
        { priority: 'urgent' },
        'a.md'
      )
    ).toBe('---\n# my notes\nauthor: me\npriority: urgent\n---\nText')
  })

  it('reads a leading rule as body and writes a header above it', () => {
    const raw = '---\nЦитата дня\n---\n# Задача\n'
    expect(parseCard(raw, 'x.md')).toMatchObject({ title: 'Задача', malformed: false })
    expect(setMeta(raw, { priority: 'high' }, 'x.md')).toBe(`---\npriority: high\n---\n${raw}`)
  })

  it('shows a broken header and refuses to write fields into it', () => {
    const raw = '---\npriority: high\ntag: [feature\n---\n# Задача\n'
    expect(parseCard(raw, 'x.md')).toMatchObject({ title: 'Задача', malformed: true })
    expect(refusal(() => setMeta(raw, { priority: 'low' }, 'x.md'))).toMatchObject({
      code: 'cardFrontmatterUnreadable'
    })
    expect(withComment(raw, '2026-01-02T03:04:05.000Z', 'ok').startsWith(raw)).toBe(true)
  })
})

describe('a task file of real size', () => {
  const body = (eol: string): string =>
    [
      '# Підтримка bar-екранів',
      '',
      '| Екран | Стан |',
      '|---|---|',
      ...Array.from({ length: 400 }, (_, i) => `| bar-${String(i)} | готово: так |`),
      '',
      '---',
      '',
      '```yaml',
      '---',
      'priority: low',
      M,
      '### 2026-01-01T00:00:00.000Z',
      '```',
      '',
      ...Array.from({ length: 600 }, (_, i) => `Рядок ${String(i)}: опис, щоб файл був великим.`),
      ''
    ].join(eol)

  it.each([
    ['LF, no header', body('\n')],
    ['CRLF, no header', body('\r\n')],
    ['LF, with a header', '---\npriority: low\nauthor: me\n---\n' + body('\n')]
  ])('%s keeps its body through every header write', (_name, raw) => {
    expect(raw.length).toBeGreaterThan(30_000)
    const before = splitCard(raw).body
    expect(splitCard(setMeta(raw, { priority: 'high', order: 3 }, 'a.md')).body).toBe(before)
    expect(
      splitCard(upsertRun(raw, S, { device: D, machine: 'm', branch: 'b' }, 'a.md')).body
    ).toBe(before)
    expect(splitBody(before).tail).toBe('')
    expect(withComment(raw, S, 'ok').startsWith(raw.trimEnd())).toBe(true)
  })
})
