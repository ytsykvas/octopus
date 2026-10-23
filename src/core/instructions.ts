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
 * Every one of them goes out as an ordinary user message the reader can see in
 * the log and edit before it is ever sent (§4). That is the whole reason they
 * are files rather than strings in the app: a prompt nobody can read is a
 * prompt nobody can correct, and octopus adds nothing to the agent's context
 * that the user has not written.
 */
export const InstructionKindSchema = z.enum([
  'pullRequest',
  'commitMessage',
  'fixChecks',
  'addressReview',
  'review',
  'multiAgentReview',
  'resolveConflicts',
  'setupScripts',
  'diagnoseRun'
])
export type InstructionKind = z.infer<typeof InstructionKindSchema>

/**
 * Whether the turn a kind starts ends in a push the app makes.
 *
 * The agent may not push (`publishGuard.ts`), so the prompts that change the
 * branch tell it to commit and stop, and the push is the app's — the press was
 * the user asking for it. A record rather than a list so a new kind cannot be
 * added without deciding.
 */
export const PUBLISHES_AFTER: Readonly<Record<InstructionKind, boolean>> = {
  pullRequest: false,
  commitMessage: false,
  fixChecks: true,
  addressReview: true,
  review: false,
  multiAgentReview: false,
  resolveConflicts: true,
  // Never read: Help's text is sent from the composer, not as an instruction.
  // False should that change — they write scripts at most, and nobody asked
  // for a push.
  setupScripts: false,
  diagnoseRun: false
}

/** How a message is sent, as accepted from the renderer: the prompt a pane button sent, if any. */
export const SendOptionsSchema = z
  .object({ instruction: InstructionKindSchema.optional() })
  .optional()
export type SendOptions = z.infer<typeof SendOptionsSchema>

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

  fixChecks: `# Fixing a failing check

A check on this pull request has failed. Find out why before changing anything.

- Read the log first. Each failing check is named below with a link to its job,
  and the number at the end of that link is what
  \`gh run view --job <id> --log-failed\` takes.
- Find the failing test or step in this repository and read it, along with the
  code it exercises. A log line names a symptom; the test says what was
  expected.
- Fix the cause. A test weakened, skipped or deleted to make a run green is a
  failure hidden rather than fixed — if the test itself is wrong, say so rather
  than quietly changing it.
- Run the same thing locally before committing. The command the workflow runs is
  in the workflow file, and a round trip through CI costs minutes.
- Commit the fix and stop. Do not push: Octopus pushes the branch once you are
  done, and the checks run again on it then.
`,

  addressReview: `# Answering a review

Read the review on this pull request and deal with it.

- Read every comment first, then decide. Some of them will be about the same
  thing, and one change may answer several.
- Where a comment is right, make the change. Where it is not, say so in the
  reply rather than changing the code to end the conversation.
- Where a comment asks a question, answer it — do not treat it as a request.
- Leave the branch committed and stop. Do not push: Octopus pushes it once you
  are done, so the request carries the answer.
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
- Commit the merge and stop. Do not push: Octopus pushes the branch once you are
  done, and the request stops showing a conflict then.
`,

  /*
   * Help's two are put into a composer to be read before they are sent, rather
   * than sent straight into the log, so their paragraphs are not wrapped: in a
   * field narrower than eighty columns every hard break wrapped a second time.
   */
  setupScripts: `# Setting this project up to run

Octopus runs every workspace in its own git worktree, on its own port, and starts it with three scripts kept in \`.octopus/scripts/\` inside the repository:

- \`setup.sh\` — on Run, before the server: dependencies, the database, dumps, migrations.
- \`run.sh\` — on Run, on \`$OCTOPUS_PORT\`: the dev server, and nothing else.
- \`archive.sh\` — when the workspace is deleted: giving back exactly what setup took.

Your job is to write them for this repository, in this worktree, and to say what else octopus needs. Octopus reads the scripts live from \`.octopus/scripts/\` in the worktree, ahead of anything in its own settings.

## Do this in order

1. **Look at the repository.** Which stack, which package manager, which services (database, cache, queue), how the dev server is started today, which files are gitignored but needed (\`.env\`, \`config/master.key\`, \`.env.local\`).
2. **Answer, for every resource, "what must this workspace not share with the others?"**
   - **Private** — created by \`setup.sh\` under a name derived from \`$OCTOPUS_WORKSPACE_SLUG\`, dropped by \`archive.sh\`. A database, a tmp directory, a cache namespace.
   - **Shared** — taken from the checkout at \`$OCTOPUS_ROOT_PATH\` and never dropped. A dump, a dependency cache.
   - **Pinned** — a value every workspace must see, such as the database name pattern. That is a variable in the project's env set, never a line in a script.

   Write the three lists down in your reply before writing any shell.

3. **The files to carry.** A worktree holds what git tracks. Every gitignored file the app needs must be listed in Project settings → Files carried into a workspace, one path per line; octopus copies them into each workspace before a run. List only paths git ignores. If this checkout has not got a file either, say where it may be found (a sibling checkout, a password manager) rather than inventing one.
4. **The variables.** Read variable _names_ from the code, the \`.env.example\` and the existing \`.env\`, and list the ones the project's env set must define. **Never write a value, never print one, never commit one.** Values go into Project settings by hand. A \`KEY=value\` appended to \`.env\` by a script loses: octopus writes its own block last, on every run.
5. **The scripts.** Write the three files, \`chmod +x\` each, and verify with \`sh -n\` and \`test -x\`. Do not run them: the person reading your reply presses Run.
6. **Say what happens next.** The Scripts tab shows a repository's scripts in full and Run stays disabled until the person presses "Allow these" or turns on "Trust this repository" in Project settings. A \`git pull\` that changes a script asks again.

## What a script is given

Every script gets \`$OCTOPUS_ROOT_PATH\` (the checkout), \`$OCTOPUS_WORKSPACE_NAME\`, \`$OCTOPUS_WORKSPACE_SLUG\` and \`$OCTOPUS_ENV_PROFILE\`, plus every variable of the env set in effect. \`run.sh\` also gets \`$OCTOPUS_PORT\` and \`$OCTOPUS_PORT_1\` … \`$OCTOPUS_PORT_9\` for a stack that is more than one process. The server binds \`$OCTOPUS_PORT\`, never a literal.

The slug is the workspace name lowercased, every other character an underscore, cut to 30 characters, so a prefix still fits inside Postgres' 63. It is the **only** source of a per-workspace name. The name itself may hold spaces.

## Rules

- Nothing shared is touched without the slug, and an empty slug stops the script: \`: "\${OCTOPUS_WORKSPACE_SLUG:?refusing to run without a workspace slug}"\` is the first line of \`setup.sh\` and \`archive.sh\`.
- \`archive.sh\` never uses \`set -e\`: nothing may stop a workspace being removed, and the script must get as far as it can.
- \`run.sh\` is only the server, started with \`exec\` so a Stop reaches it.
- Scripts never write \`.env\` and never echo credentials.
- Do not write \`.octopus/project.json\` from here: name, base branch and env file are set in Project settings, and that file is read from the checkout rather than the worktree.
- Keep the scripts short. Dependencies that a fresh checkout needs go in \`setup.sh\`; anything already in \`$OCTOPUS_ROOT_PATH\` is linked or copied, not rebuilt.

## Verify, without running anything

\`sh -n\` on each script; \`test -x\` on each; \`command -v\` for every tool they call; \`git check-ignore -v\` for every path to carry. Then read them once more for: the slug on every destructive line, no \`set -e\` in \`archive.sh\`, \`$OCTOPUS_PORT\` bound, nothing shared deleted. Report what each check answered.
`,

  diagnoseRun: `# Why does Run not work?

Run in octopus is two scripts in order: \`.octopus/scripts/setup.sh\` (the build), then \`.octopus/scripts/run.sh\` (the server) on \`$OCTOPUS_PORT\`. A failed build stops there. Below this message octopus has put what it knows: which scripts are in effect and where they come from, the env set and the names of its variables, the files it carries, any problems in the env set, and the last lines of the most recent build and server with their exit codes.

Find out why before changing anything.

1. **Read the output first.** The last error is usually not the first thing printed; find the line that actually failed.
2. **Check what the script was given.** A run most often stops on a variable the script could not read, and that is almost never the script. The env set is written into the workspace's env file on every run, last and winning; a script that appends its own \`KEY=value\` is overwritten. The variable names are listed below; the values are not, and you must not ask for them to be pasted here.
3. **Check what is missing from the worktree.** A worktree holds what git tracks. A file the app reads at boot (\`.env\`, \`master.key\`) that is not in the files carried into the workspace is simply absent.
4. **Check the port and the slug.** The server must bind \`$OCTOPUS_PORT\`, not a literal. A database or directory named without \`$OCTOPUS_WORKSPACE_SLUG\` is shared with every other workspace.
5. **Check the gate.** A repository's scripts do not run until they are allowed on the Scripts tab, and a script runs by path, so it must be executable (\`test -x\`).

Then say, in order: what failed, why, and the smallest change that fixes it. Propose the change; if it is in a script, write it and \`chmod +x\`. Do not run the scripts yourself and never write a variable's value anywhere.
`
}

/**
 * Where each kind is written, at both scopes.
 *
 * A `Record` keyed by the kind rather than a function per file, so a new kind
 * arriving without a home is a compile error here — which is also what makes
 * the uniqueness test worth having: totality is checked by the compiler, and
 * two kinds pointing at one file is not.
 *
 * Exported for the same reason as `SCRIPT_FILES`: a project may carry these
 * in its repository under `.octopus/instructions/`, and that copy is the same
 * file under the same name.
 */
export const INSTRUCTION_FILES: Record<InstructionKind, string> = {
  pullRequest: 'pull-request.md',
  commitMessage: 'commit-message.md',
  fixChecks: 'fix-checks.md',
  addressReview: 'address-review.md',
  review: 'review.md',
  multiAgentReview: 'multi-agent-review.md',
  resolveConflicts: 'resolve-conflicts.md',
  setupScripts: 'setup-scripts.md',
  diagnoseRun: 'diagnose-run.md'
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
  const file = INSTRUCTION_FILES[kind]
  return scope === null ? globalInstruction(file, root) : projectInstruction(scope, file, root)
}

/**
 * What is written, or null where nothing is.
 *
 * The distinction the fallback below is built on, and the one `readInstruction`
 * cannot make: it answers with the template for a file that is absent, which is
 * the right answer for an editor and the wrong one for a chain of defaults.
 *
 * Exported for the same distinction elsewhere: exporting a project's settings
 * into its repository should carry what somebody wrote, not a template nobody
 * has touched.
 */
export async function storedInstruction(
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

/** The text octopus ships for an instruction nobody has written. */
export function instructionTemplate(kind: InstructionKind): string {
  return TEMPLATES[kind]
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
