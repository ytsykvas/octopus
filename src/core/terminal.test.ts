import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const run = promisify(execFile)

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
      owner: { workspaceId: null, purpose: 'shell' },
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
    expect(buildTerminalArgv(spec)).toEqual(['-i', '-c', "'gh' 'auth' 'login'"])
  })

  it('keeps multi-word commands intact', () => {
    const spec = TerminalSpecSchema.parse({ cwd: '/tmp', command: ['claude', 'auth', 'status'] })
    expect(buildTerminalArgv(spec)).toEqual(['-i', '-c', "'claude' 'auth' 'status'"])
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

describe('resolveCwd leaves alone what is not ours', () => {
  // `~user` is another account's home, which only a shell can resolve.
  it('does not touch ~user', () => {
    expect(resolveCwd('~other/x', '/home/u')).toBe('~other/x')
  })

  it('does not touch a tilde inside a path', () => {
    expect(resolveCwd('/a/~b', '/home/u')).toBe('/a/~b')
  })

  it('does not touch a relative path', () => {
    expect(resolveCwd('./x', '/home/u')).toBe('./x')
  })
})

describe('buildTerminalEnv with extra variables', () => {
  it('adds what the caller passes', () => {
    expect(buildTerminalEnv({}, { OCTOPUS_PORT: '3123' }).OCTOPUS_PORT).toBe('3123')
  })

  // The caller's variable is the specific instruction; an inherited one of the
  // same name is the general case and loses.
  it('lets the extra win over an inherited value', () => {
    const env = buildTerminalEnv({ OCTOPUS_PORT: 'stale' }, { OCTOPUS_PORT: '3123' })
    expect(env.OCTOPUS_PORT).toBe('3123')
  })

  it('still sets TERM when extras are given', () => {
    expect(buildTerminalEnv({}, { X: '1' }).TERM).toBe('xterm-256color')
  })

  it('changes nothing when no extras are given', () => {
    expect(buildTerminalEnv({ A: 'b' }).A).toBe('b')
  })
})

describe('buildTerminalArgv against a hostile command', () => {
  // The path of a script carries a project id, which comes from a repository's
  // directory name — and a repository cloned from GitHub brings that name from
  // whoever wrote it. `toSlug` only removes what git forbids in a ref, so shell
  // metacharacters survive all the way here.
  const HOSTILE = [
    '/tmp/my-repo;-touch-pwned/run.sh',
    '/tmp/app$(whoami)/run.sh',
    '/tmp/a|b/run.sh',
    '/tmp/x&y/run.sh',
    "/tmp/it's-mine/run.sh",
    '/tmp/back`tick`/run.sh',
    '/tmp/with space/run.sh'
  ]

  for (const path of HOSTILE) {
    // Asked of a real shell rather than of my idea of quoting: `printf` echoes
    // back exactly the words it was given, so anything the shell expanded,
    // split or executed shows up as a difference.
    it(`reaches a shell as one literal word: ${JSON.stringify(path)}`, async () => {
      const argv = buildTerminalArgv({
        owner: { workspaceId: null, purpose: 'shell' },
        cwd: '/tmp',
        command: ['printf', '%s', path],
        env: {},
        cols: 80,
        rows: 24
      })

      const { stdout } = await run('/bin/sh', ['-c', argv[2] ?? ''])
      expect(stdout).toBe(path)
    })
  }

  it('keeps a multi-word command as separate words', () => {
    const argv = buildTerminalArgv({
      owner: { workspaceId: null, purpose: 'shell' },
      cwd: '/tmp',
      command: ['gh', 'auth', 'login'],
      env: {},
      cols: 80,
      rows: 24
    })

    expect(argv[2]).toBe("'gh' 'auth' 'login'")
  })

  // A quote is the one character single quotes cannot contain, so the word is
  // closed, the quote escaped, and the word reopened. Asked of a real shell,
  // because writing this assertion by hand is exactly where it went wrong.
  it('escapes a quote rather than ending the word early', async () => {
    const argv = buildTerminalArgv({
      owner: { workspaceId: null, purpose: 'shell' },
      cwd: '/tmp',
      command: ['printf', '%s', "it's"],
      env: {},
      cols: 80,
      rows: 24
    })

    const { stdout } = await run('/bin/sh', ['-c', argv[2] ?? ''])
    expect(stdout).toBe("it's")
  })
})
