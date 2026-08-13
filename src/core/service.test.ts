import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type { ModelInfo, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandExec } from './accounts.js'
import { DENIED, type QueryFn, READ_ONLY_TOOLS } from './agent.js'
import type { RemoteRepository } from './github.js'
import { gitIn } from './git.js'
import { WORKSPACE_NAMES } from './names.js'
import { ProjectValidationError } from './projects.js'
import { type ChatEvent, createService, type OctopusService } from './service.js'
import { listWorktrees } from './worktree.js'
import { WorkspaceError } from './workspaces.js'

const run = promisify(execFile)

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
    dataRoot: join(root, 'data')
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-service-'))
  service = await createService(paths(dir))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('default paths', () => {
  it('works in ~/.octopus when given no parameters', async () => {
    const previousHome = process.env.HOME
    process.env.HOME = dir

    try {
      const withDefaults = await createService()
      expect(withDefaults.listProjects()).toHaveLength(0)
      expect(withDefaults.getConfig().version).toBe(1)

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
    description: null,
    isPrivate: true,
    updatedAt: '2026-08-01T00:00:00Z',
    defaultBranchRef: { name: 'main' }
  }

  it('lists what gh reports', async () => {
    const commandExec: CommandExec = () => Promise.resolve(JSON.stringify([repository]))
    const withGitHub = await createService({ ...paths(dir), commandExec })

    await expect(withGitHub.listRemoteRepositories()).resolves.toHaveLength(1)
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
    // No commandExec: the service must still expose the capability rather
    // than crashing, whatever the machine's gh reports.
    const plain = await createService(paths(join(dir, 'plain')))
    await expect(plain.listRemoteRepositories()).resolves.toBeInstanceOf(Array)
  })
})

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

  it('creates a workspace with a generated name', async () => {
    const { service, projectId } = await withProject()

    const workspace = await service.createWorkspaceIn(projectId)
    expect(WORKSPACE_NAMES).toContain(workspace.name)

    const listed = await service.listWorkspaces(projectId)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.missing).toBe(false)
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
  it('is created with defaults on first run', () => {
    expect(service.getConfig().settingSources).toBe('none')
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
})

describe('projects', () => {
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

    await expect(service.projectScriptPaths(id)).resolves.toEqual({ setup: null, run: null })

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
    readonly ask: (toolName: string, input?: unknown) => Promise<unknown>
    readonly sent: string[]
    readonly interrupted: () => number
    readonly closed: () => number
    /** Permission modes the session was switched to, in order. */
    readonly modes: () => string[]
    /** Settings pushed onto the running session — where effort lands. */
    readonly flagSettings: () => { effortLevel?: string }[]
    /** Models asked for mid-session; `undefined` is "back to the default". */
    readonly requestedModels: () => (string | undefined)[]
    readonly options: () => Record<string, unknown>
  }

  /** Both responses as build 2.1.228 actually sent them, trimmed. */
  const CONTEXT_RESPONSE = {
    totalTokens: 23_921,
    maxTokens: 1_000_000,
    rawMaxTokens: 1_000_000,
    percentage: 2,
    autoCompactThreshold: 967_000,
    isAutoCompactEnabled: true
  }

  const USAGE_RESPONSE = {
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
  /** What the session answers about its context window, and the account's. */
  let contextAnswer: () => Promise<unknown>
  let usageAnswer: () => Promise<unknown>

  function fakeQuery(): QueryFn {
    return (params) => {
      const queued: SDKMessage[] = []
      const sent: string[] = []
      let wake: (() => void) | null = null
      let done = false
      let failure: Error | null = null
      const modes: string[] = []
      const flagSettings: { effortLevel?: string }[] = []
      const requestedModels: (string | undefined)[] = []
      let interrupted = 0
      let closed = 0

      const options = (params.options ?? {}) as unknown as Record<string, unknown>

      void (async () => {
        for await (const message of params.prompt) {
          // A user message the service sends carries plain text; the block
          // shape belongs to tool results, which travel the other way.
          const { content } = message.message
          if (typeof content === 'string') sent.push(content)
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
        emit: (message) => {
          queued.push(message)
          push()
        },
        finish: (error) => {
          failure = error ?? null
          done = true
          push()
        },
        ask: (toolName, input = {}) => {
          const canUseTool = options.canUseTool
          if (typeof canUseTool !== 'function') throw new Error('no canUseTool')
          return (canUseTool as (name: string, input: unknown) => Promise<unknown>)(toolName, input)
        },
        interrupted: () => interrupted,
        closed: () => closed,
        flagSettings: () => flagSettings,
        requestedModels: () => requestedModels,
        modes: () => modes,
        options: () => options
      })

      return Object.assign(stream(), {
        interrupt: () => {
          interrupted++
          return Promise.resolve(undefined)
        },
        applyFlagSettings: (settings: { effortLevel?: string }) => {
          flagSettings.push(settings)
          return Promise.resolve()
        },
        setModel: (model: string | undefined) => {
          requestedModels.push(model)
          return Promise.resolve()
        },
        supportedModels: () => offered(),
        getContextUsage: () => contextAnswer(),
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => usageAnswer(),
        setPermissionMode: (mode: string) => {
          modes.push(mode)
          return Promise.resolve()
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

  /** The one session in flight — every test here drives a single chat. */
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
  function toolResultMessage(id: string, ok: boolean): SDKMessage {
    return {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: id, is_error: !ok, content: 'done' }]
      },
      parent_tool_use_id: null,
      uuid: 'u-result',
      session_id: 'sess-1'
    } as unknown as SDKMessage
  }

  const initMessage = {
    type: 'system',
    subtype: 'init',
    session_id: 'sess-1'
  } as unknown as SDKMessage

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

  /** A service with a project, a workspace and a stubbed agent. */
  async function withWorkspace(): Promise<{
    service: OctopusService
    projectId: string
    workspaceId: string
    events: ChatEvent[]
  }> {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const service = await createService({ ...paths(dir), query: fakeQuery() })
    const project = await service.addProjectFromPath(repo)
    const workspace = await service.createWorkspaceIn(project.id)

    const events: ChatEvent[] = []
    service.onAgentEvent((event) => events.push(event))

    return { service, projectId: project.id, workspaceId: workspace.id, events }
  }

  beforeEach(() => {
    agents = []
    offered = () => Promise.resolve([])
    contextAnswer = () => Promise.resolve(CONTEXT_RESPONSE)
    usageAnswer = () => Promise.resolve(USAGE_RESPONSE)
  })

  describe('what a session says about usage', () => {
    it('answers nothing about context before a session exists, and starts none', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      await expect(service.sessionUsage(chat.id)).resolves.toEqual({
        context: null,
        subscription: null
      })
      expect(agents).toHaveLength(0)
    })

    it('reports both readings once a session is running', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await expect(service.sessionUsage(chat.id)).resolves.toEqual({
        context: { percentage: 2, usedTokens: 23_921, maxTokens: 1_000_000 },
        subscription: {
          fiveHour: { utilization: 18, resetsAt: '2026-08-12T19:50:00.149775+00:00' },
          sevenDay: { utilization: 84, resetsAt: '2026-08-12T22:00:00.149796+00:00' }
        }
      })
    })

    // The subscription belongs to the account, so a workspace nobody has
    // spoken to should still show what another one's turn just learned.
    it('lends the account figure to a chat that has no session', async () => {
      const { service, projectId, workspaceId } = await withWorkspace()
      const spoken = await service.openChat(workspaceId)
      await service.sendToChat(spoken.id, 'work')
      await service.sessionUsage(spoken.id)

      const other = await service.createWorkspaceIn(projectId)
      const silent = await service.openChat(other.id)

      const usage = await service.sessionUsage(silent.id)
      expect(usage.subscription?.sevenDay?.utilization).toBe(84)
      expect(usage.context).toBeNull()
    })

    // Blanking the figure because one request was refused would report a change
    // in the account that never happened.
    it('keeps the last good reading when a later one fails', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      await service.sessionUsage(chat.id)

      usageAnswer = () => Promise.reject(new Error('unknown control request'))

      const usage = await service.sessionUsage(chat.id)
      expect(usage.subscription?.fiveHour?.utilization).toBe(18)
    })

    it('refuses a chat that does not exist', async () => {
      const { service } = await withWorkspace()

      await expect(service.sessionUsage('nope')).rejects.toThrow()
    })

    // A reading is a moment, not a record. Nothing about it belongs on disk.
    it('writes nothing to the state file', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')
      const before = await readFile(join(dir, 'state.json'), 'utf8')

      await service.sessionUsage(chat.id)

      await expect(readFile(join(dir, 'state.json'), 'utf8')).resolves.toBe(before)
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

    // The list is a convenience. A message must not fail because the names of
    // the models could not be read — the session itself already reports its own
    // failures through the event stream.
    it('sends the message anyway when the models cannot be read', async () => {
      const { service, workspaceId } = await withWorkspace()
      offered = () => Promise.reject(new Error('no such control request'))
      const chat = await service.openChat(workspaceId)

      await expect(service.sendToChat(chat.id, 'work')).resolves.toBeUndefined()
      expect(service.knownModels()).toEqual([])
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

    it('forwards the agent answer to whoever subscribed', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'hello')

      agent().emit(textMessage('there'))

      await vi.waitFor(() => {
        expect(events).toContainEqual({
          chatId: chat.id,
          workspaceId,
          event: { type: 'text', text: 'there' }
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
          expect.objectContaining({ role: 'agent', event: { type: 'text', text: 'done' } })
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

      expect(service.getConfig().alwaysAllowedTools).toEqual(['Edit'])

      // The second call must not ask at all.
      await expect(agent().ask('Edit')).resolves.toMatchObject({ behavior: 'allow' })
    })

    it('does not list a tool twice however often it is waved through', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      await service.updateConfig({ alwaysAllowedTools: ['Edit'] })
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'edit it')

      // Already allowed, so this one never reaches the user.
      await expect(agent().ask('Edit')).resolves.toMatchObject({ behavior: 'allow' })
      expect(events.some((entry) => entry.event.type === 'permission_request')).toBe(false)

      void agent().ask('Write')
      const requestId = await waitForRequest(events)
      await service.answerPermission(requestId, 'always')

      expect(service.getConfig().alwaysAllowedTools).toEqual(['Edit', 'Write'])
    })

    /*
     * Approving a plan is the moment planning ends, and both halves of that
     * have to happen or the interface starts lying: the stored record, so the
     * next session does not begin by planning all over again, and the running
     * session, so the work the plan describes can actually start.
     *
     * The mode it hands over to is the one chosen in the composer's footer —
     * that is what the footer is for, and until this it was read by nothing.
     */
    it('leaves planning for the chosen mode when a plan is approved', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatWorkingMode(chat.id, 'acceptEdits')
      await service.setChatPlanMode(chat.id, true)
      await service.sendToChat(chat.id, 'plan it')

      const decision = agent().ask('ExitPlanMode', { plan: '# Do the thing' })
      await service.answerPermission(await waitForRequest(events), 'allow')

      await expect(decision).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { plan: '# Do the thing' },
        updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
      })
      expect(service.listChats(workspaceId)[0]?.planMode).toBe(false)
      // The other half is untouched: leaving planning is not a reason to
      // forget how freely the agent was told it may work.
      expect(service.listChats(workspaceId)[0]?.workingMode).toBe('acceptEdits')
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
     * A standing "always" on the plan tool puts it in the list handed to the
     * SDK, which then approves every later plan itself and never calls back —
     * so there is no question, no dialog, no record that planning ended, and
     * the agent goes straight to editing. `config.ts` strips it on read; this
     * stops it being written in the first place.
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
      expect(service.pendingPermission(chat.id)).toEqual({
        requestId,
        toolName: 'ExitPlanMode',
        input: { plan: 'a plan' }
      })

      // And answering it still works, which is the point of recovering it.
      await service.answerPermission(requestId, 'allow')
      await expect(decision).resolves.toMatchObject({ behavior: 'allow' })
      expect(service.pendingPermission(chat.id)).toBeNull()
    })

    it('says nothing for a chat whose agent is waiting on nothing', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)

      expect(service.pendingPermission(chat.id)).toBeNull()
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

      expect(service.pendingPermission(first.id)).not.toBeNull()
      expect(service.pendingPermission(other.id)).toBeNull()
    })

    it('refuses a chat that does not exist', async () => {
      const { service } = await withWorkspace()

      expect(() => service.pendingPermission('chat-nothing')).toThrow(WorkspaceError)
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

    it('pre-approves the read-only tools and whatever the user allowed', async () => {
      const { service, workspaceId } = await withWorkspace()
      await service.updateConfig({ alwaysAllowedTools: ['Bash'] })
      const chat = await service.openChat(workspaceId)

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().allowedTools).toEqual([...READ_ONLY_TOOLS, 'Bash'])
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

    // Declining ends the turn rather than continuing it, so the workspace is
    // idle — leaving it 'running' would show a spinner against nothing.
    it('leaves the workspace idle when the answer is no', async () => {
      const { service, workspaceId, events } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'delete it')

      void agent().ask('Bash')
      await service.answerPermission(await waitForRequest(events), 'deny')

      const [workspace] = await service.listWorkspaces('planner')
      expect(workspace?.status).toBe('idle')
    })

    // Already answered, or the session it belonged to is gone.
    it('ignores an answer to a request nobody is waiting on', async () => {
      const { service } = await withWorkspace()

      await expect(service.answerPermission('r-nothing', 'allow')).resolves.toBeUndefined()
    })
  })

  describe('the mode', () => {
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

      expect(agent().flagSettings()).toEqual([{ effortLevel: 'low' }])
    })

    // Clearing the override means "whatever the agent would choose", which it
    // can only do at the start of a session. The record still changes, so the
    // next one obeys — but the turn in flight is left alone rather than being
    // sent a level nobody asked for.
    it('writes a cleared effort without pushing one at the running session', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'max')
      await service.sendToChat(chat.id, 'work')

      await service.setChatEffort(chat.id, null)

      expect(service.listChats(workspaceId)[0]?.effort).toBeNull()
      expect(agent().flagSettings()).toEqual([])
    })

    it('starts the next session with the effort the chat is now on', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.setChatEffort(chat.id, 'medium')

      await service.sendToChat(chat.id, 'work')

      expect(agent().options().effort).toBe('medium')
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
      await service.setChatWorkingMode(chat.id, 'acceptEdits')

      await service.sendToChat(chat.id, 'first')
      // Nothing pushed: a session built moments ago carries the mode already.
      expect(agent().options().permissionMode).toBe('acceptEdits')
      expect(agent().modes()).toEqual([])

      await service.sendToChat(chat.id, 'second')

      expect(agent().modes()).toEqual(['acceptEdits'])
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

  describe('shutting down', () => {
    // Every session holds a child process; unclosed, it outlives the app.
    it('closes every live session', async () => {
      const { service, workspaceId } = await withWorkspace()
      const chat = await service.openChat(workspaceId)
      await service.sendToChat(chat.id, 'work')

      await service.closeChats()

      expect(agent().closed()).toBe(1)
    })

    it('has nothing to do when no session was ever started', async () => {
      const { service } = await withWorkspace()

      await expect(service.closeChats()).resolves.toBeUndefined()
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
  })

  /** Waits for the request the agent is blocked on and answers with its id. */
  async function waitForRequest(events: ChatEvent[]): Promise<string> {
    await vi.waitFor(() => {
      expect(events.some((entry) => entry.event.type === 'permission_request')).toBe(true)
    })

    const found = events.find((entry) => entry.event.type === 'permission_request')
    if (found?.event.type !== 'permission_request') throw new Error('no request was emitted')

    return found.event.requestId
  }
})
