import { describe, expect, it } from 'vitest'

import {
  retitled,
  splitBody,
  threadOf,
  titleHead,
  titleOf,
  withBody,
  withoutTitle
} from './boardText.js'

const M = '<!-- octopus:comments -->'

describe('splitBody', () => {
  it.each([
    ['no marker', '# A\ntext\n', '# A\ntext\n', ''],
    [
      'the first marker',
      `# A\n\n${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`,
      '# A\n\n',
      `${M}\n\n### 2026-01-02T03:04:05.000Z\n\nhi\n`
    ],
    [
      'a marker inside a backtick fence',
      `# A\n\`\`\`\n${M}\n\`\`\`\n`,
      `# A\n\`\`\`\n${M}\n\`\`\`\n`,
      ''
    ],
    ['a marker inside a tilde fence', `~~~\n${M}\n~~~\n`, `~~~\n${M}\n~~~\n`, ''],
    [
      'a tilde line inside a backtick fence',
      `\`\`\`\n~~~\n${M}\n\`\`\`\n`,
      `\`\`\`\n~~~\n${M}\n\`\`\`\n`,
      ''
    ],
    ['a marker after a closed fence', `\`\`\`\nx\n\`\`\`\n${M}\n`, '```\nx\n```\n', `${M}\n`],
    [
      'a fence indented three spaces',
      `   \`\`\`\n${M}\n   \`\`\`\n`,
      `   \`\`\`\n${M}\n   \`\`\`\n`,
      ''
    ],
    ['four spaces, which is code, not a fence', `    \`\`\`\n${M}\n`, '    ```\n', `${M}\n`],
    ['a marker with trailing spaces and a carriage return', `a\n${M}  \r\nb`, 'a\n', `${M}  \r\nb`],
    ['an empty body', '', '', '']
  ])('%s', (_name, body, description, tail) => {
    expect(splitBody(body)).toEqual({ description, tail })
    expect(description + tail).toBe(body)
  })
})

describe('titleOf', () => {
  it.each([
    ['# Підтримка bar-екранів\n\ntext', 'x.md', 'Підтримка bar-екранів'],
    ['intro\n# Later title\n', 'x.md', 'Later title'],
    ['```\n# not a title\n```\n', 'Fix login.md', 'Fix login'],
    ['```\ncode\n```\n# Real\n', 'a.md', 'Real'],
    ['## Sub\ntext', 'Notes.MD', 'Notes'],
    ['#NoSpace\n', 'a.md', 'a'],
    ['#   \n', 'a.md', 'a'],
    ['#\tTab\n', 'a.md', 'Tab'],
    ['# Title  \r\n', 'a.md', 'Title']
  ])('reads %j in %s', (description, fileName, expected) => {
    expect(titleOf(description, fileName)).toBe(expected)
  })
})

describe('retitled', () => {
  it.each([
    ['# Old\n\ntext\n', '# New\n\ntext\n'],
    ['text only\n', '# New\n\ntext only\n'],
    ['# Old\r\nrest', '# New\r\nrest'],
    ['intro\n# Old\n', 'intro\n# New\n']
  ])('retitles %j', (description, expected) => {
    expect(retitled(description, 'New')).toBe(expected)
  })
})

describe('withoutTitle', () => {
  it.each([
    ['# Title\n\n\nBody\n', 'Body\n'],
    ['Body\n', 'Body\n'],
    ['intro\n# Title\nBody', 'intro\nBody'],
    ['# Only', ''],
    ['# T\r\n\r\nBody', 'Body']
  ])('strips the title from %j', (description, expected) => {
    expect(withoutTitle(description)).toBe(expected)
  })
})

describe('titleHead', () => {
  it.each([
    ['# Title\n\n\nBody\n', '# Title\n\n\n'],
    ['\n# Title\nBody', '\n# Title\n'],
    ['# Only', '# Only'],
    ['Body\n# Title\n', ''],
    ['```\n# Not a title\n```\n', ''],
    ['', '']
  ])('reads the head of %j', (description, expected) => {
    expect(titleHead(description)).toBe(expected)
  })
})

describe('withBody', () => {
  it.each([
    ['', 'Body', 'Body'],
    ['# T', '', '# T'],
    ['# T\n\n', 'Body', '# T\n\nBody'],
    ['# T\r\n\r\n', 'Body', '# T\r\n\r\nBody'],
    ['# T\n', 'Body', '# T\n\nBody'],
    ['# T', 'Body', '# T\n\nBody']
  ])('puts %j and %j together', (head, body, expected) => {
    expect(withBody(head, body)).toBe(expected)
  })

  it('gives back what titleHead split', () => {
    const description = '# Fix login\n\nOld text.\n'
    const head = titleHead(description)

    expect(withBody(head, description.slice(head.length))).toBe(description)
  })
})

describe('threadOf', () => {
  it('reads nothing from no tail', () => {
    expect(threadOf('')).toEqual([])
  })

  it('reads each comment under its time', () => {
    expect(
      threadOf(
        `${M}\n\n### 2026-11-21T14:05:00.000Z\n\nПерший.\n\n### 2026-11-22T09:30:00Z\n\nДругий\nрядок.\n`
      )
    ).toEqual([
      { at: '2026-11-21T14:05:00.000Z', text: 'Перший.' },
      { at: '2026-11-22T09:30:00Z', text: 'Другий\nрядок.' }
    ])
  })

  it('skips lines before the first heading and keeps a heading that is not a time', () => {
    expect(threadOf(`${M}\nstray\n### 2026-11-21T14:05:00.000Z\nA\n### Not a time\nB\n`)).toEqual([
      { at: '2026-11-21T14:05:00.000Z', text: 'A\n### Not a time\nB' }
    ])
  })

  it('keeps a heading inside a fence as text', () => {
    expect(
      threadOf(`${M}\n### 2026-11-21T14:05:00.000Z\n\`\`\`\n### 2026-11-22T09:30:00.000Z\n\`\`\`\n`)
    ).toEqual([{ at: '2026-11-21T14:05:00.000Z', text: '```\n### 2026-11-22T09:30:00.000Z\n```' }])
  })

  it('starts a comment again after a closed fence', () => {
    expect(
      threadOf(
        `${M}\n### 2026-11-21T14:05:00.000Z\n\`\`\`\nx\n\`\`\`\n### 2026-11-22T09:30:00.000Z\nB\n`
      )
    ).toEqual([
      { at: '2026-11-21T14:05:00.000Z', text: '```\nx\n```' },
      { at: '2026-11-22T09:30:00.000Z', text: 'B' }
    ])
  })

  it('keeps a comment with no text', () => {
    expect(threadOf(`${M}\n### 2026-11-21T14:05:00.000Z\n`)).toEqual([
      { at: '2026-11-21T14:05:00.000Z', text: '' }
    ])
  })
})
