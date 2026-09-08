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
  },
  webUtils: {
    getPathForFile: (file: File): string => `/dropped/${file.name}`
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
      'attachments',
      'chats',
      'config',
      'dialog',
      'files',
      'library',
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
      'projects.cliPermissions',
      () => method('projects', 'cliPermissions')('p' as never),
      'permissions:cli'
    ],
    [
      'projects.declaredCarryFiles',
      () => method('projects', 'declaredCarryFiles')('p' as never),
      'carry:declared'
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
      'workspaces.fileSides',
      () => method('workspaces', 'fileSides')('w' as never),
      'workspaces:fileSides'
    ],
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
      'workspaces.replyToReviewThread',
      () =>
        method('workspaces', 'replyToReviewThread')('w' as never, 'PRRT_1' as never, 'ok' as never),
      'workspaces:replyToReviewThread'
    ],
    [
      'workspaces.setReviewThreadResolved',
      () =>
        method('workspaces', 'setReviewThreadResolved')(
          'w' as never,
          'PRRT_1' as never,
          true as never
        ),
      'workspaces:resolveReviewThread'
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
      'chats.setPlanEffort',
      () => method('chats', 'setPlanEffort')('c' as never, 'high' as never),
      'chats:planEffort'
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
    [
      'chats.answerElicitation',
      () => method('chats', 'answerElicitation')('r-1' as never, 'decline' as never),
      'chats:elicitation'
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
    [
      'dialog.pickMarkdown',
      () => method('dialog', 'pickMarkdown')('t' as never),
      'dialog:pickMarkdown'
    ],
    ['dialog.pickFiles', () => method('dialog', 'pickFiles')('t' as never), 'dialog:pickFiles'],
    [
      'attachments.paste',
      () => method('attachments', 'paste')('image/png' as never, new Uint8Array() as never),
      'attachments:paste'
    ],
    ['attachments.measure', () => method('attachments', 'measure')(), 'attachments:measure'],
    ['attachments.clear', () => method('attachments', 'clear')(), 'attachments:clear'],
    [
      'library.list',
      () => method('library', 'list')({ kind: 'global' } as never, 'command' as never),
      'library:list'
    ],
    [
      'library.read',
      () =>
        method('library', 'read')({ kind: 'global' } as never, 'command' as never, 'ship' as never),
      'library:read'
    ],
    [
      'library.save',
      () =>
        method('library', 'save')(
          { kind: 'global' } as never,
          'command' as never,
          'ship' as never,
          'text' as never
        ),
      'library:save'
    ],
    [
      'library.create',
      () =>
        method('library', 'create')(
          { kind: 'global' } as never,
          'command' as never,
          'ship' as never,
          'text' as never
        ),
      'library:create'
    ],
    [
      'library.remove',
      () =>
        method('library', 'remove')(
          { kind: 'global' } as never,
          'command' as never,
          'ship' as never
        ),
      'library:remove'
    ],
    [
      'library.rename',
      () =>
        method('library', 'rename')(
          { kind: 'global' } as never,
          'command' as never,
          'ship' as never,
          'gate' as never
        ),
      'library:rename'
    ],
    [
      'library.inspect',
      () => method('library', 'inspect')('command' as never, { kind: 'text', text: '' } as never),
      'library:inspect'
    ],
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
      'skills.rename',
      () =>
        method('skills', 'rename')(
          { kind: 'global' } as never,
          'review' as never,
          'reviewer' as never
        ),
      'skills:rename'
    ],
    [
      'skills.inspect',
      () =>
        method('skills', 'inspect')(
          { kind: 'global' } as never,
          { kind: 'text', text: '' } as never
        ),
      'skills:inspect'
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
    [
      'skills.inRepository',
      () => method('skills', 'inRepository')('w' as never),
      'skills:inRepository'
    ],
    ['skills.forChat', () => method('skills', 'forChat')('c' as never), 'skills:forChat'],
    [
      'skills.forWorkspace',
      () => method('skills', 'forWorkspace')('w' as never),
      'skills:forWorkspace'
    ],
    [
      'skills.setForChat',
      () => method('skills', 'setForChat')('c' as never, 'k' as never, false as never),
      'skills:setForChat'
    ],
    ['terminal.create', () => method('terminal', 'create')({} as never), 'terminal:create'],
    [
      'accounts.signOut',
      () => method('accounts', 'signOut')('github' as never, null as never),
      'accounts:signOut'
    ],
    [
      'terminal.write',
      () => method('terminal', 'write')('t' as never, 'x' as never),
      'terminal:write'
    ],
    [
      'terminal.resize',
      () => method('terminal', 'resize')('t' as never, 80 as never, 24 as never),
      'terminal:resize'
    ],
    ['terminal.dispose', () => method('terminal', 'dispose')('t' as never), 'terminal:dispose'],
    [
      'projects.saveInstruction',
      () =>
        method('projects', 'saveInstruction')('p' as never, 'pullRequest' as never, 'x' as never),
      'instructions:save'
    ],
    [
      'projects.addFromGitHub',
      () => method('projects', 'addFromGitHub')({} as never),
      'projects:addFromGitHub'
    ]
  ]

  /*
   * Every method on the bridge is either in the table above or named here.
   *
   * The table catches a name that drifted. This catches a method that never
   * reached the table — which is the hole six channels sat in, and closing them
   * by hand does nothing about the seventh. `ipc.test.ts` has had this half all
   * along (`bench.handlers.size` against `EXPECTED.length`); this side had
   * nothing.
   *
   * Exempt because they do not invoke: the subscription pairs go through
   * `ipcRenderer.on`, whose channels are asserted one by one below,
   * `signInCommand` builds an argv locally on purpose, and `pathFor` answers
   * from `webUtils` on this side of the bridge — which is the whole reason it
   * is a method here rather than something the window works out itself.
   */
  const NOT_CALLS: readonly string[] = [
    'theme.onChange',
    'config.onChange',
    'settings.onOpen',
    'chats.onEvent',
    'chats.onStatus',
    'chats.onChanged',
    'chats.onUsageWindows',
    'workspaces.onStatus',
    'terminal.onData',
    'terminal.onExit',
    'accounts.signInCommand',
    'attachments.pathFor'
  ]

  it('names every method on the bridge, in the table or in the exemptions', () => {
    const exposed = Object.entries(api).flatMap(([groupName, group]) =>
      Object.keys(group).map((name) => `${groupName}.${name}`)
    )
    const covered = new Set([...CALLS.map(([name]) => name), ...NOT_CALLS])

    expect(exposed.filter((name) => !covered.has(name))).toEqual([])
    // And nothing is exempted that has since gone, or the list outlives its
    // reason the way the array this replaces did.
    expect(NOT_CALLS.filter((name) => !exposed.includes(name))).toEqual([])
  })

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

  // The channel a window has no other way to hear from: it reads the config on
  // mount and otherwise only from its own update's reply.
  it('config.onChange listens on its channel and stops when told', () => {
    const handler = vi.fn()
    const stop = method('config', 'onChange')(handler as never) as () => void

    const listener = on.mock.calls.find(([channel]) => channel === 'config:changed')?.[1] as (
      event: unknown,
      config: unknown
    ) => void
    listener({}, { cloneDirectory: '/Users/x/code' })

    expect(handler).toHaveBeenCalledWith({ cloneDirectory: '/Users/x/code' })
    stop()
    expect(off).toHaveBeenCalledWith('config:changed', expect.any(Function))
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

  /*
   * The block at the foot of the sidebar. Pushed rather than asked for, which
   * is what stopped it drawing the previous turn's figure — so the delivery and
   * the unsubscribe are both worth a test.
   */
  it('chats.onUsageWindows delivers the reading and unsubscribes', () => {
    const handler = vi.fn()
    const stop = method('chats', 'onUsageWindows')(handler as never) as () => void

    const listener = on.mock.calls.find(([channel]) => channel === 'usage:windows')?.[1] as (
      event: unknown,
      windows: unknown
    ) => void

    listener({}, { limits: [], limitsApply: true, readAt: 'now' })
    expect(handler).toHaveBeenCalledWith({ limits: [], limitsApply: true, readAt: 'now' })

    stop()
    expect(off).toHaveBeenCalledWith('usage:windows', expect.any(Function))
  })

  it('settings.onOpen unsubscribes too', () => {
    const stop = method('settings', 'onOpen')(vi.fn() as never) as () => void

    expect(on).toHaveBeenCalledWith('settings:open', expect.any(Function))
    stop()
    expect(off).toHaveBeenCalled()
  })
})

describe('the rest of the surface', () => {
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

  // A fifth stream, because a conversation appearing or going is not a status:
  // a second window on the same workspace has to redraw its strip.
  it('chats.onChanged delivers the workspace and unsubscribes', () => {
    const handler = vi.fn()
    const stop = method('chats', 'onChanged')(handler as never) as () => void

    const listener = on.mock.calls.find(([channel]) => channel === 'chats:changed')?.[1] as (
      event: unknown,
      payload: unknown
    ) => void

    listener({}, { workspaceId: 'planner/kyiv' })
    expect(handler).toHaveBeenCalledWith({ workspaceId: 'planner/kyiv' })

    stop()
    expect(off).toHaveBeenCalledWith('chats:changed', expect.any(Function))
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

/*
 * The one method on the bridge that answers rather than invoking.
 *
 * A `File` in the renderer stopped carrying a path years ago, and `webUtils` is
 * the replacement — it has to be called on this side, which is the whole reason
 * this is a method here rather than something the window works out itself.
 */
describe('where a dropped file actually is', () => {
  it('answers from webUtils rather than from the file', () => {
    const pathFor = api.attachments?.pathFor as ((file: File) => string) | undefined

    expect(pathFor?.(new File(['x'], 'shot.png'))).toBe('/dropped/shot.png')
  })
})
