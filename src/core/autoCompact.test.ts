import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { findWindowOverride } from './autoCompact.js'
import { AUTO_COMPACT_VARIABLE } from './chats.js'

let dir: string
let checkout: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-compact-'))
  checkout = join(dir, 'checkout')
  home = join(dir, 'home')
  await mkdir(join(checkout, '.claude'), { recursive: true })
  await mkdir(join(home, '.claude'), { recursive: true })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
})

/** Writes a settings file whose `env` block sets the variable. */
async function setIn(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify({ env: { [AUTO_COMPACT_VARIABLE]: value } }), 'utf8')
}

const ALL = ['user', 'project', 'local'] as const

describe('who outranks a chosen compaction window', () => {
  it('finds nobody when neither the environment nor a file sets it', async () => {
    await expect(findWindowOverride(checkout, ALL, {}, home)).resolves.toBeNull()
  })

  it('names the environment when only the environment sets it', async () => {
    await expect(
      findWindowOverride(checkout, ALL, { [AUTO_COMPACT_VARIABLE]: '400000' }, home)
    ).resolves.toEqual({ value: '400000', from: null })
  })

  // An empty value is no setting at all, the way the agent reads it.
  it('ignores the variable when it is set to nothing', async () => {
    await expect(
      findWindowOverride(checkout, ALL, { [AUTO_COMPACT_VARIABLE]: '' }, home)
    ).resolves.toBeNull()
  })

  /*
   * Measured against the CLI: 450k in an `env` block beat 400k in the
   * environment. So a file that sets it is the answer even with the
   * environment saying otherwise.
   */
  it("prefers a settings file's env block to the environment", async () => {
    await setIn(join(home, '.claude', 'settings.json'), '450000')

    await expect(
      findWindowOverride(checkout, ALL, { [AUTO_COMPACT_VARIABLE]: '400000' }, home)
    ).resolves.toEqual({ value: '450000', from: '~/.claude/settings.json' })
  })

  it('prefers the narrower file: local over the project, the project over the user', async () => {
    await setIn(join(home, '.claude', 'settings.json'), '300000')
    await setIn(join(checkout, '.claude', 'settings.json'), '400000')
    await setIn(join(checkout, '.claude', 'settings.local.json'), '500000')

    await expect(findWindowOverride(checkout, ALL, {}, home)).resolves.toEqual({
      value: '500000',
      from: join('.claude', 'settings.local.json')
    })
    await expect(findWindowOverride(checkout, ['user', 'project'], {}, home)).resolves.toEqual({
      value: '400000',
      from: join('.claude', 'settings.json')
    })
  })

  // An untrusted checkout gives the session only the user's settings, so its
  // own `env` cannot be what overrides anything.
  it('reads only the files the session reads', async () => {
    await setIn(join(checkout, '.claude', 'settings.json'), '400000')

    await expect(findWindowOverride(checkout, ['user'], {}, home)).resolves.toBeNull()
  })

  it('takes a number as the agent would', async () => {
    await setIn(join(home, '.claude', 'settings.json'), 500000)

    await expect(findWindowOverride(checkout, ['user'], {}, home)).resolves.toEqual({
      value: '500000',
      from: '~/.claude/settings.json'
    })
  })

  it('passes over a file that says nothing the agent would act on', async () => {
    const user = join(home, '.claude', 'settings.json')
    const project = join(checkout, '.claude', 'settings.json')
    const local = join(checkout, '.claude', 'settings.local.json')

    // Half-written JSON, a value of no use, and a file too large to read.
    await writeFile(local, '{ "env": {', 'utf8')
    await setIn(project, true)
    await writeFile(user, `{"pad": "${'x'.repeat(300 * 1024)}"}`, 'utf8')

    await expect(findWindowOverride(checkout, ALL, {}, home)).resolves.toBeNull()

    // And one that is JSON but not an object of settings at all.
    await writeFile(user, '"settings"', 'utf8')
    await setIn(project, '')
    await expect(findWindowOverride(checkout, ALL, {}, home)).resolves.toBeNull()
  })

  // `CLAUDE_CONFIG_DIR` moves the whole of `~/.claude`, so the user's file is
  // looked for there, and named by the path the reader has to open.
  it('follows the user file when the config directory has been moved', async () => {
    const moved = join(dir, 'elsewhere')
    await mkdir(moved, { recursive: true })
    await setIn(join(moved, 'settings.json'), '600000')

    await expect(
      findWindowOverride(checkout, ['user'], { CLAUDE_CONFIG_DIR: moved })
    ).resolves.toEqual({ value: '600000', from: join(moved, 'settings.json') })
  })

  it('reads the process environment when given none', async () => {
    vi.stubEnv(AUTO_COMPACT_VARIABLE, '700000')

    await expect(findWindowOverride(checkout, [])).resolves.toEqual({
      value: '700000',
      from: null
    })
  })
})
