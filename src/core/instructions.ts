/**
 * Instructions for the agent, per project and for the installation.
 *
 * Files rather than config strings, for the same reasons as the scripts: they
 * grow past what a text field holds comfortably, they are worth reading in a
 * diff, and they can be edited outside the app.
 *
 * Kept apart from `scripts.ts` despite the resemblance. A script is executable
 * and runs in a shell; an instruction is prose handed to a model. Sharing the
 * code would mean one module that sometimes sets an executable bit, which is
 * the sort of "almost the same" that turns into a bug the first time the two
 * diverge.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { globalInstruction, projectInstruction } from './paths.js'
import type { ProjectId } from './types.js'

/**
 * The prose the pull request tab can send, one kind per button.
 *
 * All five go out as ordinary user messages the reader can see in the log and
 * edit before they are ever sent (§4). That is the whole reason they are files
 * rather than strings in the app: a prompt nobody can read is a prompt nobody
 * can correct, and octopus adds nothing to the agent's context that the user
 * has not written.
 */
export const InstructionKindSchema = z.enum([
  'pullRequest',
  'commitMessage',
  'addressReview',
  'review',
  'multiAgentReview',
  'resolveConflicts'
])
export type InstructionKind = z.infer<typeof InstructionKindSchema>

/**
 * An instruction body as accepted from the renderer.
 *
 * Bounded because it will be prepended to a prompt: an instruction longer than
 * this is not guidance, and would crowd out the diff it is meant to describe.
 */
export const InstructionBodySchema = z.string().max(16_000)

/**
 * Starting point for an instruction nobody has written.
 *
 * Written as guidance rather than left blank: a project's conventions are
 * easier to state as edits to something concrete than from nothing, and the
 * template doubles as documentation of what the instruction is for.
 */
const TEMPLATES: Record<InstructionKind, string> = {
  pullRequest: `# Pull requests

How the agent should title and describe the work in a pull request for this
project. Used both for the prompt this pane sends, and when the form is left
empty and the agent writes the title and description itself.

## The title

- One line, and specific: what changed, not which area it was in.
- Follow whatever this repository already does — a Conventional Commits prefix
  if the history has them, plain prose if it does not.

## The description

- Lead with what changed and why, not with a list of files.
- Mention anything a reviewer would otherwise have to discover: migrations,
  configuration, a follow-up that was deliberately left out.
- Keep the project's own conventions — issue references, a changelog entry,
  whatever this repository already does.
`,

  commitMessage: `# Commit messages

How the agent should write the commit that carries this workspace's work, when
the pull request pane commits it.

- One subject line saying what changed, then a blank line, then why — the shape
  git expects and every tool renders.
- Follow whatever this repository already does. If the history is Conventional
  Commits, match it; if it is plain prose, write plain prose.
- The subject is not a file list. What was touched is in the diff already.
`,

  addressReview: `# Answering a review

Read the review on this pull request and deal with it.

- Read every comment first, then decide. Some of them will be about the same
  thing, and one change may answer several.
- Where a comment is right, make the change. Where it is not, say so in the
  reply rather than changing the code to end the conversation.
- Where a comment asks a question, answer it — do not treat it as a request.
- Leave the branch committed and pushed, so the request carries the answer.
`,

  review: `# Reviewing this change

Review the pull request as though it were somebody else's, before anyone else
has to.

- Read the diff against what the change set out to do, not line by line.
- Look for what would fail: an unhandled case, a check that cannot fire, a
  claim in a comment the code no longer keeps.
- Say what is fine as well as what is not. A review that only lists faults
  cannot be told from one that ran out of time.
- Do not change the code. This is a reading, and what to do about it is the
  next decision rather than part of this one.
`,

  multiAgentReview: `# A review from several angles at once

Review this pull request with several subagents, each reading for one thing,
then reconcile what they found.

- Give each one a different lens — correctness, tests, security, performance,
  the interface it presents — so they are not four copies of one reading.
- Verify a finding before reporting it. A plausible fault that does not
  reproduce costs more to dismiss than it did to raise.
- Reconcile at the end: drop the duplicates, say which findings disagree with
  each other, and rank what is left by what it would cost to leave.
- Do not change the code.
`,

  resolveConflicts: `# Resolving the conflicts

This branch conflicts with its base. Merge the base in and settle it.

- Fetch and merge the base branch rather than rebasing: the branch is already
  pushed, and a rebase rewrites what the pull request is made of.
- For each conflict, work out what both sides were doing before choosing.
  Taking one side wholesale is how a change quietly disappears.
- Build and run the tests afterwards. A file that merged cleanly can still be
  wrong once both changes are in it.
- Commit and push, so the request stops showing a conflict.
`
}

/**
 * Where each kind is written, at both scopes.
 *
 * A `Record` keyed by the kind rather than a function per file, so a sixth kind
 * arriving without a home is a compile error here — which is also what makes
 * the uniqueness test worth having: totality is checked by the compiler, and
 * two kinds pointing at one file is not.
 */
const FILES: Record<InstructionKind, string> = {
  pullRequest: 'pull-request.md',
  commitMessage: 'commit-message.md',
  addressReview: 'address-review.md',
  review: 'review.md',
  multiAgentReview: 'multi-agent-review.md',
  resolveConflicts: 'resolve-conflicts.md'
}

/**
 * Whose instruction this is.
 *
 * `null` is the installation's own, which every project falls back to. A
 * project id rather than a boolean flag beside it, so the two cannot both be
 * given and neither can be forgotten.
 */
export type InstructionScope = ProjectId | null

export function instructionPath(
  kind: InstructionKind,
  scope: InstructionScope,
  root?: string
): string {
  const file = FILES[kind]
  return scope === null ? globalInstruction(file, root) : projectInstruction(scope, file, root)
}

/**
 * What is written, or null where nothing is.
 *
 * The distinction the fallback below is built on, and the one `readInstruction`
 * cannot make: it answers with the template for a file that is absent, which is
 * the right answer for an editor and the wrong one for a chain of defaults.
 */
async function storedInstruction(
  kind: InstructionKind,
  scope: InstructionScope,
  root?: string
): Promise<string | null> {
  try {
    return await readFile(instructionPath(kind, scope, root), 'utf8')
  } catch {
    return null
  }
}

/** An instruction's contents, or the template when it has never been written. */
export async function readInstruction(
  kind: InstructionKind,
  scope: InstructionScope,
  root?: string
): Promise<string> {
  return (await storedInstruction(kind, scope, root)) ?? TEMPLATES[kind]
}

/**
 * The instruction that actually applies to a project.
 *
 * The project's own if it has one, the installation's if not, and the template
 * if neither — the template being what both editors start from, so a project
 * that has never been touched sends the same thing it displays.
 *
 * **An empty file counts.** Emptying a project's instruction is a decision that
 * this project says nothing extra, and falling back to the global one there
 * would make that decision impossible to express.
 */
export async function effectiveInstruction(
  kind: InstructionKind,
  projectId: ProjectId,
  root?: string
): Promise<string> {
  return (
    (await storedInstruction(kind, projectId, root)) ??
    (await storedInstruction(kind, null, root)) ??
    TEMPLATES[kind]
  )
}

export async function writeInstruction(
  kind: InstructionKind,
  scope: InstructionScope,
  contents: string,
  root?: string
): Promise<void> {
  const path = instructionPath(kind, scope, root)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}
