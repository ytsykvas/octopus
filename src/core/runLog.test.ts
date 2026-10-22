import { describe, expect, it } from 'vitest'

import { appendTail, cleanTerminalOutput, lastLines, TAIL_CHARS, TAIL_LINES } from './runLog.js'

describe('appendTail', () => {
  it('keeps everything while it fits', () => {
    expect(appendTail('build ', 'ok')).toBe('build ok')
  })

  it('keeps the last TAIL_CHARS and not one more, across the chunk boundary', () => {
    const kept = 'a'.repeat(TAIL_CHARS - 2)
    const next = appendTail(kept, 'bcde')

    expect(next).toHaveLength(TAIL_CHARS)
    expect(next.endsWith('aabcde')).toBe(true)
    expect(next.startsWith('a')).toBe(true)
  })

  it('cuts a single chunk larger than the limit to its end', () => {
    const next = appendTail('', `${'x'.repeat(TAIL_CHARS)}end`)

    expect(next).toHaveLength(TAIL_CHARS)
    expect(next.endsWith('end')).toBe(true)
  })
})

describe('cleanTerminalOutput', () => {
  it('drops colour codes and cursor moves', () => {
    expect(cleanTerminalOutput('\u001b[31merror\u001b[0m: \u001b[2K\u001b[1Gmissing')).toBe(
      'error: missing'
    )
  })

  it('drops a window title, ended by BEL or by ST', () => {
    expect(cleanTerminalOutput('\u001b]0;npm run dev\u0007ready')).toBe('ready')
    expect(cleanTerminalOutput('\u001b]2;title\u001b\\ready')).toBe('ready')
  })

  it('drops the other escapes a script prints', () => {
    expect(cleanTerminalOutput('\u001b=keypad\u001b7saved\u001bMup\u001b(B\u001b[mplain')).toBe(
      'keypadsavedupplain'
    )
  })

  it('keeps only the last state of a line redrawn with a carriage return', () => {
    expect(cleanTerminalOutput('10%\r50%\r100%\ndone')).toBe('100%\ndone')
  })

  it('treats a CRLF line ending as a line ending, not a redraw', () => {
    expect(cleanTerminalOutput('first\r\nsecond\r\n')).toBe('first\nsecond\n')
  })
})

describe('lastLines', () => {
  it('hands back every line when there are fewer than asked for', () => {
    expect(lastLines('one\ntwo', 5)).toBe('one\ntwo')
  })

  it('drops blank lines at the end before counting', () => {
    expect(lastLines('one\ntwo\nthree\n\n  \n', 2)).toBe('two\nthree')
  })

  it('hands back exactly TAIL_LINES of a longer text, the last ones', () => {
    const text = Array.from({ length: TAIL_LINES + 10 }, (_, index) => String(index)).join('\n')
    const lines = lastLines(text, TAIL_LINES).split('\n')

    expect(lines).toHaveLength(TAIL_LINES)
    expect(lines[0]).toBe('10')
    expect(lines.at(-1)).toBe(String(TAIL_LINES + 9))
  })

  it('hands back nothing for nothing', () => {
    expect(lastLines('\n\n', 3)).toBe('')
  })
})
