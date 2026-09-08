/**
 * The commands and subagents the user keeps in octopus.
 *
 * A **command** is one markdown file whose name is what the user types after a
 * slash and whose body is the prompt; a **subagent** is one markdown file whose
 * frontmatter names it and says when the model should reach for it. Both
 * formats are Claude Code's, not ours, which is the point — a file written here
 * can be copied anywhere, and one written anywhere can be brought here.
 *
 * **Beside the skills, in the same two stores.** A store is a directory handed
 * to a session as an extra working-directory root, and Claude Code discovers
 * `.claude/commands/` and `.claude/agents/` under a root exactly as it
 * discovers `.claude/skills/` — measured against a live session, where
 * `supportedCommands()` listed the command and `supportedAgents()` listed the
 * subagent beside the built-in ones. So this needs nothing written inside a
 * checkout, and the promise in `docs/repo-config.md` that exporting is the only
 * write octopus makes inside a repository still holds.
 *
 * **A file, not a directory**, which is the whole difference from `skills.ts`
 * and the reason this is a module of its own rather than a parameter on that
 * one. There is nothing to walk, no folder to size, and no symlink to refuse.
 *
 * **The name is the file.** For a subagent the frontmatter carries it too and
 * the two are kept in step, because that is the name the agent knows it by. A
 * command has no such field: the file is the only name it has, which is why
 * every route in here ends up asking the caller for one.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { z } from 'zod'

import { CodedError } from './codedError.js'
import { type Download, fetchDocument, httpsUrl } from './download.js'
import { parseFrontmatter, setFields } from './frontmatter.js'
import { isLibraryName, type LibraryKind } from './libraryNames.js'
import { libraryDirOf } from './paths.js'

/**
 * Caps, each answering a different way this can go wrong.
 *
 * The document cap is the same 64k the skills and the scripts use: past it a
 * prompt is not guidance any more, and it is the agent's context window that
 * pays. The download cap is smaller because a URL is the one input here whose
 * size somebody else decides.
 */
const MAX_DOCUMENT = 64_000
const MAX_DOWNLOAD_BYTES = 256 * 1024

/** Machine-readable reason an item was refused; the renderer localises it. */
export type LibraryErrorCode =
  | 'libraryNameInvalid'
  | 'libraryExists'
  | 'libraryMissing'
  | 'libraryTooLarge'
  | 'libraryUrlRefused'
  | 'librarySubagentNeedsDescription'

/** A command or subagent could not be read, written or imported. */
export class LibraryError extends CodedError<LibraryErrorCode> {
  override readonly name = 'LibraryError'
}

/** What a list needs to draw one row. */
export interface LibraryEntry {
  readonly kind: LibraryKind
  /**
   * The file's name without its extension, which is what the agent calls it.
   *
   * Also the address: every read and write in here takes it, and it is the one
   * string that is true of both kinds. A subagent's frontmatter repeats it and
   * is kept in step; a command has nothing to disagree with.
   */
  readonly name: string
  /** From the frontmatter, or empty — a command need not declare one. */
  readonly description: string
  /** Where it landed, so a caller can say so. */
  readonly path: string
}

/** One item, opened for editing. */
export interface LibraryDocument extends LibraryEntry {
  readonly body: string
  readonly raw: string
}

/**
 * A whole document, as the editor and the paste import hand it over.
 *
 * There is no form half here, where a skill has one. A skill's editor offers
 * two fields because a skill has structure worth separating; a command **is**
 * its text, and a subagent's other fields — `tools`, `model` — are not
 * something a two-field form could edit without dropping them.
 */
export const LibraryRawSchema = z.string().max(MAX_DOCUMENT)

/** The three ways a command or subagent written elsewhere gets in. */
export const LibraryImportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().min(1) }),
  z.object({ kind: z.literal('text'), text: LibraryRawSchema }),
  z.object({ kind: z.literal('url'), url: z.string().min(1).max(2_000) })
])
export type LibraryImport = z.infer<typeof LibraryImportSchema>

function itemPath(dir: string, name: string): string {
  return join(dir, `${name}.md`)
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Everything of one kind a store holds, in the order a list draws them.
 *
 * Never throws. The directory may be absent, and a file in it may be anything
 * at all: a list that refuses to be drawn because one entry is malformed is
 * worse than a list missing that entry.
 */
export async function readLibraryIn(dir: string, kind: LibraryKind): Promise<LibraryEntry[]> {
  let listing
  try {
    listing = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const found: LibraryEntry[] = []

  for (const entry of listing) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue

    // A file that cannot be read is still on the list, with nothing said about
    // it: it is there, and the session will find it or fail to exactly as we
    // did. Leaving it out would make this pane disagree with what the agent has.
    const path = join(dir, entry.name)
    const raw = (await readText(path)) ?? ''

    found.push({
      kind,
      name: entry.name.slice(0, -'.md'.length),
      description: parseFrontmatter(raw)?.field('description') ?? '',
      path
    })
  }

  return found.sort((first, second) => first.name.localeCompare(second.name))
}

/** One item, opened for editing. */
export async function readLibraryItem(
  dir: string,
  kind: LibraryKind,
  name: string
): Promise<LibraryDocument> {
  const path = itemPath(dir, name)
  const raw = await readText(path)

  if (raw === null) {
    throw new LibraryError('libraryMissing', { name }, `${name} is not here.`)
  }

  const document = parseFrontmatter(raw)

  return {
    kind,
    name,
    description: document?.field('description') ?? '',
    // No frontmatter at all is an ordinary command: the whole file is the
    // prompt, and there is nothing above it to strip.
    body: document?.body ?? raw,
    raw,
    path
  }
}

function assertFits(text: string): void {
  if (text.length > MAX_DOCUMENT) {
    throw new LibraryError('libraryTooLarge', { limit: String(MAX_DOCUMENT) }, 'It is too long.')
  }
}

function requireName(name: string): string {
  if (!isLibraryName(name)) {
    throw new LibraryError('libraryNameInvalid', { name }, `${name} cannot be a name.`)
  }

  return name
}

/** Refuses a name already taken, in this store or beside it. */
async function refuseExisting(
  dir: string,
  name: string,
  elsewhere: readonly string[]
): Promise<void> {
  if (elsewhere.includes(name) || (await readText(itemPath(dir, name))) !== null) {
    throw new LibraryError('libraryExists', { name }, `${name} is already here.`)
  }
}

/**
 * Gives a store the shape a session discovers these in.
 *
 * Called before every write rather than once at startup, exactly as
 * `ensureStore` is for skills: a store exists from the moment somebody puts
 * something in it, and a directory created eagerly for one nobody uses is a
 * thing the user has to wonder about.
 */
export async function ensureLibrary(root: string, kind: LibraryKind): Promise<string> {
  const dir = libraryDirOf(root, kind)
  await mkdir(dir, { recursive: true })

  return dir
}

/**
 * The frontmatter a subagent must have, put in step with the file's name.
 *
 * Claude Code reads `name` and `description` off a subagent and will not offer
 * one without them, so a document that arrives missing either is completed
 * rather than refused — and a `name` that disagrees with the file is corrected,
 * because the file is what this module addresses it by.
 *
 * A command is left exactly as it was written. It has no such fields, and
 * inventing frontmatter for a file whose whole content is a prompt would change
 * what the agent reads.
 */
function documentFor(kind: LibraryKind, name: string, raw: string): string {
  if (kind === 'command') return raw

  const document = parseFrontmatter(raw)
  const description = document?.field('description') ?? ''

  // Both halves, and they are two different documents: one with no frontmatter
  // at all, and one whose frontmatter says nothing about when to use it.
  if (document === null || description === '') {
    throw new LibraryError(
      'librarySubagentNeedsDescription',
      { name },
      'A subagent needs a description saying when to use it.'
    )
  }

  return `---\n${setFields(document.front, { name, description }).trimEnd()}\n---\n\n${document.body}`
}

/**
 * Writes a whole document, as the editor hands it over.
 *
 * Saves over whatever is there, which is what saving an edit means. Creating
 * one goes through `importLibraryItem` instead, and the split is the point:
 * a save refused by the name it already has would be a save nobody could make.
 */
export async function writeLibraryItem(
  dir: string,
  kind: LibraryKind,
  name: string,
  raw: string
): Promise<LibraryEntry> {
  requireName(name)

  const text = documentFor(kind, name, raw)
  assertFits(text)

  await mkdir(dir, { recursive: true })
  await writeFile(itemPath(dir, name), text, 'utf8')

  return {
    kind,
    name,
    description: parseFrontmatter(text)?.field('description') ?? '',
    path: itemPath(dir, name)
  }
}

/**
 * Writes one that is not here yet — the last step of every import, and of the
 * button that starts an empty one.
 *
 * The name is the caller's because nothing else can supply it: the preview
 * suggests, the user decides. So this is where the collision is caught, and it
 * is caught against both stores at once — a session is handed both, and which
 * of two files sharing a name answers is not ours to say.
 */
export async function importLibraryItem(
  dir: string,
  kind: LibraryKind,
  name: string,
  raw: string,
  elsewhere: readonly string[] = []
): Promise<LibraryEntry> {
  requireName(name)
  await refuseExisting(dir, name, elsewhere)

  return writeLibraryItem(dir, kind, name, raw)
}

export async function removeLibraryItem(dir: string, name: string): Promise<void> {
  await rm(itemPath(dir, name), { force: true })
}

/**
 * Gives one another name — the file and, for a subagent, its frontmatter.
 *
 * An ordinary rename rather than the migration `renameSkill` is, and the
 * difference is worth knowing: a skill's name is the key three stored answers
 * use, so moving it means moving them. Nothing is keyed on a command or a
 * subagent — there is no per-conversation switch for either, because the SDK
 * offers none — so the file is the whole of it.
 */
export async function renameLibraryItem(
  dir: string,
  kind: LibraryKind,
  name: string,
  to: string,
  elsewhere: readonly string[] = []
): Promise<LibraryEntry> {
  requireName(to)

  const raw = await readText(itemPath(dir, name))
  if (raw === null) {
    throw new LibraryError('libraryMissing', { name }, `${name} is not here.`)
  }

  // Before anything moves, which is what makes the ordering safe rather than a
  // rollback: with the new name proved free, what is left to fail is exotic.
  if (to !== name) await refuseExisting(dir, to, elsewhere)

  await rename(itemPath(dir, name), itemPath(dir, to))
  const text = documentFor(kind, to, raw)
  await writeFile(itemPath(dir, to), text, 'utf8')

  return {
    kind,
    name: to,
    description: parseFrontmatter(text)?.field('description') ?? '',
    path: itemPath(dir, to)
  }
}

/** The document at an address, refused in this module's own words. */
function fetched(value: string, download: Download): Promise<string> {
  return fetchDocument(value, MAX_DOWNLOAD_BYTES, download, {
    refuseUrl: (params, message) => new LibraryError('libraryUrlRefused', params, message),
    refuseSize: (params, message) => new LibraryError('libraryTooLarge', params, message)
  })
}

/**
 * A name this document suggests for itself, or empty where it suggests none.
 *
 * A subagent names itself in its frontmatter, which is where the agent reads it
 * from. A command has no such field, so the only hint is the file or the
 * address it came from — and pasted text offers nothing at all, which is why
 * the dialog asks and this only prefills.
 *
 * Tidied rather than refused: `Run Checks.md` becomes `run-checks`, because a
 * name the user then has to retype for a reason the app could have handled is a
 * worse answer than a suggestion they can edit.
 */
export function suggestName(kind: LibraryKind, request: LibraryImport, raw: string): string {
  const declared = kind === 'subagent' ? (parseFrontmatter(raw)?.field('name') ?? '') : ''
  const source =
    declared !== ''
      ? declared
      : request.kind === 'path'
        ? basename(request.path)
        : request.kind === 'url'
          ? basename(httpsUrl(request.url)?.pathname ?? '')
          : ''

  const tidied = source
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64)
    .replace(/[-_]+$/, '')

  return isLibraryName(tidied) ? tidied : ''
}

/** The document behind a request, read the way the import reads it. */
async function sourceText(request: LibraryImport, download: Download): Promise<string> {
  if (request.kind === 'text') return request.text
  if (request.kind === 'url') return fetched(request.url, download)

  // Read without a fallback, so a file the user picked and we cannot open fails
  // saying which file and why. A code of ours in its place would replace
  // "permission denied" with something vaguer.
  return readFile(request.path, 'utf8')
}

/** What a preview says about an item that has not been written yet. */
export interface LibraryPreview {
  /** What the dialog prefills its name field with; empty where nothing said. */
  readonly name: string
  readonly description: string
  /**
   * The document, so the import need not read the source twice.
   *
   * A **link** is the case this exists for: inspecting and then importing would
   * otherwise fetch the address twice, and the second answer need not be the
   * first. Carried for every route because the name is chosen between the two
   * steps, so even a file could have changed underneath.
   */
  readonly text: string
}

/**
 * What an import would write, without writing it.
 *
 * The name is the reason this step exists at all. A skill's document names
 * itself, so its preview is a courtesy for the one route whose source cannot be
 * read beforehand; a command names itself nowhere, so somebody has to choose —
 * and choosing needs the document on screen first.
 */
export async function inspectLibraryImport(
  kind: LibraryKind,
  request: LibraryImport,
  download: Download
): Promise<LibraryPreview> {
  const text = await sourceText(request, download)
  assertFits(text)

  return {
    name: suggestName(kind, request, text),
    description: parseFrontmatter(text)?.field('description') ?? '',
    text
  }
}
