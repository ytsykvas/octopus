/**
 * A project's settings as its repository can carry them: `.octopus/`.
 *
 * Everything a project knows about itself — the three scripts, the carry list,
 * the seven instructions, its base branch and env file — lives under
 * `~/.octopus/projects/<id>/`. That directory is a single point of failure:
 * wipe it, or move to another machine, and it is all gone with no trace in the
 * repository the settings describe. A repository may therefore carry a copy,
 * which is what this module reads and writes.
 *
 * **A snapshot, never read at runtime.** Nothing here is consulted while the
 * app works: scripts still run from the data root, `carryInto` still reads the
 * list it always read. The copy moves by two explicit actions, import and
 * export, and the import shows the user every byte before writing it.
 *
 * That is not caution for its own sake. Reading the repository live would mean
 * executing shell that arrived with a `git pull`, and approval in this app is a
 * fact about a **worktree** (`repoTrust.ts`) — a project just re-added after a
 * wipe has approved nothing and has no workspace to approve in, so a live layer
 * would be switched off in exactly the situation it exists for.
 *
 * **Writing into a checkout is new.** `SECURITY.md` says `~/.octopus` and the
 * worktree are the whole of what the app may touch, and nothing in `core/` has
 * written under a `repoPath` before. Export is the exception, so it is confined
 * rather than trusted: every path is built from a fixed constant, those
 * constants are checked by a test, the id that selects one is parsed at the IPC
 * boundary, and a symlink that could redirect a write out of the folder is
 * refused.
 *
 * The env overrides are deliberately absent. They are one machine's
 * credentials, `origin` is frequently public, and a secret that has been pushed
 * has been published whatever the next commit does — `env.ts` says the rest.
 */

import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { CarryListSchema } from './carry.js'
import { ProjectColorSchema } from './colors.js'
import { ProjectIconSchema } from './icons.js'
import { INSTRUCTION_FILES, InstructionBodySchema, InstructionKindSchema } from './instructions.js'
import { SCRIPT_FILES, ScriptBodySchema, ScriptKindSchema } from './scripts.js'

/** The directory a repository carries its octopus settings in. */
export const REPO_DIR = '.octopus'

/**
 * One thing that can travel between a repository and the installation.
 *
 * A flat id rather than a nested shape, because it crosses IPC and is what the
 * user ticks in the import dialog. Built from the two existing kind enums, so a
 * new script or instruction cannot be added without one.
 */
export type RepoItemId =
  | 'project'
  | 'carry'
  | `script.${z.infer<typeof ScriptKindSchema>}`
  | `instruction.${z.infer<typeof InstructionKindSchema>}`

const SCRIPTS = 'scripts'
const INSTRUCTIONS = 'instructions'

/**
 * Where each item sits inside `.octopus/`.
 *
 * Written out rather than assembled, for the reason `INSTRUCTION_FILES` is:
 * totality is then checked by the compiler, and a kind added without a home
 * here fails the build. The filenames themselves are not repeated — they come
 * from the modules that own the kinds, so the copy in a repository and the copy
 * in the data root cannot drift into different names.
 */
const ITEM_PATHS: Record<RepoItemId, string> = {
  project: 'project.json',
  carry: 'carry',
  'script.setup': join(SCRIPTS, SCRIPT_FILES.setup),
  'script.run': join(SCRIPTS, SCRIPT_FILES.run),
  'script.archive': join(SCRIPTS, SCRIPT_FILES.archive),
  'instruction.pullRequest': join(INSTRUCTIONS, INSTRUCTION_FILES.pullRequest),
  'instruction.commitMessage': join(INSTRUCTIONS, INSTRUCTION_FILES.commitMessage),
  'instruction.fixChecks': join(INSTRUCTIONS, INSTRUCTION_FILES.fixChecks),
  'instruction.addressReview': join(INSTRUCTIONS, INSTRUCTION_FILES.addressReview),
  'instruction.review': join(INSTRUCTIONS, INSTRUCTION_FILES.review),
  'instruction.multiAgentReview': join(INSTRUCTIONS, INSTRUCTION_FILES.multiAgentReview),
  'instruction.resolveConflicts': join(INSTRUCTIONS, INSTRUCTION_FILES.resolveConflicts)
}

/**
 * Every item, in a fixed order.
 *
 * Derived from the kind enums rather than listed again: the record above is
 * what the compiler checks for totality, and this is what the dialog iterates.
 */
export const REPO_ITEM_IDS = [
  'project',
  'carry',
  ...ScriptKindSchema.options.map((kind) => `script.${kind}` as const),
  ...InstructionKindSchema.options.map((kind) => `instruction.${kind}` as const)
] satisfies readonly RepoItemId[]

const KNOWN: ReadonlySet<string> = new Set<string>(REPO_ITEM_IDS)

/**
 * An id as accepted from the renderer.
 *
 * Values crossing IPC are parsed before they reach a path, and this one names
 * a file the app writes — so it is checked against the list rather than trusted
 * to be one of ours.
 */
export const RepoItemIdSchema = z.custom<RepoItemId>(
  (value) => typeof value === 'string' && KNOWN.has(value)
)

/** Machine-readable reason a repository's settings could not be used. */
export type RepoConfigCode = 'repoConfigSymlink' | 'repoConfigTooLarge' | 'repoConfigMalformed'

/** A repository's `.octopus/` cannot be read or written, with a reason. */
export class RepoConfigError extends Error {
  constructor(
    readonly code: RepoConfigCode,
    readonly params: Readonly<Record<string, string>>,
    message: string
  ) {
    super(message)
    this.name = 'RepoConfigError'
  }
}

/**
 * The project fields a repository may carry.
 *
 * Every one optional: a repository that only wants to pin its base branch
 * should not have to state a colour. Unknown keys are dropped rather than
 * refused, so a file written by a later version still imports what this one
 * understands.
 *
 * `branchPrefix` is not here — it is a person's username, not a fact about the
 * project — and neither is `approvedSettings`, which is the trust record: a
 * repository declaring itself trusted would defeat the gate it has to pass.
 */
export const RepoProjectSchema = z.object({
  baseBranch: z.string().min(1).optional(),
  envFile: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  icon: ProjectIconSchema.optional(),
  color: ProjectColorSchema.optional()
})

export type RepoProject = z.infer<typeof RepoProjectSchema>

/** `project.json` as text, bounded because it is five short fields. */
const ProjectBodySchema = z.string().max(8_000)

/** What bounds each item, reusing the limit its own editor already applies. */
function bodySchema(id: RepoItemId): z.ZodType<string> {
  if (id === 'project') return ProjectBodySchema
  if (id === 'carry') return CarryListSchema
  return id.startsWith('script.') ? ScriptBodySchema : InstructionBodySchema
}

/** One item as it exists in a repository. */
export interface RepoItem {
  readonly id: RepoItemId
  /** Relative to the repository root, so a message can name the file. */
  readonly path: string
  readonly contents: string
}

/**
 * The relative paths, so a test can check every one of them.
 *
 * Export is the single place this app writes inside somebody's checkout, and
 * the promise is that it never writes outside `.octopus/`. A runtime branch
 * cannot carry that promise: the paths are constants, so the branch is one no
 * input reaches — code nobody can test and therefore nobody should trust. The
 * check lives in `repoConfig.test.ts`, over this record, where an added path
 * that climbs out fails the suite.
 *
 * What varies is the id, and that is checked where it arrives: `RepoItemIdSchema`
 * parses it at the IPC boundary before it ever reaches a path.
 */
export const REPO_ITEM_PATHS: Readonly<Record<RepoItemId, string>> = ITEM_PATHS

/** Where an item lives inside a repository. */
export function repoItemPath(repoPath: string, id: RepoItemId): string {
  return join(repoPath, REPO_DIR, ITEM_PATHS[id])
}

/**
 * Refuses a path that is a symbolic link.
 *
 * A link inside `.octopus/` would make every guarantee above cosmetic: reading
 * would follow it out of the repository, and writing would land wherever it
 * points. `lstat` rather than `stat` precisely because it does not follow.
 */
async function assertNotLink(path: string, name: string): Promise<void> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) return
  } catch {
    // Absent, which is the ordinary case for most items in most repositories.
    return
  }

  throw new RepoConfigError('repoConfigSymlink', { path: name }, `${name} is a symbolic link.`)
}

/** Reads one item, or null where the repository does not carry it. */
async function readItem(repoPath: string, id: RepoItemId): Promise<RepoItem | null> {
  const path = repoItemPath(repoPath, id)
  const name = join(REPO_DIR, ITEM_PATHS[id])

  await assertNotLink(path, name)

  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch {
    return null
  }

  if (!bodySchema(id).safeParse(contents).success) {
    throw new RepoConfigError('repoConfigTooLarge', { path: name }, `${name} is too large to read.`)
  }

  return { id, path: name, contents }
}

/**
 * Everything a repository carries, in a fixed order.
 *
 * An empty answer means the repository carries nothing — which is most of
 * them, and not a failure. The directory itself is checked first, so a
 * `.octopus` symlinked somewhere else is refused once rather than twelve times.
 */
export async function readRepoConfig(repoPath: string): Promise<RepoItem[]> {
  await assertNotLink(join(repoPath, REPO_DIR), REPO_DIR)

  const found = await Promise.all(REPO_ITEM_IDS.map((id) => readItem(repoPath, id)))
  return found.filter((item): item is RepoItem => item !== null)
}

/**
 * The project fields a repository carries, or null where it carries none.
 *
 * Separate from reading the file, so the parse failure can name the file and
 * the caller can go on importing the other eleven items. A malformed
 * `project.json` should not cost somebody their setup script.
 */
export function parseRepoProject(contents: string): RepoProject {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new RepoConfigError(
      'repoConfigMalformed',
      { path: join(REPO_DIR, ITEM_PATHS.project) },
      'project.json is not valid JSON.'
    )
  }

  const result = RepoProjectSchema.safeParse(parsed)
  if (!result.success) {
    throw new RepoConfigError(
      'repoConfigMalformed',
      { path: join(REPO_DIR, ITEM_PATHS.project) },
      'project.json does not describe a project.'
    )
  }

  return result.data
}

/** Serialises the fields a project exports, with the keys it has not left out. */
export function formatRepoProject(project: RepoProject): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

/**
 * What octopus writes beside the settings, so the folder explains itself.
 *
 * A repository is read by people who have never opened this app — and by the
 * agent working in it. A directory of loose shell scripts with no note saying
 * what reads them is how a folder gets deleted in a tidy-up.
 */
export const REPO_README = `# .octopus

Project settings for [octopus](https://github.com/ytsykvas/octopus), a local app
that runs Claude Code sessions in parallel — each task in its own git worktree.

octopus keeps a project's settings under \`~/.octopus\`, which lives on one
machine and disappears with it. This directory is a copy, so a fresh
installation can be rebuilt from the repository instead of from memory.

| Path | What it is |
| --- | --- |
| \`project.json\` | base branch, env file, and the project's name, icon and colour |
| \`carry\` | gitignored files copied into every new worktree, one path per line |
| \`scripts/setup.sh\` | prepares a workspace |
| \`scripts/run.sh\` | starts the dev server; receives \`$OCTOPUS_PORT\` |
| \`scripts/archive.sh\` | takes back what setup gave out, when a workspace is removed |
| \`instructions/\` | prose the app sends the agent, one file per action |

**Nothing here runs on its own.** octopus never reads this directory while it
works: the scripts it executes live in \`~/.octopus\`. These files move by two
explicit actions in Project Settings — Import, which shows every file before
writing it, and Export, which writes this directory from the settings in the
app.

**No credentials.** The env overrides a project applies to each workspace are
never written here. They stay in \`~/.octopus\`, readable by their owner alone,
because a secret committed to a repository has been published whatever the next
commit does.
`

/** Scripts are written executable, which is a mode git records and preserves. */
const SCRIPT_MODE = 0o755

/**
 * Writes the given items into a repository's `.octopus/`, with the README.
 *
 * The README goes in on every export rather than only the first, so a
 * directory whose note was deleted gets it back and one written by an older
 * version is brought up to date.
 */
export async function writeRepoConfig(repoPath: string, items: readonly RepoItem[]): Promise<void> {
  const root = join(repoPath, REPO_DIR)
  await assertNotLink(root, REPO_DIR)
  await mkdir(root, { recursive: true })

  const readme = join(root, 'README.md')
  await assertNotLink(readme, join(REPO_DIR, 'README.md'))
  await writeFile(readme, REPO_README, 'utf8')

  for (const item of items) {
    const path = repoItemPath(repoPath, item.id)
    await assertNotLink(path, item.path)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, item.contents, 'utf8')

    if (item.id.startsWith('script.')) await chmod(path, SCRIPT_MODE)
  }
}
