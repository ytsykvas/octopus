/**
 * Where a skill the agent holds — and octopus never wrote — comes from.
 *
 * Pure, with nothing behind it, because the renderer reads the tuple below as a
 * value to order its groups, and a value reached out of a module that pulls in
 * Node has broken the window at runtime while every check stayed green
 * (`CLAUDE.md`; listed in `docs/core.md`'s first table). The one import is a
 * type, and types are erased.
 */

import type { AgentSkill } from './agent.js'

/**
 * The four sources, in the order the panel draws them.
 *
 * One tuple for both the type and the order, so a source added here is a
 * label TypeScript demands in the panel rather than a group nobody draws.
 */
export const SESSION_SKILL_SOURCES = ['builtin', 'plugin', 'synced', 'own'] as const
export type SessionSkillSource = (typeof SESSION_SKILL_SOURCES)[number]

/**
 * Whether a skill from this source can be kept from the agent one at a time.
 *
 * Not a plugin's. Read out of the CLI itself (agent SDK 0.3.299): the
 * function that resolves a skill's override returns "on" for any command whose
 * source is a plugin, before it looks at `skillOverrides`. Measured too — a
 * live session kept `commit-commands:commit` with it set to `off` while
 * `dataviz` and `docx` beside it left. A plugin goes as a whole, through
 * Claude Code's `/plugin`, and a switch here would be a promise with nothing
 * behind it.
 */
export function withholdable(source: SessionSkillSource): boolean {
  return source !== 'plugin'
}

export interface DescribedSkill {
  readonly source: SessionSkillSource
  /** The key the CLI knows it by, unchanged — `plugin:skill` reads unambiguously. */
  readonly name: string
  /** With the source's own label taken off, since the group heading says it. */
  readonly description: string
}

/**
 * Observed, not documented: the CLI appends this to the description of every
 * skill synced down from the claude.ai account. Measured against a live
 * session (agent SDK 0.3.299) on all thirteen of them, and on nothing else.
 */
const SYNCED_SUFFIX = ' (claude.ai sync)'

/** `(commit-commands) Create a git commit` — the plugin's name, leading. */
const PLUGIN_PREFIX = /^\([^)]*\)\s*/

/**
 * Which source a held skill belongs to, and how it reads under that heading.
 *
 * The checks run from the best-founded signal to the weakest, and the order is
 * the point:
 *
 * 1. `builtin` is the SDK's own documented flag for Claude Code's skills.
 * 2. The sync suffix comes next, because a synced skill may also carry a
 *    namespace — `anthropic-skills:deep-research` is synced, not a plugin.
 * 3. A `plugin:skill` name is how the CLI keys a plugin's skill.
 * 4. Anything else is the user's own — `~/.claude/skills`, or an MCP
 *    server's.
 *
 * If the CLI ever changes the undocumented suffix, those skills fall through
 * to "own". They are drawn under the wrong heading, never lost and never
 * unswitchable: the key is untouched either way.
 */
export function describeSessionSkill(skill: AgentSkill): DescribedSkill {
  const { name, description } = skill

  if (skill.builtin) return { source: 'builtin', name, description }

  if (description.endsWith(SYNCED_SUFFIX)) {
    return { source: 'synced', name, description: description.slice(0, -SYNCED_SUFFIX.length) }
  }

  if (name.includes(':')) {
    return { source: 'plugin', name, description: description.replace(PLUGIN_PREFIX, '') }
  }

  return { source: 'own', name, description }
}
