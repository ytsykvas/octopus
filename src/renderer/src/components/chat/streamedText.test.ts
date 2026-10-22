import { describe, expect, it } from 'vitest'

import { SETTLED_AFTER, splitStreamed } from './streamedText.js'

const paragraph = (word: string): string => `${word} `.repeat(120).trim()

describe('a reply being written', () => {
  it('is parsed whole while it is short', () => {
    const text = 'One line.\n\nAnother.'

    expect(splitStreamed(text)).toEqual({ settled: '', tail: text })
  })

  it('is cut at the last blank line before a paragraph once it is long', () => {
    const text = `${paragraph('first')}\n\n${paragraph('second')}\n\nthird, still arriving`
    expect(text.length).toBeGreaterThan(SETTLED_AFTER)

    const { settled, tail } = splitStreamed(text)

    expect(settled).toBe(`${paragraph('first')}\n\n${paragraph('second')}\n\n`)
    expect(tail).toBe('third, still arriving')
    expect(settled + tail).toBe(text)
  })

  it('is cut before a heading as before a paragraph', () => {
    const text = `${paragraph('first')}\n\n${paragraph('second')}\n\n## Next`

    expect(splitStreamed(text).tail).toBe('## Next')
  })

  it('is not cut inside a fenced block, whatever the lines in it look like', () => {
    const settled = `${paragraph('first')}\n\n${paragraph('second')}\n\n`
    const text = `${settled}\`\`\`sh\necho one\n\necho two\n\n`

    expect(splitStreamed(text)).toEqual({ settled, tail: '```sh\necho one\n\necho two\n\n' })
  })

  it('is not cut before a line that may read on from the block above', () => {
    const settled = `${paragraph('first')}\n\n${paragraph('second')}\n\n`
    for (const next of ['- item', '2. item', '| cell |', '> quoted', '  indented', '*emphasis*']) {
      expect(splitStreamed(`${settled}${next}`).tail, next).toBe(
        `${paragraph('second')}\n\n${next}`
      )
    }
  })

  it('keeps everything in the tail when there is nowhere to cut', () => {
    const text = paragraph('one').repeat(2)

    expect(splitStreamed(text)).toEqual({ settled: '', tail: text })
  })
})
