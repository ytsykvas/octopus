import { describe, expect, it } from 'vitest'

import { ChatMessageSchema } from './chats.js'
import { InstructionBodySchema } from './instructions.js'
import {
  appendTail,
  cleanTerminalOutput,
  helpRun,
  lastLines,
  MASK_MIN_LENGTH,
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
    expect(lastLines('one\ntwo', 5, 100)).toBe('one\ntwo')
  })

  it('drops blank lines at the end before counting', () => {
    expect(lastLines('one\ntwo\nthree\n\n  \n', 2, 100)).toBe('two\nthree')
  })

  it('hands back exactly TAIL_LINES of a longer text, the last ones', () => {
    const text = Array.from({ length: TAIL_LINES + 10 }, (_, index) => String(index)).join('\n')
    const lines = lastLines(text, TAIL_LINES, TAIL_OUTPUT_CHARS).split('\n')

    expect(lines).toHaveLength(TAIL_LINES)
    expect(lines[0]).toBe('10')
    expect(lines.at(-1)).toBe(String(TAIL_LINES + 9))
  })

  it('hands back nothing for nothing', () => {
    expect(lastLines('\n\n', 3, 100)).toBe('')
  })

  it('keeps whole lines within the character budget, the last ones', () => {
    expect(lastLines('aaaa\nbbbb\ncccc', 10, 9)).toBe('bbbb\ncccc')
    expect(lastLines('aaaa\nbbbb\ncccc', 10, 8)).toBe('cccc')
  })

  it('keeps the end of a single line longer than the budget', () => {
    expect(lastLines('0123456789', 10, 4)).toBe('6789')
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
  it('replaces every secret by its name, wherever it appears', () => {
    const url = 'postgres://app:hunter2@db/app'

    expect(
      maskValues(`connecting to ${url}\nretry ${url}`, [{ name: 'DATABASE_URL', value: url }])
    ).toBe('connecting to [DATABASE_URL]\nretry [DATABASE_URL]')
  })

  it('masks a secret no name owns as masked', () => {
    expect(maskValues('key MIIEvQIBADAN', [{ name: null, value: 'MIIEvQIBADAN' }])).toBe(
      'key [masked]'
    )
  })

  it('masks a value that contains another one whole', () => {
    expect(
      maskValues('key=abcdef123456', [
        { name: 'SHORT', value: 'abcdef' },
        { name: 'LONG', value: 'abcdef123456' }
      ])
    ).toBe('key=[LONG]')
  })

  it('masks from MASK_MIN_LENGTH up, and leaves shorter values alone', () => {
    const shortest = 'x'.repeat(MASK_MIN_LENGTH)

    expect(
      maskValues(`debug true on 5432, ${shortest}`, [
        { name: 'DEBUG', value: 'true' },
        { name: 'PORT', value: '5432' },
        { name: 'TOKEN', value: shortest }
      ])
    ).toBe('debug true on 5432, [TOKEN]')
  })
})

describe('helpRun', () => {
  const run = (raw: string): Parameters<typeof helpRun>[0] => ({
    purpose: 'run',
    outcome: { kind: 'running' },
    raw
  })

  it('cleans what the terminal was sent and masks the secrets in it', () => {
    expect(
      helpRun(run('\u001b[31mcannot reach postgres://u:hunter2@db\u001b[0m\r\n'), [
        { name: 'DATABASE_URL', value: 'postgres://u:hunter2@db' }
      ])
    ).toEqual({
      purpose: 'run',
      outcome: { kind: 'running' },
      output: 'cannot reach [DATABASE_URL]'
    })
  })

  it('holds a server logging long lines to the budget', () => {
    const json = Array.from({ length: TAIL_LINES }, () => 'x'.repeat(400)).join('\n')

    expect(helpRun(run(json), []).output.length).toBeLessThanOrEqual(TAIL_OUTPUT_CHARS)
  })

  // Cut first, the budget would start inside the value and leave its end unmatched.
  it('masks before it cuts, so no part of a value survives the cut', () => {
    const secret = 'sk-live-0123456789abcdef'
    const line = `${'x'.repeat(100)}${secret}${'y'.repeat(TAIL_OUTPUT_CHARS - 10)}`

    const { output } = helpRun(run(line), [{ name: 'API_TOKEN', value: secret }])

    expect(output).not.toContain('abcdef')
    expect(output.length).toBeLessThanOrEqual(TAIL_OUTPUT_CHARS)
  })

  /*
   * The tail kept is the last TAIL_CHARS of what was sent, cut wherever that
   * falls — here ten characters into a token, behind one long colour code the
   * cleaning removes, so the line holding the token's end is among the last.
   */
  it('drops the line the kept tail was cut through', () => {
    const secret = 'sk-live-0123456789abcdef'
    const colour = `\u001b[${'0'.repeat(TAIL_CHARS - 23)}m`
    const raw = appendTail('', `${'x'.repeat(100)}${secret}\r\n${colour}ok\r\n`)
    expect(raw.startsWith(secret.slice(10))).toBe(true)

    expect(helpRun(run(raw), [{ name: 'API_TOKEN', value: secret }]).output).toBe('ok')
  })

  it('keeps nothing of a single line longer than the whole tail', () => {
    expect(helpRun(run(appendTail('', 'z'.repeat(TAIL_CHARS + 1))), []).output).toBe('')
  })
})
