/**
 * The answers of "always", and how narrow each one is.
 *
 * "Always allow" used to write the **tool name**, so answering it on one file
 * under `.claude/` granted every `Edit` in every workspace from then on. A
 * standing approval an order of magnitude wider than the question asked is the
 * kind that gets granted once and regretted quietly, and §4 puts transparency
 * first.
 *
 * The SDK offers the narrow rule it actually meant, in the third argument to
 * `canUseTool`: `{ toolName: 'Edit', ruleContent: '/.claude/skills/demo/**' }`.
 * That is what is stored now, and `ruleContent` absent still means the whole
 * tool — which is what every answer written before this meant.
 *
 * **Matched here rather than by the SDK**, and that is deliberate. A name in
 * `allowedTools` is approved before `canUseTool` is consulted, so one handed
 * over at session start cannot be taken back until the session ends — unticking
 * it in Settings would change nothing the agent was already doing. These are
 * read on every call instead, against the config as it stands at that moment.
 */

import { z } from 'zod'

/**
 * One standing answer.
 *
 * A bare string is accepted and normalised, because that is what every config
 * written before this holds and it means exactly "the whole tool". A default
 * rather than a version bump, which is the convention `StateSchema` states.
 */
export const StandingPermissionSchema = z.union([
  z
    .string()
    .min(1)
    .transform((toolName) => ({ toolName, ruleContent: null })),
  z.object({
    toolName: z.string().min(1),
    /** What the answer was about; null grants the tool everywhere. */
    ruleContent: z.string().min(1).nullable().default(null)
  })
])

export type StandingPermission = z.infer<typeof StandingPermissionSchema>

/**
 * Whether a standing answer covers this call.
 *
 * **Conservative on purpose.** `ruleContent` is a glob in Claude Code's own
 * syntax, and a matcher that reads it loosely grants more than the person
 * answering agreed to — the failure this whole change is about. So only the
 * literal part before the first wildcard is used, and a call it cannot decide
 * is one the user is asked about again. Narrower than the rule says is safe;
 * wider is the bug.
 *
 * An empty prefix — a rule that begins with a wildcard — matches nothing here
 * for the same reason: `**` at the start would otherwise be "every path", which is the
 * width the narrow rule exists to avoid.
 */
export function covers(permission: StandingPermission, toolName: string, input: unknown): boolean {
  if (permission.toolName !== toolName) return false
  if (permission.ruleContent === null) return true

  const prefix = literalPrefix(permission.ruleContent)
  if (prefix === null) return false

  const path = pathOf(input)

  return path !== null && (path === prefix || path.startsWith(withSlash(prefix)))
}

/** Whether any of them does. */
export function allowedStanding(
  permissions: readonly StandingPermission[],
  toolName: string,
  input: unknown
): boolean {
  return permissions.some((permission) => covers(permission, toolName, input))
}

/**
 * Adds an answer, keeping the narrowest reading of what was granted.
 *
 * A rule for the whole tool replaces the narrow ones it makes redundant, and a
 * narrow one is not added where the whole tool is already granted — otherwise
 * the list grows a row per file for a permission somebody already has, and the
 * Settings screen stops being readable.
 */
export function withStanding(
  permissions: readonly StandingPermission[],
  added: StandingPermission
): StandingPermission[] {
  const others = permissions.filter((permission) => permission.toolName !== added.toolName)
  const mine = permissions.filter((permission) => permission.toolName === added.toolName)

  if (mine.some((permission) => permission.ruleContent === null)) return [...permissions]
  if (added.ruleContent === null) return [...others, added]

  const already = mine.some((permission) => permission.ruleContent === added.ruleContent)

  return already ? [...permissions] : [...permissions, added]
}

/**
 * Reads a rule as Claude Code writes it: `Edit(/w/docs/**)`, or `Edit` alone.
 *
 * The inverse of `standingKey`, and the one place that form is understood.
 * Null for anything that is not a rule — a settings file is somebody else's,
 * and a line nobody can read is dropped rather than guessed at.
 */
export function parseStandingRule(text: string): StandingPermission | null {
  const match = /^([A-Za-z_][\w-]*)(?:\((.*)\))?$/u.exec(text.trim())
  if (!match) return null

  const [, toolName, ruleContent] = match

  /* Unreachable: the first group is not optional, so a match always has one.
     The guard is here because an indexed read is `T | undefined`. */
  /* v8 ignore next */
  if (toolName === undefined) return null

  return {
    toolName,
    ruleContent: ruleContent === undefined || ruleContent === '' ? null : ruleContent
  }
}

/** What a standing answer is stored and shown under; unique across the list. */
export function standingKey(permission: StandingPermission): string {
  return permission.ruleContent === null
    ? permission.toolName
    : `${permission.toolName}(${permission.ruleContent})`
}

/**
 * The directory a rule is certainly about, or null when there is not one.
 *
 * A wildcard is only read where it opens a path segment — `/w/docs/**` says
 * "under `/w/docs`", and nothing else has to be understood to know that. A
 * wildcard **inside** a segment is not read at all: truncating `/w/src/comp*.ts`
 * to its parent would grant the whole of `/w/src`, which is wider than the rule
 * says and is the exact failure this module exists to prevent. Null means the
 * user is asked again, which costs a click and grants nothing.
 */
function literalPrefix(rule: string): string | null {
  const at = rule.search(/[*?[{]/u)
  if (at === -1) return rule === '' ? null : rule

  const literal = rule.slice(0, at)

  return literal.endsWith('/') && literal !== '/' ? literal.replace(/\/$/u, '') : null
}

/** A trailing separator, so a prefix matches a directory and not a name. */
function withSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

/**
 * The path a tool call is about, where it has one.
 *
 * Only the argument every file tool names it by. A `Bash` command has no path
 * argument at all, so a narrow rule never covers one — which is the safe
 * answer: the user is asked again.
 */
function pathOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null

  const value = (input as Record<string, unknown>).file_path
  return typeof value === 'string' && value !== '' ? value : null
}
