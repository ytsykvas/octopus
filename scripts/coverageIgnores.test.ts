import { readdir, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = resolve(import.meta.dirname, '../src')
const HELPERS = `${join('renderer', 'src', 'test')}${sep}`
const POLICY = 'see docs/testing.md#inline-ignores'

// Lowered with every ignore that goes; the last test fails until it is.
const MAX_IGNORES = 33

const DIRECTIVE = /\b(?:v8|c8|istanbul) ignore\b/
const ALLOWED = /^\s*\/\* v8 ignore next(?: \d+)? \*\/$/
const COMMENT = /^(?:\/\/|\*)|\*\/$/

interface Ignore {
  readonly at: string
  readonly line: string
  readonly above: string
}

async function ignores(): Promise<Ignore[]> {
  const names = (await readdir(SRC, { recursive: true })).filter(
    (name) =>
      /\.tsx?$/.test(name) && !/\.(?:test|spec)\.tsx?$/.test(name) && !name.startsWith(HELPERS)
  )
  const found: Ignore[] = []

  for (const name of names.sort()) {
    const lines = (await readFile(join(SRC, name), 'utf8')).split('\n')
    lines.forEach((line, index) => {
      if (!DIRECTIVE.test(line)) return
      const above = (lines[index - 1] ?? '').trim()
      found.push({ at: `src/${name}:${String(index + 1)}`, line, above })
    })
  }

  return found
}

describe('an inline coverage ignore', () => {
  it("is a `v8 ignore next`, never a range or another tool's", async () => {
    const odd = (await ignores()).filter(({ line }) => !ALLOWED.test(line)).map(({ at }) => at)

    expect(odd, POLICY).toEqual([])
  })

  it('has the reason for it on the line above', async () => {
    const bare = (await ignores())
      .filter(({ above }) => !COMMENT.test(above) || DIRECTIVE.test(above))
      .map(({ at }) => at)

    expect(bare, POLICY).toEqual([])
  })

  it('grows no more common', async () => {
    const count = (await ignores()).length

    expect(count, `Fewer, not more — ${POLICY}`).toBeLessThanOrEqual(MAX_IGNORES)
    expect(count, 'Fewer than allowed: lower MAX_IGNORES to match').toBe(MAX_IGNORES)
  })
})
