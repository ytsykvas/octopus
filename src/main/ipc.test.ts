import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { OpenDialogOptions } from 'electron'

import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import type * as AccountsModule from '../core/accounts.js'
import {
  type AccountsStatus,
  checkAccounts,
  checkGitHubAccount,
  type CommandExec,
  signOut
} from '../core/accounts.js'
import type { QueryFn } from '../core/agent.js'
import type { Config } from '../core/config.js'
import { MAX_PASTE_BYTES } from '../core/attachments.js'
import type { RemoteRepository } from '../core/github.js'
import {
  createService as makeService,
  type OctopusService,
  type ServiceOptions
} from '../core/service.js'
import type {
  ChatEvent,
  ChatsChangedEvent,
  ChatStatusEvent,
  TasksEvent,
  WorkspaceStatusEvent
} from '../core/service.js'
import { SIDE_HISTORY_LIMIT } from '../core/sideQuestions.js'
import { TAIL_CHARS, type RecordedRun } from '../core/runLog.js'
import type { Workspace } from '../core/store.js'
import type { ThemeName } from '../core/types.js'
import type { UsageWindows } from '../core/usage.js'
import { type IpcHost, registerIpc, type PickedDirectory } from './ipc.js'
import type { Result } from './result.js'
import type { TerminalManager } from './terminals.js'

/**
 * The account calls are the one part of the table that cannot run for real:
 * `accounts:status` and `accounts:github` shell out to `claude` and `gh`, and
 * `accounts:signOut` would drop whoever runs the suite from their own CLI
 * session.
 */
vi.mock('../core/accounts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof AccountsModule>()),
  checkAccounts: vi.fn(),
  checkGitHubAccount: vi.fn(),
  signOut: vi.fn()
}))

const run = promisify(execFile)

/**
 * A stand-in for the Electron surface the IPC layer touches.
 *
 * Nine small functions instead of a framework — which is the point of injecting
 * them: the whole channel table can be exercised without a window.
 */
interface Harness {
  readonly host: IpcHost
  readonly handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
  readonly broadcasts: ThemeName[]
  readonly chatEvents: ChatEvent[]
  readonly statusEvents: WorkspaceStatusEvent[]
  readonly chatStatusEvents: ChatStatusEvent[]
  /** Every announcement that a workspace's set of conversations moved. */
  readonly chatsChangedEvents: ChatsChangedEvent[]
  /** Every push of a conversation's background agents. */
  readonly taskEvents: TasksEvent[]
  /** Every config a write announced, so a window that made no call can learn. */
  readonly configBroadcasts: Config[]
  /** Paths handed to the system, in order. */
  readonly opened: string[]
  picked: PickedDirectory
  prefersDark: boolean
  /** What the system says about the next open; empty means it worked. */
  openRefusal: string
  /** What each picker was opened with, so a test can name the shapes it takes. */
  dialogOptions: OpenDialogOptions[]
  /** Every account reading pushed at the windows, newest last. */
  usageBroadcasts: UsageWindows[]
  /** null once the window a call came from has closed, as Electron reports it. */
  window: unknown
}

function harness(): Harness {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const broadcasts: ThemeName[] = []
  const chatEvents: ChatEvent[] = []
  const statusEvents: WorkspaceStatusEvent[] = []
  const chatStatusEvents: ChatStatusEvent[] = []
  const chatsChangedEvents: ChatsChangedEvent[] = []
  const taskEvents: TasksEvent[] = []
  const configBroadcasts: Config[] = []
  const opened: string[] = []
  const dialogOptions: OpenDialogOptions[] = []
  const usageBroadcasts: UsageWindows[] = []

  const state: Harness = {
    handlers,
    broadcasts,
    chatEvents,
    statusEvents,
    chatStatusEvents,
    chatsChangedEvents,
    taskEvents,
    configBroadcasts,
    opened,
    dialogOptions,
    usageBroadcasts,
    picked: { canceled: true, filePaths: [] },
    prefersDark: false,
    openRefusal: '',
    window: {},
    host: {
      handle: (channel, handler) => {
        handlers.set(channel, handler as (event: unknown, ...args: unknown[]) => unknown)
      },
      showOpenDialog: (options) => {
        dialogOptions.push(options)
        return Promise.resolve(state.picked)
      },
      windowFor: () => state.window,
      prefersDark: () => state.prefersDark,
      broadcastTheme: (theme) => broadcasts.push(theme),
      broadcastChatEvent: (event) => chatEvents.push(event),
      broadcastWorkspaceStatus: (event) => statusEvents.push(event),
      broadcastUsageWindows: (windows) => usageBroadcasts.push(windows),
      broadcastChatStatus: (event) => chatStatusEvents.push(event),
      broadcastChatsChanged: (event) => chatsChangedEvents.push(event),
      broadcastTasks: (event) => taskEvents.push(event),
      broadcastConfig: (config) => configBroadcasts.push(config),
      openPath: (path) => {
        opened.push(path)
        return Promise.resolve(state.openRefusal)
      }
    }
  }

  return state
}

/**
 * The session methods as plain spies.
 *
 * A PTY is a real process, so the manager is stubbed — and these three
 * channels forward without answering, so a spy is the only observable effect.
 */
interface TerminalSpies {
  readonly write: Mock<(id: string, data: string) => void>
  readonly resize: Mock<(id: string, cols: number, rows: number) => void>
  readonly dispose: Mock<(id: string) => void>
  readonly lastRuns: Mock<(workspaceId: string) => RecordedRun[]>
  readonly forgetRuns: Mock<(workspaceId: string) => void>
  readonly refuse: Mock<(workspaceId: string, purpose: string, reason: string) => void>
}

function terminalsStub(): { manager: TerminalManager; sessions: TerminalSpies } {
  const sessions: TerminalSpies = {
    write: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    lastRuns: vi.fn((): RecordedRun[] => []),
    forgetRuns: vi.fn(),
    refuse: vi.fn()
  }

  // Enough of a manager to answer `list`, so a test about the channel can read
  // back what the parse made of the spec it was given.
  const live: { id: string; owner: unknown }[] = []

  return {
    manager: {
      create: vi.fn((spec: { owner: unknown }) => {
        const id = `term-${String(live.length + 1)}`
        live.push({ id, owner: spec.owner })

        return id
      }),
      list: vi.fn(() => [...live]),
      leaders: vi.fn(() => live.map(({ owner }, index) => ({ pid: 500 + index, owner }))),
      ...sessions,
      disposeAll: vi.fn(),
      disposeFor: vi.fn(() => Promise.resolve()),
      size: 0
    } as unknown as TerminalManager,
    sessions
  }
}

let dir: string
let service: OctopusService
let terminals: TerminalManager
let sessions: TerminalSpies
let bench: Harness

/** Invokes a channel the way the renderer would. */
function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = bench.handlers.get(channel)
  if (!handler) throw new Error(`no handler registered for ${channel}`)
  return Promise.resolve(handler({ sender: {} }, ...args))
}

/**
 * Creates a workspace through the channel and hands back the record.
 *
 * The later assertions need its id and path, and a failure here should say so
 * rather than surface as an undefined property three lines down.
 */
async function createWorkspace(projectId: string): Promise<Workspace> {
  const result = (await invoke('workspaces:create', projectId)) as Result<Workspace>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function servicePaths(root: string): ServiceOptions {
  return {
    stateFilePath: join(root, 'state.json'),
    stateTempFilePath: join(root, 'state.json.tmp'),
    configFilePath: join(root, 'config.json'),
    // Without this, worktrees would land in the real ~/.octopus.
    dataRoot: join(root, 'data')
  }
}

/**
 * Points the channel table at a service the test builds for itself.
 *
 * Needed where a handler reaches `gh`: the executor is a constructor argument,
 * so the only way to keep the real one out is to build another service.
 */
async function useService(options: Partial<ServiceOptions>): Promise<OctopusService> {
  const replacement = await createService({ ...servicePaths(dir), ...options })
  registerIpc(replacement, terminals, bench.host)
  return replacement
}

/** A real repository, since every project handler reaches actual git. */
async function initRepo(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: path })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  await run('git', ['config', 'user.name', 'Test'], { cwd: path })
  await writeFile(join(path, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: path })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: path })
}

/** A project added the way the renderer would, so its id is a real one. */
async function addProject(name = 'planner'): Promise<string> {
  const repo = join(dir, name)
  await initRepo(repo)
  const project = await service.addProjectFromPath(repo)
  return project.id
}

const REPOSITORY: RemoteRepository = {
  name: 'planner',
  nameWithOwner: 'ytsykvas/planner',
  owner: { login: 'ytsykvas' },
  description: null,
  isPrivate: false,
  updatedAt: '2026-08-08T00:00:00Z',
  defaultBranchRef: { name: 'main' }
}

/**
 * A `gh` that builds a real repository where a clone would land.
 *
 * An executor that merely reported success would prove nothing: the project is
 * validated against git immediately afterwards.
 */
const cloningExec: CommandExec = async (_command, args) => {
  if (args[0] === 'repo' && args[1] === 'clone') {
    const target = args[3]
    if (target !== undefined) await initRepo(target)
  }
  return ''
}

const CONNECTED: AccountsStatus = {
  claude: {
    connected: true,
    email: 'dev@example.com',
    authMethod: 'oauth',
    subscriptionType: 'max',
    orgName: null
  },
  github: { connected: false, login: null, name: null, seesOrganisations: null }
}

/**
 * Every service this file makes, so teardown can stop them all.
 *
 * A wrapper rather than a change at each call site, and the name is the
 * imported one so nothing else here knows the difference.
 */
const started: OctopusService[] = []

async function createService(options: ServiceOptions = {}): Promise<OctopusService> {
  // Not the machine's own `~/.claude` and environment, which the default reads
  // — and never the real plugin CLI, which would write into that `~/.claude`.
  const made = await makeService({
    windowOverride: () => Promise.resolve(null),
    pluginCli: () => Promise.reject(new Error('the plugin CLI is not run in tests')),
    // Nor the machine's ports, where a dev server can hold the one a test expects.
    listening: () => Promise.resolve(false),
    ...options
  })
  started.push(made)
  return made
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-ipc-'))
  service = await createService(servicePaths(dir))

  vi.mocked(checkAccounts).mockReset().mockResolvedValue(CONNECTED)
  vi.mocked(checkGitHubAccount).mockReset().mockResolvedValue({
    connected: true,
    login: 'ytsykvas',
    name: 'Yurii',
    seesOrganisations: true
  })
  vi.mocked(signOut).mockReset().mockResolvedValue(true)

  bench = harness()
  const stub = terminalsStub()
  terminals = stub.manager
  sessions = stub.sessions
  registerIpc(service, terminals, bench.host)
})

afterEach(async () => {
  // Stopped before the directory goes: a service writes from event handlers
  // with nothing awaiting them, and a write still running when `rm` starts
  // fails in whichever test the runner tears down next rather than in this one.
  await Promise.allSettled(started.map((one) => one.closeChats()))
  started.length = 0

  await rm(dir, { recursive: true, force: true })
})

describe('channel table', () => {
  // The renderer calls these by name. A channel that stops being registered
  // fails at runtime with nothing but "no handler", far from the cause.
  const EXPECTED = [
    'theme:get',
    'config:get',
    'config:update',
    'config:edit',
    'projects:list',
    'projects:add',
    'projects:update',
    'projects:edit',
    'projects:reorder',
    'projects:remove',
    'projects:branches',
    'projects:pullRequests',
    'projects:listRemote',
    'projects:addFromGitHub',
    'scripts:read',
    'scripts:save',
    'scripts:paths',
    'carry:read',
    'carry:save',
    'permissions:cli',
    'repoConfig:read',
    'repoConfig:export',
    'workspace:prepare',
    'env:profiles',
    'env:read',
    'env:save',
    'env:create',
    'env:rename',
    'env:remove',
    'workspaces:envProfile',
    'env:ignored',
    'instructions:sources',
    'trust:read',
    'sources:read',
    'trust:project',
    'trust:approve',
    'scripts:resolved',
    'scripts:project',
    'scripts:approve',
    'workspace:env',
    'workspaces:serving',
    'resources:read',
    'workspaces:port',
    'workspaces:strays',
    'workspaces:stopStrays',
    'instructions:read',
    'instructions:save',
    'instructions:effective',
    'workspaces:helpContext',
    'skills:list',
    'skills:read',
    'skills:save',
    'skills:remove',
    'skills:rename',
    'skills:inspect',
    'skills:import',
    'skills:inRepository',
    'skills:forChat',
    'skills:forWorkspace',
    'skills:setForChat',
    'plugins:list',
    'plugins:catalog',
    'plugins:install',
    'plugins:uninstall',
    'plugins:setEnabled',
    'plugins:connectOfficial',
    'plugins:refresh',
    'library:list',
    'library:read',
    'library:save',
    'library:create',
    'library:remove',
    'library:rename',
    'library:inspect',
    'dialog:pickSkill',
    'dialog:pickMarkdown',
    'dialog:pickFiles',
    'attachments:paste',
    'attachments:measure',
    'attachments:clear',
    'workspaces:list',
    'workspaces:read',
    'workspaces:create',
    'workspaces:rename',
    'workspaces:notes',
    'workspaces:remove',
    'workspaces:hasChanges',
    'workspaces:changes',
    'workspaces:revertFile',
    'workspaces:pullRequest',
    'workspaces:createPullRequest',
    'workspaces:draftPullRequest',
    'workspaces:commitAndPush',
    'workspaces:amendAndPush',
    'workspaces:push',
    'workspaces:updateFromBase',
    'workspaces:pullRequestDetail',
    'workspaces:mergePullRequest',
    'workspaces:closePullRequest',
    'workspaces:rerunChecks',
    'workspaces:replyToReviewThread',
    'workspaces:resolveReviewThread',
    'files:open',
    'files:tree',
    'files:directory',
    'files:read',
    'chats:list',
    'chats:open',
    'chats:create',
    'chats:fork',
    'chats:close',
    'chats:closed',
    'chats:reopen',
    'chats:rewindPreview',
    'chats:rewind',
    'chats:rename',
    'chats:history',
    'chats:send',
    'chats:interrupt',
    'tasks:list',
    'tasks:stop',
    'chats:mode',
    'chats:planMode',
    'chats:setEfforts',
    'chats:autoCompact',
    'chats:setModels',
    'chats:models',
    'chats:commands',
    'chats:agents',
    'chats:answerQuestions',
    'chats:pending',
    'chats:usage',
    'chats:sideQuestion',
    'chats:permission',
    'chats:elicitation',
    'chats:rateLimit',
    'chats:subscription',
    'chats:refreshSubscription',
    'terminal:create',
    'terminal:write',
    'terminal:resize',
    'terminal:dispose',
    'terminal:list',
    'terminal:refused',
    'accounts:status',
    'accounts:github',
    'accounts:signOut',
    'dialog:pickDirectory'
  ]

  it('registers every channel the preload bridge calls', () => {
    for (const channel of EXPECTED) {
      expect(bench.handlers.has(channel)).toBe(true)
    }
  })

  it('registers each channel once', () => {
    expect(bench.handlers.size).toBe(EXPECTED.length)
  })
})

describe('theme', () => {
  it('follows the system when the config says system', async () => {
    bench.prefersDark = true
    await expect(invoke('theme:get')).resolves.toBe('dark')

    bench.prefersDark = false
    await expect(invoke('theme:get')).resolves.toBe('light')
  })

  // Every window has to hear about it, or one of them keeps the old palette.
  it('broadcasts the resolved theme when the config changes', async () => {
    await invoke('config:update', { theme: 'dark' })
    expect(bench.broadcasts).toContain('dark')
  })
})

describe('editing a list', () => {
  // The window hears the edited config, as it does an update.
  it('tells every window the config after an edit', async () => {
    await invoke('config:edit', { kind: 'dismissTip', id: 'tabs' })

    expect(bench.configBroadcasts.at(-1)).toMatchObject({ dismissedTips: ['tabs'] })
  })

  it('refuses an edit of a shape it does not know', async () => {
    await expect(invoke('config:edit', { kind: 'dismissTip', id: '' })).resolves.toMatchObject({
      ok: false
    })
  })

  // An empty key is one the stored state would take, so only the parse here
  // can refuse it — which is what this is asserting.
  it('refuses a project edit the record would have taken', async () => {
    const projectId = await addProject()

    await expect(
      invoke('projects:edit', projectId, { kind: 'skillDefault', key: '', enabled: false })
    ).resolves.toMatchObject({ ok: false })
    await expect(invoke('projects:list')).resolves.toMatchObject({
      ok: true,
      value: [{ disabledSkillDefaults: [] }]
    })
  })

  it('saves the order of the projects', async () => {
    const first = await addProject('planner')
    const second = await addProject('ledger')

    await expect(invoke('projects:reorder', [second, first])).resolves.toMatchObject({ ok: true })

    await expect(invoke('projects:list')).resolves.toMatchObject({
      ok: true,
      value: [{ id: second }, { id: first }]
    })
  })

  it('refuses an order that is not a list of ids', async () => {
    await expect(invoke('projects:reorder', 'planner')).resolves.toMatchObject({ ok: false })
  })

  it('applies a project edit', async () => {
    const projectId = await addProject()

    await invoke('projects:edit', projectId, {
      kind: 'skillDefault',
      key: 'review',
      enabled: false
    })

    await expect(invoke('projects:list')).resolves.toMatchObject({
      ok: true,
      value: [{ disabledSkillDefaults: ['review'] }]
    })
  })
})

describe('validation at the boundary', () => {
  // These arrive from the renderer and end up in a file, a command line or a
  // working directory. Types guarantee nothing across the process boundary.
  it('rejects a project patch with an unknown colour', async () => {
    const result = await invoke('projects:update', 'nothing', { color: 'chartreuse' })
    expect(result).toMatchObject({ ok: false })
  })

  /*
   * The patch is parsed here and nowhere else, which is where zod fills in a
   * default for every key the caller left out — and `updateProject` applies
   * anything that is not `undefined`. Every field the dialog sends is sent
   * alone, so this is the ordinary path rather than a corner of it.
   *
   * Asserted field by field on purpose. `toMatchObject` is subset matching, and
   * the tests below it pass today while the same call quietly resets six
   * others.
   */
  it('leaves the fields a patch does not carry exactly where they were', async () => {
    const projectId = await addProject()

    await invoke('projects:update', projectId, { envFile: '.env.local' })
    await invoke('projects:update', projectId, { trustRepoScripts: true })

    await invoke('projects:update', projectId, { icon: 'rocket' })

    const listed = await invoke('projects:list')
    const project = (listed as { value: { envFile: string; trustRepoScripts: boolean }[] }).value[0]
    expect(project?.envFile).toBe('.env.local')
    expect(project?.trustRepoScripts).toBe(true)
  })

  // The patch schema lists its fields one by one, and zod drops what is not
  // listed without a word — which is how the colour picker once spent a week
  // looking inert. An icon has to survive the crossing, not merely be sent.
  it('carries a chosen icon through to the stored project', async () => {
    const projectId = await addProject()

    await invoke('projects:update', projectId, { icon: 'rocket' })

    expect(await invoke('projects:list')).toMatchObject({
      ok: true,
      value: [{ id: projectId, icon: 'rocket' }]
    })
  })

  // `null` is how the dialog puts the initials back. Were it refused here, the
  // icon could be chosen but never taken off again.
  it('carries the clearing of an icon through as well', async () => {
    const projectId = await addProject()
    await invoke('projects:update', projectId, { icon: 'rocket' })

    await invoke('projects:update', projectId, { icon: null })

    expect(await invoke('projects:list')).toMatchObject({
      ok: true,
      value: [{ id: projectId, icon: null }]
    })
  })

  it('rejects a project patch with an icon nothing can draw', async () => {
    const result = await invoke('projects:update', 'nothing', { icon: 'unicorn' })
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a script kind it does not know', async () => {
    const result = await invoke('scripts:read', 'nothing', 'malicious')
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a carry list longer than a list has any business being', async () => {
    const result = await invoke('carry:save', 'nothing', '.env\n'.repeat(20_000))
    expect(result).toMatchObject({ ok: false })
  })

  // The ids name files the app reads and writes, so one the app does not know
  // is refused at the boundary rather than reaching a path.
  // It becomes a git argument and, for an untracked file, a path to unlink.
  it('rejects a revert of a path that leaves the workspace', async () => {
    const result = await invoke('workspaces:revertFile', 'nothing', '../escape.txt', null)
    expect(result).toMatchObject({ ok: false })
  })

  // A valid path for a workspace that is not there: the paths are parsed before
  // the service is reached, so this is the service refusing rather than zod.
  it('rejects a revert for a workspace it does not know', async () => {
    const result = await invoke('workspaces:revertFile', 'nothing', 'a.txt', null)
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a revert whose far end leaves the workspace', async () => {
    const result = await invoke('workspaces:revertFile', 'nothing', 'a.txt', '/etc/passwd')
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a repository item it does not know', async () => {
    const result = await invoke('repoConfig:export', 'nothing', ['script.evil'])
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a selection longer than there are items to select', async () => {
    const result = await invoke('repoConfig:export', 'nothing', Array(50).fill('carry'))
    expect(result).toMatchObject({ ok: false })
  })

  // Out, and then read live: nothing has to be brought back in by hand.
  it('carries a project settings out to its repository, where it is read', async () => {
    const projectId = await addProject('carried')

    await invoke('scripts:save', projectId, 'setup', '#!/bin/sh\nnpm ci\n')
    expect(await invoke('repoConfig:export', projectId, ['script.setup'])).toMatchObject({
      ok: true,
      value: ['script.setup']
    })

    await invoke('scripts:save', projectId, 'setup', '#!/bin/sh\nsomething else\n')

    await expect(invoke('repoConfig:read', projectId)).resolves.toMatchObject({
      ok: true,
      value: { present: true }
    })

    // The checkout's copy is the one in effect, over the project's own.
    const sources = (await invoke('sources:read', projectId, null)) as {
      value: { id: string; effective: string; layers: { layer: string; body: string }[] }[]
    }
    const setup = sources.value.find((view) => view.id === 'script.setup')
    expect(setup?.effective).toBe('repository')
    expect(setup?.layers[0]?.body).toContain('npm ci')
  })

  it('rejects an env block longer than a block has any business being', async () => {
    const result = await invoke('env:save', 'nothing', 'default', 'A=1\n'.repeat(20_000))
    expect(result).toMatchObject({ ok: false })
  })

  /*
   * The installation's own instruction, which every project falls back to. It
   * crosses the same channel with a null project rather than a channel of its
   * own — they are edited the same way, and two would be two spellings of one
   * thing that could drift.
   */
  it('carries the instruction a workspace would send across', async () => {
    const projectId = await addProject('instructed')
    const workspace = await createWorkspace(projectId)

    await invoke('instructions:save', null, 'pullRequest', 'Global rules.')
    await expect(invoke('instructions:effective', workspace.id, 'pullRequest')).resolves.toEqual({
      ok: true,
      value: 'Global rules.'
    })

    await invoke('instructions:save', projectId, 'pullRequest', 'Project rules.')
    await expect(invoke('instructions:effective', workspace.id, 'pullRequest')).resolves.toEqual({
      ok: true,
      value: 'Project rules.'
    })
  })

  it('hands Help a workspace’s facts and last runs, names and no values', async () => {
    const projectId = await addProject('masked')
    const workspace = await createWorkspace(projectId)
    await invoke('env:save', projectId, 'default', 'DATABASE_URL=postgres://u:hunter2@db/app\n')
    sessions.lastRuns.mockReturnValueOnce([
      {
        purpose: 'run',
        outcome: { kind: 'running' },
        raw: 'cannot reach postgres://u:hunter2@db/app'
      }
    ])

    const answer = await invoke('workspaces:helpContext', workspace.id)

    expect(answer).toMatchObject({
      ok: true,
      value: {
        port: workspace.port,
        portListening: false,
        variableNames: ['DATABASE_URL'],
        lastRuns: [
          { purpose: 'run', outcome: { kind: 'running' }, output: 'cannot reach [DATABASE_URL]' }
        ]
      }
    })
    expect(JSON.stringify(answer)).not.toContain('hunter2')
    expect(sessions.lastRuns).toHaveBeenCalledWith(workspace.id)
    await expect(invoke('workspaces:helpContext', 'masked/nobody')).resolves.toMatchObject({
      ok: false
    })
  })

  it('rejects an instruction body that is not a string', async () => {
    const result = await invoke('instructions:save', 'nothing', 'pullRequest', { not: 'a string' })
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a terminal spec without a working directory', async () => {
    const result = await invoke('terminal:create', { command: ['ls'] })
    expect(result).toMatchObject({ ok: false })
  })
})

describe('failures come back as results', () => {
  // A throw would cross IPC as an opaque Electron error with the message
  // mangled, so the renderer could say nothing useful about it.
  it('answers with ok:false rather than throwing', async () => {
    await expect(invoke('workspaces:create', 'no-such-project')).resolves.toMatchObject({
      ok: false
    })
  })

  it('carries a code the renderer can localise', async () => {
    const result = await invoke('projects:update', 'no-such-project', { name: 'x' })
    expect(result).toMatchObject({ ok: false })
  })
})

describe('skills', () => {
  const DOCUMENT = '---\nname: review\ndescription: When reviewing.\n---\n\n# Review\n'

  it('writes, lists, opens and removes a skill', async () => {
    const store = { kind: 'global' }

    await expect(
      invoke('skills:save', store, 'review', { kind: 'raw', text: DOCUMENT })
    ).resolves.toMatchObject({ ok: true, value: { name: 'review' } })

    await expect(invoke('skills:list', store)).resolves.toMatchObject({
      ok: true,
      value: [{ name: 'review', description: 'When reviewing.' }]
    })

    await expect(invoke('skills:read', store, 'review')).resolves.toMatchObject({
      ok: true,
      value: { body: '# Review\n' }
    })

    /*
     * Read without being written, which is the whole of what the channel is
     * for: the reader sees what an import would land before it lands. Asserted
     * against the store's own listing, because "wrote nothing" is the half a
     * preview can get wrong invisibly.
     */
    await expect(
      invoke('skills:inspect', store, {
        kind: 'text',
        text: '---\nname: ship\ndescription: Ships it.\n---\n\n# Ship\n'
      })
    ).resolves.toMatchObject({ ok: true, value: { name: 'ship', description: 'Ships it.' } })
    await expect(invoke('skills:list', store)).resolves.toMatchObject({
      ok: true,
      value: [{ name: 'review' }]
    })

    // Renamed on the way past, because both names become directories and both
    // are parsed here for that reason.
    await expect(invoke('skills:rename', store, 'review', 'reviewer')).resolves.toMatchObject({
      ok: true,
      value: { name: 'reviewer', folder: 'reviewer' }
    })
    await expect(invoke('skills:rename', store, 'reviewer', '..')).resolves.toMatchObject({
      ok: false
    })

    await expect(invoke('skills:remove', store, 'reviewer')).resolves.toMatchObject({ ok: true })
    await expect(invoke('skills:list', store)).resolves.toMatchObject({ ok: true, value: [] })
  })

  /*
   * The code is what lets the window say this in the reader's own language.
   * Without it every skill refusal arrived as the developer English thrown in
   * core, with eight translations sitting unreachable behind it — which is how
   * it shipped, because `SkillError` was missing from the list `attempt`
   * translated and nothing tested the crossing.
   *
   * A verbatim repeat of the `EnvProfileError` bug above, which is why the
   * list is no longer written by hand.
   */
  it('carries the reason a skill was refused across the boundary', async () => {
    const store = { kind: 'global' }
    await invoke('skills:save', store, 'review', { kind: 'raw', text: DOCUMENT })

    await expect(
      invoke('skills:import', store, { kind: 'text', text: DOCUMENT })
    ).resolves.toMatchObject({
      ok: false,
      code: 'skillExists',
      params: { name: 'review' }
    })

    await expect(invoke('skills:read', store, 'absent')).resolves.toMatchObject({
      ok: false,
      code: 'skillMissing'
    })
  })

  it('imports a document handed over as text', async () => {
    await expect(
      invoke('skills:import', { kind: 'global' }, { kind: 'text', text: DOCUMENT })
    ).resolves.toMatchObject({ ok: true, value: { name: 'review' } })
  })

  /*
   * The name becomes a directory under `~/.octopus` and reaches a recursive
   * delete, so it is refused here rather than anywhere further in. Types are
   * gone by this point: a renderer sending this is the case the parse exists
   * for.
   */
  it('refuses a name that would name a directory somewhere else', async () => {
    for (const name of ['../escape', 'a/b', '..']) {
      await expect(invoke('skills:read', { kind: 'global' }, name)).resolves.toMatchObject({
        ok: false
      })
      await expect(invoke('skills:remove', { kind: 'global' }, name)).resolves.toMatchObject({
        ok: false
      })
    }
  })

  it('refuses a store that is neither of the two', async () => {
    await expect(invoke('skills:list', { kind: 'somewhere' })).resolves.toMatchObject({
      ok: false
    })
    await expect(invoke('skills:list', 'global')).resolves.toMatchObject({ ok: false })
  })

  it('refuses a save that is neither shape, and an import that is none of the three', async () => {
    await expect(
      invoke('skills:save', { kind: 'global' }, 'review', { kind: 'sideways', text: '' })
    ).resolves.toMatchObject({ ok: false })
    await expect(
      invoke('skills:import', { kind: 'global' }, { kind: 'sideways' })
    ).resolves.toMatchObject({ ok: false })
  })

  it("carries a conversation's list across, and switches one of them", async () => {
    const projectId = await addProject('skilled')
    const workspace = await createWorkspace(projectId)
    await invoke('skills:save', { kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

    const opened = (await invoke('chats:open', workspace.id)) as Result<{ id: string }>
    if (!opened.ok) throw new Error(opened.error)

    await expect(invoke('skills:forChat', opened.value.id)).resolves.toMatchObject({
      ok: true,
      value: [{ key: 'review', enabled: true }]
    })

    await expect(
      invoke('skills:setForChat', opened.value.id, 'review', false)
    ).resolves.toMatchObject({ ok: true })

    await expect(invoke('skills:forChat', opened.value.id)).resolves.toMatchObject({
      ok: true,
      value: [{ key: 'review', enabled: false }]
    })
  })

  it("carries the checkout's own skills across", async () => {
    const projectId = await addProject('carried')
    const workspace = await createWorkspace(projectId)
    const path = join(workspace.path, '.claude', 'skills', 'in-repo')
    await mkdir(path, { recursive: true })
    await writeFile(
      join(path, 'SKILL.md'),
      '---\nname: in-repo\ndescription: From the checkout.\n---\n\nBody\n',
      'utf8'
    )

    await expect(invoke('skills:inRepository', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ name: 'in-repo' }]
    })
  })

  it('answers for a workspace whose conversation has not started', async () => {
    const projectId = await addProject('unspoken')
    const workspace = await createWorkspace(projectId)
    await invoke('skills:save', { kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

    await expect(invoke('skills:forWorkspace', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ key: 'review', enabled: true }]
    })
  })

  it('refuses a switch whose answer is not a yes or a no', async () => {
    await expect(invoke('skills:setForChat', 'c', 'review', 'yes')).resolves.toMatchObject({
      ok: false
    })
  })
})

describe('plugins', () => {
  const ok = `${JSON.stringify({ outcome: 'ok' })}\n`

  /** A service whose plugin CLI records what it was asked to run. */
  async function withCli(): Promise<string[][]> {
    const ran: string[][] = []
    await useService({
      pluginCli: (args, cwd) => {
        ran.push([...args, `cwd=${cwd ?? ''}`])
        const listing =
          args[1] === 'list'
            ? JSON.stringify([
                { id: 'a@m', scope: 'user', enabled: true },
                { id: 'a@m', scope: 'project', projectPath: dir, enabled: true }
              ])
            : args[2] === 'list'
              ? '[]'
              : ok
        return Promise.resolve({ stdout: listing, stderr: '' })
      }
    })
    return ran
  }

  it('carries every action through to the CLI', async () => {
    const ran = await withCli()
    const sha = 'f'.repeat(64)

    await expect(invoke('plugins:list')).resolves.toMatchObject({ ok: true })
    await expect(invoke('plugins:catalog')).resolves.toMatchObject({ ok: true })
    await expect(invoke('plugins:install', 'a@m', sha)).resolves.toMatchObject({
      ok: true,
      value: { kind: 'installed' }
    })
    await expect(
      invoke('plugins:setEnabled', 'a@m', false, { scope: 'project', projectPath: dir })
    ).resolves.toEqual({ ok: true, value: { reloaded: 0 } })
    await expect(invoke('plugins:uninstall', 'a@m', { scope: 'user' })).resolves.toMatchObject({
      ok: true
    })
    await expect(invoke('plugins:connectOfficial')).resolves.toMatchObject({ ok: true })
    await expect(invoke('plugins:refresh')).resolves.toMatchObject({ ok: true })

    expect(ran.filter((call) => call[1] !== 'list')).toEqual([
      ['plugin', 'marketplace', 'list', '--json', 'cwd='],
      ['plugin', 'install', 'a@m', '--scope', 'user', '--accept-command', sha, '--json', 'cwd='],
      ['plugin', 'disable', 'a@m', '--scope', 'project', '--json', `cwd=${dir}`],
      ['plugin', 'uninstall', 'a@m', '--scope', 'user', '--json', 'cwd='],
      ['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official', '--json', 'cwd='],
      ['plugin', 'marketplace', 'update', 'claude-plugins-official', '--json', 'cwd=']
    ])
  })

  /*
   * Each of these becomes an argument to a process. An id starting with `-`
   * would be read as a flag; a project scope with no project would run from
   * home and edit the user's own settings; a relative project would be
   * wherever the app stands.
   */
  it('refuses what would reach the CLI as something else', async () => {
    const ran = await withCli()

    for (const call of [
      ['plugins:install', '--scope@m'],
      ['plugins:install', 'no-marketplace'],
      ['plugins:install', 'a@m', 'not-a-digest'],
      ['plugins:setEnabled', 'a@m', 'yes', { scope: 'user' }],
      ['plugins:setEnabled', 'a@m', true, { scope: 'managed' }],
      ['plugins:setEnabled', 'a@m', true, { scope: 'project' }],
      ['plugins:setEnabled', 'a@m', true, { scope: 'project', projectPath: 'relative/path' }],
      ['plugins:uninstall', 'a@m', 'user'],
      ['plugins:uninstall', 'a@m', { scope: 'local' }]
    ] as const) {
      const [channel, ...args] = call
      await expect(invoke(channel, ...args)).resolves.toMatchObject({ ok: false })
    }
    expect(ran).toEqual([])
  })
})

describe('directory pickers', () => {
  it('reports null when the picker is cancelled, which is not an error', async () => {
    bench.picked = { canceled: true, filePaths: [] }
    await expect(invoke('dialog:pickDirectory', 'Pick')).resolves.toEqual({
      ok: true,
      value: null
    })
  })

  it('reports the chosen path', async () => {
    bench.picked = { canceled: false, filePaths: ['/tmp/chosen'] }
    await expect(invoke('dialog:pickDirectory', 'Pick')).resolves.toEqual({
      ok: true,
      value: '/tmp/chosen'
    })
  })

  // A picker that reports no path is not a choice either, however it answers
  // the cancelled flag — the renderer must not receive an undefined value.
  it('reports null when the picker answers without a path', async () => {
    bench.picked = { canceled: false, filePaths: [] }
    await expect(invoke('dialog:pickDirectory', 'Pick')).resolves.toEqual({
      ok: true,
      value: null
    })
  })

  /*
   * A skill arrives as either shape — a folder when it carries references, a
   * lone `SKILL.md` when it was copied out of a README — so the picker takes
   * both rather than sending the user off to rearrange files first.
   */
  it('lets a skill be picked as a folder or as a file', async () => {
    bench.picked = { canceled: false, filePaths: ['/tmp/skill'] }

    await expect(invoke('dialog:pickSkill', 'Pick')).resolves.toEqual({
      ok: true,
      value: '/tmp/skill'
    })
    expect(bench.dialogOptions.at(-1)?.properties).toEqual(['openFile', 'openDirectory'])
  })

  it('reports null when the skill picker is cancelled', async () => {
    bench.picked = { canceled: true, filePaths: [] }

    await expect(invoke('dialog:pickSkill', 'Pick')).resolves.toEqual({ ok: true, value: null })
  })

  it('opens the skill picker unparented when the window has closed', async () => {
    bench.window = null
    bench.picked = { canceled: false, filePaths: [] }

    await expect(invoke('dialog:pickSkill', 'Pick')).resolves.toEqual({ ok: true, value: null })
  })

  // The window can be gone by the time the call lands; the dialog then opens
  // unparented rather than the call failing.
  it('still opens the dialog when the window has closed', async () => {
    bench.window = null
    bench.picked = { canceled: false, filePaths: ['/tmp/chosen'] }

    await expect(invoke('dialog:pickDirectory', 'Pick')).resolves.toEqual({
      ok: true,
      value: '/tmp/chosen'
    })
  })

  // Cancelling the destination prompt means "not now", so nothing is added.
  it('adds no project when the clone destination is cancelled', async () => {
    bench.picked = { canceled: true, filePaths: [] }

    const result = await invoke('projects:addFromGitHub', REPOSITORY)

    expect(result).toEqual({ ok: true, value: null })
    expect(service.listProjects()).toHaveLength(0)
  })

  it('adds no project when the destination prompt answers without a path', async () => {
    bench.picked = { canceled: false, filePaths: [] }

    await expect(invoke('projects:addFromGitHub', REPOSITORY)).resolves.toEqual({
      ok: true,
      value: null
    })
  })

  // Asked once, then never again: the answer is written to the config.
  it('remembers the clone directory the user picks', async () => {
    const destination = join(dir, 'clones')
    await mkdir(destination, { recursive: true })

    const cloning = await useService({ commandExec: cloningExec })
    bench.window = null
    bench.picked = { canceled: false, filePaths: [destination] }

    expect(await invoke('projects:addFromGitHub', REPOSITORY)).toMatchObject({
      ok: true,
      value: { name: 'planner' }
    })
    expect(cloning.getConfig().cloneDirectory).toBe(destination)
    /*
     * And the window is told, which is the half that was missing. Main's own
     * dialog wrote through the service directly, so the renderer's copy stayed
     * `''` for the rest of the session — and both places reporting where clones
     * land went on saying the user would be asked, while every later clone was
     * written somewhere without a prompt.
     */
    expect(bench.configBroadcasts.at(-1)).toMatchObject({ cloneDirectory: destination })
  })

  /*
   * The other write, and the reason the announcement lives where the write is
   * rather than at either handler: a second window has no other way to learn of
   * a setting changed in the first.
   */
  it('tells every window when a setting is changed through the handler', async () => {
    await invoke('config:update', { branchPrefix: 'ytsykvas' })

    expect(bench.configBroadcasts.at(-1)).toMatchObject({ branchPrefix: 'ytsykvas' })
  })

  it('clones into the configured directory without asking', async () => {
    const destination = join(dir, 'clones')
    await mkdir(destination, { recursive: true })

    const cloning = await useService({ commandExec: cloningExec })
    await invoke('config:update', { cloneDirectory: destination })

    // The picker would answer "cancelled", so a clone that happens anyway
    // proves the configured directory was used instead of a prompt.
    bench.picked = { canceled: true, filePaths: [] }

    expect(await invoke('projects:addFromGitHub', REPOSITORY)).toMatchObject({ ok: true })
    expect(cloning.listProjects()).toHaveLength(1)
  })

  // Remembering the choice writes to the config, and that write can fail.
  // It used to happen outside `attempt`, so the failure crossed IPC as a throw
  // — an opaque Electron error the renderer could say nothing about.
  it('reports a failure to remember the clone directory', async () => {
    const destination = join(dir, 'clones')
    const configDir = join(dir, 'config')
    await mkdir(destination, { recursive: true })
    await mkdir(configDir, { recursive: true })

    await useService({
      configFilePath: join(configDir, 'config.json'),
      commandExec: cloningExec
    })

    // A file where the config directory was: the next write has nowhere to go.
    await rm(configDir, { recursive: true, force: true })
    await writeFile(configDir, 'not a directory\n', 'utf8')

    bench.picked = { canceled: false, filePaths: [destination] }

    expect(await invoke('projects:addFromGitHub', REPOSITORY)).toMatchObject({ ok: false })
  })
})

describe('adding a project from disk', () => {
  it('adds nothing when the picker is cancelled', async () => {
    bench.picked = { canceled: true, filePaths: [] }

    await expect(invoke('projects:add')).resolves.toEqual({ ok: true, value: null })
    expect(service.listProjects()).toHaveLength(0)
  })

  it('adds nothing when the picker answers without a path', async () => {
    bench.picked = { canceled: false, filePaths: [] }

    await expect(invoke('projects:add')).resolves.toEqual({ ok: true, value: null })
    expect(service.listProjects()).toHaveLength(0)
  })

  it('adds the repository that was chosen', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    bench.window = null
    bench.picked = { canceled: false, filePaths: [repo] }

    expect(await invoke('projects:add')).toMatchObject({ ok: true, value: { name: 'planner' } })
    expect(service.listProjects()).toHaveLength(1)
  })

  // Picking any directory is easy; only a repository can hold worktrees, so
  // the refusal has to reach the renderer as something it can explain.
  it('refuses a directory that is not a repository', async () => {
    const notes = join(dir, 'notes')
    await mkdir(notes, { recursive: true })

    bench.picked = { canceled: false, filePaths: [notes] }

    await expect(invoke('projects:add')).resolves.toMatchObject({ ok: false })
    expect(service.listProjects()).toHaveLength(0)
  })
})

describe('reads that forward to the service', () => {
  it('answers config:get with the stored config', async () => {
    await expect(invoke('config:get')).resolves.toMatchObject({
      ok: true,
      value: { version: 2, theme: 'system' }
    })
  })

  it('lists the projects that have been added', async () => {
    await addProject()

    expect(await invoke('projects:list')).toMatchObject({
      ok: true,
      value: [{ name: 'planner' }]
    })
  })

  // A repository added from disk has no remote, so the local branches are the
  // only thing left to offer as a base.
  it('offers the local branches when there is no remote', async () => {
    const projectId = await addProject()

    await expect(invoke('projects:branches', projectId)).resolves.toEqual({
      ok: true,
      value: ['main']
    })
  })

  it('lists the repositories gh reports', async () => {
    const reply = JSON.stringify({
      data: {
        viewer: {
          login: 'ytsykvas',
          organizations: { nodes: [] },
          repositories: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ ...REPOSITORY, isArchived: false, viewerPermission: 'ADMIN' }]
          }
        }
      }
    })
    await useService({ commandExec: () => Promise.resolve(reply) })

    await expect(invoke('projects:listRemote')).resolves.toMatchObject({
      ok: true,
      value: {
        repositories: [{ nameWithOwner: 'ytsykvas/planner' }],
        capped: false,
        organisations: []
      }
    })
  })
})

describe('scripts and instructions of a real project', () => {
  // A script nobody has written is the normal state of a new project, so the
  // editor opens on a template rather than on a failure.
  it('reads a template for a script nobody has written yet', async () => {
    const projectId = await addProject()

    await expect(invoke('scripts:read', projectId, 'setup')).resolves.toMatchObject({
      ok: true,
      value: expect.stringContaining('#!/bin/sh')
    })
  })

  it('reads back the script it saved', async () => {
    const projectId = await addProject()

    expect(
      await invoke('scripts:save', projectId, 'run', '#!/bin/sh\necho started\n')
    ).toMatchObject({ ok: true })

    await expect(invoke('scripts:read', projectId, 'run')).resolves.toMatchObject({
      ok: true,
      value: expect.stringContaining('echo started')
    })
  })

  // The tab shows the file it runs, so a script that was never written must
  // report no path at all rather than one that does not exist.
  it('reports a path only for a script that exists', async () => {
    const projectId = await addProject()

    await expect(invoke('scripts:paths', projectId)).resolves.toEqual({
      ok: true,
      value: { setup: null, run: null, archive: null }
    })

    await invoke('scripts:save', projectId, 'setup', '#!/bin/sh\nnpm install\n')

    await expect(invoke('scripts:paths', projectId)).resolves.toMatchObject({
      ok: true,
      value: { setup: expect.stringContaining('setup.sh'), run: null }
    })
  })

  // A worktree holds what git tracks and nothing else, so the gitignored
  // secrets an app boots from are missing from every fresh one.
  it('carries a listed file out of the checkout and into a workspace', async () => {
    const projectId = await addProject()
    await writeFile(join(dir, 'planner', '.env'), 'API_KEY=secret\n', 'utf8')
    await invoke('carry:save', projectId, '.env\n')

    const workspace = await createWorkspace(projectId)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toBe('API_KEY=secret\n')
    // Already there from creation; a second pass is what a run does, and it
    // has to stay harmless.
    await expect(invoke('workspace:prepare', workspace.id)).resolves.toEqual({
      ok: true,
      value: { written: [], missing: [], profile: 'default', variables: {} }
    })
  })

  // The root is this process and the terminals are the ones it spawned; the
  // renderer has nothing to say about either.
  it('measures the tree under this process, terminals charged to their workspaces', async () => {
    const measure = vi.spyOn(service, 'measureResources').mockResolvedValue({
      total: { cpu: 0, memory: 0 },
      app: { cpu: 0, memory: 0 },
      parts: []
    })
    await invoke('terminal:create', {
      cwd: dir,
      owner: { workspaceId: 'planner/anna', purpose: 'run' }
    })
    await invoke('terminal:create', { cwd: dir, owner: { workspaceId: null, purpose: 'auth' } })

    await expect(invoke('resources:read')).resolves.toMatchObject({ ok: true })
    expect(measure).toHaveBeenCalledWith(process.pid, [
      { pid: 500, workspaceId: 'planner/anna', kind: 'server' }
    ])
  })

  // The port is ours to decide, so the channel takes a workspace rather than a
  // number to connect to.
  it('reports whether a workspace\u2019s own port is answering', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:serving', workspace.id)).resolves.toEqual({
      ok: true,
      value: false
    })
  })

  // Asked on the way into a run: a port free when the workspace was made can
  // belong to something else by then.
  it('settles the port a workspace should serve on', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:port', workspace.id)).resolves.toEqual({
      ok: true,
      value: workspace.port
    })
  })

  it('reports nothing left serving from a fresh workspace', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:strays', workspace.id)).resolves.toEqual({
      ok: true,
      value: []
    })
    await expect(invoke('workspaces:stopStrays', workspace.id, [])).resolves.toEqual({
      ok: true,
      value: undefined
    })
  })

  // Signals go to processes, so what names them is checked before the core
  // ever looks.
  it('refuses a list of pids that is not one', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:stopStrays', workspace.id, ['1; rm'])).resolves.toMatchObject({
      ok: false
    })
    await expect(invoke('workspaces:stopStrays', workspace.id, [-1])).resolves.toMatchObject({
      ok: false
    })
  })

  // Last wins, so the block goes below whatever the checkout carried in — and
  // it is the whole file where a clone had nothing to carry.
  it('writes a project\u2019s env overrides at the end of a workspace\u2019s env', async () => {
    const projectId = await addProject()
    await writeFile(join(dir, 'planner', '.env'), 'MYSQL_HOST=production\n', 'utf8')
    await invoke('carry:save', projectId, '.env\n')
    await invoke('env:save', projectId, 'default', 'MYSQL_HOST=dev.example\n')

    const workspace = await createWorkspace(projectId)

    const contents = await readFile(join(workspace.path, '.env'), 'utf8')
    expect(contents.indexOf('production')).toBeLessThan(contents.indexOf('dev.example'))
  })

  it('reads a workspace\u2019s env file as it stands', async () => {
    const projectId = await addProject()
    await invoke('env:save', projectId, 'default', 'A=1\n')
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspace:env', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: expect.stringContaining('A=1')
    })
  })

  /*
   * octopus writes credentials into that file, in a directory an agent commits
   * from freely. A repository that does not ignore it turns the block into a
   * change waiting to be committed.
   */
  it('says whether git would keep the env file out of a commit', async () => {
    const projectId = await addProject()

    await expect(invoke('env:ignored', projectId)).resolves.toEqual({ ok: true, value: false })

    await writeFile(join(dir, 'planner', '.gitignore'), '.env\n', 'utf8')
    await expect(invoke('env:ignored', projectId)).resolves.toEqual({ ok: true, value: true })
  })

  // A repository that ships settings can pre-approve tools and declare shell
  // hooks, and octopus loads them as the CLI does.
  it('says what a repository can grant itself, and takes the approval', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await mkdir(join(workspace.path, '.claude'), { recursive: true })
    await writeFile(join(workspace.path, '.claude', 'settings.json'), '{"a":1}', 'utf8')

    const read = (await invoke('trust:read', workspace.id)) as {
      value: { approved: boolean; digest: string }
    }
    expect(read.value.approved).toBe(false)
    await expect(invoke('trust:project', projectId, workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { approved: false, digest: read.value.digest }
    })

    // Approved under the digest that was shown, and refused under any other.
    await expect(invoke('trust:approve', projectId, workspace.id, 'stale')).resolves.toMatchObject({
      ok: false,
      code: 'trustChanged'
    })
    await expect(
      invoke('trust:approve', projectId, workspace.id, read.value.digest)
    ).resolves.toMatchObject({ ok: true })
    await expect(invoke('trust:read', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { approved: true }
    })
    // The digest is parsed rather than trusted.
    await expect(invoke('trust:approve', projectId, workspace.id, 7)).resolves.toMatchObject({
      ok: false
    })
  })

  it("keeps a project's sets of variables apart, and moves what points at one", async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    await invoke('env:save', projectId, 'default', 'A=dev\n')
    await invoke('env:create', projectId, 'prod', 'default')
    await invoke('env:save', projectId, 'prod', 'A=prod\n')

    await expect(invoke('env:profiles', projectId)).resolves.toMatchObject({
      ok: true,
      value: { profiles: ['default', 'prod'], projectDefault: 'default' }
    })

    await invoke('workspaces:envProfile', workspace.id, 'prod')
    await invoke('env:rename', projectId, 'prod', 'production')
    await expect(invoke('env:read', projectId, 'production')).resolves.toEqual({
      ok: true,
      value: 'A=prod\n'
    })

    // Back to following the project, and a set made from nothing rather than
    // copied — both arms of a `null` that crosses this boundary as a value.
    await invoke('workspaces:envProfile', workspace.id, null)
    await invoke('env:create', projectId, 'staging', null)
    await expect(invoke('env:read', projectId, 'staging')).resolves.toEqual({ ok: true, value: '' })
    await invoke('env:remove', projectId, 'staging')

    await invoke('env:remove', projectId, 'production')
    await expect(invoke('env:profiles', projectId)).resolves.toMatchObject({
      ok: true,
      value: { profiles: ['default'] }
    })
  })

  it('carries the reason a set could not be added across the boundary', async () => {
    /*
     * The code is what lets the window say this in the reader's own language.
     * Without it the refusal arrived as the developer English thrown in core —
     * which is how it shipped, because `EnvProfileError` was missing from the
     * list `attempt` translates and nothing tested the crossing.
     */
    const projectId = await addProject()
    await invoke('env:create', projectId, 'prod', null)

    await expect(invoke('env:create', projectId, 'prod', null)).resolves.toMatchObject({
      ok: false,
      code: 'envProfileExists',
      params: { name: 'prod' }
    })
  })

  it('refuses a set name that could not be a file', async () => {
    // Types vanish at this boundary, and the name becomes a filename.
    const projectId = await addProject()

    await expect(invoke('env:read', projectId, '../escape')).resolves.toMatchObject({ ok: false })
    await expect(invoke('env:create', projectId, 'Prod', null)).resolves.toMatchObject({
      ok: false
    })
  })

  // The same shape of question about a different thing: what the Run button may
  // execute, rather than what the agent may load.
  it('says which scripts a repository supplies, and takes the approval', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await mkdir(join(workspace.path, '.octopus', 'scripts'), { recursive: true })
    await writeFile(
      join(workspace.path, '.octopus', 'scripts', 'setup.sh'),
      '#!/bin/sh\nmake dev\n',
      'utf8'
    )

    await expect(invoke('scripts:resolved', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { approved: false, scripts: { setup: { source: 'repoOctopus' } } }
    })

    const shown = (await invoke('scripts:resolved', workspace.id)) as { value: { digest: string } }
    await expect(
      invoke('scripts:approve', projectId, workspace.id, shown.value.digest)
    ).resolves.toMatchObject({ ok: true })
    await expect(invoke('scripts:resolved', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { approved: true }
    })
  })

  // Every layer of every script and instruction, for the settings window.
  it('lists where each script and instruction comes from', async () => {
    const projectId = await addProject()

    const answer = (await invoke('sources:read', projectId, null)) as {
      ok: boolean
      value: { id: string }[]
    }

    expect(answer.ok).toBe(true)
    expect(answer.value).toHaveLength(15)
    // The workspace is parsed rather than trusted.
    await expect(invoke('sources:read', projectId, 7)).resolves.toMatchObject({ ok: false })
  })

  // Asked of the project rather than a workspace, because Project settings is
  // open with no workspace to ask about.
  it('says which scripts the checkout itself supplies', async () => {
    const projectId = await addProject()
    await mkdir(join(dir, 'planner', '.octopus', 'scripts'), { recursive: true })
    await writeFile(
      join(dir, 'planner', '.octopus', 'scripts', 'setup.sh'),
      '#!/bin/sh\nmake dev\n',
      'utf8'
    )

    await expect(invoke('scripts:project', projectId, null)).resolves.toMatchObject({
      ok: true,
      value: { approved: false, scripts: { setup: { source: 'repoOctopus' } } }
    })
  })

  // octopus loads every settings source, so the agent arrives carrying whatever
  // the repository wrote for it. This is how the app can say what that was.
  it('reports what the project offers the agent', async () => {
    const projectId = await addProject()
    await writeFile(join(dir, 'planner', 'CLAUDE.md'), '# rules\n', 'utf8')

    const answer = await invoke('instructions:sources', projectId, null)

    expect(answer).toMatchObject({ ok: true })
    expect((answer as { value: { id: string; present: boolean }[] }).value).toContainEqual(
      expect.objectContaining({ id: 'projectMemory', present: true })
    )
  })

  it('reads back the env block a project saved', async () => {
    const projectId = await addProject()
    await invoke('env:save', projectId, 'default', 'A=1\n')

    await expect(invoke('env:read', projectId, 'default')).resolves.toEqual({
      ok: true,
      value: 'A=1\n'
    })
  })

  it('starts from a list that names the env', async () => {
    const projectId = await addProject()

    await expect(invoke('carry:read', projectId)).resolves.toMatchObject({
      ok: true,
      value: expect.stringContaining('.env')
    })
  })

  it('reads a template for an instruction nobody has written yet', async () => {
    const projectId = await addProject()

    await expect(invoke('instructions:read', projectId, 'pullRequest')).resolves.toMatchObject({
      ok: true,
      value: expect.stringContaining('Pull request')
    })
  })

  it('reads back the instruction it saved', async () => {
    const projectId = await addProject()

    await invoke('instructions:save', projectId, 'pullRequest', 'Lead with the why.')

    await expect(invoke('instructions:read', projectId, 'pullRequest')).resolves.toEqual({
      ok: true,
      value: 'Lead with the why.'
    })
  })
})

describe('workspaces of a real project', () => {
  it('lists nothing before one is created', async () => {
    const projectId = await addProject()

    await expect(invoke('workspaces:list', projectId)).resolves.toEqual({ ok: true, value: [] })
  })

  // What a finished turn reads: the one row, as the list draws it.
  it('reads one workspace as the list draws it, and nothing for one that is gone', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    const listed = (await invoke('workspaces:list', projectId)) as Result<unknown[]>
    const [row] = listed.ok ? listed.value : []
    await expect(invoke('workspaces:read', workspace.id)).resolves.toEqual({ ok: true, value: row })
    expect(row).toMatchObject({ id: workspace.id, changedFiles: 1 })
    await expect(invoke('workspaces:read', 'nobody/here')).resolves.toEqual({
      ok: true,
      value: null
    })
  })

  it('renames a workspace and lists it under the new name', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    expect(await invoke('workspaces:rename', workspace.id, 'fix auth')).toMatchObject({ ok: true })

    await expect(invoke('workspaces:list', projectId)).resolves.toMatchObject({
      ok: true,
      value: [{ name: 'fix auth' }]
    })
  })

  it('keeps a Run the Scripts tab refused, its purpose and reason parsed', async () => {
    const workspace = await createWorkspace(await addProject())

    await expect(invoke('terminal:refused', workspace.id, 'run', 'Port taken.')).resolves.toEqual({
      ok: true,
      value: undefined
    })
    expect(sessions.refuse).toHaveBeenCalledExactlyOnceWith(workspace.id, 'run', 'Port taken.')
  })

  // Dropped, the run before would answer as this one; Help masks before it cuts shorter.
  it('cuts a long reason rather than dropping it', async () => {
    const workspace = await createWorkspace(await addProject())

    await invoke('terminal:refused', workspace.id, 'setup', 'x'.repeat(TAIL_CHARS + 10))

    expect(sessions.refuse).toHaveBeenCalledExactlyOnceWith(
      workspace.id,
      'setup',
      'x'.repeat(TAIL_CHARS)
    )
  })

  it('keeps nothing for a script Help never asks about, or a workspace not on record', async () => {
    const workspace = await createWorkspace(await addProject())

    for (const purpose of ['archive', 'mining']) {
      await expect(invoke('terminal:refused', workspace.id, purpose, 'x')).resolves.toMatchObject({
        ok: false
      })
    }
    await expect(invoke('terminal:refused', 'nobody/here', 'run', 'x')).resolves.toMatchObject({
      ok: true
    })
    expect(sessions.refuse).not.toHaveBeenCalled()
  })

  it('forgets the last runs of every workspace of a project it removes', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    sessions.forgetRuns.mockClear()

    await expect(invoke('projects:remove', projectId)).resolves.toEqual({
      ok: true,
      value: undefined
    })
    expect(sessions.forgetRuns).toHaveBeenCalledExactlyOnceWith(workspace.id)
  })

  it('starts a new workspace with no last runs', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    expect(sessions.forgetRuns).toHaveBeenCalledWith(workspace.id)
  })

  // The renderer asks before it removes, so the refusal and the forced removal
  // are both part of one flow and have to work in that order.
  it('refuses to remove uncommitted work until it is forced', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    // Creating it forgets its runs too; what is asked here is removal.
    sessions.forgetRuns.mockClear()

    await expect(invoke('workspaces:hasChanges', workspace.id)).resolves.toEqual({
      ok: true,
      value: false
    })

    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await expect(invoke('workspaces:hasChanges', workspace.id)).resolves.toEqual({
      ok: true,
      value: true
    })
    expect(await invoke('workspaces:remove', workspace.id, {})).toMatchObject({
      ok: false,
      code: 'uncommittedChanges'
    })
    expect(sessions.forgetRuns).not.toHaveBeenCalled()

    expect(await invoke('workspaces:remove', workspace.id, { force: true })).toMatchObject({
      ok: true
    })
    expect(sessions.forgetRuns).toHaveBeenCalledExactlyOnceWith(workspace.id)
    await expect(invoke('workspaces:list', projectId)).resolves.toEqual({ ok: true, value: [] })
  })

  it('carries a workspace’s diff across', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await expect(invoke('workspaces:changes', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { diff: { added: 1, files: [{ path: 'draft.txt', status: 'untracked' }] } }
    })
  })

  /* Files rather than a directory, and several at once. Cancelling adds
     nothing, which is a choice rather than a failure. */
  it('answers with the files that were chosen, and with none when cancelled', async () => {
    await expect(invoke('dialog:pickFiles', 'Attach files')).resolves.toEqual({
      ok: true,
      value: []
    })

    bench.picked = { canceled: false, filePaths: ['/a/one.png', '/b/two.log'] }

    await expect(invoke('dialog:pickFiles', 'Attach files')).resolves.toEqual({
      ok: true,
      value: ['/a/one.png', '/b/two.log']
    })
  })

  // The window can be gone by the time the call lands; the dialog then opens
  // unparented rather than the call failing.
  it('still opens the file picker when the window has closed', async () => {
    bench.window = null
    bench.picked = { canceled: false, filePaths: ['/a/one.png'] }

    await expect(invoke('dialog:pickFiles', 'Attach files')).resolves.toEqual({
      ok: true,
      value: ['/a/one.png']
    })
  })

  /*
   * The one attachment octopus writes. A file dragged in or chosen from disk
   * keeps its own path; a clipboard carries a picture rather than a file.
   *
   * The type decides a filename, so it is checked against an allowlist rather
   * than trusted — this channel is the boundary, and the renderer having read
   * the contract is not a reason to believe it.
   */
  it('writes a pasted image and refuses one it cannot name', async () => {
    const written = await invoke('attachments:paste', 'image/png', Uint8Array.from([1, 2, 3]))

    expect(written).toMatchObject({ ok: true, value: expect.stringContaining('.png') })

    await expect(
      invoke('attachments:paste', 'application/x-sh', Uint8Array.from([1]))
    ).resolves.toMatchObject({ ok: false, code: 'attachmentType' })
  })

  it('refuses bytes that are not bytes, and more of them than the cap allows', async () => {
    await expect(invoke('attachments:paste', 'image/png', 'not bytes')).resolves.toMatchObject({
      ok: false
    })

    await expect(
      invoke('attachments:paste', 'image/png', new Uint8Array(MAX_PASTE_BYTES + 1))
    ).resolves.toMatchObject({ ok: false })
  })

  /* Read and shown, never written: two of the three files are inside the
     checkout, and one is in the trust digest. */
  it('carries what Claude Code’s own settings allow across', async () => {
    const projectId = await addProject('permitted')
    await mkdir(join(dir, 'permitted', '.claude'), { recursive: true })
    await writeFile(
      join(dir, 'permitted', '.claude', 'settings.json'),
      JSON.stringify({ permissions: { deny: ['Read(./.env)'] } }),
      'utf8'
    )

    await expect(invoke('permissions:cli', projectId)).resolves.toEqual({
      ok: true,
      value: [
        {
          scope: 'project',
          verdict: 'deny',
          rule: { toolName: 'Read', ruleContent: './.env' },
          from: '.claude/settings.json'
        }
      ]
    })
  })

  /* In the same answer as the diff, so the two cannot describe different
     trees. */
  it('carries the sides a file is coloured from beside the diff', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'README.md'), '# changed\n', 'utf8')

    await expect(invoke('workspaces:changes', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { sides: { 'README.md': { current: '# changed' } } }
    })
  })

  /*
   * `gh` is the one command in the table that cannot run for real: it would ask
   * GitHub about somebody's repository, and creating would open a pull request
   * on it. Git stays real — pushing to a bare repository next door is what
   * proves the branch actually left.
   */
  it('carries what GitHub says about a branch across', async () => {
    const projectId = await addProject('prs')
    service = await useService({ makeGh: () => () => Promise.resolve('[]') })
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:pullRequest', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { request: null, pushed: false }
    })
  })

  it('pushes the branch and opens the request', async () => {
    const projectId = await addProject('opening')
    const origin = join(dir, 'origin.git')
    await run('git', ['init', '-q', '--bare', origin])
    await run('git', ['remote', 'add', 'origin', origin], { cwd: join(dir, 'opening') })

    const asked: string[][] = []
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve('https://github.com/o/p/pull/1\n')
      }
    })

    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'a.txt'), 'work\n', 'utf8')
    await run('git', ['add', '.'], { cwd: workspace.path })
    await run('git', ['commit', '-q', '-m', 'work'], { cwd: workspace.path })

    await expect(
      invoke('workspaces:createPullRequest', workspace.id, {
        title: 'Add a thing',
        body: '',
        draft: false,
        commitMessage: null
      })
    ).resolves.toEqual({ ok: true, value: 'https://github.com/o/p/pull/1' })

    // The base came from the project rather than from the renderer, which never
    // sends one — it is a fact about the project, not about the request.
    expect(asked[0]).toContain('--base')
    expect(asked[0]).toContain('main')
    const pushed = await run('git', ['ls-remote', '--heads', 'origin', workspace.branch], {
      cwd: workspace.path
    })
    expect(pushed.stdout).toContain(workspace.branch)
  })

  // Both strings end up as arguments to `gh`, so they are checked here rather
  // than left to fail somewhere less able to explain itself.
  it('refuses a pull request with no title', async () => {
    const projectId = await addProject('untitled')
    const workspace = await createWorkspace(projectId)

    await expect(
      invoke('workspaces:createPullRequest', workspace.id, {
        title: '',
        body: '',
        draft: false
      })
    ).resolves.toMatchObject({ ok: false })
  })

  it('asks the service to describe a branch, and passes the answer back', async () => {
    const projectId = await addProject('describing')
    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    // Built after the workspace exists, so the replacement reads it back from
    // the state file the first service wrote.
    await useService({
      query: answeringQuery(
        '<<<OCTOPUS_TITLE>>>\nAdd a draft\n<<<OCTOPUS_BODY>>>\nBecause.\n<<<OCTOPUS_COMMIT>>>\nAdd a draft'
      )
    })

    await expect(invoke('workspaces:draftPullRequest', workspace.id)).resolves.toEqual({
      ok: true,
      value: { title: 'Add a draft', body: 'Because.', commitMessage: 'Add a draft' }
    })
  })

  it('commits everything in a workspace and pushes the branch', async () => {
    const projectId = await addProject('answering')
    const origin = join(dir, 'answering-origin.git')
    await run('git', ['init', '-q', '--bare', origin])
    await run('git', ['remote', 'add', 'origin', origin], { cwd: join(dir, 'answering') })

    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'answer.txt'), 'done\n', 'utf8')

    await expect(
      invoke('workspaces:commitAndPush', workspace.id, 'Answer the review')
    ).resolves.toMatchObject({ ok: true })

    const pushed = await run('git', ['ls-remote', '--heads', 'origin', workspace.branch], {
      cwd: workspace.path
    })
    expect(pushed.stdout).toContain(workspace.branch)
  })

  // The service resolves the base, so a workspace with no commit of its own is
  // told so rather than having the base's commit rewritten.
  it('refuses to amend a workspace branch with no commit of its own', async () => {
    const projectId = await addProject('amending')
    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'answer.txt'), 'done\n', 'utf8')

    await expect(invoke('workspaces:amendAndPush', workspace.id)).resolves.toMatchObject({
      ok: false,
      code: 'nothingToAmend'
    })
  })

  /*
   * The other half of the pair, and the one that was missing: work committed in
   * the workspace's own terminal, or by the agent, had no way onto the request.
   * Uncommitted work stays where it is — a button that committed on the
   * reader's behalf would be choosing a commit message for them.
   */
  it('pushes what is committed and leaves uncommitted work alone', async () => {
    const projectId = await addProject('sending')
    const origin = join(dir, 'sending-origin.git')
    await run('git', ['init', '-q', '--bare', origin])
    await run('git', ['remote', 'add', 'origin', origin], { cwd: join(dir, 'sending') })

    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'committed.txt'), 'done\n', 'utf8')
    await run('git', ['add', '-A'], { cwd: workspace.path })
    await run('git', ['commit', '-q', '-m', 'a change'], { cwd: workspace.path })
    await writeFile(join(workspace.path, 'loose.txt'), 'not yet\n', 'utf8')

    await expect(invoke('workspaces:push', workspace.id)).resolves.toMatchObject({ ok: true })

    const pushed = await run('git', ['ls-remote', '--heads', 'origin', workspace.branch], {
      cwd: workspace.path
    })
    expect(pushed.stdout).toContain(workspace.branch)
    const left = await run('git', ['status', '--porcelain'], { cwd: workspace.path })
    expect(left.stdout).toContain('loose.txt')
  })

  // No remote to fetch from, so the base is the local branch: a commit made
  // there after the workspace was cut is what must arrive in it.
  it('brings the base into the branch', async () => {
    const projectId = await addProject('updating')
    const workspace = await createWorkspace(projectId)
    const repo = join(dir, 'updating')
    await writeFile(join(repo, 'later.txt'), 'later\n', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'on the base later'], { cwd: repo })
    const later = (await run('git', ['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()

    await expect(invoke('workspaces:updateFromBase', workspace.id)).resolves.toMatchObject({
      ok: true
    })

    await expect(
      run('git', ['merge-base', '--is-ancestor', later, 'HEAD'], { cwd: workspace.path })
    ).resolves.toBeDefined()
  })

  it('says why the base was not brought in', async () => {
    const projectId = await addProject('unupdatable')
    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'loose.txt'), 'not yet\n', 'utf8')

    await expect(invoke('workspaces:updateFromBase', workspace.id)).resolves.toMatchObject({
      ok: false,
      code: 'uncommittedChanges'
    })
  })

  it('says why a push failed rather than swallowing it', async () => {
    const projectId = await addProject('unsendable')
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:push', workspace.id)).resolves.toMatchObject({
      ok: false,
      code: 'pushFailed'
    })
  })

  // The message becomes an argument to git, so an empty one is refused here
  // rather than left to fail somewhere less able to explain itself.
  it('refuses a commit with no message', async () => {
    const projectId = await addProject('unmessaged')
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:commitAndPush', workspace.id, '')).resolves.toMatchObject({
      ok: false
    })
  })

  it('carries the checks and the review of one request across', async () => {
    const projectId = await addProject('detail')
    service = await useService({
      makeGh: () => (args) =>
        Promise.resolve(
          args[1] === 'view'
            ? JSON.stringify({
                id: 'PR_1',
                state: 'OPEN',
                title: 'Rename the thing',
                url: 'https://github.com/o/p/pull/7',
                isDraft: false,
                mergeable: 'CONFLICTING',
                mergeStateStatus: 'DIRTY',
                reviewDecision: 'CHANGES_REQUESTED',
                statusCheckRollup: [],
                comments: [],
                reviews: []
              })
            : JSON.stringify({ data: { node: { reviewThreads: { nodes: [] } } } })
        )
    })
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:pullRequestDetail', workspace.id, 7)).resolves.toMatchObject({
      ok: true,
      value: { state: 'open', mergeable: 'conflicting', decision: 'changesRequested' }
    })
  })

  /*
   * The number becomes an argument to `gh`. The renderer read it from us, which
   * is not a reason to believe it coming back: types are gone at this boundary.
   */
  it('refuses a pull request number that is not one', async () => {
    const projectId = await addProject('bad-number')
    const workspace = await createWorkspace(projectId)

    await expect(
      invoke('workspaces:pullRequestDetail', workspace.id, 'seven')
    ).resolves.toMatchObject({ ok: false })
    await expect(
      invoke('workspaces:mergePullRequest', workspace.id, -1, 'merge')
    ).resolves.toMatchObject({ ok: false })
  })

  it('closes one by number, and refuses a number that is not one', async () => {
    const projectId = await addProject('closing')
    const asked: string[][] = []
    // Answers the guard with whatever branch this workspace is on, so the
    // channel is exercised rather than the refusal.
    let branch = ''
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve(args[1] === 'view' ? JSON.stringify({ headRefName: branch }) : '')
      }
    })
    const workspace = await createWorkspace(projectId)
    branch = workspace.branch

    await expect(invoke('workspaces:closePullRequest', workspace.id, 7)).resolves.toMatchObject({
      ok: true
    })
    expect(asked[1]).toEqual(['pr', 'close', '7'])

    // The number becomes an argument to gh, so it is proved to be one here.
    await expect(
      invoke('workspaces:closePullRequest', workspace.id, 'seven')
    ).resolves.toMatchObject({ ok: false })
  })

  it('re-runs the failed checks, and refuses a scope that is not one', async () => {
    const projectId = await addProject('rerunning')
    const asked: string[][] = []
    let branch = ''
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve(
          args[1] === 'view'
            ? JSON.stringify({
                headRefName: branch,
                url: 'https://github.com/o/p/pull/7',
                statusCheckRollup: [
                  {
                    __typename: 'CheckRun',
                    name: 'check',
                    workflowName: 'check',
                    status: 'COMPLETED',
                    conclusion: 'FAILURE',
                    startedAt: '2026-08-20T11:00:00Z',
                    completedAt: '2026-08-20T11:02:00Z',
                    detailsUrl: 'https://github.com/o/p/actions/runs/123/job/456'
                  }
                ]
              })
            : ''
        )
      }
    })
    const workspace = await createWorkspace(projectId)
    branch = workspace.branch

    await expect(
      invoke('workspaces:rerunChecks', workspace.id, 7, 'failed')
    ).resolves.toMatchObject({ ok: true })
    expect(asked[1]).toEqual(['run', 'rerun', '123', '--failed'])

    await expect(
      invoke('workspaces:rerunChecks', workspace.id, 7, 'everything')
    ).resolves.toMatchObject({ ok: false })
    expect(asked).toHaveLength(2)
  })

  it('answers a review thread, and refuses an id that is not a node id', async () => {
    const projectId = await addProject('replying')
    const asked: string[][] = []
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve('{}')
      }
    })
    const workspace = await createWorkspace(projectId)

    await expect(
      invoke('workspaces:replyToReviewThread', workspace.id, 'PRRT_kwDO1', 'Left as it is.')
    ).resolves.toMatchObject({ ok: true })
    expect((asked[0] ?? []).join(' ')).toContain('addPullRequestReviewThreadReply')

    // Both become arguments to `gh`, so both are proved here rather than
    // trusted because the renderer read them from us.
    await expect(
      invoke('workspaces:replyToReviewThread', workspace.id, 'PRRT_1;id', 'Left as it is.')
    ).resolves.toMatchObject({ ok: false })
    await expect(
      invoke('workspaces:replyToReviewThread', workspace.id, 'PRRT_kwDO1', '')
    ).resolves.toMatchObject({ ok: false })
    expect(asked).toHaveLength(1)
  })

  it('settles a thread and puts it back, and refuses a state that is not one', async () => {
    const projectId = await addProject('resolving')
    const asked: string[][] = []
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve('{}')
      }
    })
    const workspace = await createWorkspace(projectId)

    await invoke('workspaces:resolveReviewThread', workspace.id, 'PRRT_kwDO1', true)
    await invoke('workspaces:resolveReviewThread', workspace.id, 'PRRT_kwDO1', false)

    expect((asked[0] ?? []).join(' ')).toContain('resolveReviewThread(')
    expect((asked[1] ?? []).join(' ')).toContain('unresolveReviewThread(')

    await expect(
      invoke('workspaces:resolveReviewThread', workspace.id, 'PRRT_kwDO1', 'yes')
    ).resolves.toMatchObject({ ok: false })
    expect(asked).toHaveLength(2)
  })

  it('merges by the method it is given, and refuses one it is not', async () => {
    const projectId = await addProject('merging')
    const asked: string[][] = []
    let branch = ''
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve(args[1] === 'view' ? JSON.stringify({ headRefName: branch }) : '')
      }
    })
    const workspace = await createWorkspace(projectId)
    branch = workspace.branch

    await expect(
      invoke('workspaces:mergePullRequest', workspace.id, 7, 'squash')
    ).resolves.toMatchObject({ ok: true })
    expect(asked[1]).toEqual(['pr', 'merge', '7', '--squash'])

    await expect(
      invoke('workspaces:mergePullRequest', workspace.id, 7, 'fast-forward')
    ).resolves.toMatchObject({ ok: false })
  })

  /*
   * The end of the guard, through the whole bridge: the service takes the
   * branch off the workspace record rather than from the window, so a number
   * belonging to another branch of the same repository is refused before `gh`
   * is asked to merge anything.
   *
   * `gh pr merge 7` resolves 7 against the repository, not against the worktree
   * it is standing in, and merging does not come back. The window used to be
   * the only thing keeping the pair honest.
   */
  it('refuses a number that belongs to another branch of the repository', async () => {
    const projectId = await addProject('mismatch')
    const asked: string[][] = []
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve(
          args[1] === 'view' ? JSON.stringify({ headRefName: 'someone/else' }) : ''
        )
      }
    })
    const workspace = await createWorkspace(projectId)

    await expect(
      invoke('workspaces:mergePullRequest', workspace.id, 7, 'squash')
    ).resolves.toMatchObject({ ok: false, code: 'requestNotOnBranch' })

    expect(asked.map((call) => call[1])).toEqual(['view'])
  })

  it('answers with every branch of a project that has a request', async () => {
    const projectId = await addProject('marks')
    service = await useService({
      makeGh: () => () =>
        Promise.resolve(
          JSON.stringify([
            {
              headRefName: 'ytsykvas/anna',
              number: 7,
              state: 'OPEN',
              url: 'https://github.com/o/p/pull/7',
              createdAt: '2026-02-01T00:00:00Z',
              statusCheckRollup: [],
              isDraft: false,
              mergeable: 'MERGEABLE',
              mergeStateStatus: 'CLEAN',
              reviewDecision: '',
              headRefOid: 'abc123'
            }
          ])
        )
    })

    await expect(invoke('projects:pullRequests', projectId)).resolves.toMatchObject({
      ok: true,
      value: {
        requests: [{ branch: 'ytsykvas/anna', number: 7, state: 'open', checks: 'none' }],
        // One request against a limit of a hundred: nothing is missing, and the
        // header may go on saying there is no request rather than doubting it.
        capped: false
      }
    })
  })

  // The code is what the renderer localises; without it the pane could only
  // show git's English, which is the fallback rather than the message.
  it('carries the code across when the base branch cannot be found', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await service.updateProjectById(projectId, { baseBranch: 'main' })
    await run('git', ['branch', '-m', 'main', 'trunk'], { cwd: join(dir, 'planner') })

    await expect(invoke('workspaces:changes', workspace.id)).resolves.toMatchObject({
      ok: false,
      code: 'baseUnknown'
    })
  })

  it('opens a file in a workspace', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    expect(await invoke('files:open', workspace.id, 'README.md')).toMatchObject({ ok: true })
    expect(bench.opened).toEqual([join(workspace.path, 'README.md')])
  })

  it('refuses to open a path outside the workspace', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    expect(await invoke('files:open', workspace.id, '../../../etc/passwd')).toMatchObject({
      ok: false
    })
    expect(bench.opened).toEqual([])
  })

  it('reads the file tree, a folder and a file of a workspace', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await mkdir(join(workspace.path, 'node_modules'))
    await writeFile(join(workspace.path, 'node_modules', 'a.js'), '', 'utf8')

    await expect(invoke('files:tree', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { statuses: {}, truncated: false }
    })
    await expect(invoke('files:directory', workspace.id, 'node_modules')).resolves.toEqual({
      ok: true,
      value: { entries: [{ name: 'a.js', kind: 'file' }], truncated: false }
    })
    await expect(invoke('files:read', workspace.id, 'README.md')).resolves.toMatchObject({
      ok: true,
      value: { kind: 'text' }
    })
  })

  // Refused at the boundary before the service sees it; the service then
  // refuses what climbs out, which is a different check.
  it('refuses a folder or file path that is empty, not a string, or outside', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    for (const channel of ['files:directory', 'files:read']) {
      expect(await invoke(channel, workspace.id, '')).toMatchObject({ ok: false })
      expect(await invoke(channel, workspace.id, 42)).toMatchObject({ ok: false })
    }
    expect(await invoke('files:directory', workspace.id, '../..')).toMatchObject({
      ok: false,
      code: 'worktreeMissing'
    })
    expect(await invoke('files:read', workspace.id, '../../../etc/passwd')).toMatchObject({
      ok: true,
      value: { kind: 'missing' }
    })
  })

  it('refuses a path that is not a string at all', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    expect(await invoke('files:open', workspace.id, 42)).toMatchObject({ ok: false })
  })

  // A refusal from the system is the only sign that nothing opened; swallowing
  // it would leave a click that silently did nothing.
  it('reports what the system said when a file would not open', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    bench.openRefusal = 'no application knows this file'

    expect(await invoke('files:open', workspace.id, 'README.md')).toMatchObject({
      ok: false,
      error: 'no application knows this file'
    })
  })

  // Workspaces left behind would keep their directories and branches while
  // being invisible to the app, and adding the project back would collide.
  it('removes a project along with its workspaces', async () => {
    const projectId = await addProject()
    await invoke('workspaces:create', projectId)

    expect(await invoke('projects:remove', projectId)).toMatchObject({ ok: true })
    expect(service.listProjects()).toHaveLength(0)
    await expect(invoke('workspaces:list', projectId)).resolves.toEqual({ ok: true, value: [] })
  })
})

describe('terminal sessions', () => {
  it('forwards keystrokes to the session they were typed into', async () => {
    await invoke('terminal:write', 'term-1', 'ls\n')

    expect(sessions.write).toHaveBeenCalledWith('term-1', 'ls\n')
  })

  it('forwards both dimensions of a resize', async () => {
    await invoke('terminal:resize', 'term-1', 120, 40)

    expect(sessions.resize).toHaveBeenCalledWith('term-1', 120, 40)
  })

  // An undisposed session keeps a shell process alive after its tab is gone.
  it('disposes the session it is asked to', async () => {
    await invoke('terminal:dispose', 'term-1')

    expect(sessions.dispose).toHaveBeenCalledWith('term-1')
  })
})

describe('accounts', () => {
  it('reports what the account check found', async () => {
    await expect(invoke('accounts:status')).resolves.toMatchObject({
      ok: true,
      value: {
        claude: { connected: true, email: 'dev@example.com' },
        github: { connected: false }
      }
    })
  })

  /*
   * The button that opens the repository picker is about GitHub alone.
   *
   * It used to ask `accounts:status`, which queries both services — so a click
   * started a `claude` process nobody asked for and then waited on whichever of
   * the two answered last.
   */
  it('asks about GitHub without starting the Claude CLI', async () => {
    await expect(invoke('accounts:github')).resolves.toEqual({
      ok: true,
      value: { connected: true, login: 'ytsykvas', name: 'Yurii', seesOrganisations: true }
    })
    expect(vi.mocked(checkAccounts)).not.toHaveBeenCalled()
  })

  // `gh` prompts for an account unless it is told which one to drop, so the
  // login has to survive the trip across IPC rather than being dropped here.
  it('passes the account and the login through to the sign-out', async () => {
    await expect(invoke('accounts:signOut', 'github', 'ytsykvas')).resolves.toEqual({
      ok: true,
      value: true
    })
    expect(vi.mocked(signOut)).toHaveBeenCalledWith('github', 'ytsykvas')
  })

  it('answers with a result when the sign-out fails', async () => {
    vi.mocked(signOut).mockRejectedValue(new Error('no such account'))

    await expect(invoke('accounts:signOut', 'github', null)).resolves.toMatchObject({ ok: false })
  })
})

describe('the agent chat', () => {
  it('lists nothing for a workspace nobody has written in, and creates none', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    await expect(invoke('chats:list', workspace.id)).resolves.toEqual({ ok: true, value: [] })
  })

  it('opens a chat and lists it afterwards', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    const opened = await invoke('chats:open', workspace.id)
    expect(opened).toMatchObject({ ok: true, value: { workspaceId: workspace.id } })

    await expect(invoke('chats:list', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ workspaceId: workspace.id }]
    })
  })

  it('answers with a result rather than throwing across IPC', async () => {
    await expect(invoke('chats:open', 'planner/nowhere')).resolves.toMatchObject({
      ok: false,
      code: 'worktreeMissing'
    })
  })

  it('creates a second conversation and closes it again', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await invoke('chats:open', workspace.id)

    const created = (await invoke('chats:create', workspace.id)) as {
      ok: true
      value: { id: string }
    }
    expect(created.ok).toBe(true)
    await expect(invoke('chats:list', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ workspaceId: workspace.id }, { workspaceId: workspace.id }]
    })

    await expect(invoke('chats:close', created.value.id)).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(invoke('chats:list', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ workspaceId: workspace.id }]
    })
  })

  describe('putting the files back to a message', () => {
    // What to put back comes from the window too, and only three answers mean
    // anything.
    it('refuses a choice it does not know', async () => {
      const projectId = await addProject()
      const workspace = await createWorkspace(projectId)
      const opened = (await invoke('chats:open', workspace.id)) as {
        ok: true
        value: { id: string }
      }
      const stranger = '00000000-0000-4000-8000-000000000000'

      const refused = await invoke('chats:rewind', opened.value.id, stranger, 'everything')
      expect(refused).toMatchObject({ ok: false })
      expect(refused).not.toMatchObject({ code: 'rewindUnavailable' })
    })

    // The id names a point in a conversation, and comes from the window.
    it('refuses an id that is not a uuid', async () => {
      const projectId = await addProject()
      const workspace = await createWorkspace(projectId)
      const opened = (await invoke('chats:open', workspace.id)) as {
        ok: true
        value: { id: string }
      }

      expect(await invoke('chats:rewind', opened.value.id, 'not-a-uuid', 'files')).toMatchObject({
        ok: false
      })
      expect(await invoke('chats:rewindPreview', opened.value.id, 42)).toMatchObject({
        ok: false
      })
    })

    // Well formed, and still not one this conversation recorded.
    it('refuses a message the conversation never sent', async () => {
      const projectId = await addProject()
      const workspace = await createWorkspace(projectId)
      const opened = (await invoke('chats:open', workspace.id)) as {
        ok: true
        value: { id: string }
      }
      const stranger = '00000000-0000-4000-8000-000000000000'

      await expect(
        invoke('chats:rewind', opened.value.id, stranger, 'both')
      ).resolves.toMatchObject({
        ok: false,
        code: 'rewindUnavailable'
      })
      await expect(invoke('chats:rewindPreview', opened.value.id, stranger)).resolves.toMatchObject(
        { ok: false, code: 'rewindUnavailable' }
      )
    })
  })

  // Closing is not deleting: the conversation leaves the strip and waits to be
  // brought back, with the same record.
  it('closes a conversation into the history and brings it back', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await invoke('chats:open', workspace.id)
    const created = (await invoke('chats:create', workspace.id)) as {
      ok: true
      value: { id: string }
    }

    await invoke('chats:close', created.value.id)
    await expect(invoke('chats:closed', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ chat: { id: created.value.id }, preview: '' }]
    })

    await expect(invoke('chats:reopen', created.value.id)).resolves.toMatchObject({
      ok: true,
      value: { id: created.value.id, closedAt: null }
    })
    await expect(invoke('chats:closed', workspace.id)).resolves.toEqual({ ok: true, value: [] })
  })

  it('names a conversation, and refuses one longer than a tab can hold', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = (await invoke('chats:open', workspace.id)) as { ok: true; value: { id: string } }

    await expect(invoke('chats:rename', opened.value.id, 'auth refactor')).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(invoke('chats:list', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: [{ title: 'auth refactor' }]
    })

    await expect(invoke('chats:rename', opened.value.id, 'x'.repeat(61))).resolves.toMatchObject({
      ok: false
    })
  })

  // The code is what the renderer localises; without it the window shows the
  // English fallback for a refusal it knows how to explain.
  it('carries a refused fork back with its code', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = (await invoke('chats:open', workspace.id)) as { ok: true; value: { id: string } }

    await expect(invoke('chats:fork', opened.value.id)).resolves.toMatchObject({
      ok: false,
      code: 'nothingToFork'
    })
  })

  // The exchange becomes a prompt in the fork, so its shape is checked here; a
  // well-formed one gets through to the service, which refuses for its own reason.
  it('checks the side exchange a fork is made off', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = (await invoke('chats:open', workspace.id)) as { ok: true; value: { id: string } }

    await expect(
      invoke('chats:fork', opened.value.id, { question: 'why?' })
    ).resolves.not.toMatchObject({ code: 'nothingToFork' })
    await expect(
      invoke('chats:fork', opened.value.id, { question: 'why?', response: 'because' })
    ).resolves.toMatchObject({ ok: false, code: 'nothingToFork' })
    await expect(invoke('chats:fork', opened.value.id, null)).resolves.toMatchObject({
      ok: false,
      code: 'nothingToFork'
    })
  })

  it('reads back an empty history for a chat that has said nothing', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:history', chatIdOf(opened))).resolves.toEqual({
      ok: true,
      value: []
    })
  })

  // The message becomes a prompt and the mode reaches a running session, so
  // neither is taken on trust from the renderer.
  it('rejects a message that is empty or absurdly long', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)
    const chatId = chatIdOf(opened)

    await expect(invoke('chats:send', chatId, '')).resolves.toMatchObject({ ok: false })
    await expect(invoke('chats:send', chatId, 'x'.repeat(100_001))).resolves.toMatchObject({
      ok: false
    })
    // What decides whether the app pushes after the turn is not taken on trust either.
    await expect(
      invoke('chats:send', chatId, 'hi', { instruction: 'deploy' })
    ).resolves.toMatchObject({ ok: false })
  })

  it('rejects a permission mode it does not know', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(
      invoke('chats:mode', chatIdOf(opened), 'bypassPermissions')
    ).resolves.toMatchObject({ ok: false })

    // Planning is its own channel now, so the mode channel refuses it too —
    // the field it writes to holds two values and this is where that is kept.
    await expect(invoke('chats:mode', chatIdOf(opened), 'plan')).resolves.toMatchObject({
      ok: false
    })

    await expect(invoke('chats:mode', chatIdOf(opened), 'acceptEdits')).resolves.toEqual({
      ok: true,
      value: undefined
    })

    await expect(invoke('chats:mode', chatIdOf(opened), 'auto')).resolves.toEqual({
      ok: true,
      value: undefined
    })
  })

  it('takes planning as the boolean it now is', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:planMode', chatIdOf(opened), 'plan')).resolves.toMatchObject({
      ok: false
    })

    await expect(invoke('chats:planMode', chatIdOf(opened), true)).resolves.toEqual({
      ok: true,
      value: undefined
    })
  })

  // Null used to be a value for the working effort, meaning "leave the choice
  // to the agent". It is not one any more: a chat always holds a level, so a
  // null arriving there is a caller out of step rather than a choice expressed.
  it('rejects a working effort it does not know, null included', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)
    const efforts = (value: unknown): Promise<unknown> =>
      invoke('chats:setEfforts', chatIdOf(opened), value)

    await expect(efforts({ effort: 'ludicrous' })).resolves.toMatchObject({ ok: false })
    await expect(efforts({ effort: null })).resolves.toMatchObject({ ok: false })
    await expect(efforts({ effort: 'xhigh' })).resolves.toEqual({ ok: true, value: undefined })

    // Not a level, and the one value here that is not: the schema is the wider
    // of the two, or the scale's last notch would be refused at the boundary
    // rather than run.
    await expect(efforts({ effort: 'ultracode' })).resolves.toEqual({ ok: true, value: undefined })
  })

  /* Null **is** a value for the planning effort, unlike the working one: it is
     how the picker says the writing follows the plan, which is what most
     conversations want and where every one of them starts. */
  it('accepts a planning effort or none at all, and nothing else', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)
    const efforts = (value: unknown): Promise<unknown> =>
      invoke('chats:setEfforts', chatIdOf(opened), value)

    await expect(efforts({ effort: 'low', planEffort: 'max' })).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(efforts({ planEffort: null })).resolves.toEqual({ ok: true, value: undefined })
    await expect(efforts({ planEffort: 'ludicrous' })).resolves.toMatchObject({ ok: false })
  })

  // The menu's five or none: any other number would go into the agent's
  // settings unchecked, and the agent's own range is wider than what is offered.
  it('accepts a listed compaction window or none, and nothing else', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:autoCompact', chatIdOf(opened), 500_000)).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(invoke('chats:autoCompact', chatIdOf(opened), null)).resolves.toEqual({
      ok: true,
      value: undefined
    })
    // Refused at the door, not left to the state write to catch: that one
    // would answer `fileUnreadable`, after the number had reached the service.
    await expect(invoke('chats:autoCompact', chatIdOf(opened), 450_000)).resolves.toMatchObject({
      ok: false,
      code: 'valueRefused'
    })
  })

  // Null is the picker's way of handing the choice back; an empty string is a
  // model nobody can run, and it arrives from the same place.
  it('rejects an empty model, accepting a name or none at all', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)
    const models = (value: unknown): Promise<unknown> =>
      invoke('chats:setModels', chatIdOf(opened), value)

    await expect(models({ model: '' })).resolves.toMatchObject({ ok: false })
    await expect(models({ model: 'claude-opus-5' })).resolves.toEqual({
      ok: true,
      value: undefined
    })
    await expect(models({ model: null })).resolves.toEqual({ ok: true, value: undefined })
  })

  /*
   * The plan side, whose null means something else again — "no split", rather
   * than "the agent's default" — but is bounded exactly the same way, since an
   * empty string is not a model name on either side.
   */
  it('bounds the planning model the same way', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)
    const models = (value: unknown): Promise<unknown> =>
      invoke('chats:setModels', chatIdOf(opened), value)

    await expect(models({ planModel: '' })).resolves.toMatchObject({ ok: false })
    await expect(models({ model: 'claude-sonnet-5', planModel: 'claude-opus-5' })).resolves.toEqual(
      { ok: true, value: undefined }
    )
    await expect(models({ planModel: null })).resolves.toEqual({ ok: true, value: undefined })
  })

  it('reports no models before a session has ever run', async () => {
    await expect(invoke('chats:models')).resolves.toEqual({ ok: true, value: [] })
  })

  // Per chat, unlike the models: a project's own commands live in its
  // `.claude/commands/`, so the channel has to carry which chat is asking.
  it('reports no commands for a chat that has not run a session', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:commands', chatIdOf(opened))).resolves.toEqual({
      ok: true,
      value: []
    })
  })

  // The `@` list, per chat for the same reason as the commands.
  it('reports no agents for a chat that has not run a session', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:agents', chatIdOf(opened))).resolves.toEqual({
      ok: true,
      value: []
    })
  })

  it('reports no usage for a chat that has no session', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:usage', chatIdOf(opened))).resolves.toEqual({
      ok: true,
      value: { context: null, autoCompact: null }
    })
  })

  // Bounds enforced before the agent sees them.
  it('refuses a side question that is empty or carries too long a thread', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)
    const exchange = { question: 'q', response: 'a' }

    await expect(invoke('chats:sideQuestion', chatIdOf(opened), '   ', [])).resolves.toMatchObject({
      ok: false
    })
    await expect(
      invoke(
        'chats:sideQuestion',
        chatIdOf(opened),
        'why?',
        Array(SIDE_HISTORY_LIMIT + 1).fill(exchange)
      )
    ).resolves.toMatchObject({ ok: false })
  })

  // What a window asks on opening a conversation, because the event announcing
  // a blocked tool goes out once and is gone.
  it('reports nothing pending for a chat whose agent is not blocked', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:pending', chatIdOf(opened))).resolves.toEqual({
      ok: true,
      value: []
    })
  })

  it('refuses to answer for a chat that does not exist', async () => {
    await expect(invoke('chats:pending', 'chat-nothing')).resolves.toMatchObject({ ok: false })
  })

  // The answers reach the agent as text, so they are parsed at the boundary
  // like every other thing the window sends.
  it('rejects answers to a question that are not answers', async () => {
    await expect(
      invoke('chats:answerQuestions', 'r-1', [{ selected: ['yes'] }])
    ).resolves.toMatchObject({ ok: false })

    await expect(invoke('chats:answerQuestions', 'r-1', 'yes')).resolves.toMatchObject({
      ok: false
    })
  })

  it('accepts answers to a question nobody is waiting on', async () => {
    await expect(
      invoke('chats:answerQuestions', 'r-1', [
        { question: 'Which one?', selected: ['the first'], other: null }
      ])
    ).resolves.toEqual({ ok: true, value: undefined })
  })

  it('rejects an answer that is not one of the three the card offers', async () => {
    await expect(invoke('chats:permission', 'r-1', 'perhaps')).resolves.toMatchObject({
      ok: false
    })
  })

  // It replaces the tool's own argument, which the agent then works from — so
  // it is bounded like a prompt, and never empty: an empty plan is not an edit.
  it('refuses a rewritten plan that is empty or enormous', async () => {
    await expect(invoke('chats:permission', 'r-1', 'allow', undefined, '')).resolves.toMatchObject({
      ok: false
    })
    await expect(
      invoke('chats:permission', 'r-1', 'allow', undefined, 'x'.repeat(100_001))
    ).resolves.toMatchObject({ ok: false })
    await expect(
      invoke('chats:permission', 'r-1', 'allow', undefined, '# A better plan')
    ).resolves.toEqual({ ok: true, value: undefined })
  })

  // Unknown means already answered, or the session it belonged to is gone.
  it('accepts an answer to a request nobody is waiting on', async () => {
    await expect(invoke('chats:permission', 'r-1', 'allow')).resolves.toEqual({
      ok: true,
      value: undefined
    })
  })

  it('treats stopping a chat with no session as nothing to do', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:interrupt', chatIdOf(opened))).resolves.toEqual({
      ok: true,
      value: undefined
    })
  })

  // Nothing has run yet, so there is nothing to report — and an API key
  // session never reports one at all.
  it('answers with no rate limit before any turn has run', async () => {
    await expect(invoke('chats:rateLimit')).resolves.toEqual({ ok: true, value: null })
    // The same before anything has run, and answerable without a chat at all.
    await expect(invoke('chats:subscription')).resolves.toEqual({ ok: true, value: null })
    // Nothing to ask through either, which the press is told in its own words
    // rather than left to read as a control that does nothing.
    await expect(invoke('chats:refreshSubscription')).resolves.toEqual({
      ok: true,
      value: { kind: 'nowhereToAsk' }
    })
    // Pressed or not, and anything that is not a press reads as not pressed.
    await expect(invoke('chats:refreshSubscription', true)).resolves.toEqual({
      ok: true,
      value: { kind: 'nowhereToAsk' }
    })
    await expect(invoke('chats:refreshSubscription', 'yes')).resolves.toEqual({
      ok: true,
      value: { kind: 'nowhereToAsk' }
    })
  })

  /*
   * The block at the foot of the sidebar, told rather than asked. A window that
   * watched for a finished turn and then read the cache was racing whatever
   * filled it, and drew the previous turn's figure every time.
   */
  it('broadcasts the account reading when it moves', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    // Built after the workspace exists, so the replacement reads it back from
    // the state file the first service wrote.
    await useService({ query: answeringQuery('there') })

    await invoke('chats:open', workspace.id)
    await invoke('chats:refreshSubscription')

    expect(bench.usageBroadcasts.at(-1)?.limits.at(0)?.utilization).toBe(18)
  })

  // Events keep arriving long after the call that started them returned, and a
  // second window on the same workspace should see the same conversation, so
  // they are broadcast rather than answered back to whoever asked.
  it('broadcasts agent events to every window', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    // Built after the workspace exists, so the replacement reads it back from
    // the state file the first service wrote.
    await useService({ query: answeringQuery('there') })

    const opened = await invoke('chats:open', workspace.id)

    // Answered with the id the message was sent under, which is what lets the
    // line already drawn be rewound before the history is read again.
    await expect(invoke('chats:send', chatIdOf(opened), 'hello')).resolves.toEqual({
      ok: true,
      value: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown
    })

    await vi.waitFor(() => {
      expect(bench.chatEvents.map((entry) => entry.event)).toContainEqual({
        type: 'text',
        text: 'there',
        // The message's own wire id, so a retraction naming it has something
        // to point at on the other side of the bridge too.
        uuid: 'u-1'
      })
    })
  })

  describe('the agent map', () => {
    /** An SDK whose turn sent one agent off, and which records what it is told to stop. */
    function agentAwayQuery(stopped: string[]): QueryFn {
      return () => {
        async function* stream(): AsyncGenerator<SDKMessage> {
          await Promise.resolve()
          yield {
            type: 'system',
            subtype: 'task_started',
            task_id: 'task-1',
            tool_use_id: 'call-1',
            description: 'Look around',
            task_type: 'local_agent',
            is_backgrounded: true,
            uuid: 'frame',
            session_id: 'sess-1'
          } as unknown as SDKMessage
        }

        return Object.assign(stream(), {
          interrupt: () => Promise.resolve(undefined),
          setPermissionMode: () => Promise.resolve(),
          stopTask: (taskId: string) => {
            stopped.push(taskId)
            return Promise.resolve()
          }
        }) as unknown as Query
      }
    }

    it('lists nothing before any agent has run', async () => {
      await expect(invoke('tasks:list')).resolves.toEqual({ ok: true, value: [] })
    })

    /*
     * Progress arrives per tool call per agent, and the list of what is alive
     * with it. Each reaches a window folded into the task list, gathered — and
     * used to reach it a second time as an event, to every window, which no
     * window read: serialised, delivered and dropped, at the rate the
     * gathering exists to avoid.
     */
    it('keeps an agent’s progress out of the event stream, in the task list', async () => {
      const projectId = await addProject()
      const workspace = await createWorkspace(projectId)
      await useService({
        query: () => {
          async function* stream(): AsyncGenerator<SDKMessage> {
            await Promise.resolve()
            yield {
              type: 'system',
              subtype: 'task_started',
              task_id: 'task-1',
              tool_use_id: 'call-1',
              description: 'Look around',
              task_type: 'local_agent',
              is_backgrounded: true,
              uuid: 'frame',
              session_id: 'sess-1'
            } as unknown as SDKMessage
            yield {
              type: 'system',
              subtype: 'task_progress',
              task_id: 'task-1',
              description: 'Reading auth.rb',
              usage: { total_tokens: 12, tool_uses: 1, duration_ms: 100 },
              uuid: 'frame',
              session_id: 'sess-1'
            } as unknown as SDKMessage
            yield {
              type: 'system',
              subtype: 'background_tasks_changed',
              task_ids: ['task-1'],
              uuid: 'frame',
              session_id: 'sess-1'
            } as unknown as SDKMessage
          }

          return Object.assign(stream(), {
            interrupt: () => Promise.resolve(undefined),
            setPermissionMode: () => Promise.resolve()
          }) as unknown as Query
        }
      })

      const chatId = chatIdOf(await invoke('chats:open', workspace.id))
      await invoke('chats:send', chatId, 'look around')

      // The stream ends with the turn, which closes the session and empties the
      // list; the progress is in the push before that.
      await vi.waitFor(() => {
        expect(
          bench.taskEvents.some((push) =>
            push.tasks.some((task) => task.activity === 'Reading auth.rb' && task.tokens === 12)
          )
        ).toBe(true)
      })
      const types = bench.chatEvents.map((entry) => entry.event.type)
      expect(types).toContain('task_started')
      expect(types).not.toContain('task_progress')
      expect(types).not.toContain('background_tasks')
    })

    // The same wiring the set of conversations needed a test for: that a push
    // reaches the sender at all, and that the list answers what was pushed.
    it('broadcasts an agent starting, lists it and stops it', async () => {
      const projectId = await addProject()
      const workspace = await createWorkspace(projectId)
      const stopped: string[] = []
      await useService({ query: agentAwayQuery(stopped) })

      const chatId = chatIdOf(await invoke('chats:open', workspace.id))
      await invoke('chats:send', chatId, 'look around')

      await vi.waitFor(() => {
        expect(bench.taskEvents.at(-1)?.tasks).toEqual([
          expect.objectContaining({ taskId: 'task-1', status: 'running' })
        ])
      })
      await expect(invoke('tasks:list')).resolves.toMatchObject({
        ok: true,
        value: [{ chatId, tasks: [{ taskId: 'task-1' }] }]
      })

      await expect(invoke('tasks:stop', chatId, 'task-1')).resolves.toEqual({
        ok: true,
        value: undefined
      })
      expect(stopped).toEqual(['task-1'])
    })

    // The id goes on to the agent's process, so it is bounded on the way in.
    it('refuses a task id that is not one', async () => {
      const projectId = await addProject()
      const workspace = await createWorkspace(projectId)
      const chatId = chatIdOf(await invoke('chats:open', workspace.id))

      await expect(invoke('tasks:stop', chatId, '')).resolves.toMatchObject({ ok: false })
      await expect(invoke('tasks:stop', chatId, 7)).resolves.toMatchObject({ ok: false })
    })
  })

  /*
   * The wiring, which nothing asserted: the array existed on the bench because
   * the interface would not compile without it, and no test ever read it. The
   * `service.onChatsChanged(host.broadcastChatsChanged)` line could be deleted
   * and the whole suite stayed green with the channel dead in the app.
   *
   * That the sender uses the right channel string is `broadcast.test.ts`'s job.
   * This is the other half: that anything reaches the sender at all.
   */
  it('broadcasts a changed set of conversations to every window', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    await invoke('chats:open', workspace.id)
    await invoke('chats:create', workspace.id)

    expect(bench.chatsChangedEvents).toContainEqual({ workspaceId: workspace.id })
  })
})

/** The chat id out of a successful `chats:open`. */
function chatIdOf(result: unknown): string {
  const answer = result as Result<{ id: string }>
  if (!answer.ok) throw new Error(answer.error)
  return answer.value.id
}

/**
 * An Agent SDK that says one thing and stops.
 *
 * Enough to prove an event made the trip from the core to the window; the
 * mapping itself is covered where it lives, in `agent.test.ts`.
 */
function answeringQuery(text: string): QueryFn {
  return () => {
    async function* stream(): AsyncGenerator<SDKMessage> {
      // Yields on the next tick, as a real session does — a generator that
      // answers before `startSession` has returned is not a shape the SDK has.
      await Promise.resolve()

      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text }] },
        parent_tool_use_id: null,
        uuid: 'u-1',
        session_id: 'sess-1'
      } as unknown as SDKMessage
    }

    return Object.assign(stream(), {
      interrupt: () => Promise.resolve(undefined),
      setPermissionMode: () => Promise.resolve(),
      // Enough of the account's answer for the reading to be a reading. The
      // narrowing itself is `core/usage.test.ts`; what this table is about is
      // that the figure reaches every window.
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
        Promise.resolve({
          session: {
            total_cost_usd: 0,
            total_api_duration_ms: 0,
            total_duration_ms: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
            model_usage: {}
          },
          subscription_type: 'max',
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: 18, resets_at: null } },
          behaviors: null
        }),
      close: () => undefined
    }) as unknown as Query
  }
}

describe('the commands and subagents channels', () => {
  const GLOBAL = { kind: 'global' }
  const SUBAGENT = '---\nname: reviewer\ndescription: When reviewing.\n---\n\nYou review.'

  it('writes one, lists it, opens it and takes it away', async () => {
    await expect(
      invoke('library:create', GLOBAL, 'command', 'ship', 'Commit and push.')
    ).resolves.toMatchObject({ ok: true, value: { name: 'ship' } })

    await expect(invoke('library:list', GLOBAL, 'command')).resolves.toMatchObject({
      ok: true,
      value: [{ name: 'ship' }]
    })

    await expect(invoke('library:read', GLOBAL, 'command', 'ship')).resolves.toMatchObject({
      ok: true,
      value: { raw: 'Commit and push.' }
    })

    await expect(
      invoke('library:save', GLOBAL, 'command', 'ship', 'Commit.')
    ).resolves.toMatchObject({ ok: true })

    await expect(
      invoke('library:rename', GLOBAL, 'command', 'ship', 'gate')
    ).resolves.toMatchObject({ ok: true, value: { name: 'gate' } })

    await expect(invoke('library:remove', GLOBAL, 'command', 'gate')).resolves.toMatchObject({
      ok: true
    })
    await expect(invoke('library:list', GLOBAL, 'command')).resolves.toMatchObject({
      ok: true,
      value: []
    })
  })

  it('reads what an import would write without writing it', async () => {
    await expect(
      invoke('library:inspect', 'subagent', { kind: 'text', text: SUBAGENT })
    ).resolves.toMatchObject({ ok: true, value: { name: 'reviewer' } })

    await expect(invoke('library:list', GLOBAL, 'subagent')).resolves.toMatchObject({
      ok: true,
      value: []
    })
  })

  /*
   * The name becomes a file under `~/.octopus` and reaches a delete, so it is
   * refused here rather than anywhere further in. Types are gone by this point:
   * a renderer sending this is the case the parse exists for.
   */
  it('refuses a name that would name a file somewhere else', async () => {
    for (const name of ['../escape', 'a/b', '..', 'Upper']) {
      await expect(invoke('library:read', GLOBAL, 'command', name)).resolves.toMatchObject({
        ok: false
      })
      await expect(invoke('library:remove', GLOBAL, 'command', name)).resolves.toMatchObject({
        ok: false
      })
      await expect(
        invoke('library:rename', GLOBAL, 'command', 'ship', name)
      ).resolves.toMatchObject({ ok: false })
    }
  })

  // The kind decides which directory is written into, so a value outside the
  // two has to be impossible rather than defaulted.
  it('refuses a kind that is neither of the two', async () => {
    await expect(invoke('library:list', GLOBAL, 'skill')).resolves.toMatchObject({ ok: false })
    await expect(invoke('library:create', GLOBAL, 'skill', 'ship', 'x')).resolves.toMatchObject({
      ok: false
    })
  })

  it('refuses a store that is neither of the two, and a request that is none of the three', async () => {
    await expect(invoke('library:list', { kind: 'somewhere' }, 'command')).resolves.toMatchObject({
      ok: false
    })
    await expect(invoke('library:inspect', 'command', { kind: 'sideways' })).resolves.toMatchObject(
      { ok: false }
    )
  })

  /*
   * Files only, where the skill picker takes a directory too: a skill may be a
   * folder and neither of these ever is, so offering one would let the user
   * choose something the read behind it can only fail on.
   */
  it('offers one markdown file from disk, never a folder', async () => {
    bench.picked = { canceled: false, filePaths: ['/x/ship.md'] }

    await expect(invoke('dialog:pickMarkdown', 'Pick')).resolves.toEqual({
      ok: true,
      value: '/x/ship.md'
    })
    expect(bench.dialogOptions.at(-1)?.properties).toEqual(['openFile'])
  })

  it('answers with nothing when the picker is cancelled', async () => {
    bench.picked = { canceled: true, filePaths: [] }

    await expect(invoke('dialog:pickMarkdown', 'Pick')).resolves.toEqual({ ok: true, value: null })
  })

  // The window can be gone by the time the call lands; the dialog then opens
  // unparented rather than not at all.
  it('opens unparented when the window has closed, and answers for an empty pick', async () => {
    bench.window = null
    bench.picked = { canceled: false, filePaths: [] }

    await expect(invoke('dialog:pickMarkdown', 'Pick')).resolves.toEqual({ ok: true, value: null })
  })
})

describe('the pasted images channels', () => {
  it('measures what is there and empties it', async () => {
    await expect(invoke('attachments:measure')).resolves.toEqual({
      ok: true,
      value: { files: 0, bytes: 0 }
    })

    const written = (await invoke(
      'attachments:paste',
      'image/png',
      Uint8Array.from([0x89, 0x50])
    )) as Result<string>
    if (!written.ok) throw new Error(written.error)

    await expect(invoke('attachments:measure')).resolves.toMatchObject({
      ok: true,
      value: { files: 1 }
    })

    await expect(invoke('attachments:clear')).resolves.toEqual({
      ok: true,
      value: { files: 0, bytes: 0 }
    })
  })
})

describe('the MCP question channel', () => {
  /*
   * The values become the `content` an MCP server reads back, so they are
   * parsed rather than trusted: a window sending something else is the case
   * the parse exists for. Types are gone by this point.
   */
  it('refuses an answer that is none of the three words', async () => {
    await expect(invoke('chats:elicitation', 'r-1', 'perhaps', {})).resolves.toMatchObject({
      ok: false
    })
  })

  it('refuses values that are not text or flags', async () => {
    await expect(
      invoke('chats:elicitation', 'r-1', 'accept', { token: { nested: true } })
    ).resolves.toMatchObject({ ok: false })
    await expect(invoke('chats:elicitation', 'r-1', 'accept', 'nope')).resolves.toMatchObject({
      ok: false
    })
  })

  // A question nobody is holding open is not an error: it is a second window
  // pressing a button the first had already pressed.
  it('is untroubled by an answer to a question that has gone', async () => {
    await expect(invoke('chats:elicitation', 'r-gone', 'decline', {})).resolves.toMatchObject({
      ok: true
    })
  })
})

describe('the list of what is still running', () => {
  /*
   * No argument, and every window's rather than the caller's own: the session
   * worth finding is precisely the one whose pane is gone, and a list scoped to
   * the asker could never show it.
   */
  it('names each session by whose it is', async () => {
    await invoke('terminal:create', {
      cwd: '/tmp/work',
      owner: { workspaceId: 'planner/anna', purpose: 'run' }
    })

    await expect(invoke('terminal:list')).resolves.toMatchObject({
      ok: true,
      value: [{ owner: { workspaceId: 'planner/anna', purpose: 'run' } }]
    })
  })

  // Defaulted rather than required: an unnamed session on the list is a worse
  // answer than no session, and a refusal here would be the worst of the three.
  it('accepts a spec that says nothing about ownership', async () => {
    await invoke('terminal:create', { cwd: '/tmp/work' })

    await expect(invoke('terminal:list')).resolves.toMatchObject({
      ok: true,
      value: [{ owner: { workspaceId: null, purpose: 'shell' } }]
    })
  })

  it('refuses a purpose that is none of the five', async () => {
    await expect(
      invoke('terminal:create', { cwd: '/tmp/work', owner: { purpose: 'mining' } })
    ).resolves.toMatchObject({ ok: false })
  })
})

describe('the workspace notes channel', () => {
  it('writes a note and hands it back on the list', async () => {
    const projectId = await addProject('noted')
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:notes', workspace.id, 'remember this')).resolves.toMatchObject({
      ok: true
    })

    const listed = (await invoke('workspaces:list', projectId)) as Result<{ notes: string }[]>
    expect(listed.ok && listed.value[0]?.notes).toBe('remember this')
  })

  /*
   * The body is parsed rather than trusted: it is written into `state.json`,
   * which `commit` rewrites whole, so its ceiling is paid for by every other
   * field in the file. Types are gone by this point — a renderer sending
   * something else is the case the parse exists for.
   */
  it('refuses a body past the ceiling, and one that is not text', async () => {
    const projectId = await addProject('noted')
    const workspace = await createWorkspace(projectId)

    await expect(
      invoke('workspaces:notes', workspace.id, 'x'.repeat(16_001))
    ).resolves.toMatchObject({ ok: false })
    await expect(invoke('workspaces:notes', workspace.id, { text: 'no' })).resolves.toMatchObject({
      ok: false
    })
  })
})
