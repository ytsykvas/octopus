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

import { globalPullRequestInstruction, pullRequestInstruction } from './paths.js'
import type { ProjectId } from './types.js'

export const InstructionKindSchema = z.enum(['pullRequest'])
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
  pullRequest: `# Pull request descriptions

How the agent should describe the work in a pull request for this project.

- Lead with what changed and why, not with a list of files.
- Mention anything a reviewer would otherwise have to discover: migrations,
  configuration, a follow-up that was deliberately left out.
- Keep the project's own conventions — issue references, a changelog entry,
  whatever this repository already does.
`
}

/**
 * Whose instruction this is.
 *
 * `null` is the installation's own, which every project falls back to. A
 * project id rather than a boolean flag beside it, so the two cannot both be
 * given and neither can be forgotten.
 */
export type InstructionScope = ProjectId | null

/**
 * Where each kind of instruction lives, at each scope.
 *
 * A map keyed by the kind, so adding a second one is a compile error here
 * rather than something that quietly falls through to the first file.
 */
const PATHS: Record<
  InstructionKind,
  {
    project: (projectId: ProjectId, root?: string) => string
    global: (root?: string) => string
  }
> = {
  pullRequest: { project: pullRequestInstruction, global: globalPullRequestInstruction }
}

export function instructionPath(
  kind: InstructionKind,
  scope: InstructionScope,
  root?: string
): string {
  const paths = PATHS[kind]
  return scope === null ? paths.global(root) : paths.project(scope, root)
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
