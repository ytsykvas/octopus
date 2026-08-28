import { describe, expect, it } from 'vitest'

import {
  extractPath,
  type LoginShellExec,
  loginShellPathArgv,
  mergePath,
  resolveLoginShellPath
} from './loginShell.js'

const MARKER = '__OCTOPUS_PATH__'

/** What a cooperative shell prints: the value, wrapped in delimiters. */
function reply(path: string): string {
  return `${MARKER}${path}${MARKER}`
}

describe('loginShellPathArgv', () => {
  it('loads both profiles, because tools install into either', () => {
    const argv = loginShellPathArgv()
    expect(argv[0]).toBe('-ilc')
  })

  it('expands PATH in the shell rather than interpolating it', () => {
    // The value must reach us through the shell's own expansion; a command
    // that built the string on our side would be quoting user configuration.
    expect(argv()).toContain('"$PATH"')
  })

  function argv(): string {
    const [, command] = loginShellPathArgv()
    return command ?? ''
  }
})

describe('extractPath', () => {
  it('reads the value between the delimiters', () => {
    expect(extractPath(reply('/opt/homebrew/bin:/usr/bin'))).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('ignores whatever the profile printed around it', () => {
    const noisy = `nvm loaded\n${reply('/usr/local/bin')}\nwelcome back`
    expect(extractPath(noisy)).toBe('/usr/local/bin')
  })

  it('gives up when the shell printed nothing recognisable', () => {
    expect(extractPath('command not found')).toBeUndefined()
  })

  it('gives up when the output was cut off mid-value', () => {
    expect(extractPath(`${MARKER}/usr/bin`)).toBeUndefined()
  })

  it('treats an empty value as no answer', () => {
    expect(extractPath(reply('   '))).toBeUndefined()
  })
})

describe('mergePath', () => {
  it("keeps the shell's order, so a version manager stays ahead of /usr/bin", () => {
    expect(mergePath('/opt/homebrew/bin:/usr/bin', '/usr/bin:/sbin')).toBe(
      '/opt/homebrew/bin:/usr/bin:/sbin'
    )
  })

  it('never repeats an entry', () => {
    expect(mergePath('/usr/bin:/usr/bin', '/usr/bin')).toBe('/usr/bin')
  })

  it('drops empty segments, which a trailing colon produces', () => {
    expect(mergePath('/usr/bin::', ':/sbin')).toBe('/usr/bin:/sbin')
  })

  it('copes with nothing inherited', () => {
    expect(mergePath('/usr/bin', undefined)).toBe('/usr/bin')
  })
})

describe('resolveLoginShellPath', () => {
  it('asks the shell the user configured', async () => {
    const asked: string[] = []
    const exec: LoginShellExec = (file) => {
      asked.push(file)
      return Promise.resolve(reply('/opt/homebrew/bin'))
    }

    await resolveLoginShellPath(exec, { SHELL: '/bin/bash', PATH: '/usr/bin' })
    expect(asked).toEqual(['/bin/bash'])
  })

  it('returns the shell PATH merged with the one already in the environment', async () => {
    const exec: LoginShellExec = () => Promise.resolve(reply('/opt/homebrew/bin:/usr/bin'))

    await expect(resolveLoginShellPath(exec, { PATH: '/usr/bin:/sbin' })).resolves.toBe(
      '/opt/homebrew/bin:/usr/bin:/sbin'
    )
  })

  it('gives up quietly when the profile exits non-zero', async () => {
    // A broken profile is a bad reason to refuse to start: without a PATH the
    // app behaves exactly as it did before this existed.
    const exec: LoginShellExec = () => Promise.reject(new Error('.zshrc: line 4: boom'))

    await expect(resolveLoginShellPath(exec, { PATH: '/usr/bin' })).resolves.toBeUndefined()
  })

  it('gives up quietly when the shell answered with noise', async () => {
    const exec: LoginShellExec = () => Promise.resolve('no marker here')

    await expect(resolveLoginShellPath(exec, { PATH: '/usr/bin' })).resolves.toBeUndefined()
  })

  it('reads the real environment by default', async () => {
    const original = process.env.PATH
    process.env.PATH = '/inherited/only'

    try {
      const exec: LoginShellExec = () => Promise.resolve(reply('/from/shell'))
      // Asserting the shell's own entry would pass with no environment read at
      // all; the inherited half is the only part that proves the default.
      await expect(resolveLoginShellPath(exec)).resolves.toBe('/from/shell:/inherited/only')
    } finally {
      process.env.PATH = original
    }
  })
})
