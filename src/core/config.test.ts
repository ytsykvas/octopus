import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type Config,
  ConfigSchema,
  createDefaultConfig,
  loadConfig,
  saveConfig,
  toSdkSettingSources
} from './config.js'
import { InvalidFileError } from './persist.js'

const UUID = '00000000-0000-4000-8000-000000000000'
const NOW = new Date('2026-08-07T12:00:00.000Z')

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-config-'))
  file = join(dir, 'config.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('createDefaultConfig', () => {
  it('loads no setting sources by default — transparency out of the box', () => {
    expect(createDefaultConfig('ytsykvas', NOW, () => UUID).settingSources).toBe('none')
  })

  it('keeps the branch prefix it was given', () => {
    expect(createDefaultConfig('ytsykvas', NOW, () => UUID).branchPrefix).toBe('ytsykvas')
  })

  it('records deviceId and install time — hooks for future licensing', () => {
    const config = createDefaultConfig('ytsykvas', NOW, () => UUID)
    expect(config.deviceId).toBe(UUID)
    expect(config.installedAt).toBe('2026-08-07T12:00:00.000Z')
  })

  it('follows the system theme by default', () => {
    expect(createDefaultConfig('ytsykvas', NOW, () => UUID).theme).toBe('system')
  })

  it('defaults to English', () => {
    expect(createDefaultConfig('ytsykvas', NOW, () => UUID).language).toBe('en')
  })

  it('generates distinct device ids when no generator is supplied', () => {
    expect(createDefaultConfig('a').deviceId).not.toBe(createDefaultConfig('a').deviceId)
  })

  it('defaults to the current time', () => {
    const before = Date.now()
    const at = Date.parse(createDefaultConfig('a').installedAt)
    expect(at).toBeGreaterThanOrEqual(before - 1000)
  })
})

describe('loadConfig', () => {
  it('creates the file on first run', async () => {
    const defaults = createDefaultConfig('ytsykvas', NOW, () => UUID)
    await expect(loadConfig(file, defaults)).resolves.toEqual(defaults)
    await expect(readFile(file, 'utf8')).resolves.toContain('ytsykvas')
  })

  it('reads an existing config without overwriting it', async () => {
    const saved = { ...createDefaultConfig('first', NOW, () => UUID) }
    await saveConfig(saved, file)

    const other = createDefaultConfig('second', NOW, () => UUID)
    await expect(loadConfig(file, other)).resolves.toEqual(saved)
  })

  it('throws on a corrupt config instead of silently resetting settings', async () => {
    await writeFile(file, '{ broken', 'utf8')
    await expect(loadConfig(file)).rejects.toBeInstanceOf(InvalidFileError)
  })

  it('uses built-in defaults when none are supplied', async () => {
    const config = await loadConfig(file)
    expect(config.branchPrefix).toBe('octopus')
  })

  it('still loads a config written before a newer field existed', async () => {
    // A config from an older build: neither `language` nor `rightPanelWidth`.
    const legacy = {
      version: 1,
      branchPrefix: 'ytsykvas',
      settingSources: 'none',
      theme: 'system',
      deviceId: UUID,
      installedAt: '2026-08-07T12:00:00.000Z'
    }
    await writeFile(file, JSON.stringify(legacy), 'utf8')

    const config = await loadConfig(file)
    expect(config.language).toBe('en')
    expect(config.rightPanelWidth).toBe(360)
    expect(config.sidebarWidth).toBe(240)
    expect(config.branchPrefix).toBe('ytsykvas')
  })
})

describe('rightPanelWidth', () => {
  // Too narrow to read build output in, or wider than any real display.
  it('rejects a width outside the usable range', () => {
    const base = createDefaultConfig('ytsykvas', NOW, () => UUID)

    expect(ConfigSchema.safeParse({ ...base, rightPanelWidth: 100 }).success).toBe(false)
    expect(ConfigSchema.safeParse({ ...base, rightPanelWidth: 9000 }).success).toBe(false)
  })

  it('accepts the bounds themselves', () => {
    const base = createDefaultConfig('ytsykvas', NOW, () => UUID)

    expect(ConfigSchema.safeParse({ ...base, rightPanelWidth: 280 }).success).toBe(true)
    expect(ConfigSchema.safeParse({ ...base, rightPanelWidth: 4000 }).success).toBe(true)
  })

  // A width saved on a wide display must still load on a laptop; the pane is
  // clamped to the window when rendered, not rejected here.
  it('accepts a width wider than the current window', () => {
    const base = createDefaultConfig('ytsykvas', NOW, () => UUID)
    expect(ConfigSchema.safeParse({ ...base, rightPanelWidth: 2200 }).success).toBe(true)
  })

  // A fractional width would reach CSS as a blurry half-pixel edge.
  it('rejects a fractional width', () => {
    const base = createDefaultConfig('ytsykvas', NOW, () => UUID)
    expect(ConfigSchema.safeParse({ ...base, rightPanelWidth: 360.5 }).success).toBe(false)
  })
})

describe('saveConfig', () => {
  it('persists changes so they read back', async () => {
    const config = createDefaultConfig('ytsykvas', NOW, () => UUID)
    await saveConfig({ ...config, theme: 'dark' }, file)
    await expect(loadConfig(file)).resolves.toMatchObject({ theme: 'dark' })
  })

  it('refuses to save a config with an empty branch prefix', async () => {
    const broken = { ...createDefaultConfig('x', NOW, () => UUID), branchPrefix: '' } as Config
    await expect(saveConfig(broken, file)).rejects.toBeInstanceOf(InvalidFileError)
  })
})

describe('toSdkSettingSources', () => {
  it('maps none to an empty array — the SDK cannot pick up CLAUDE.md silently', () => {
    expect(toSdkSettingSources('none')).toEqual([])
  })

  it('maps project to repository settings only', () => {
    expect(toSdkSettingSources('project')).toEqual(['project'])
  })

  it('maps all to the full set of sources', () => {
    expect(toSdkSettingSources('all')).toEqual(['user', 'project', 'local'])
  })
})

describe('sidebarWidth', () => {
  // Below the floor the project name in the header is all ellipsis, which
  // reads as broken rather than as narrow.
  it('rejects a width outside the usable range', () => {
    const base = createDefaultConfig('ytsykvas', NOW, () => UUID)

    expect(ConfigSchema.safeParse({ ...base, sidebarWidth: 80 }).success).toBe(false)
    expect(ConfigSchema.safeParse({ ...base, sidebarWidth: 900 }).success).toBe(false)
  })

  it('accepts the bounds themselves', () => {
    const base = createDefaultConfig('ytsykvas', NOW, () => UUID)

    expect(ConfigSchema.safeParse({ ...base, sidebarWidth: 180 }).success).toBe(true)
    expect(ConfigSchema.safeParse({ ...base, sidebarWidth: 560 }).success).toBe(true)
  })

  it('rejects a fractional width', () => {
    const base = createDefaultConfig('ytsykvas', NOW, () => UUID)
    expect(ConfigSchema.safeParse({ ...base, sidebarWidth: 240.5 }).success).toBe(false)
  })
})
