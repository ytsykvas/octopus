import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CommandExec } from './accounts.js'
import type { RemoteRepository } from './github.js'
import { createService, type OctopusService } from './service.js'

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
    configFilePath: join(root, 'config.json')
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
