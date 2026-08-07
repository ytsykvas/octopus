/**
 * Базові типи ядра.
 *
 * Модуль свідомо не має жодних імпортів — ані Electron, ані Node.
 * Його вільно імпортує і main-процес, і renderer (див. §11.1 docs/PROJECT.md).
 */

/** Активна тема оформлення (§10.7). */
export type ThemeName = 'light' | 'dark'

/** Slug проєкту, похідний від назви репозиторію. */
export type ProjectId = string

/** Ідентифікатор воркспейсу, стабільний протягом його життя. */
export type WorkspaceId = string

/** Стан воркспейсу в його життєвому циклі. */
export type WorkspaceStatus = 'idle' | 'running' | 'waiting_permission' | 'error' | 'archived'

export interface Project {
  readonly id: ProjectId
  readonly name: string
  /** Абсолютний шлях до основного репозиторію. */
  readonly repoPath: string
  /** Гілка, від якої створюються воркспейси і проти якої рахується дифф. */
  readonly baseBranch: string
  /** Префікс гілок, напр. GitHub-username. */
  readonly branchPrefix: string
}

export interface Workspace {
  readonly id: WorkspaceId
  readonly projectId: ProjectId
  readonly name: string
  readonly branch: string
  /** Абсолютний шлях до git worktree. */
  readonly path: string
  readonly status: WorkspaceStatus
  /** session_id Claude Code; null, поки сесія не стартувала. */
  readonly sessionId: string | null
  /** Порт для dev-сервера, детермінований з id. */
  readonly port: number
  readonly createdAt: string
  /**
   * Місце під майбутню багатокористувацькість (§15.3).
   * Наразі завжди null — структура просто не припускає одного користувача.
   */
  readonly ownerId: string | null
}

/**
 * Нормалізована подія агента.
 *
 * Шар ізоляції від Agent SDK: UI знає лише цей тип, тому зміни у формі
 * повідомлень SDK не течуть у renderer (§11.2).
 */
export type AgentEvent =
  | { readonly type: 'session_started'; readonly sessionId: string }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly text: string }
  | {
      readonly type: 'tool_use'
      readonly toolUseId: string
      readonly name: string
      readonly input: unknown
    }
  | {
      readonly type: 'tool_result'
      readonly toolUseId: string
      readonly ok: boolean
      readonly content: string
    }
  | {
      readonly type: 'permission_request'
      readonly requestId: string
      readonly toolName: string
      readonly input: unknown
    }
  | {
      readonly type: 'result'
      readonly ok: boolean
      readonly costUsd: number | null
      readonly durationMs: number | null
    }
  | { readonly type: 'error'; readonly message: string }
