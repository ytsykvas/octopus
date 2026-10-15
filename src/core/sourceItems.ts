/**
 * The settings that can come from more than one place, and the places.
 *
 * Its own module, importing nothing Node-only, because the window needs these
 * as **values** — the overview table lists every item, and a badge names every
 * layer. `instructions.ts` and `scripts.ts` read files, so a constant imported
 * out of either would carry `node:fs` into the renderer; that broke the window
 * twice before (CLAUDE.md). The kinds are therefore listed again here, and a
 * test holds each list to the schema it mirrors.
 */

import { z } from 'zod'

import type { InstructionKind } from './instructions.js'
import type { ScriptKind } from './scripts.js'

/** The three scripts, in the order they run. Mirrors `ScriptKindSchema`. */
export const SOURCE_SCRIPT_KINDS: readonly ScriptKind[] = ['setup', 'run', 'archive']

/** The seven instructions, in the order the editors show them. Mirrors `InstructionKindSchema`. */
export const SOURCE_INSTRUCTION_KINDS: readonly InstructionKind[] = [
  'pullRequest',
  'commitMessage',
  'fixChecks',
  'addressReview',
  'review',
  'multiAgentReview',
  'resolveConflicts'
]

/**
 * Where a setting can come from, nearest first.
 *
 * - `repository` — the checkout's `.octopus/`, a fact about the branch;
 * - `project` — this project's own copy under `~/.octopus`;
 * - `global` — the installation's, for every project that wrote none;
 * - `template` — the text octopus ships, used when nothing else is written.
 *
 * Not every item has every layer: a script has no global copy, and nothing runs
 * from a script template — it is only where an editor starts.
 */
export type SourceLayer = 'repository' | 'project' | 'global' | 'template'

/** Every item that can come from the repository, named as `.octopus/` names its files. */
export const SOURCE_ITEM_IDS = [
  'script.setup',
  'script.run',
  'script.archive',
  'instruction.pullRequest',
  'instruction.commitMessage',
  'instruction.fixChecks',
  'instruction.addressReview',
  'instruction.review',
  'instruction.multiAgentReview',
  'instruction.resolveConflicts',
  'project.baseBranch',
  'project.envFile'
] as const

export const SourceItemIdSchema = z.enum(SOURCE_ITEM_IDS)
export type SourceItemId = z.infer<typeof SourceItemIdSchema>

export function scriptItem(kind: ScriptKind): SourceItemId {
  return `script.${kind}`
}

export function instructionItem(kind: InstructionKind): SourceItemId {
  return `instruction.${kind}`
}

/**
 * Why what the repository states is not what is in effect.
 *
 * Only the two project fields can be refused this way: a script or an
 * instruction from the repository is taken as it is, while a base branch and an
 * env file are checked against git first.
 */
export type SourceWarning =
  'baseBranchMissing' | 'envFileOutside' | 'envFileNotIgnored' | 'projectFileUnreadable'

/** One layer of one item, as the window draws it. */
export interface SourceLayerView {
  readonly layer: SourceLayer
  /** Where it was read from — a path in the checkout or under `~/.octopus`. Null for the template. */
  readonly from: string | null
  readonly body: string
}

/** Everything known about where one item comes from. */
export interface SourceView {
  readonly id: SourceItemId
  /** The layers that exist, nearest first. The template is always last where there is one. */
  readonly layers: readonly SourceLayerView[]
  /** The layer in effect, or null where nothing applies — a script nobody wrote does not run. */
  readonly effective: SourceLayer | null
  /** Whether the user chose their own over the repository's. */
  readonly preferLocal: boolean
  /** Why the repository's is not in effect although it states one, or null. */
  readonly warning: SourceWarning | null
}
