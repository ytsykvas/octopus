import { describe, expect, it } from 'vitest'

import {
  checkAccounts,
  checkClaudeAccount,
  checkGitHubAccount,
  type CommandExec,
  defaultExec,
  InvalidAuthRequestError,
  signInCommand,
  signOut,
  signOutCommand
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

/** What `gh auth status --json hosts` answers, with the scopes it names. */
function status(scopes: string | undefined): string {
  return JSON.stringify({
    hosts: { 'github.com': [{ state: 'success', active: true, login: 'ytsykvas', scopes }] }
  })
}

/**
 * A `gh` that answers both calls `checkGitHubAccount` makes.
 *
 * They are told apart by the first argument, which is all that separates
 * `gh api user` from `gh auth status`.
 */
function gh(user: string, authStatus: string): CommandExec {
  return (command, args) => {
    if (command !== 'gh') return Promise.reject(new Error('not installed'))
    return Promise.resolve(args.includes('api') ? user : authStatus)
  }
}

describe('defaultExec', () => {
  // Uses `echo` rather than claude or gh: the point is that the executor
  // spawns a real process and returns its stdout, not that any particular
  // CLI is installed on this machine.
  it('returns the stdout of a real command', async () => {
    await expect(defaultExec('echo', ['hello'])).resolves.toBe('hello\n')
  })

  it('rejects when the command does not exist', async () => {
    await expect(defaultExec('octopus-no-such-binary', [])).rejects.toThrow()
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
    const exec = gh(GITHUB_USER, status('gist, read:org, repo, workflow'))

    await expect(checkGitHubAccount(exec)).resolves.toEqual({
      connected: true,
      login: 'ytsykvas',
      name: 'Yurii Tsykvas',
      seesOrganisations: true
    })
  })

  it('handles an account without a display name', async () => {
    const payload = JSON.stringify({ login: 'ytsykvas', name: null })
    await expect(checkGitHubAccount(gh(payload, status('repo')))).resolves.toEqual({
      connected: true,
      login: 'ytsykvas',
      name: null,
      seesOrganisations: false
    })
  })

  /*
   * The whole point of the scope check, and the one assertion that would let a
   * wrong sentence onto the screen if it went: a token that names its scopes
   * and does not hold this one cannot list organisations, and the picker says
   * so.
   */
  it('reports that a token without read:org cannot see organisations', async () => {
    const exec = gh(GITHUB_USER, status('gist, repo, workflow'))
    await expect(checkGitHubAccount(exec)).resolves.toMatchObject({ seesOrganisations: false })
  })

  it('asks about the active account only, since a host can hold several', async () => {
    const calls: string[][] = []
    const exec: CommandExec = (_command, args) => {
      calls.push([...args])
      return Promise.resolve(args.includes('api') ? GITHUB_USER : status('repo'))
    }

    await checkGitHubAccount(exec)

    const auth = calls.find((args) => args.includes('auth')) ?? []
    expect(auth).toContain('--active')
    expect(auth).toContain('github.com')
  })

  /*
   * A fine-grained token holds no classic scopes and can still reach an
   * organisation, so "none named" has to mean "we were not told" rather than
   * "none". Reading it as none would put a confident wrong line under the
   * repository list.
   */
  it('does not claim a token without named scopes is missing one', async () => {
    for (const answer of [status(undefined), status(''), status('  ')]) {
      await expect(checkGitHubAccount(gh(GITHUB_USER, answer))).resolves.toMatchObject({
        seesOrganisations: null
      })
    }
  })

  it('says nothing about scopes when gh cannot answer for them', async () => {
    const exec: CommandExec = (_command, args) =>
      args.includes('api')
        ? Promise.resolve(GITHUB_USER)
        : Promise.reject(new Error('unknown flag: --json'))

    await expect(checkGitHubAccount(exec)).resolves.toMatchObject({
      connected: true,
      seesOrganisations: null
    })
  })

  it('says nothing about scopes when the status is not readable', async () => {
    for (const answer of ['<html>', JSON.stringify({ hosts: 'none' }), JSON.stringify({})]) {
      await expect(checkGitHubAccount(gh(GITHUB_USER, answer))).resolves.toMatchObject({
        seesOrganisations: null
      })
    }
  })

  it('says nothing about scopes for a host gh reports no account on', async () => {
    const answer = JSON.stringify({ hosts: { 'github.com': [] } })
    await expect(checkGitHubAccount(gh(GITHUB_USER, answer))).resolves.toMatchObject({
      seesOrganisations: null
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

describe('signInCommand', () => {
  it('builds the Claude sign-in command', () => {
    expect(signInCommand('claude')).toEqual(['claude', 'auth', 'login'])
  })

  it('builds the GitHub sign-in command', () => {
    expect(signInCommand('github')).toEqual(['gh', 'auth', 'login'])
  })

  // This argument crosses an IPC boundary, where TypeScript guarantees
  // nothing, and the result ends up on a command line. The validation must
  // survive refactoring, so the attack itself is a test.
  it('rejects an unknown account instead of passing it through', () => {
    expect(() => signInCommand('evil')).toThrow(InvalidAuthRequestError)
  })

  it('rejects non-string arguments', () => {
    expect(() => signInCommand(null)).toThrow(InvalidAuthRequestError)
    expect(() => signInCommand({ toString: () => 'claude' })).toThrow(InvalidAuthRequestError)
  })
})

describe('signOutCommand', () => {
  it('signs out of Claude without extra arguments', () => {
    expect(signOutCommand('claude')).toEqual({ command: 'claude', args: ['auth', 'logout'] })
  })

  it('tells gh which host to drop, so it does not prompt', () => {
    expect(signOutCommand('github')).toEqual({
      command: 'gh',
      args: ['auth', 'logout', '--hostname', 'github.com']
    })
  })

  it('names the account when one is known', () => {
    expect(signOutCommand('github', 'ytsykvas').args).toEqual([
      'auth',
      'logout',
      '--hostname',
      'github.com',
      '--user',
      'ytsykvas'
    ])
  })

  // The login comes from a CLI's output and ends up on a command line, so it
  // is checked rather than trusted.
  it('drops a login that does not look like an account name', () => {
    expect(signOutCommand('github', 'user; rm -rf ~').args).not.toContain('--user')
  })

  it('drops a login that is empty or absurdly long', () => {
    expect(signOutCommand('github', '').args).not.toContain('--user')
    expect(signOutCommand('github', 'x'.repeat(40)).args).not.toContain('--user')
  })

  it('ignores a login for Claude, which takes none', () => {
    expect(signOutCommand('claude', 'ytsykvas').args).toEqual(['auth', 'logout'])
  })

  it('rejects an unknown account', () => {
    expect(() => signOutCommand('evil')).toThrow(InvalidAuthRequestError)
  })
})

describe('signOut', () => {
  it('confirms success by re-reading the status, not by the exit code', async () => {
    let loggedIn = true
    const exec: CommandExec = (command, args) => {
      if (args[1] === 'logout') {
        loggedIn = false
        return Promise.resolve('')
      }
      if (command === 'gh') {
        return loggedIn ? Promise.resolve(GITHUB_USER) : Promise.reject(new Error('not logged in'))
      }
      return Promise.reject(new Error('unexpected'))
    }

    await expect(signOut('github', 'ytsykvas', exec)).resolves.toBe(true)
  })

  it('reports failure when the account is still there afterwards', async () => {
    const exec: CommandExec = (command, args) => {
      if (args[1] === 'logout') return Promise.resolve('')
      if (command === 'gh') return Promise.resolve(GITHUB_USER)
      return Promise.reject(new Error('unexpected'))
    }

    await expect(signOut('github', 'ytsykvas', exec)).resolves.toBe(false)
  })

  it('still verifies when the command itself fails — the exit code is not trusted', async () => {
    const exec: CommandExec = (_command, args) => {
      if (args[1] === 'logout') return Promise.reject(new Error('exit 1'))
      return Promise.reject(new Error('not logged in'))
    }

    await expect(signOut('claude', null, exec)).resolves.toBe(true)
  })

  it('checks the Claude account when signing out of Claude', async () => {
    const seen: string[] = []
    const exec: CommandExec = (command) => {
      seen.push(command)
      return Promise.reject(new Error('gone'))
    }

    await signOut('claude', null, exec)
    expect(seen).toContain('claude')
    expect(seen).not.toContain('gh')
  })
})
