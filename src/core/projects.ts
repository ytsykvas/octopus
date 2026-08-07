/**
 * Додавання репозиторію як проєкту.
 *
 * Це шар над `git.ts` і `store.ts`: перевіряє, що тека придатна, і збирає
 * запис проєкту. Сам запис на диск робить викликач.
 */

import {
  detectBaseBranch,
  type GitExec,
  gitIn,
  findRepositoryRoot,
  hasCommits,
  repositoryName,
  toSlug
} from './git.js'
import type { Project, State } from './store.js'

/** Тека не годиться як проєкт — з поясненням, зрозумілим користувачу. */
export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectValidationError'
  }
}

export interface RepositoryInfo {
  /** Корінь репозиторію — може відрізнятися від вибраної теки. */
  readonly root: string
  readonly name: string
  readonly baseBranch: string
}

/**
 * Перевіряє теку й збирає відомості про репозиторій.
 *
 * Кидає {@link ProjectValidationError} з поясненням причини, а не повертає
 * null: користувачу треба показати, **чому** тека не підійшла.
 */
export async function inspectRepository(
  path: string,
  makeExec: (cwd: string) => GitExec = gitIn
): Promise<RepositoryInfo> {
  const exec = makeExec(path)

  const root = await findRepositoryRoot(exec)
  if (!root) {
    throw new ProjectValidationError(`Тека ${path} не є git-репозиторієм`)
  }

  const rootExec = makeExec(root)

  if (!(await hasCommits(rootExec))) {
    throw new ProjectValidationError(
      `Репозиторій ${root} порожній. Зробіть перший коміт — worktree неможливо створити без жодного.`
    )
  }

  const baseBranch = await detectBaseBranch(rootExec)
  if (!baseBranch) {
    throw new ProjectValidationError(
      `Не вдалося визначити базову гілку в ${root}. Перейдіть на потрібну гілку й спробуйте ще раз.`
    )
  }

  return { root, name: repositoryName(root), baseBranch }
}

/**
 * Підбирає вільний ідентифікатор проєкту.
 *
 * Два репозиторії можуть називатися однаково (напр. `app` у різних теках),
 * тому до зайнятого slug додається числовий суфікс.
 */
export function uniqueProjectId(baseSlug: string, taken: readonly string[]): string {
  if (!taken.includes(baseSlug)) return baseSlug

  for (let suffix = 2; ; suffix++) {
    const candidate = `${baseSlug}-${String(suffix)}`
    if (!taken.includes(candidate)) return candidate
  }
}

/**
 * Збирає запис проєкту з теки.
 *
 * Не змінює стан — лише готує значення для `addProject`.
 */
export async function createProject(
  path: string,
  branchPrefix: string,
  state: State,
  makeExec: (cwd: string) => GitExec = gitIn
): Promise<Project> {
  const info = await inspectRepository(path, makeExec)

  const duplicate = state.projects.find((project) => project.repoPath === info.root)
  if (duplicate) {
    throw new ProjectValidationError(`Репозиторій уже доданий як проєкт «${duplicate.name}»`)
  }

  const taken = state.projects.map((project) => project.id)

  return {
    id: uniqueProjectId(toSlug(info.name), taken),
    name: info.name,
    repoPath: info.root,
    baseBranch: info.baseBranch,
    branchPrefix
  }
}
