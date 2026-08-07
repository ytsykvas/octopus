/**
 * Єдине джерело правди для всіх шляхів на диску.
 *
 * Жодного хардкоду `~/Library` чи `/Users/...` — усе через `path.join`,
 * щоб та сама збірка працювала на macOS і на Linux (§11.2 docs/PROJECT.md).
 *
 * Кожна функція приймає базову теку параметром із розумним типовим значенням:
 * це робить модуль тестованим без моків файлової системи.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ProjectId, WorkspaceId } from './types.js'

const ROOT_DIR_NAME = '.maestro'

/** Коренева тека даних застосунку: `~/.maestro`. */
export function rootDir(home: string = homedir()): string {
  return join(home, ROOT_DIR_NAME)
}

/** Глобальні налаштування: `~/.maestro/config.json`. */
export function configFile(root: string = rootDir()): string {
  return join(root, 'config.json')
}

/** Стан воркспейсів: `~/.maestro/state.json`. */
export function stateFile(root: string = rootDir()): string {
  return join(root, 'state.json')
}

/**
 * Тимчасовий файл для атомарного запису стану.
 * Запис іде сюди, далі `rename` — щоб аварійне завершення не лишило
 * обрізаний `state.json` (§11.2).
 */
export function stateTempFile(root: string = rootDir()): string {
  return join(root, 'state.json.tmp')
}

/** Тека метаданих проєкту: `~/.maestro/projects/<projectId>`. */
export function projectDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(root, 'projects', projectId)
}

/** Тека скриптів проєкту. */
export function projectScriptsDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectDir(projectId, root), 'scripts')
}

/** Скрипт підготовки воркспейсу після `git worktree add`. */
export function setupScript(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectScriptsDir(projectId, root), 'setup.sh')
}

/** Скрипт запуску dev-сервера; отримує `$MAESTRO_PORT`. */
export function runScript(projectId: ProjectId, root: string = rootDir()): string {
  return join(projectScriptsDir(projectId, root), 'run.sh')
}

/** Тека всіх воркспейсів проєкту. */
export function workspacesDir(projectId: ProjectId, root: string = rootDir()): string {
  return join(root, 'workspaces', projectId)
}

/** Тека конкретного воркспейсу — вона ж корінь git worktree. */
export function workspacePath(
  projectId: ProjectId,
  workspaceId: WorkspaceId,
  root: string = rootDir()
): string {
  return join(workspacesDir(projectId, root), workspaceId)
}
