import { describe, expect, it } from 'vitest'

import {
  authCommand,
  checkAccounts,
  checkClaudeAccount,
  checkGitHubAccount,
  type CommandExec,
  defaultExec,
  InvalidAuthRequestError
} from './accounts.js'

/** Answers a fixed payload for one command and fails for anything else. */
function respondTo(command: string, payload: string): CommandExec {
  return (name) =>
    name === command ? Promise.resolve(payload) : Promise.reject(new Error('not installed'))
}

const CLAUDE_SIGNED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'user@example.com',
  orgId: 'org-1',
  orgName: "user@example.com's Organization",
  subscriptionType: 'max'
})

const GITHUB_USER = JSON.stringify({ login: 'ytsykvas', name: 'Yurii Tsykvas', id: 1 })

describe('defaultExec', () => {
  // Uses `echo` rather than claude or gh: the point is that the executor
  // spawns a real process and returns its stdout, not that any particular
  // CLI is installed on this machine.
  it('returns the stdout of a real command', async () => {
    await expect(defaultExec('echo', ['hello'])).resolves.toBe('hello\n')
  })

  it('rejects when the command does not exist', async () => {
    await expect(defaultExec('maestro-no-such-binary', [])).rejects.toThrow()
  })
})

describe('checkClaudeAccount', () => {
  it('reports a signed-in account with its details', async () => {
    const account = await checkClaudeAccount(respondTo('claude', CLAUDE_SIGNED_IN))

    expect(account).toEqual({
      connected: true,
      email: 'user@example.com',
      authMethod: 'claude.ai',
      subscriptionType: 'max',
      orgName: "user@example.com's Organization"
    })
  })

  it('treats loggedIn: false as disconnected', async () => {
    const payload = JSON.stringify({ loggedIn: false })
    await expect(checkClaudeAccount(respondTo('claude', payload))).resolves.toMatchObject({
      connected: false
    })
  })

  it('survives a signed-in account that reports only the minimum', async () => {
    const payload = JSON.stringify({ loggedIn: true })
    await expect(checkClaudeAccount(respondTo('claude', payload))).resolves.toEqual({
      connected: true,
      email: null,
      authMethod: null,
      subscriptionType: null,
      orgName: null
    })
  })

  it('reports disconnected when the CLI is missing', async () => {
    const missing: CommandExec = () => Promise.reject(new Error('spawn claude ENOENT'))
    await expect(checkClaudeAccount(missing)).resolves.toMatchObject({ connected: false })
  })

  it('reports disconnected on unparsable output rather than throwing', async () => {
    await expect(checkClaudeAccount(respondTo('claude', 'not json'))).resolves.toMatchObject({
      connected: false
    })
  })

  it('reports disconnected when the payload has an unexpected shape', async () => {
    const payload = JSON.stringify({ loggedIn: 'yes' })
    await expect(checkClaudeAccount(respondTo('claude', payload))).resolves.toMatchObject({
      connected: false
    })
  })
})

describe('checkGitHubAccount', () => {
  it('reports a signed-in account', async () => {
    await expect(checkGitHubAccount(respondTo('gh', GITHUB_USER))).resolves.toEqual({
      connected: true,
      login: 'ytsykvas',
      name: 'Yurii Tsykvas'
    })
  })

  it('handles an account without a display name', async () => {
    const payload = JSON.stringify({ login: 'ytsykvas', name: null })
    await expect(checkGitHubAccount(respondTo('gh', payload))).resolves.toEqual({
      connected: true,
      login: 'ytsykvas',
      name: null
    })
  })

  it('handles a payload that omits the name entirely', async () => {
    const payload = JSON.stringify({ login: 'ytsykvas' })
    await expect(checkGitHubAccount(respondTo('gh', payload))).resolves.toMatchObject({
      name: null
    })
  })

  it('reports disconnected when gh is not signed in', async () => {
    const failing: CommandExec = () => Promise.reject(new Error('gh: not authenticated'))
    await expect(checkGitHubAccount(failing)).resolves.toMatchObject({ connected: false })
  })

  it('reports disconnected on unparsable output', async () => {
    await expect(checkGitHubAccount(respondTo('gh', '<html>'))).resolves.toMatchObject({
      connected: false
    })
  })

  it('reports disconnected when the payload lacks a login', async () => {
    const payload = JSON.stringify({ name: 'Someone' })
    await expect(checkGitHubAccount(respondTo('gh', payload))).resolves.toMatchObject({
      connected: false
    })
  })
})

describe('checkAccounts', () => {
  it('reports both services independently', async () => {
    const exec: CommandExec = (command) => {
      if (command === 'claude') return Promise.resolve(CLAUDE_SIGNED_IN)
      return Promise.reject(new Error('gh missing'))
    }

    const status = await checkAccounts(exec)
    expect(status.claude.connected).toBe(true)
    expect(status.github.connected).toBe(false)
  })

  it('one missing CLI does not hide the other account', async () => {
    const exec: CommandExec = (command) => {
      if (command === 'gh') return Promise.resolve(GITHUB_USER)
      return Promise.reject(new Error('claude missing'))
    }

    const status = await checkAccounts(exec)
    expect(status.github.login).toBe('ytsykvas')
    expect(status.claude.connected).toBe(false)
  })
})

describe('authCommand', () => {
  it('builds the Claude sign-in command', () => {
    expect(authCommand('claude', 'login')).toEqual(['claude', 'auth', 'login'])
  })

  it('builds the GitHub sign-out command', () => {
    expect(authCommand('github', 'logout')).toEqual(['gh', 'auth', 'logout'])
  })

  // These arguments cross an IPC boundary, where TypeScript guarantees
  // nothing, and the result ends up on a command line. The validation must
  // survive refactoring, so the attack itself is a test.
  it('rejects an unknown account instead of passing it through', () => {
    expect(() => authCommand('evil', 'login')).toThrow(InvalidAuthRequestError)
  })

  it('rejects an action carrying shell or AppleScript metacharacters', () => {
    expect(() => authCommand('claude', 'login"; do shell script "rm -rf ~')).toThrow(
      InvalidAuthRequestError
    )
  })

  it('rejects non-string arguments', () => {
    expect(() => authCommand(null, 'login')).toThrow(InvalidAuthRequestError)
    expect(() => authCommand('claude', { toString: () => 'login' })).toThrow(
      InvalidAuthRequestError
    )
  })

  it('never emits anything beyond the two fixed command vectors', () => {
    const allowed = [
      ['claude', 'auth', 'login'],
      ['claude', 'auth', 'logout'],
      ['gh', 'auth', 'login'],
      ['gh', 'auth', 'logout']
    ]

    for (const kind of ['claude', 'github']) {
      for (const action of ['login', 'logout']) {
        expect(allowed).toContainEqual(authCommand(kind, action))
      }
    }
  })
})
