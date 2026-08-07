import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createService, type MaestroService } from './service.js'

const run = promisify(execFile)

let dir: string
let service: MaestroService

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
  dir = await mkdtemp(join(tmpdir(), 'maestro-service-'))
  service = await createService(paths(dir))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('default paths', () => {
  it('works in ~/.maestro when given no parameters', async () => {
    const previousHome = process.env.HOME
    process.env.HOME = dir

    try {
      const withDefaults = await createService()
      expect(withDefaults.listProjects()).toHaveLength(0)
      expect(withDefaults.getConfig().version).toBe(1)

      // The config must land in the .maestro subdirectory of the home directory.
      await expect(readFile(join(dir, '.maestro', 'config.json'), 'utf8')).resolves.toContain(
        'deviceId'
      )
    } finally {
      process.env.HOME = previousHome
    }
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
