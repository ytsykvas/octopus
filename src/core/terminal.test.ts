import { describe, expect, it } from 'vitest'

import {
  buildTerminalArgv,
  buildTerminalEnv,
  resolveCwd,
  resolveShell,
  TerminalSpecSchema
} from './terminal.js'

describe('TerminalSpecSchema', () => {
  it('fills in a usable default size', () => {
    const spec = TerminalSpecSchema.parse({ cwd: '/tmp' })
    expect(spec.cols).toBe(80)
    expect(spec.rows).toBe(24)
    expect(spec.command).toEqual([])
  })

  it('rejects an empty working directory', () => {
    expect(TerminalSpecSchema.safeParse({ cwd: '' }).success).toBe(false)
  })

  it('rejects an absurd size, which would be a bug rather than a request', () => {
    expect(TerminalSpecSchema.safeParse({ cwd: '/tmp', cols: 0 }).success).toBe(false)
    expect(TerminalSpecSchema.safeParse({ cwd: '/tmp', rows: 100_000 }).success).toBe(false)
  })

  it('keeps an explicit command and size', () => {
    const spec = TerminalSpecSchema.parse({
      cwd: '/repo',
      command: ['gh', 'auth', 'login'],
      cols: 120,
      rows: 40
    })
    expect(spec.command).toEqual(['gh', 'auth', 'login'])
    expect(spec.cols).toBe(120)
  })
})

describe('resolveShell', () => {
  it('uses the shell the user configured', () => {
    expect(resolveShell({ SHELL: '/bin/bash' })).toBe('/bin/bash')
  })

  it('falls back when SHELL is missing — some launch contexts do not set it', () => {
    expect(resolveShell({})).toBe('/bin/zsh')
  })

  it('treats a blank SHELL as missing', () => {
    expect(resolveShell({ SHELL: '   ' })).toBe('/bin/zsh')
  })

  it('reads the real environment by default', () => {
    expect(resolveShell()).toMatch(/\/\w+/)
  })
})

describe('resolveCwd', () => {
  // A `~` reaching a process as its working directory kills the session
  // instantly: expansion is a shell feature, not a system one.
  it('expands a bare tilde to the home directory', () => {
    expect(resolveCwd('~', '/Users/test')).toBe('/Users/test')
  })

  it('expands a tilde prefix', () => {
    expect(resolveCwd('~/projects/app', '/Users/test')).toBe('/Users/test/projects/app')
  })

  it('leaves absolute paths untouched', () => {
    expect(resolveCwd('/repos/app', '/Users/test')).toBe('/repos/app')
  })

  it('does not touch a tilde in the middle of a path', () => {
    expect(resolveCwd('/repos/~backup', '/Users/test')).toBe('/repos/~backup')
  })
})

describe('buildTerminalArgv', () => {
  it('returns no arguments for a plain shell session', () => {
    const spec = TerminalSpecSchema.parse({ cwd: '/tmp' })
    expect(buildTerminalArgv(spec)).toEqual([])
  })

  it('runs a command through an interactive login shell', () => {
    const spec = TerminalSpecSchema.parse({ cwd: '/tmp', command: ['gh', 'auth', 'login'] })
    expect(buildTerminalArgv(spec)).toEqual(['-i', '-c', 'gh auth login'])
  })

  it('keeps multi-word commands intact', () => {
    const spec = TerminalSpecSchema.parse({ cwd: '/tmp', command: ['claude', 'auth', 'status'] })
    expect(buildTerminalArgv(spec)).toEqual(['-i', '-c', 'claude auth status'])
  })
})

describe('buildTerminalEnv', () => {
  it('announces a capable terminal so tools format their output', () => {
    const env = buildTerminalEnv({ PATH: '/usr/bin' })
    expect(env.TERM).toBe('xterm-256color')
    expect(env.COLORTERM).toBe('truecolor')
  })

  it('carries the surrounding environment through', () => {
    const env = buildTerminalEnv({ PATH: '/usr/bin', HOME: '/Users/test' })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/Users/test')
  })

  it('drops undefined values, which would break the child process', () => {
    const env = buildTerminalEnv({ PATH: '/usr/bin', EMPTY: undefined })
    expect('EMPTY' in env).toBe(false)
  })

  it('overrides an inherited TERM — the embedded emulator decides, not the parent', () => {
    const env = buildTerminalEnv({ TERM: 'dumb' })
    expect(env.TERM).toBe('xterm-256color')
  })

  it('reads the real environment by default', () => {
    expect(buildTerminalEnv().TERM).toBe('xterm-256color')
  })
})
