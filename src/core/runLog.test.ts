import { describe, expect, it } from 'vitest'

import { ChatMessageSchema } from './chats.js'
import { InstructionBodySchema } from './instructions.js'
import {
  appendTail,
  cleanTerminalOutput,
  lastLines,
  maskValues,
  TAIL_CHARS,
  TAIL_LINES,
  TAIL_OUTPUT_CHARS
} from './runLog.js'

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

  it('keeps whole lines within the character budget, the last ones', () => {
    expect(lastLines('aaaa\nbbbb\ncccc', 10, 9)).toBe('bbbb\ncccc')
    expect(lastLines('aaaa\nbbbb\ncccc', 10, 8)).toBe('cccc')
  })

  it('keeps the end of a single line longer than the budget', () => {
    expect(lastLines('0123456789', 10, 4)).toBe('6789')
  })

  it('holds a server logging long lines to the budget by default', () => {
    const json = Array.from({ length: TAIL_LINES }, () => 'x'.repeat(400)).join('\n')

    expect(lastLines(json, TAIL_LINES).length).toBeLessThanOrEqual(TAIL_OUTPUT_CHARS)
  })

  /*
   * Both runs go into one message under an instruction, and a message longer
   * than the bridge accepts is a Send that fails on Help's own text. What is
   * left is room for the facts and the fences around the output.
   */
  it('leaves room for two runs and the longest instruction in one message', () => {
    const ceiling = ChatMessageSchema.maxLength ?? 0
    const instruction = InstructionBodySchema.maxLength ?? 0

    expect(2 * TAIL_OUTPUT_CHARS + instruction).toBeLessThanOrEqual(ceiling - 20_000)
  })
})

describe('maskValues', () => {
  it('replaces every value of the set by its name, wherever it appears', () => {
    expect(
      maskValues(
        'connecting to postgres://app:hunter2@db/app\nretry postgres://app:hunter2@db/app',
        {
          DATABASE_URL: 'postgres://app:hunter2@db/app'
        }
      )
    ).toBe('connecting to [DATABASE_URL]\nretry [DATABASE_URL]')
  })

  it('masks a value that contains another one whole', () => {
    expect(maskValues('key=abcdef123456', { SHORT: 'abcdef', LONG: 'abcdef123456' })).toBe(
      'key=[LONG]'
    )
  })

  it('leaves values too short to be anybody’s secret alone', () => {
    expect(maskValues('debug true on 5432', { DEBUG: 'true', PORT: '5432' })).toBe(
      'debug true on 5432'
    )
  })
})
