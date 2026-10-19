import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { skillsInFiles } from './settingsFiles.js'

let dir: string
let checkout: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-settings-'))
  checkout = join(dir, 'checkout')
  home = join(dir, 'home')
  await mkdir(join(checkout, '.claude'), { recursive: true })
  await mkdir(join(home, '.claude'), { recursive: true })
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const user = (): string => join(home, '.claude', 'settings.json')
const project = (): string => join(checkout, '.claude', 'settings.json')
const local = (): string => join(checkout, '.claude', 'settings.local.json')

async function withhold(path: string, skillOverrides: unknown): Promise<void> {
  await writeFile(path, JSON.stringify({ skillOverrides }), 'utf8')
}

const ALL = ['user', 'project', 'local'] as const

describe('what the settings files say about skills', () => {
  it('lets the narrower file win key by key, as the CLI merges them', async () => {
    await withhold(user(), { review: 'off', ship: 'off', plan: 'off' })
    await withhold(project(), { ship: 'name-only', plan: 'on' })
    await withhold(local(), { plan: 'user-invocable-only' })

    await expect(skillsInFiles(checkout, ALL, {}, home)).resolves.toEqual(
      new Map([
        ['plan', 'user-invocable-only'],
        ['ship', 'name-only'],
        ['review', 'off']
      ])
    )
  })

  // An untrusted checkout gives the session only the user's settings.
  it('reads only the files the session reads', async () => {
    await withhold(user(), { review: 'off' })
    await withhold(project(), { review: 'on' })

    await expect(skillsInFiles(checkout, ['user'], {}, home)).resolves.toEqual(
      new Map([['review', 'off']])
    )
  })

  it('passes over a value that is not one of the four, so the wider file stands', async () => {
    await withhold(user(), { review: 'off' })
    await withhold(local(), { review: 'hidden', ship: false })

    await expect(skillsInFiles(checkout, ALL, {}, home)).resolves.toEqual(
      new Map([['review', 'off']])
    )
  })

  it('takes a skill named like a property every object has', async () => {
    await withhold(user(), { constructor: 'off' })

    await expect(skillsInFiles(checkout, ALL, {}, home)).resolves.toEqual(
      new Map([['constructor', 'off']])
    )
  })

  it('says nothing for a file that is missing, broken or not settings', async () => {
    await writeFile(local(), '{ "skillOverrides": {', 'utf8')
    await writeFile(project(), '"settings"', 'utf8')
    await writeFile(user(), `{"pad": "${'x'.repeat(300 * 1024)}"}`, 'utf8')

    await expect(skillsInFiles(checkout, ALL, {}, home)).resolves.toEqual(new Map())

    // And settings that name no skill at all.
    await writeFile(user(), '{"env": {}}', 'utf8')
    await expect(skillsInFiles(checkout, ALL, {}, home)).resolves.toEqual(new Map())
    await expect(skillsInFiles(join(dir, 'nowhere'), ['local'])).resolves.toEqual(new Map())
  })

  it('follows the user file when the config directory has been moved', async () => {
    const moved = join(dir, 'elsewhere')
    await mkdir(moved, { recursive: true })
    await withhold(join(moved, 'settings.json'), { review: 'off' })

    await expect(
      skillsInFiles(checkout, ['user'], { CLAUDE_CONFIG_DIR: moved }, home)
    ).resolves.toEqual(new Map([['review', 'off']]))
  })
})
