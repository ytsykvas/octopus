/**
 * The identifiers the whole application shares.
 *
 * Only identifiers: the records themselves are the zod inferences in
 * `store.ts`, and they belong there because the schema is what validates them.
 * Hand-written copies lived here once and drifted eight fields apart from the
 * schema without anything noticing — a type-only module emits no code, so
 * coverage could never have said so.
 *
 * This module deliberately has no imports — neither Electron nor Node.
 * Both the main process and the renderer are free to import it (§11.1).
 */

/** Active colour theme (§10.6). */
export type ThemeName = 'light' | 'dark'

/** Project slug, derived from the repository name. */
export type ProjectId = string

/** Workspace identifier, stable for the workspace's whole lifetime. */
export type WorkspaceId = string

/** Chat identifier. Also the name of the file its transcript lives in. */
export type ChatId = string
