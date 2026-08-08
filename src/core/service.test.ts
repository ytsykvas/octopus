import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CommandExec } from './accounts.js'
import type { RemoteRepository } from './github.js'
import { gitIn } from './git.js'
import { WORKSPACE_NAMES } from './names.js'
import { ProjectValidationError } from './projects.js'
import { createService, type OctopusService } from './service.js'
import { listWorktrees } from './worktree.js'

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
    // With no worktrees reported, the workspace reads as missing.
    expect(listed[0]?.missing).toBe(true)
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
