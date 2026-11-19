import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

async function policy(): Promise<Record<string, string>> {
  const html = await readFile(resolve(import.meta.dirname, '../src/renderer/index.html'), 'utf8')
  const content = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? ''

  return Object.fromEntries(
    content
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name !== undefined && name !== '')
      .map(([name = '', ...values]) => [name, values.join(' ')])
  )
}

describe("the window's content security policy", () => {
  it('allows only what the window loads from itself, and nothing that leaves', async () => {
    expect(await policy()).toEqual({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': "'self' 'unsafe-inline'",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'"
    })
  })
})
