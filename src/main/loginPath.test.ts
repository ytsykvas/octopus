import { describe, expect, it, vi } from 'vitest'

/**
 * The real `execFile` would spawn the login shell of whoever runs the suite and
 * read their profile — a test of the machine rather than of this module, and a
 * slow one. The stand-in records the call and answers for it.
 *
 * No `promisify.custom` symbol on it, so `promisify` resolves with the
 * callback's second argument, which is the shape the module destructures.
 */
const { calls, answer } = vi.hoisted(() => ({
  calls: [] as { file: string; args: readonly string[]; options: { timeout?: number } }[],
  answer: { stdout: '__OCTOPUS_PATH__/from/profile__OCTOPUS_PATH__' }
}))

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: readonly string[],
    options: { timeout?: number },
    callback: (error: null, result: { stdout: string }) => void
  ) => {
    calls.push({ file, args, options })
    callback(null, answer)
  }
}))

const { applyLoginShellPath } = await import('./loginPath.js')

describe('applyLoginShellPath', () => {
  it('replaces PATH with what the shell reported, merged', async () => {
    const env = { SHELL: '/bin/zsh', PATH: '/usr/bin' }

    await applyLoginShellPath(env, () =>
      Promise.resolve('__OCTOPUS_PATH__/opt/bin__OCTOPUS_PATH__')
    )
    expect(env.PATH).toBe('/opt/bin:/usr/bin')
  })

  it('leaves the environment alone when the shell could not be asked', async () => {
    const env = { SHELL: '/bin/zsh', PATH: '/usr/bin' }

    await applyLoginShellPath(env, () => Promise.reject(new Error('profile exploded')))
    expect(env.PATH).toBe('/usr/bin')
  })

  it('runs the login shell through execFile, with a timeout', async () => {
    calls.length = 0
    const env = { SHELL: '/bin/dash', PATH: '/usr/bin' }

    await applyLoginShellPath(env)

    // The default executor is the point of this test: it is what runs in the
    // app, and injecting one everywhere else would leave it unexercised.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.file).toBe('/bin/dash')
    expect(calls[0]?.args[0]).toBe('-ilc')
    expect(calls[0]?.options.timeout).toBeGreaterThan(0)
    expect(env.PATH).toBe('/from/profile:/usr/bin')
  })

  it('writes into the real process environment by default', async () => {
    const original = process.env.PATH
    process.env.PATH = '/inherited/only'

    try {
      await applyLoginShellPath(undefined, () =>
        Promise.resolve('__OCTOPUS_PATH__/from/shell__OCTOPUS_PATH__')
      )
      // Naming both halves proves the default reached process.env rather than
      // some other object: the inherited entry could come from nowhere else.
      expect(process.env.PATH).toBe('/from/shell:/inherited/only')
    } finally {
      process.env.PATH = original
    }
  })
})
