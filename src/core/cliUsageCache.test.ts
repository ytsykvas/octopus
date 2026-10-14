import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cliConfigDir, readCachedUsageAt } from './cliUsageCache.js'

describe('when the CLI last fetched the account usage', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopus-cli-cache-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const write = (content: string): Promise<void> => writeFile(join(dir, '.claude.json'), content)

  it('reads the moment the CLI wrote down', async () => {
    await write(
      JSON.stringify({
        numStartups: 7,
        cachedUsageUtilization: {
          fetchedAtMs: 1_790_000_000_000,
          accountUuid: 'a',
          utilization: { five_hour: { utilization: 3, resets_at: null } }
        }
      })
    )

    await expect(readCachedUsageAt(dir)).resolves.toBe(1_790_000_000_000)
  })

  // A fresh install, or a CLI that has never been asked: nothing to read.
  it('says nothing when there is no file', async () => {
    await expect(readCachedUsageAt(dir)).resolves.toBeNull()
  })

  it('says nothing when the file has no cached usage in it', async () => {
    await write(JSON.stringify({ numStartups: 7 }))

    await expect(readCachedUsageAt(dir)).resolves.toBeNull()
  })

  // The file is the CLI's and can be mid-write or damaged; a gauge's footnote
  // must not turn that into a failed read.
  it('says nothing when the file is not JSON', async () => {
    await write('{ not json')

    await expect(readCachedUsageAt(dir)).resolves.toBeNull()
  })

  it('says nothing when the moment is not a number', async () => {
    await write(JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: 'yesterday' } }))

    await expect(readCachedUsageAt(dir)).resolves.toBeNull()
  })

  it('says nothing when the file is not an object at all', async () => {
    await write(JSON.stringify(['cachedUsageUtilization']))

    await expect(readCachedUsageAt(dir)).resolves.toBeNull()
  })
})

describe('where the CLI keeps its config', () => {
  it('follows CLAUDE_CONFIG_DIR when it is set', () => {
    expect(cliConfigDir({ CLAUDE_CONFIG_DIR: '/somewhere/else' }, '/home/anna')).toBe(
      '/somewhere/else'
    )
  })

  it('is the home directory otherwise', () => {
    expect(cliConfigDir({}, '/home/anna')).toBe('/home/anna')
  })

  // An exported-but-empty variable is how a shell unsets it without unsetting
  // it, and joining `''` with a file name would read a path relative to cwd.
  it('treats an empty variable as unset', () => {
    expect(cliConfigDir({ CLAUDE_CONFIG_DIR: '' }, '/home/anna')).toBe('/home/anna')
  })
})
