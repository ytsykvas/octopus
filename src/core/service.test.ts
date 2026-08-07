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

describe('типові шляхи', () => {
  it('без параметрів працює в ~/.maestro', async () => {
    const previousHome = process.env.HOME
    process.env.HOME = dir

    try {
      const withDefaults = await createService()
      expect(withDefaults.listProjects()).toHaveLength(0)
      expect(withDefaults.getConfig().version).toBe(1)

      // Конфіг мусив лягти саме в підтеку .maestro домашньої теки.
      await expect(readFile(join(dir, '.maestro', 'config.json'), 'utf8')).resolves.toContain(
        'deviceId'
      )
    } finally {
      process.env.HOME = previousHome
    }
  })
})

describe('конфіг', () => {
  it('на першому запуску створюється з типовими значеннями', () => {
    expect(service.getConfig().settingSources).toBe('none')
  })

  it('оновлення зберігається й переживає перезапуск', async () => {
    await service.updateConfig({ theme: 'dark', branchPrefix: 'ytsykvas' })

    const restarted = await createService(paths(dir))
    expect(restarted.getConfig()).toMatchObject({ theme: 'dark', branchPrefix: 'ytsykvas' })
  })

  it('оновлення повертає новий конфіг', async () => {
    const updated = await service.updateConfig({ settingSources: 'project' })
    expect(updated.settingSources).toBe('project')
    expect(service.getConfig().settingSources).toBe('project')
  })
})

describe('проєкти', () => {
  it('на початку список порожній', () => {
    expect(service.listProjects()).toHaveLength(0)
  })

  it('доданий проєкт з’являється у списку', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const project = await service.addProjectFromPath(repo)
    expect(project.name).toBe('planner')
    expect(service.listProjects()).toHaveLength(1)
  })

  it('проєкт переживає перезапуск застосунку', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await service.addProjectFromPath(repo)

    const restarted = await createService(paths(dir))
    expect(restarted.listProjects()).toHaveLength(1)
    expect(restarted.listProjects()[0]?.name).toBe('planner')
  })

  it('бере префікс гілок з конфігу', async () => {
    await service.updateConfig({ branchPrefix: 'ytsykvas' })
    const repo = join(dir, 'planner')
    await initRepo(repo)

    const project = await service.addProjectFromPath(repo)
    expect(project.branchPrefix).toBe('ytsykvas')
  })

  it('не додає ту саму теку двічі', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await service.addProjectFromPath(repo)

    await expect(service.addProjectFromPath(repo)).rejects.toThrow(/уже доданий/)
  })

  it('не додає теку, що не є репозиторієм', async () => {
    const plain = join(dir, 'просто-тека')
    await mkdir(plain)

    await expect(service.addProjectFromPath(plain)).rejects.toThrow(/не є git-репозиторієм/)
  })

  it('видалення прибирає проєкт зі списку й з диска', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    const project = await service.addProjectFromPath(repo)

    await service.removeProjectById(project.id)
    expect(service.listProjects()).toHaveLength(0)

    const restarted = await createService(paths(dir))
    expect(restarted.listProjects()).toHaveLength(0)
  })

  it('видалення неіснуючого проєкту не ламає стан', async () => {
    await expect(service.removeProjectById('немає')).resolves.toBeUndefined()
    expect(service.listProjects()).toHaveLength(0)
  })

  it('невдале додавання не псує вже збережений стан', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)
    await service.addProjectFromPath(repo)

    await expect(service.addProjectFromPath(join(dir, 'немає'))).rejects.toThrow()

    const restarted = await createService(paths(dir))
    expect(restarted.listProjects()).toHaveLength(1)
  })

  it('приймає власний виконавець git', async () => {
    const repo = join(dir, 'planner')
    await initRepo(repo)

    let calls = 0
    const custom = await createService({
      ...paths(join(dir, 'окремий')),
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
