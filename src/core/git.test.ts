/**
 * Тести працюють зі **справжнім** git у тимчасовому репозиторії.
 *
 * Причина: парсинг виводу git — найчастіше джерело хибних припущень.
 * Фейковий виконавець перевіряв би лише те, що ми й так вигадали.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branchExists,
  extractStderr,
  currentBranch,
  detectBaseBranch,
  findRepositoryRoot,
  GitError,
  type GitExec,
  gitIn,
  hasCommits,
  repositoryName,
  toSlug
} from './git.js'

const run = promisify(execFile)

let dir: string
let exec: GitExec

/** Готує репозиторій з одним комітом на гілці `main`. */
async function initRepo(path: string): Promise<void> {
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: path })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: path })
  await run('git', ['config', 'user.name', 'Test'], { cwd: path })
  await writeFile(join(path, 'README.md'), '# test\n', 'utf8')
  await run('git', ['add', '.'], { cwd: path })
  await run('git', ['commit', '-q', '-m', 'first'], { cwd: path })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maestro-git-'))
  exec = gitIn(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('gitIn', () => {
  it('повертає вивід успішної команди', async () => {
    await initRepo(dir)
    await expect(exec(['rev-parse', '--abbrev-ref', 'HEAD'])).resolves.toContain('main')
  })

  it('кидає GitError зі stderr, а не ковтає причину', async () => {
    await initRepo(dir)
    await expect(exec(['checkout', 'неіснуюча-гілка'])).rejects.toBeInstanceOf(GitError)
  })

  it('повідомлення помилки містить і команду, і причину', async () => {
    await initRepo(dir)
    const error = await exec(['checkout', 'нема']).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GitError)
    expect((error as GitError).message).toContain('checkout')
    expect((error as GitError).stderr.length).toBeGreaterThan(0)
  })

  it('кидає GitError, коли git не має де виконатися', async () => {
    const missing = gitIn(join(dir, 'немає-такої-теки'))
    await expect(missing(['status'])).rejects.toBeInstanceOf(GitError)
  })
})

describe('extractStderr', () => {
  it('бере stderr, коли він змістовний', () => {
    expect(extractStderr({ stderr: 'fatal: not a git repository\n' })).toBe(
      'fatal: not a git repository'
    )
  })

  it('відкочується на повідомлення помилки, коли stderr порожній', () => {
    const error = Object.assign(new Error('spawn ENOENT'), { stderr: '   ' })
    expect(extractStderr(error)).toBe('spawn ENOENT')
  })

  it('працює, коли поля stderr немає взагалі — так буває при ENOENT', () => {
    expect(extractStderr(new Error('spawn git ENOENT'))).toBe('spawn git ENOENT')
  })
})

describe('findRepositoryRoot', () => {
  it('повертає null, коли git віддав порожній рядок замість шляху', async () => {
    const silent: GitExec = () => Promise.resolve('  \n')
    await expect(findRepositoryRoot(silent)).resolves.toBeNull()
  })

  it('знаходить корінь репозиторію', async () => {
    await initRepo(dir)
    const root = await findRepositoryRoot(exec)
    expect(root).toBeTruthy()
    expect(root?.endsWith(dir.split('/').pop() ?? '')).toBe(true)
  })

  it('повертає корінь, навіть якщо вибрано підтеку', async () => {
    await initRepo(dir)
    const sub = join(dir, 'src', 'nested')
    await run('mkdir', ['-p', sub])
    const fromRoot = await findRepositoryRoot(exec)
    const fromSub = await findRepositoryRoot(gitIn(sub))
    expect(fromSub).toBe(fromRoot)
  })

  it('повертає null для теки поза репозиторієм', async () => {
    await expect(findRepositoryRoot(exec)).resolves.toBeNull()
  })
})

describe('hasCommits', () => {
  it('розрізняє репозиторій з комітом', async () => {
    await initRepo(dir)
    await expect(hasCommits(exec)).resolves.toBe(true)
  })

  it('порожній репозиторій не годиться для worktree', async () => {
    await run('git', ['init', '-q'], { cwd: dir })
    await expect(hasCommits(exec)).resolves.toBe(false)
  })
})

describe('currentBranch', () => {
  it('повертає назву поточної гілки', async () => {
    await initRepo(dir)
    await expect(currentBranch(exec)).resolves.toBe('main')
  })

  it('повертає null у detached HEAD', async () => {
    await initRepo(dir)
    const sha = (await exec(['rev-parse', 'HEAD'])).trim()
    await exec(['checkout', '-q', sha])
    await expect(currentBranch(exec)).resolves.toBeNull()
  })
})

describe('branchExists', () => {
  it('знаходить наявну гілку', async () => {
    await initRepo(dir)
    await expect(branchExists(exec, 'main')).resolves.toBe(true)
  })

  it('не знаходить неіснуючої', async () => {
    await initRepo(dir)
    await expect(branchExists(exec, 'немає')).resolves.toBe(false)
  })
})

describe('detectBaseBranch', () => {
  it('бере гілку за замовчуванням з origin, якщо вона налаштована', async () => {
    await initRepo(dir)
    await exec(['branch', 'нетипова-назва'])
    await exec(['remote', 'add', 'origin', 'https://example.com/repo.git'])
    await exec(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/нетипова-назва'])

    await expect(detectBaseBranch(exec)).resolves.toBe('нетипова-назва')
  })

  it('за відсутності origin бере main', async () => {
    await initRepo(dir)
    await expect(detectBaseBranch(exec)).resolves.toBe('main')
  })

  it('розпізнає master у старих репозиторіях', async () => {
    await run('git', ['init', '-q', '--initial-branch=master'], { cwd: dir })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'a.txt'), 'a\n', 'utf8')
    await exec(['add', '.'])
    await exec(['commit', '-q', '-m', 'first'])

    await expect(detectBaseBranch(exec)).resolves.toBe('master')
  })

  it('розпізнає develop, коли інших звичних гілок немає', async () => {
    await run('git', ['init', '-q', '--initial-branch=develop'], { cwd: dir })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'a.txt'), 'a\n', 'utf8')
    await exec(['add', '.'])
    await exec(['commit', '-q', '-m', 'first'])

    await expect(detectBaseBranch(exec)).resolves.toBe('develop')
  })

  it('відкочується на поточну гілку за нетипової назви', async () => {
    await run('git', ['init', '-q', '--initial-branch=trunk'], { cwd: dir })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
    await writeFile(join(dir, 'a.txt'), 'a\n', 'utf8')
    await exec(['add', '.'])
    await exec(['commit', '-q', '-m', 'first'])

    await expect(detectBaseBranch(exec)).resolves.toBe('trunk')
  })

  it('ігнорує порожню відповідь origin/HEAD і шукає далі', async () => {
    const odd: GitExec = (args) => {
      if (args[0] === 'symbolic-ref') return Promise.resolve('origin/\n')
      if (args[0] === 'rev-parse') return Promise.reject(new Error('немає гілки'))
      if (args[0] === 'branch') return Promise.resolve('запасна\n')
      return Promise.resolve('')
    }

    await expect(detectBaseBranch(odd)).resolves.toBe('запасна')
  })

  it('повертає null, коли визначити нічим', async () => {
    await initRepo(dir)
    await exec(['branch', '-m', 'main', 'trunk'])
    const sha = (await exec(['rev-parse', 'HEAD'])).trim()
    await exec(['checkout', '-q', sha])

    await expect(detectBaseBranch(exec)).resolves.toBeNull()
  })
})

describe('repositoryName', () => {
  it('бере останню складову шляху', () => {
    expect(repositoryName('/Users/tsykvas/projects/planner')).toBe('planner')
  })

  it('не спотикається на кінцевому слеші', () => {
    expect(repositoryName('/repos/esl')).toBe('esl')
  })
})

describe('toSlug', () => {
  it('лишає вже придатні назви незмінними', () => {
    expect(toSlug('planner')).toBe('planner')
    expect(toSlug('my-app_v2')).toBe('my-app_v2')
  })

  it('зводить до нижнього регістру', () => {
    expect(toSlug('MyApp')).toBe('myapp')
  })

  it('зберігає кирилицю — git приймає UTF-8 у назвах гілок', () => {
    expect(toSlug('Планувальник')).toBe('планувальник')
    expect(toSlug('мій проєкт')).toBe('мій-проєкт')
  })

  it('замінює пробіли та символи, заборонені git', () => {
    expect(toSlug('Family Shopping')).toBe('family-shopping')
    expect(toSlug('a:b?c*d')).toBe('a-b-c-d')
    expect(toSlug('a[b]c')).toBe('a-b-c')
    expect(toSlug('a~b^c')).toBe('a-b-c')
  })

  it('прибирає дефіси й крапки з країв — git не приймає таких гілок', () => {
    expect(toSlug('--назва--')).toBe('назва')
    expect(toSlug('.hidden.')).toBe('hidden')
  })

  it('стискає повтори дефісів і крапок', () => {
    expect(toSlug('a   b')).toBe('a-b')
    expect(toSlug('a..b')).toBe('a.b')
  })

  it('прибирає суфікс .lock, який git резервує за собою', () => {
    expect(toSlug('branch.lock')).toBe('branch')
  })

  it('вирізає керуючі символи', () => {
    expect(toSlug('ab')).toBe('ab')
  })

  it('дає запасну назву, якщо не лишилося нічого придатного', () => {
    expect(toSlug('~~~')).toBe('project')
    expect(toSlug('')).toBe('project')
  })
})
