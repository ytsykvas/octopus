import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { withoutDefaults } from './patchSchema.js'

describe('a patch built from a schema with defaults', () => {
  it('fills in nothing the patch left out', () => {
    const patch = z
      .object(withoutDefaults({ name: z.string().default('anna'), port: z.number() }))
      .exactPartial()

    expect(patch.parse({ port: 1 })).toEqual({ port: 1 })
  })

  it('leaves a field without a default as it was', () => {
    const port = z.number()

    expect(withoutDefaults({ port }).port).toBe(port)
  })

  // The limit `ConfigPatchSchema` works around by re-declaring such fields plainly.
  it('does not reach a default inside a pipe', () => {
    const tab = z
      .enum(['diff', 'files'])
      .default('diff')
      .transform((value) => value)
    const patch = z.object(withoutDefaults({ tab, port: z.number() })).exactPartial()

    expect(patch.parse({ port: 1 })).toEqual({ port: 1, tab: 'diff' })
  })
})
