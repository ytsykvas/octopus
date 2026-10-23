import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { DATA_DIR_ENV } from './paths.js'

const run = promisify(execFile)

/**
 * This repository's own `.octopus/scripts` — what Run executes for octopus.
 *
 * Nothing else would notice one going wrong: they are shell, outside the type
 * checker, and a broken one fails only when somebody presses Run or deletes a
 * workspace. These pin the rules the `workspace-scripts` skill writes down.
 */
const SCRIPTS = join(fileURLToPath(import.meta.url), '../../../.octopus/scripts')
const NAMES = ['setup.sh', 'run.sh', 'archive.sh'] as const

const read = (name: string): Promise<string> => readFile(join(SCRIPTS, name), 'utf8')

/** The slug's own directory under the data roots a dev copy gets. */
const DEV_ROOT = '$HOME/.octopus-dev/$OCTOPUS_WORKSPACE_SLUG'

describe("the repository's own scripts", () => {
  it.each(NAMES)('%s is executable', async (name) => {
    const { mode } = await stat(join(SCRIPTS, name))

    expect(mode & 0o111).not.toBe(0)
  })

  it.each(NAMES)('%s parses as shell', async (name) => {
    await expect(run('sh', ['-n', join(SCRIPTS, name)])).resolves.toBeDefined()
  })

  describe('run.sh', () => {
    it('gives the dev copy a data root of its own, named by the slug', async () => {
      expect(await read('run.sh')).toContain(`export ${DATA_DIR_ENV}="${DEV_ROOT}"`)
    })

    it('refuses to start without a slug, before the root is built from it', async () => {
      const script = await read('run.sh')

      expect(script).toContain(': "${OCTOPUS_WORKSPACE_SLUG:?')
      expect(script.indexOf('OCTOPUS_WORKSPACE_SLUG:?')).toBeLessThan(
        script.indexOf(`export ${DATA_DIR_ENV}`)
      )
    })

    it('binds no literal port', async () => {
      expect(await read('run.sh')).not.toMatch(/--port|PORT=\d|:\d{4}/)
    })
  })

  describe('archive.sh', () => {
    // Cleanup cannot stop the removal, so a failed line must not skip the rest.
    it('has no set -e', async () => {
      expect(await read('archive.sh')).not.toMatch(/^\s*set\s+-\w*e/m)
    })

    it('stops on an empty slug before it removes anything', async () => {
      const script = await read('archive.sh')

      expect(script.indexOf('OCTOPUS_WORKSPACE_SLUG:?')).toBeGreaterThan(-1)
      expect(script.indexOf('OCTOPUS_WORKSPACE_SLUG:?')).toBeLessThan(script.indexOf('rm '))
    })

    it('removes only the slug-named directory, and the one run.sh made', async () => {
      const removals = (await read('archive.sh'))
        .split('\n')
        .filter((line) => /^\s*rm\s/.test(line))

      expect(removals).toEqual([`rm -rf "${DEV_ROOT}"`])
    })
  })
})
