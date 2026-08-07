import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createProject,
  inspectRepository,
  ProjectValidationError,
  uniqueProjectId
} from './projects.js'
import { addProject, EMPTY_STATE, type State } from './store.js'

const run = promisify(execFile)

let dir: string

async function initRepo(path: string, branch = 'main'): Promise<void> {
  await run('git', ['init', '-q', `--initial-branch=${branch}`], { cwd: path })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  await run('git', ['config', 'user.name', 'Test'], { cwd: path })
  await writeFile(join(path, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: path })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: path })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maestro-projects-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('inspectRepository', () => {
  it('розпізнає готовий репозиторій', async () => {
    const repo = join(dir, 'planner')
    await mkdir(repo)
    await initRepo(repo)

    const info = await inspectRepository(repo)
    expect(info.name).toBe('planner')
    expect(info.baseBranch).toBe('main')
    expect(info.root).toContain('planner')
  })

  it('прив’язується до кореня, навіть якщо вибрано підтеку', async () => {
    const repo = join(dir, 'planner')
    await mkdir(repo)
    await initRepo(repo)
    const nested = join(repo, 'src', 'deep')
    await mkdir(nested, { recursive: true })

    const fromRoot = await inspectRepository(repo)
    const fromNested = await inspectRepository(nested)
    expect(fromNested.root).toBe(fromRoot.root)
    expect(fromNested.name).toBe('planner')
  })

  it('пояснює, що тека не є репозиторієм', async () => {
    await expect(inspectRepository(dir)).rejects.toBeInstanceOf(ProjectValidationError)
  })

  it('відмовляє порожньому репозиторію без жодного коміту', async () => {
    const repo = join(dir, 'empty')
    await mkdir(repo)
    await run('git', ['init', '-q'], { cwd: repo })

    await expect(inspectRepository(repo)).rejects.toThrow(/порожній/)
  })

  it('відмовляє, коли базову гілку визначити нічим', async () => {
    const repo = join(dir, 'detached')
    await mkdir(repo)
    await initRepo(repo, 'trunk')
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: repo })
    await run('git', ['branch', '-m', 'trunk', 'нетипова'], { cwd: repo })
    await run('git', ['checkout', '-q', stdout.trim()], { cwd: repo })
    await run('git', ['branch', '-D', 'нетипова'], { cwd: repo })

    await expect(inspectRepository(repo)).rejects.toThrow(/базову гілку/)
  })
})

describe('uniqueProjectId', () => {
  it('лишає вільний ідентифікатор без змін', () => {
    expect(uniqueProjectId('planner', [])).toBe('planner')
  })

  it('додає суфікс, коли ідентифікатор зайнятий', () => {
    expect(uniqueProjectId('planner', ['planner'])).toBe('planner-2')
  })

  it('шукає далі, поки не знайде вільний', () => {
    expect(uniqueProjectId('app', ['app', 'app-2', 'app-3'])).toBe('app-4')
  })
})

describe('createProject', () => {
  it('збирає запис проєкту з теки', async () => {
    const repo = join(dir, 'planner')
    await mkdir(repo)
    await initRepo(repo)

    const project = await createProject(repo, 'ytsykvas', EMPTY_STATE)
    expect(project).toMatchObject({
      id: 'planner',
      name: 'planner',
      baseBranch: 'main',
      branchPrefix: 'ytsykvas'
    })
  })

  it('відмовляє, якщо репозиторій уже доданий', async () => {
    const repo = join(dir, 'planner')
    await mkdir(repo)
    await initRepo(repo)

    const first = await createProject(repo, 'ytsykvas', EMPTY_STATE)
    const state: State = addProject(EMPTY_STATE, first)

    await expect(createProject(repo, 'ytsykvas', state)).rejects.toThrow(/уже доданий/)
  })

  it('розводить ідентифікатори однойменних репозиторіїв у різних теках', async () => {
    const first = join(dir, 'a', 'app')
    const second = join(dir, 'b', 'app')
    await mkdir(first, { recursive: true })
    await mkdir(second, { recursive: true })
    await initRepo(first)
    await initRepo(second)

    const one = await createProject(first, 'ytsykvas', EMPTY_STATE)
    const state = addProject(EMPTY_STATE, one)
    const two = await createProject(second, 'ytsykvas', state)

    expect(one.id).toBe('app')
    expect(two.id).toBe('app-2')
  })

  it('нормалізує назву репозиторію в ідентифікатор', async () => {
    const repo = join(dir, 'Family Shopping')
    await mkdir(repo)
    await initRepo(repo)

    const project = await createProject(repo, 'ytsykvas', EMPTY_STATE)
    expect(project.id).toBe('family-shopping')
    expect(project.name).toBe('Family Shopping')
  })
})
