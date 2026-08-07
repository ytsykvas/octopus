import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CommandExec } from './accounts.js'
import type { RemoteRepository } from './github.js'
import { gitIn } from './git.js'
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
    expect(workspace.name).toBe('anna')

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

    await service.renameProjectById(project.id, 'Weekly planner')
    expect(service.listProjects()[0]?.name).toBe('Weekly planner')

    const restarted = await createService(paths(dir))
    expect(restarted.listProjects()[0]?.name).toBe('Weekly planner')
  })

  it('refuses to rename a project that is not there', async () => {
    await expect(service.renameProjectById('missing', 'Name')).rejects.toThrow()
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
