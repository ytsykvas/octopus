/**
 * Per-project instructions for the agent.
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

import { pullRequestInstruction } from './paths.js'
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
 * Where each kind of instruction lives.
 *
 * A map keyed by the kind, so adding a second one is a compile error here
 * rather than something that quietly falls through to the first file.
 */
const PATHS: Record<InstructionKind, (projectId: ProjectId, root?: string) => string> = {
  pullRequest: pullRequestInstruction
}

export function instructionPath(
  kind: InstructionKind,
  projectId: ProjectId,
  root?: string
): string {
  return PATHS[kind](projectId, root)
}

/** An instruction's contents, or the template when it has never been written. */
export async function readInstruction(
  kind: InstructionKind,
  projectId: ProjectId,
  root?: string
): Promise<string> {
  try {
    return await readFile(instructionPath(kind, projectId, root), 'utf8')
  } catch {
    return TEMPLATES[kind]
  }
}

export async function writeInstruction(
  kind: InstructionKind,
  projectId: ProjectId,
  contents: string,
  root?: string
): Promise<void> {
  const path = instructionPath(kind, projectId, root)

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}
