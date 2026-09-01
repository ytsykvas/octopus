import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The bridge is tested against a stand-in for Electron.
 *
 * Importing the real module would pull in the whole framework for what is a
 * table of channel names — and the table is the thing worth checking, since a
 * name that drifts from `main/ipc.ts` fails only at runtime, in the one place
 * with no stack trace worth reading.
 */
const invoke = vi.fn((...args: unknown[]) => {
  void args
  return Promise.resolve({ ok: true, value: null })
})
const on = vi.fn()
const off = vi.fn()
const exposeInMainWorld = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown): void => {
      exposeInMainWorld(name, value)
    }
  },
  ipcRenderer: {
    invoke: (...args: unknown[]): Promise<unknown> => invoke(...args),
    on: (...args: unknown[]): void => {
      on(...args)
    },
    off: (...args: unknown[]): void => {
      off(...args)
    }
  }
}))

type Group = Record<string, (...args: never[]) => unknown>
type Api = Record<string, Group>

let api: Api

/**
 * One method of the bridge, by name.
 *
 * Looked up rather than imported: the point is to check the table the renderer
 * actually receives, which means going through it the way the renderer does.
 */
function method(groupName: string, name: string): (...args: never[]) => unknown {
  const found = api[groupName]?.[name]
  if (!found) throw new Error(`the bridge exposes no ${groupName}.${name}`)
  return found
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.resetModules()

  await import('./index.js')
  api = exposeInMainWorld.mock.calls[0]?.[1] as Api
})

describe('the exposed bridge', () => {
  it('is published under one name the renderer knows', () => {
    expect(exposeInMainWorld).toHaveBeenCalledWith('octopus', expect.anything())
  })

  it('groups its methods rather than flattening everything', () => {
    expect(Object.keys(api).sort()).toEqual([
      'accounts',
      'chats',
      'config',
      'dialog',
      'files',
      'projects',
      'settings',
      'skills',
      'terminal',
      'theme',
      'workspaces'
    ])
  })
})

describe('channel names', () => {
  // Each of these must exist in `main/ipc.ts`. A typo here is invisible until
  // the feature is used, and then says only "no handler registered".
  const CALLS: readonly [string, () => unknown, string][] = [
    ['theme.get', () => method('theme', 'get')(), 'theme:get'],
    ['config.get', () => method('config', 'get')(), 'config:get'],
    ['config.update', () => method('config', 'update')({} as never), 'config:update'],
    ['projects.list', () => method('projects', 'list')(), 'projects:list'],
    ['projects.add', () => method('projects', 'add')(), 'projects:add'],
    [
      'projects.update',
      () => method('projects', 'update')('p' as never, {} as never),
      'projects:update'
    ],
    ['projects.remove', () => method('projects', 'remove')('p' as never), 'projects:remove'],
    ['projects.branches', () => method('projects', 'branches')('p' as never), 'projects:branches'],
    [
      'projects.pullRequests',
      () => method('projects', 'pullRequests')('p' as never),
      'projects:pullRequests'
    ],
    ['projects.listRemote', () => method('projects', 'listRemote')(), 'projects:listRemote'],
    [
      'projects.readScript',
      () => method('projects', 'readScript')('p' as never, 'setup' as never),
      'scripts:read'
    ],
    [
      'projects.saveScript',
      () => method('projects', 'saveScript')('p' as never, 'setup' as never, 'x' as never),
      'scripts:save'
    ],
    [
      'projects.scriptPaths',
      () => method('projects', 'scriptPaths')('p' as never),
      'scripts:paths'
    ],
    [
      'projects.readCarryList',
      () => method('projects', 'readCarryList')('p' as never),
      'carry:read'
    ],
    [
      'projects.saveCarryList',
      () => method('projects', 'saveCarryList')('p' as never, '.env' as never),
      'carry:save'
    ],
    [
      'projects.repoConfig',
      () => method('projects', 'repoConfig')('p' as never),
      'repoConfig:read'
    ],
    [
      'projects.importRepoConfig',
      () => method('projects', 'importRepoConfig')('p' as never, ['carry'] as never),
      'repoConfig:import'
    ],
    [
      'projects.exportRepoConfig',
      () => method('projects', 'exportRepoConfig')('p' as never, ['carry'] as never),
      'repoConfig:export'
    ],
    [
      'projects.readInstruction',
      () => method('projects', 'readInstruction')('p' as never, 'pullRequest' as never),
      'instructions:read'
    ],
    [
      'workspaces.prepare',
      () => method('workspaces', 'prepare')('w' as never),
      'workspace:prepare'
    ],
    ['projects.readEnv', () => method('projects', 'readEnv')('p' as never), 'env:read'],
    [
      'projects.saveEnv',
      () => method('projects', 'saveEnv')('p' as never, 'A=1' as never),
      'env:save'
    ],
    [
      'projects.isEnvIgnored',
      () => method('projects', 'isEnvIgnored')('p' as never),
      'env:ignored'
    ],
    [
      'projects.instructionSources',
      () => method('projects', 'instructionSources')('p' as never, null as never),
      'instructions:sources'
    ],
    ['workspaces.env', () => method('workspaces', 'env')('w' as never), 'workspace:env'],
    ['workspaces.trust', () => method('workspaces', 'trust')('w' as never), 'trust:read'],
    [
      'workspaces.approveSettings',
      () => method('workspaces', 'approveSettings')('w' as never),
      'trust:approve'
    ],
    ['workspaces.scripts', () => method('workspaces', 'scripts')('w' as never), 'scripts:resolved'],
    [
      'projects.scripts',
      () => method('projects', 'scripts')('p' as never, null as never),
      'scripts:project'
    ],
    [
      'workspaces.setEnvProfile',
      () => method('workspaces', 'setEnvProfile')('w' as never, null as never),
      'workspaces:envProfile'
    ],
    [
      'workspaces.approveScripts',
      () => method('workspaces', 'approveScripts')('w' as never),
      'scripts:approve'
    ],
    ['projects.envProfiles', () => method('projects', 'envProfiles')('p' as never), 'env:profiles'],
    [
      'projects.createEnv',
      () => method('projects', 'createEnv')('p' as never, 'n' as never, null as never),
      'env:create'
    ],
    [
      'projects.renameEnv',
      () => method('projects', 'renameEnv')('p' as never, 'a' as never, 'b' as never),
      'env:rename'
    ],
    [
      'projects.removeEnv',
      () => method('projects', 'removeEnv')('p' as never, 'n' as never),
      'env:remove'
    ],
    ['workspaces.port', () => method('workspaces', 'port')('w' as never), 'workspaces:port'],
    [
      'workspaces.serving',
      () => method('workspaces', 'serving')('w' as never),
      'workspaces:serving'
    ],
    ['workspaces.list', () => method('workspaces', 'list')('p' as never), 'workspaces:list'],
    ['workspaces.create', () => method('workspaces', 'create')('p' as never), 'workspaces:create'],
    [
      'workspaces.rename',
      () => method('workspaces', 'rename')('w' as never, 'n' as never),
      'workspaces:rename'
    ],
    ['workspaces.remove', () => method('workspaces', 'remove')('w' as never), 'workspaces:remove'],
    [
      'workspaces.hasChanges',
      () => method('workspaces', 'hasChanges')('w' as never),
      'workspaces:hasChanges'
    ],
    ['workspaces.diff', () => method('workspaces', 'diff')('w' as never), 'workspaces:diff'],
    [
      'workspaces.revertFile',
      () => method('workspaces', 'revertFile')('w' as never, 'a.txt' as never),
      'workspaces:revertFile'
    ],
    [
      'workspaces.pullRequest',
      () => method('workspaces', 'pullRequest')('w' as never),
      'workspaces:pullRequest'
    ],
    [
      'workspaces.createPullRequest',
      () => method('workspaces', 'createPullRequest')('w' as never, {} as never),
      'workspaces:createPullRequest'
    ],
    [
      'workspaces.draftPullRequest',
      () => method('workspaces', 'draftPullRequest')('w' as never),
      'workspaces:draftPullRequest'
    ],
    [
      'workspaces.commitAndPush',
      () => method('workspaces', 'commitAndPush')('w' as never, 'Add a thing' as never),
      'workspaces:commitAndPush'
    ],
    [
      'workspaces.pullRequestDetail',
      () => method('workspaces', 'pullRequestDetail')('w' as never, 7 as never),
      'workspaces:pullRequestDetail'
    ],
    [
      'workspaces.closePullRequest',
      () => method('workspaces', 'closePullRequest')('w' as never, 7 as never),
      'workspaces:closePullRequest'
    ],
    [
      'workspaces.mergePullRequest',
      () => method('workspaces', 'mergePullRequest')('w' as never, 7 as never, 'squash' as never),
      'workspaces:mergePullRequest'
    ],
    [
      'workspaces.instruction',
      () => method('workspaces', 'instruction')('w' as never, 'pullRequest' as never),
      'instructions:effective'
    ],
    ['files.open', () => method('files', 'open')('w' as never, 'a.ts' as never), 'files:open'],
    ['chats.list', () => method('chats', 'list')('w' as never), 'chats:list'],
    ['chats.open', () => method('chats', 'open')('w' as never), 'chats:open'],
    ['chats.create', () => method('chats', 'create')('w' as never), 'chats:create'],
    ['chats.fork', () => method('chats', 'fork')('c' as never), 'chats:fork'],
    ['chats.close', () => method('chats', 'close')('c' as never), 'chats:close'],
    [
      'chats.rename',
      () => method('chats', 'rename')('c' as never, 'auth' as never),
      'chats:rename'
    ],
    ['chats.history', () => method('chats', 'history')('c' as never), 'chats:history'],
    ['chats.send', () => method('chats', 'send')('c' as never, 'hi' as never), 'chats:send'],
    ['chats.interrupt', () => method('chats', 'interrupt')('c' as never), 'chats:interrupt'],
    [
      'chats.setWorkingMode',
      () => method('chats', 'setWorkingMode')('c' as never, 'acceptEdits' as never),
      'chats:mode'
    ],
    [
      'chats.setPlanMode',
      () => method('chats', 'setPlanMode')('c' as never, true as never),
      'chats:planMode'
    ],
    [
      'chats.setEffort',
      () => method('chats', 'setEffort')('c' as never, 'xhigh' as never),
      'chats:effort'
    ],
    [
      'chats.setModel',
      () => method('chats', 'setModel')('c' as never, 'claude-opus-5' as never),
      'chats:model'
    ],
    [
      'chats.setPlanModel',
      () => method('chats', 'setPlanModel')('c' as never, 'claude-opus-5' as never),
      'chats:planModel'
    ],
    ['chats.models', () => method('chats', 'models')(), 'chats:models'],
    ['chats.commands', () => method('chats', 'commands')('c' as never), 'chats:commands'],
    [
      'chats.answerQuestions',
      () => method('chats', 'answerQuestions')('r-1' as never, [] as never),
      'chats:answerQuestions'
    ],
    [
      'chats.pendingPermission',
      () => method('chats', 'pendingPermission')('c' as never),
      'chats:pending'
    ],
    ['chats.usage', () => method('chats', 'usage')('c' as never), 'chats:usage'],
    [
      'chats.answerPermission',
      () => method('chats', 'answerPermission')('r' as never, 'allow' as never),
      'chats:permission'
    ],
    ['chats.rateLimit', () => method('chats', 'rateLimit')(), 'chats:rateLimit'],
    ['chats.subscription', () => method('chats', 'subscription')(), 'chats:subscription'],
    [
      'chats.refreshSubscription',
      () => method('chats', 'refreshSubscription')(),
      'chats:refreshSubscription'
    ],
    ['accounts.status', () => method('accounts', 'status')(), 'accounts:status'],
    ['accounts.github', () => method('accounts', 'github')(), 'accounts:github'],
    [
      'dialog.pickDirectory',
      () => method('dialog', 'pickDirectory')('t' as never),
      'dialog:pickDirectory'
    ],
    ['dialog.pickSkill', () => method('dialog', 'pickSkill')('t' as never), 'dialog:pickSkill'],
    ['skills.list', () => method('skills', 'list')({ kind: 'global' } as never), 'skills:list'],
    [
      'skills.read',
      () => method('skills', 'read')({ kind: 'global' } as never, 'review' as never),
      'skills:read'
    ],
    [
      'skills.save',
      () =>
        method('skills', 'save')(
          { kind: 'global' } as never,
          'review' as never,
          { kind: 'raw', text: '' } as never
        ),
      'skills:save'
    ],
    [
      'skills.remove',
      () => method('skills', 'remove')({ kind: 'global' } as never, 'review' as never),
      'skills:remove'
    ],
    [
      'skills.import',
      () =>
        method('skills', 'import')(
          { kind: 'global' } as never,
          { kind: 'text', text: '' } as never
        ),
      'skills:import'
    ],
    ['skills.forChat', () => method('skills', 'forChat')('c' as never), 'skills:forChat'],
    [
      'skills.setForChat',
      () => method('skills', 'setForChat')('c' as never, 'k' as never, false as never),
      'skills:setForChat'
    ],
    ['terminal.create', () => method('terminal', 'create')({} as never), 'terminal:create']
  ]

  for (const [name, call, channel] of CALLS) {
    it(`${name} talks to ${channel}`, () => {
      call()
      expect(invoke.mock.calls[0]?.[0]).toBe(channel)
    })
  }
})

describe('arguments reach main unchanged', () => {
  it('passes the project id and patch through', () => {
    method('projects', 'update')('planner' as never, { name: 'x' } as never)
    expect(invoke).toHaveBeenCalledWith('projects:update', 'planner', { name: 'x' })
  })

  it('passes removal options through', () => {
    method('workspaces', 'remove')('planner/anna' as never, { force: true } as never)
    expect(invoke).toHaveBeenCalledWith('workspaces:remove', 'planner/anna', { force: true })
  })
})

describe('subscriptions', () => {
  // A component that unmounts without unsubscribing leaks a listener, and the
  // next event reaches a handler holding a dead reference.
  it('theme.onChange returns an unsubscribe that removes the listener', () => {
    const stop = method('theme', 'onChange')(vi.fn() as never) as () => void

    expect(on).toHaveBeenCalledWith('theme:changed', expect.any(Function))
    stop()
    expect(off).toHaveBeenCalledWith('theme:changed', expect.any(Function))
  })

  // The raw Electron event is deliberately not passed on: the renderer has no
  // use for it, and handing it over would leak the transport into the UI.
  it('theme.onChange delivers only the theme', () => {
    const handler = vi.fn()
    method('theme', 'onChange')(handler as never)

    const listener = on.mock.calls.find(([channel]) => channel === 'theme:changed')?.[1] as (
      event: unknown,
      theme: unknown
    ) => void

    listener({}, 'dark')
    expect(handler).toHaveBeenCalledWith('dark')
  })

  it('terminal.onData delivers the payload without the raw event', () => {
    const handler = vi.fn()
    method('terminal', 'onData')(handler as never)

    const listener = on.mock.calls.find(([channel]) => channel === 'terminal:data')?.[1] as (
      event: unknown,
      payload: unknown
    ) => void

    listener({}, { id: 'term-1', data: 'hello' })
    expect(handler).toHaveBeenCalledWith({ id: 'term-1', data: 'hello' })
  })

  // A component that unmounts without unsubscribing leaks a listener, and the
  // next chunk of output reaches a handler holding a dead reference.
  it('terminal.onData unsubscribes', () => {
    const stop = method('terminal', 'onData')(vi.fn() as never) as () => void

    stop()
    expect(off).toHaveBeenCalledWith('terminal:data', expect.any(Function))
  })

  it('settings.onOpen unsubscribes too', () => {
    const stop = method('settings', 'onOpen')(vi.fn() as never) as () => void

    expect(on).toHaveBeenCalledWith('settings:open', expect.any(Function))
    stop()
    expect(off).toHaveBeenCalled()
  })
})

describe('the rest of the surface', () => {
  // Every method is a channel name that must match main/ipc.ts. Calling each
  // one is the only way to find a name that drifted.
  const REMAINING: readonly [string, string, () => unknown][] = [
    ['accounts', 'signOut', () => method('accounts', 'signOut')('github' as never, null as never)],
    ['terminal', 'write', () => method('terminal', 'write')('t' as never, 'x' as never)],
    [
      'terminal',
      'resize',
      () => method('terminal', 'resize')('t' as never, 80 as never, 24 as never)
    ],
    ['terminal', 'dispose', () => method('terminal', 'dispose')('t' as never)],
    [
      'projects',
      'saveInstruction',
      () =>
        method('projects', 'saveInstruction')('p' as never, 'pullRequest' as never, 'x' as never)
    ],
    ['projects', 'addFromGitHub', () => method('projects', 'addFromGitHub')({} as never)]
  ]

  for (const [groupName, name, call] of REMAINING) {
    it(`${groupName}.${name} reaches main`, () => {
      call()
      expect(invoke).toHaveBeenCalled()
    })
  }

  // Sign-in is interactive, so the argv is built here and hosted in a terminal
  // rather than run behind the user's back.
  it('builds the sign-in command locally instead of calling main', () => {
    const claude = method('accounts', 'signInCommand')('claude' as never)
    const github = method('accounts', 'signInCommand')('github' as never)

    expect(claude).toEqual(['claude', 'auth', 'login'])
    expect(github).toEqual(['gh', 'auth', 'login'])
    expect(invoke).not.toHaveBeenCalled()
  })

  it('terminal.onExit delivers the exit and unsubscribes', () => {
    const handler = vi.fn()
    const stop = method('terminal', 'onExit')(handler as never) as () => void

    const listener = on.mock.calls.find(([channel]) => channel === 'terminal:exit')?.[1] as (
      event: unknown,
      payload: unknown
    ) => void

    listener({}, { id: 'term-1', exitCode: 0 })
    expect(handler).toHaveBeenCalledWith({ id: 'term-1', exitCode: 0 })

    stop()
    expect(off).toHaveBeenCalledWith('terminal:exit', expect.any(Function))
  })

  it('settings.onOpen notifies without a payload', () => {
    const handler = vi.fn()
    method('settings', 'onOpen')(handler as never)

    const listener = on.mock.calls.find(
      ([channel]) => channel === 'settings:open'
    )?.[1] as () => void

    listener()
    expect(handler).toHaveBeenCalledWith()
  })
  it('chats.onEvent delivers the envelope and unsubscribes', () => {
    const handler = vi.fn()
    const stop = method('chats', 'onEvent')(handler as never) as () => void

    const listener = on.mock.calls.find(([channel]) => channel === 'chats:event')?.[1] as (
      event: unknown,
      payload: unknown
    ) => void

    const envelope = {
      chatId: 'chat-1',
      workspaceId: 'planner/kyiv',
      event: { type: 'text', text: 'there' }
    }
    listener({}, envelope)
    expect(handler).toHaveBeenCalledWith(envelope)

    stop()
    expect(off).toHaveBeenCalledWith('chats:event', expect.any(Function))
  })

  // A third stream, because a conversation's state moves at moments neither of
  // the other two describe: an interrupt, an answered permission, a closed tab.
  it('chats.onStatus delivers the status and unsubscribes', () => {
    const handler = vi.fn()
    const stop = method('chats', 'onStatus')(handler as never) as () => void

    const listener = on.mock.calls.find(([channel]) => channel === 'chats:status')?.[1] as (
      event: unknown,
      payload: unknown
    ) => void

    const status = { chatId: 'chat-1', workspaceId: 'planner/kyiv', status: 'running' }
    listener({}, status)
    expect(handler).toHaveBeenCalledWith(status)

    stop()
    expect(off).toHaveBeenCalledWith('chats:status', expect.any(Function))
  })

  // A second stream, because the list that draws this is not looking at a chat.
  it('workspaces.onStatus delivers the status and unsubscribes', () => {
    const handler = vi.fn()
    const stop = method('workspaces', 'onStatus')(handler as never) as () => void

    const listener = on.mock.calls.find(([channel]) => channel === 'workspaces:status')?.[1] as (
      event: unknown,
      payload: unknown
    ) => void

    const status = { workspaceId: 'planner/kyiv', status: 'running' }
    listener({}, status)
    expect(handler).toHaveBeenCalledWith(status)

    stop()
    expect(off).toHaveBeenCalledWith('workspaces:status', expect.any(Function))
  })
})
