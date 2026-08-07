/**
 * Низькорівневі операції з git.
 *
 * Усі виклики йдуть через `execFile` — **ніколи** через `exec`. Назви гілок
 * і шляхи приходять від користувача, а `exec` віддав би їх шелу, що є прямою
 * ін'єкцією команд (§11.2 docs/PROJECT.md).
 */

import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'

import { describeError } from './persist.js'

const run = promisify(execFile)

/**
 * Виконавець git-команд.
 *
 * Передається параметром у кожну функцію, щоб логіку можна було тестувати
 * без запуску git, а самі команди — перевіряти на справжньому репозиторії.
 */
export type GitExec = (args: readonly string[]) => Promise<string>

/** Помилка виконання git — несе stderr, а не ковтає його (§13). */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string
  ) {
    super(`git ${args.join(' ')} завершився помилкою: ${stderr}`)
    this.name = 'GitError'
  }
}

/**
 * Дістає з помилки виконання найзмістовніше пояснення.
 *
 * `execFile` кладе вивід у `stderr`, але не завжди: при ENOENT його немає
 * зовсім, а при частині збоїв він порожній. Винесено окремо, щоб цю
 * непослідовність можна було перевірити тестом напряму.
 */
export function extractStderr(error: unknown): string {
  const fromField =
    typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : ''

  return fromField.trim() || describeError(error)
}

/** Створює виконавця, прив'язаного до теки репозиторію. */
export function gitIn(cwd: string): GitExec {
  return async (args) => {
    try {
      const { stdout } = await run('git', [...args], { cwd, maxBuffer: 32 * 1024 * 1024 })
      return stdout
    } catch (error) {
      throw new GitError(args, extractStderr(error))
    }
  }
}

/**
 * Корінь робочого дерева, або null якщо тека не в репозиторії.
 *
 * Повертає саме корінь, а не переданий шлях: користувач може вибрати
 * підтеку, і проєкт має прив'язатися до репозиторію, а не до неї.
 */
export async function findRepositoryRoot(exec: GitExec): Promise<string | null> {
  try {
    const out = await exec(['rev-parse', '--show-toplevel'])
    return out.trim() || null
  } catch {
    return null
  }
}

/** Чи має репозиторій хоча б один коміт. Порожній репо не годиться для worktree. */
export async function hasCommits(exec: GitExec): Promise<boolean> {
  try {
    await exec(['rev-parse', '--verify', 'HEAD'])
    return true
  } catch {
    return false
  }
}

/** Поточна гілка, або null у detached HEAD. */
export async function currentBranch(exec: GitExec): Promise<string | null> {
  const out = (await exec(['branch', '--show-current'])).trim()
  return out || null
}

/** Чи існує локальна гілка з такою назвою. */
export async function branchExists(exec: GitExec, branch: string): Promise<boolean> {
  try {
    await exec(['rev-parse', '--verify', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

/**
 * Визначає базову гілку репозиторію.
 *
 * Порядок: гілка за замовчуванням у origin → поширені назви → поточна гілка.
 * Останній крок важливий для репозиторіїв з нетиповим іменуванням.
 */
export async function detectBaseBranch(exec: GitExec): Promise<string | null> {
  try {
    const out = (await exec(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim()
    const name = out.replace(/^origin\//, '')
    if (name) return name
  } catch {
    // origin/HEAD не налаштований — звичайна ситуація для локальних репозиторіїв.
  }

  for (const candidate of ['main', 'master', 'develop']) {
    if (await branchExists(exec, candidate)) return candidate
  }

  return currentBranch(exec)
}

/** Назва репозиторію — остання складова шляху до його кореня. */
export function repositoryName(repoRoot: string): string {
  return basename(repoRoot)
}

/**
 * Перетворює довільний рядок на безпечний slug для тек і гілок.
 *
 * Юнікод свідомо зберігається: git приймає UTF-8 у назвах гілок, і українські
 * назви мають лишатися читабельними. Вирізається лише те, що git справді
 * забороняє (`git check-ref-format`): пробіли, `~^:?*[\`, керуючі символи,
 * подвійні крапки, крайні крапки й дефіси, суфікс `.lock`.
 */
export function toSlug(value: string): string {
  const slug = value
    .toLowerCase()
    // eslint-disable-next-line no-control-regex -- саме керуючі символи git і відхиляє
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/[\s~^:?*[\]\\@{}]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/\.lock$/, '')

  return slug || 'project'
}
