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
import type { RemoteRepository } from '../core/github.js'
import { createService, type OctopusService, type ServiceOptions } from '../core/service.js'
import type { ChatEvent, ChatStatusEvent, WorkspaceStatusEvent } from '../core/service.js'
import type { ThemeName, Workspace } from '../core/types.js'
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
  /** Paths handed to the system, in order. */
  readonly opened: string[]
  picked: PickedDirectory
  prefersDark: boolean
  /** What the system says about the next open; empty means it worked. */
  openRefusal: string
  /** What each picker was opened with, so a test can name the shapes it takes. */
  dialogOptions: OpenDialogOptions[]
  /** null once the window a call came from has closed, as Electron reports it. */
  window: unknown
}

function harness(): Harness {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const broadcasts: ThemeName[] = []
  const chatEvents: ChatEvent[] = []
  const statusEvents: WorkspaceStatusEvent[] = []
  const chatStatusEvents: ChatStatusEvent[] = []
  const opened: string[] = []
  const dialogOptions: OpenDialogOptions[] = []

  const state: Harness = {
    handlers,
    broadcasts,
    chatEvents,
    statusEvents,
    chatStatusEvents,
    opened,
    dialogOptions,
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
      broadcastChatStatus: (event) => chatStatusEvents.push(event),
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
}

function terminalsStub(): { manager: TerminalManager; sessions: TerminalSpies } {
  const sessions: TerminalSpies = {
    write: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn()
  }

  return {
    manager: {
      create: vi.fn(() => 'term-1'),
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
  github: { connected: false, login: null, name: null }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-ipc-'))
  service = await createService(servicePaths(dir))

  vi.mocked(checkAccounts).mockReset().mockResolvedValue(CONNECTED)
  vi.mocked(checkGitHubAccount)
    .mockReset()
    .mockResolvedValue({ connected: true, login: 'ytsykvas', name: 'Yurii' })
  vi.mocked(signOut).mockReset().mockResolvedValue(true)

  bench = harness()
  const stub = terminalsStub()
  terminals = stub.manager
  sessions = stub.sessions
  registerIpc(service, terminals, bench.host)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('channel table', () => {
  // The renderer calls these by name. A channel that stops being registered
  // fails at runtime with nothing but "no handler", far from the cause.
  const EXPECTED = [
    'theme:get',
    'config:get',
    'config:update',
    'projects:list',
    'projects:add',
    'projects:update',
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
    'repoConfig:read',
    'repoConfig:import',
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
    'trust:approve',
    'scripts:resolved',
    'scripts:project',
    'scripts:approve',
    'workspace:env',
    'workspaces:serving',
    'workspaces:port',
    'instructions:read',
    'instructions:save',
    'instructions:effective',
    'skills:list',
    'skills:read',
    'skills:save',
    'skills:remove',
    'skills:import',
    'skills:inRepository',
    'skills:forChat',
    'skills:forWorkspace',
    'skills:setForChat',
    'dialog:pickSkill',
    'workspaces:list',
    'workspaces:create',
    'workspaces:rename',
    'workspaces:remove',
    'workspaces:hasChanges',
    'workspaces:diff',
    'workspaces:revertFile',
    'workspaces:pullRequest',
    'workspaces:createPullRequest',
    'workspaces:draftPullRequest',
    'workspaces:commitAndPush',
    'workspaces:pullRequestDetail',
    'workspaces:mergePullRequest',
    'workspaces:closePullRequest',
    'files:open',
    'chats:list',
    'chats:open',
    'chats:create',
    'chats:fork',
    'chats:close',
    'chats:rename',
    'chats:history',
    'chats:send',
    'chats:interrupt',
    'chats:mode',
    'chats:planMode',
    'chats:effort',
    'chats:model',
    'chats:planModel',
    'chats:models',
    'chats:commands',
    'chats:answerQuestions',
    'chats:pending',
    'chats:usage',
    'chats:permission',
    'chats:rateLimit',
    'chats:subscription',
    'chats:refreshSubscription',
    'terminal:create',
    'terminal:write',
    'terminal:resize',
    'terminal:dispose',
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

describe('validation at the boundary', () => {
  // These arrive from the renderer and end up in a file, a command line or a
  // working directory. Types guarantee nothing across the process boundary.
  it('rejects a project patch with an unknown colour', async () => {
    const result = await invoke('projects:update', 'nothing', { color: 'chartreuse' })
    expect(result).toMatchObject({ ok: false })
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
    const result = await invoke('repoConfig:import', 'nothing', ['script.evil'])
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a selection longer than there are items to select', async () => {
    const result = await invoke('repoConfig:export', 'nothing', Array(50).fill('carry'))
    expect(result).toMatchObject({ ok: false })
  })

  it('carries a project settings out to its repository and back in', async () => {
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

    expect(await invoke('repoConfig:import', projectId, ['script.setup'])).toMatchObject({
      ok: true,
      value: ['script.setup']
    })
    await expect(invoke('scripts:read', projectId, 'setup')).resolves.toMatchObject({
      value: expect.stringContaining('npm ci')
    })
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

    await expect(invoke('skills:remove', store, 'review')).resolves.toMatchObject({ ok: true })
    await expect(invoke('skills:list', store)).resolves.toMatchObject({ ok: true, value: [] })
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
      value: [{ nameWithOwner: 'ytsykvas/planner' }]
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
      value: []
    })
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

    await expect(invoke('trust:read', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { approved: false }
    })

    await expect(invoke('trust:approve', workspace.id)).resolves.toMatchObject({ ok: true })
    await expect(invoke('trust:read', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { approved: true }
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
    await mkdir(join(workspace.path, '.conductor'), { recursive: true })
    await writeFile(
      join(workspace.path, '.conductor', 'settings.toml'),
      '[scripts]\nsetup = "make dev"\n',
      'utf8'
    )

    await expect(invoke('scripts:resolved', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { approved: false, scripts: { setup: { source: 'repoConductor' } } }
    })

    await expect(invoke('scripts:approve', workspace.id)).resolves.toMatchObject({ ok: true })
    await expect(invoke('scripts:resolved', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { approved: true }
    })
  })

  // Asked of the project rather than a workspace, because Project settings is
  // open with no workspace to ask about.
  it('says which scripts the checkout itself supplies', async () => {
    const projectId = await addProject()
    await mkdir(join(dir, 'planner', '.conductor'), { recursive: true })
    await writeFile(
      join(dir, 'planner', '.conductor', 'settings.toml'),
      '[scripts]\nsetup = "make dev"\n',
      'utf8'
    )

    await expect(invoke('scripts:project', projectId, null)).resolves.toMatchObject({
      ok: true,
      value: { approved: false, scripts: { setup: { source: 'repoConductor' } } }
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

  it('renames a workspace and lists it under the new name', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

    expect(await invoke('workspaces:rename', workspace.id, 'fix auth')).toMatchObject({ ok: true })

    await expect(invoke('workspaces:list', projectId)).resolves.toMatchObject({
      ok: true,
      value: [{ name: 'fix auth' }]
    })
  })

  // The renderer asks before it removes, so the refusal and the forced removal
  // are both part of one flow and have to work in that order.
  it('refuses to remove uncommitted work until it is forced', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)

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

    expect(await invoke('workspaces:remove', workspace.id, { force: true })).toMatchObject({
      ok: true
    })
    await expect(invoke('workspaces:list', projectId)).resolves.toEqual({ ok: true, value: [] })
  })

  it('carries a workspace’s diff across', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await expect(invoke('workspaces:diff', workspace.id)).resolves.toMatchObject({
      ok: true,
      value: { added: 1, files: [{ path: 'draft.txt', status: 'untracked' }] }
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
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve('')
      }
    })
    const workspace = await createWorkspace(projectId)

    await expect(invoke('workspaces:closePullRequest', workspace.id, 7)).resolves.toMatchObject({
      ok: true
    })
    expect(asked[0]).toEqual(['pr', 'close', '7'])

    // The number becomes an argument to gh, so it is proved to be one here.
    await expect(
      invoke('workspaces:closePullRequest', workspace.id, 'seven')
    ).resolves.toMatchObject({ ok: false })
  })

  it('merges by the method it is given, and refuses one it is not', async () => {
    const projectId = await addProject('merging')
    const asked: string[][] = []
    service = await useService({
      makeGh: () => (args) => {
        asked.push([...args])
        return Promise.resolve('')
      }
    })
    const workspace = await createWorkspace(projectId)

    await expect(
      invoke('workspaces:mergePullRequest', workspace.id, 7, 'squash')
    ).resolves.toMatchObject({ ok: true })
    expect(asked[0]).toEqual(['pr', 'merge', '7', '--squash'])

    await expect(
      invoke('workspaces:mergePullRequest', workspace.id, 7, 'fast-forward')
    ).resolves.toMatchObject({ ok: false })
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
              statusCheckRollup: []
            }
          ])
        )
    })

    await expect(invoke('projects:pullRequests', projectId)).resolves.toMatchObject({
      ok: true,
      value: [{ branch: 'ytsykvas/anna', number: 7, state: 'open', checks: 'none' }]
    })
  })

  // The code is what the renderer localises; without it the pane could only
  // show git's English, which is the fallback rather than the message.
  it('carries the code across when the base branch cannot be found', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    await service.updateProjectById(projectId, { baseBranch: 'main' })
    await run('git', ['branch', '-m', 'main', 'trunk'], { cwd: join(dir, 'planner') })

    await expect(invoke('workspaces:diff', workspace.id)).resolves.toMatchObject({
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
      value: { connected: true, login: 'ytsykvas', name: 'Yurii' }
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

  // Null used to be a value here, meaning "leave the choice to the agent". It
  // is not one any more: a chat always holds a level, so a null arriving on
  // this channel is a caller out of step rather than a choice being expressed.
  it('rejects an effort it does not know, null included', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:effort', chatIdOf(opened), 'ludicrous')).resolves.toMatchObject({
      ok: false
    })

    await expect(invoke('chats:effort', chatIdOf(opened), null)).resolves.toMatchObject({
      ok: false
    })

    await expect(invoke('chats:effort', chatIdOf(opened), 'xhigh')).resolves.toEqual({
      ok: true,
      value: undefined
    })

    // Not a level, and the one value on this channel that is not: the schema
    // here is the wider of the two, or the scale's last notch would be refused
    // at the boundary rather than run.
    await expect(invoke('chats:effort', chatIdOf(opened), 'ultracode')).resolves.toEqual({
      ok: true,
      value: undefined
    })
  })

  // Null is the picker's way of handing the choice back; an empty string is a
  // model nobody can run, and it arrives from the same place.
  it('rejects an empty model, accepting a name or none at all', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:model', chatIdOf(opened), '')).resolves.toMatchObject({ ok: false })

    await expect(invoke('chats:model', chatIdOf(opened), 'claude-opus-5')).resolves.toEqual({
      ok: true,
      value: undefined
    })

    await expect(invoke('chats:model', chatIdOf(opened), null)).resolves.toEqual({
      ok: true,
      value: undefined
    })
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

    await expect(invoke('chats:planModel', chatIdOf(opened), '')).resolves.toMatchObject({
      ok: false
    })

    await expect(invoke('chats:planModel', chatIdOf(opened), 'claude-opus-5')).resolves.toEqual({
      ok: true,
      value: undefined
    })

    await expect(invoke('chats:planModel', chatIdOf(opened), null)).resolves.toEqual({
      ok: true,
      value: undefined
    })
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

  it('reports no usage for a chat that has no session', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:usage', chatIdOf(opened))).resolves.toEqual({
      ok: true,
      value: { context: null }
    })
  })

  // What a window asks on opening a conversation, because the event announcing
  // a blocked tool goes out once and is gone.
  it('reports nothing pending for a chat whose agent is not blocked', async () => {
    const projectId = await addProject()
    const workspace = await createWorkspace(projectId)
    const opened = await invoke('chats:open', workspace.id)

    await expect(invoke('chats:pending', chatIdOf(opened))).resolves.toEqual({
      ok: true,
      value: null
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

    await invoke('chats:send', chatIdOf(opened), 'hello')

    await vi.waitFor(() => {
      expect(bench.chatEvents.map((entry) => entry.event)).toContainEqual({
        type: 'text',
        text: 'there'
      })
    })
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
      close: () => undefined
    }) as unknown as Query
  }
}
