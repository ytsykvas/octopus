/**
 * What kind of work a workspace holds.
 *
 * Shown on the workspace's card so a list of a dozen branches says at a glance
 * which are features and which are bugs, and carried in the branch name
 * (`<prefix>/<kind>/<name>`) so the same answer reaches git and GitHub.
 */

import { z } from 'zod'

import type { ProjectColor } from './colors.js'

/**
 * The kinds, in the order the picker lists them.
 *
 * A fixed set rather than labels the user makes up: each one is a segment of
 * a branch name and a word in three locales, and a free-form label could be
 * neither without a check on every keystroke.
 */
export const WORKSPACE_KINDS = [
  'feature',
  'fix',
  'bug',
  'research',
  'tests',
  'refactor',
  'docs',
  'chore',
  'perf',
  'design',
  'security',
  'review'
] as const

export const WorkspaceKindSchema = z.enum(WORKSPACE_KINDS)
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>

/** A workspace always has a kind; this is the one it starts with. */
export const DEFAULT_WORKSPACE_KIND: WorkspaceKind = 'feature'

/**
 * The colour each kind is drawn in.
 *
 * Taken from the project palette, which is already declared once per theme,
 * rather than a second set of tokens nobody would keep in step with it.
 */
export const KIND_COLORS: Readonly<Record<WorkspaceKind, ProjectColor>> = {
  feature: 'blue',
  fix: 'amber',
  bug: 'red',
  research: 'violet',
  tests: 'teal',
  refactor: 'indigo',
  docs: 'sky',
  chore: 'slate',
  perf: 'lime',
  design: 'pink',
  security: 'rose',
  review: 'orange'
}

/** Whether a branch segment names a kind, rather than being part of a name. */
export function isWorkspaceKind(value: string): value is WorkspaceKind {
  return WorkspaceKindSchema.safeParse(value).success
}
