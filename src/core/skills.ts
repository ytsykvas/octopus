/**
 * The skills the user keeps in octopus, and the plugin shape they are kept in.
 *
 * A skill is a directory holding a `SKILL.md`: YAML frontmatter naming it and
 * saying when to reach for it, then prose the agent reads once it does. That
 * format is Claude Code's, not ours, which is the point — a skill written here
 * is a file the user can copy anywhere, and one written anywhere can be
 * brought here.
 *
 * Two things make this more than a directory of markdown.
 *
 * **A store is a working-directory root, not a plugin.** A local plugin was
 * the obvious way to hand the SDK skills it would not find on its own, and it
 * works — right up to the point of switching one off, which is the feature.
 * Measured against a live session: a plugin's skills load and appear in the
 * listing, and `skillOverrides` does not touch them under any spelling of the
 * key, while the same override hides a skill discovered the ordinary way. So a
 * store is a directory holding `.claude/skills/`, handed over as an extra
 * root, and its skills are then exactly as switchable as the checkout's own.
 *
 * **Nothing here is written inside a checkout.** These live under
 * `~/.octopus`, so a workspace's `git status` is unchanged by any of it, and
 * the promise in `docs/repo-config.md` that exporting is the only write
 * octopus makes inside a repository still holds.
 */

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod'

import { CodedError } from './codedError.js'
import { parseFrontmatter, setFields } from './frontmatter.js'
import { type Download, fetchDocument } from './download.js'
import { skillsDirOf } from './paths.js'
import { isSkillName, type SkillScope } from './skillNames.js'

/** The one file a skill must have, named as Claude Code names it. */
const SKILL_FILE = 'SKILL.md'

/**
 * Caps, each answering a different way this can go wrong.
 *
 * The document cap is the same 64k the scripts use: past it a skill is not
 * guidance any more, and it is the agent's context window that pays. The two
 * import caps exist because "choose a folder" is one mis-click away from a
 * home directory, and the byte cap on a download because a URL is the one
 * input here that somebody else controls the size of.
 */
const MAX_DOCUMENT = 64_000
const MAX_IMPORT_FILES = 64
const MAX_IMPORT_BYTES = 2 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 256 * 1024

/** Machine-readable reason a skill was refused; the renderer localises it. */
export type SkillErrorCode =
  | 'skillNameInvalid'
  | 'skillNameMismatch'
  | 'skillExists'
  | 'skillMissing'
  | 'skillFrontmatterMissing'
  | 'skillTooLarge'
  | 'skillLinkRefused'
  | 'skillUrlRefused'

/** A skill could not be read, written or imported, with a reason to show. */
export class SkillError extends CodedError<SkillErrorCode> {
  override readonly name = 'SkillError'
}

/** What a list needs to draw one row. */
export interface SkillEntry {
  /**
   * What the agent calls the skill, from the frontmatter.
   *
   * Not an address. Two directories may claim one name — a folder placed by
   * hand beside one the app wrote — and the agent treats them as one skill, so
   * the listing reports both under it. Use `folder` to act on one.
   */
  readonly name: string
  readonly description: string
  /**
   * The directory this was found in, relative to the store.
   *
   * What every read and write is addressed by. It used to be re-derived from
   * `name`, which is the same string only for a skill the app itself created:
   * anything else was edited, saved and deleted somewhere the listing had never
   * looked, and where two rows shared a name it was the wrong one.
   */
  readonly folder: string
  /** The skill's own directory, so a caller can say where it landed. */
  readonly path: string
}

/** The same, opened: what the editor shows in its form and in its raw mode. */
export interface SkillDocument extends SkillEntry {
  readonly body: string
  readonly raw: string
}

/**
 * What the form edits, as it arrives from the renderer.
 *
 * The name is not in here: it is the directory, and this pass does not rename.
 */
export const SkillContentSchema = z.object({
  description: z.string().max(1_000),
  body: z.string().max(MAX_DOCUMENT)
})
export type SkillContent = z.infer<typeof SkillContentSchema>

/** A whole `SKILL.md`, as the raw editor and the paste import hand it over. */
export const SkillRawSchema = z.string().max(MAX_DOCUMENT)

/**
 * A save, from either half of the editor.
 *
 * Two shapes rather than one because they mean different things: the form
 * edits two fields and leaves the rest of the frontmatter alone, while the raw
 * mode is the user saying the document is theirs entire.
 */
export const SkillSaveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('form'), content: SkillContentSchema }),
  z.object({ kind: z.literal('raw'), text: SkillRawSchema })
])
export type SkillSave = z.infer<typeof SkillSaveSchema>

/** The three ways a skill written elsewhere gets in. */
export const SkillImportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('path'), path: z.string().min(1) }),
  z.object({ kind: z.literal('text'), text: SkillRawSchema }),
  z.object({ kind: z.literal('url'), url: z.string().min(1).max(2_000) })
])
export type SkillImport = z.infer<typeof SkillImportSchema>

/** One row of the panel: a skill, where it came from, and whether it is on. */
/**
 * One row of the composer's skills panel.
 *
 * Not a `SkillEntry` with fields added, which it used to be: a skill the
 * session holds and octopus never wrote has no folder and no path, and the
 * panel reads neither — it needs a name, a description, the key an answer is
 * stored under, and whether it is on. The Settings screens address a skill by
 * its folder and read `SkillEntry` for exactly that reason.
 */
export interface SkillListing {
  readonly name: string
  readonly description: string
  /** The name the agent knows it by, and the key every stored answer uses. */
  readonly key: string
  readonly scope: SkillScope
  readonly enabled: boolean
}

interface ParsedSkill {
  readonly name: string
  readonly description: string
  /** Kept so an edit can be written back onto it rather than over it. */
  readonly front: string
  readonly body: string
  readonly raw: string
}

/**
 * The document, or null when there is no frontmatter at all.
 *
 * Frontmatter that will not parse is **not** a refusal — `frontmatter.ts` says
 * why, and reads it line by line instead.
 */
function parse(raw: string): ParsedSkill | null {
  const document = parseFrontmatter(raw)
  if (document === null) return null

  return {
    name: document.field('name'),
    description: document.field('description'),
    front: document.front,
    body: document.body,
    raw
  }
}

/** The two lists a conversation's answer is read over. */
export interface SkillDefaults {
  /** Off in every conversation of this installation. */
  readonly global: readonly string[]
  /** Off in every conversation of this project. */
  readonly project: readonly string[]
}

/**
 * Whether a skill is on for one conversation.
 *
 * Three layers, narrowest first. A chat holds only what the user changed in
 * it, so a skill it says nothing about follows the two default lists — which
 * is what lets a skill added, renamed or removed after the conversation
 * started behave sensibly instead of being stuck at a stale answer.
 *
 * An empty everything means on, deliberately: that is how Claude Code treats a
 * skill it discovers, and octopus withholds only what it was asked to.
 */
export function skillEnabled(
  key: string,
  defaults: SkillDefaults,
  overrides: Readonly<Record<string, boolean>>
): boolean {
  const chosen = overrides[key]
  if (chosen !== undefined) return chosen

  return !defaults.global.includes(key) && !defaults.project.includes(key)
}

/**
 * The skill's directory, with the name checked before it becomes a path.
 *
 * `SkillNameSchema` is the whole guard: it allows nothing but lowercase
 * letters, digits and single dashes, so `.`, `..` and a separator are refused
 * here rather than caught by a second check further down. `removeProjectData`
 * needs that second check because a project id reaches it from a file somebody
 * can edit by hand; a skill name is validated at the moment it is used.
 */
function skillPath(dir: string, name: string): string {
  if (!isSkillName(name)) {
    throw new SkillError('skillNameInvalid', { name }, `${name} is not a skill name.`)
  }

  return join(dir, name)
}

/** The file's text, or null for anything that stops us reading it. */
async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function readDocument(skillDir: string): Promise<ParsedSkill | null> {
  const raw = await readText(join(skillDir, SKILL_FILE))

  return raw === null ? null : parse(raw)
}

/**
 * Every skill in a directory of skill directories.
 *
 * Never throws. This reads three different places — two of ours and the
 * checkout's own — and any of them may be absent, half-written or hold a
 * directory that is not a skill at all. A list that refuses to be drawn
 * because one entry is malformed is worse than a list missing that entry.
 *
 * The name comes from the frontmatter where there is one, because that is what
 * the agent calls the skill, and falls back to the directory.
 */
export async function readSkillsIn(dir: string): Promise<SkillEntry[]> {
  let listing
  try {
    listing = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const found: SkillEntry[] = []

  for (const entry of listing) {
    if (!entry.isDirectory()) continue

    const path = join(dir, entry.name)
    const parsed = await readDocument(path)
    if (parsed === null) continue

    found.push({
      name: parsed.name === '' ? entry.name : parsed.name,
      description: parsed.description,
      folder: entry.name,
      path
    })
  }

  return found.sort((first, second) => first.name.localeCompare(second.name))
}

/** One skill, opened for editing. */
export async function readSkill(dir: string, folder: string): Promise<SkillDocument> {
  const path = skillPath(dir, folder)
  const parsed = await readDocument(path)

  if (parsed === null) {
    throw new SkillError(
      'skillMissing',
      { name: folder },
      `${folder} has no readable ${SKILL_FILE}.`
    )
  }

  return {
    // From the document, not from the directory: the editor shows what the
    // agent calls it, and the two need not agree.
    name: parsed.name === '' ? folder : parsed.name,
    description: parsed.description,
    body: parsed.body,
    raw: parsed.raw,
    folder,
    path
  }
}

/**
 * Frontmatter for a skill about to be written.
 *
 * The name goes in beside the description because the two are what the form
 * edits; everything else the document carried survives, which is what
 * `setFields` is for.
 */
function frontmatterFor(previous: string | null, name: string, description: string): string {
  return setFields(previous, { name, description })
}

function assertFits(text: string): void {
  if (text.length > MAX_DOCUMENT) {
    throw new SkillError('skillTooLarge', { limit: String(MAX_DOCUMENT) }, 'The skill is too long.')
  }
}

/** Writes what the form edited, keeping any frontmatter it does not know about. */
export async function writeSkill(
  dir: string,
  folder: string,
  content: SkillContent,
  elsewhere: readonly string[] = []
): Promise<SkillEntry> {
  const path = skillPath(dir, folder)
  const existing = await readDocument(path)
  // Only when this creates one. Saving an edit to a skill that already exists
  // must not be refused by its own name, and `elsewhere` never holds this
  // store's names anyway.
  if (existing === null) await refuseExisting(dir, folder, elsewhere)
  // The name written into the document is the one it already had, not the
  // directory: a skill whose frontmatter names something else keeps saying so
  // after an edit, because that is the name the agent knows it by.
  const name = existing === null || existing.name === '' ? folder : existing.name
  const raw = `---\n${frontmatterFor(existing === null ? null : existing.front, name, content.description).trimEnd()}\n---\n\n${content.body}`

  assertFits(raw)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, SKILL_FILE), raw, 'utf8')

  return { name, description: content.description, folder, path }
}

/**
 * Writes a whole `SKILL.md`, as the raw mode and the paste import hand it over.
 *
 * The frontmatter's name must match the directory. Letting them drift would
 * make the file claim to be a skill the store has filed under another name,
 * and every key stored against it — the default marks, each chat's overrides —
 * would point at the wrong one.
 */
export async function writeRawSkill(
  dir: string,
  folder: string,
  text: string,
  elsewhere: readonly string[] = []
): Promise<SkillEntry> {
  const path = skillPath(dir, folder)

  assertFits(text)

  const parsed = parse(text)
  if (parsed === null) {
    throw new SkillError(
      'skillFrontmatterMissing',
      {},
      `A ${SKILL_FILE} needs frontmatter with a name and a description.`
    )
  }

  /*
   * The save must not change which skill this is.
   *
   * Compared against the name the document already carries rather than against
   * the directory, because those are the same string only for a skill the app
   * created: a folder placed by hand naming something else is a supported way
   * in, and refusing to save it would make raw mode the one place that cannot
   * edit it.
   *
   * What stays refused is the rename, which is what this check was always for:
   * every key stored against a skill — the default marks, each chat's overrides
   * — is its name, and moving it here would leave all of them pointing at a
   * skill that no longer answers to it. A rename is a migration and has a task
   * file of its own.
   */
  const existing = await readDocument(path)
  if (existing === null) await refuseExisting(dir, parsed.name, elsewhere)

  const current = existing === null || existing.name === '' ? folder : existing.name

  if (parsed.name !== current) {
    throw new SkillError(
      'skillNameMismatch',
      { name: current, found: parsed.name },
      `The document names ${parsed.name}, not ${current}.`
    )
  }

  await mkdir(path, { recursive: true })
  await writeFile(join(path, SKILL_FILE), text, 'utf8')

  return { name: parsed.name, description: parsed.description, folder, path }
}

export async function removeSkill(dir: string, folder: string): Promise<void> {
  await rm(skillPath(dir, folder), { recursive: true, force: true })
}

/**
 * Gives a skill another name — the directory and the frontmatter together.
 *
 * The name **is** the directory, and it is also the key three stored answers
 * use: the installation's default list, the project's own, and every chat's
 * overrides. So this is a migration rather than an edit, which is why the
 * editor's name field is disabled and why it was left out rather than
 * half-done: a rename that moved the folder and left the keys behind would look
 * like it worked and quietly switch the skill back on everywhere it had been
 * turned off, because `skillEnabled` reads a key no list mentions as on. The
 * caller moves the keys; `service.renameStoredSkill` is the only one there is.
 *
 * The collision check runs **before** anything moves, and that is what makes
 * the ordering safe rather than a rollback: with the new name proved free, what
 * is left to fail is exotic, and the alternative — writing the records first —
 * fails the same way round.
 */
export async function renameSkill(
  dir: string,
  folder: string,
  to: string,
  elsewhere: readonly string[] = []
): Promise<SkillEntry> {
  const from = skillPath(dir, folder)
  const path = skillPath(dir, to)

  const existing = await readDocument(from)
  if (existing === null) {
    throw new SkillError('skillMissing', { name: folder }, `${folder} is not here.`)
  }

  if (to !== folder) await refuseExisting(dir, to, elsewhere)

  await rename(from, path)

  // The frontmatter follows the directory, or the file claims to be a skill the
  // store has filed under another name — the drift `writeRawSkill` refuses.
  const raw = `---\n${frontmatterFor(existing.front, to, existing.description).trimEnd()}\n---\n\n${existing.body}`
  await writeFile(join(path, SKILL_FILE), raw, 'utf8')

  return { name: to, description: existing.description, folder: to, path }
}

/**
 * Gives a store the shape a session discovers skills in, and answers where
 * they go inside it.
 *
 * Called before every write rather than once at startup: a store exists from
 * the moment somebody puts something in it, and a directory created eagerly
 * for one nobody uses is a thing the user has to wonder about.
 */
export async function ensureStore(root: string): Promise<string> {
  const skills = skillsDirOf(root)
  await mkdir(skills, { recursive: true })

  return skills
}

function requireName(name: string): string {
  if (!isSkillName(name)) {
    throw new SkillError('skillNameInvalid', { name }, `${name} is not a skill name.`)
  }

  return name
}

function requireDocument(raw: string): ParsedSkill {
  assertFits(raw)

  const parsed = parse(raw)
  if (parsed === null) {
    throw new SkillError(
      'skillFrontmatterMissing',
      {},
      `A ${SKILL_FILE} needs frontmatter with a name and a description.`
    )
  }

  return parsed
}

/**
 * Refuses a name that is already in use, in this store or beside it.
 *
 * `elsewhere` is the wider half and the reason this takes an argument at all.
 * A skill is keyed by its bare name wherever it came from — `skillKey` says so,
 * and it is right: measured against a live session, one `local-probe` in a
 * store and another in the checkout came back as a single row, so a key telling
 * them apart would describe something the CLI cannot. But the check was made
 * against one directory, so a global `review` and a project `review` were both
 * accepted and the switch on either row then moved both.
 *
 * The caller supplies the list because the scope is the caller's to know: this
 * module knows about a directory, and which directories are in view is a
 * question about stores.
 */
async function refuseExisting(
  dir: string,
  name: string,
  elsewhere: readonly string[]
): Promise<void> {
  if (elsewhere.includes(name)) {
    throw new SkillError('skillExists', { name }, `${name} is already here.`)
  }

  if ((await readText(join(skillPath(dir, name), SKILL_FILE))) !== null) {
    throw new SkillError('skillExists', { name }, `${name} is already here.`)
  }
}

/** Imports a `SKILL.md` handed over as text — pasted, or downloaded. */
export async function importFromText(
  dir: string,
  text: string,
  elsewhere: readonly string[] = []
): Promise<SkillEntry> {
  const parsed = requireDocument(text)
  const name = requireName(parsed.name)

  await refuseExisting(dir, name, elsewhere)

  return writeRawSkill(dir, name, text)
}

/**
 * Refuses a source directory that is too big to be a skill, or that links out
 * of itself.
 *
 * The links matter more than the size. A skill copied here is read by the
 * agent later, and a symlink would make "what this store holds" a question
 * about somewhere else on the disk — so the copy below can use the plain,
 * link-preserving mode knowing there are none to preserve.
 */
async function inspectSource(source: string): Promise<void> {
  const listing = await readdir(source, { withFileTypes: true, recursive: true })
  let files = 0
  let bytes = 0

  for (const entry of listing) {
    if (entry.isSymbolicLink()) {
      throw new SkillError('skillLinkRefused', { name: entry.name }, `${entry.name} is a link.`)
    }

    if (!entry.isFile()) continue

    files += 1
    if (files > MAX_IMPORT_FILES) {
      throw new SkillError(
        'skillTooLarge',
        { limit: String(MAX_IMPORT_FILES) },
        'The folder holds too many files to be one skill.'
      )
    }

    bytes += (await stat(join(entry.parentPath, entry.name))).size
    if (bytes > MAX_IMPORT_BYTES) {
      throw new SkillError(
        'skillTooLarge',
        { limit: String(MAX_IMPORT_BYTES) },
        'The folder is too large to be one skill.'
      )
    }
  }
}

async function importDirectory(
  dir: string,
  source: string,
  elsewhere: readonly string[]
): Promise<SkillEntry> {
  const raw = await readText(join(source, SKILL_FILE))
  if (raw === null) {
    throw new SkillError('skillFrontmatterMissing', {}, `The folder holds no ${SKILL_FILE}.`)
  }

  const parsed = requireDocument(raw)
  const name = requireName(parsed.name)

  await refuseExisting(dir, name, elsewhere)
  await inspectSource(source)
  await mkdir(dir, { recursive: true })

  const path = skillPath(dir, name)
  await cp(source, path, { recursive: true, errorOnExist: true, force: false })

  // The one place the two are the same by construction: an import creates the
  // directory, and it creates it under the name the document claims.
  return { name, description: parsed.description, folder: name, path }
}

/**
 * Imports whatever the user picked: a skill's folder, or a lone `SKILL.md`.
 *
 * Both are offered because both are what a skill arrives as. One that carries
 * references or scripts is a folder; one copied out of a README is a file.
 */
export async function importFromPath(
  dir: string,
  source: string,
  elsewhere: readonly string[] = []
): Promise<SkillEntry> {
  const info = await stat(source)

  if (info.isDirectory()) return importDirectory(dir, source, elsewhere)

  // Read without a fallback, so a file the user picked and we cannot open
  // fails saying which file and why. A code of ours in its place would replace
  // "permission denied" with something vaguer.
  return importFromText(dir, await readFile(source, 'utf8'), elsewhere)
}

/**
 * Downloads one `SKILL.md` and files it.
 *
 * One document and nothing beside it, which is the whole reason this is
 * narrower than the folder import: a URL is the only source here the user has
 * not already got on their own disk, and fetching a tree from it would mean
 * writing files nobody has looked at into a directory the agent reads.
 *
 * `https` only, and checked again after the redirects: a hop down to plaintext
 * is exactly the case the scheme check exists for.
 */
export async function importFromUrl(
  dir: string,
  value: string,
  download: Download,
  elsewhere: readonly string[] = []
): Promise<SkillEntry> {
  return importFromText(dir, await fetched(value, download), elsewhere)
}

/**
 * The document at an address, in this module's own words.
 *
 * Its own function because the preview reads the same address the same way —
 * and because a link inspected and then imported must be fetched **once**: the
 * second answer need not be the first, and the reader approved the first.
 */
function fetched(value: string, download: Download): Promise<string> {
  return fetchDocument(value, MAX_DOWNLOAD_BYTES, download, {
    refuseUrl: (params, message) => new SkillError('skillUrlRefused', params, message),
    refuseSize: (params, message) => new SkillError('skillTooLarge', params, message)
  })
}

/** What a preview says about a skill that has not been written yet. */
export interface SkillPreview {
  readonly name: string
  readonly description: string
  /**
   * The document, for the one route whose source cannot be read twice.
   *
   * Null for a folder and for pasted text, where the caller still has what it
   * handed over. A **link** is the case this field exists for: inspecting and
   * then importing would otherwise fetch the address twice, and the second
   * answer need not be the first.
   */
  readonly text: string | null
}

/**
 * What an import would write, without writing it.
 *
 * The three routes differ in how much can be seen beforehand. A folder somebody
 * picked, they know; pasted text, they can read. A **link** they cannot: the
 * only thing on screen is an address, and what comes back is prose the agent
 * will later follow. Naming it first is the difference between importing a
 * skill and importing a URL.
 *
 * Every refusal the write makes is made here too — a name that cannot be a
 * folder, a name already taken — so it arrives before the round trip rather
 * than after it, and about a name the reader has now seen.
 */
export async function inspectImport(
  dir: string,
  request: SkillImport,
  download: Download,
  elsewhere: readonly string[] = []
): Promise<SkillPreview> {
  const text = request.kind === 'text' ? request.text : await sourceText(request, download)

  const parsed = requireDocument(text)
  const name = requireName(parsed.name)
  await refuseExisting(dir, name, elsewhere)

  return {
    name,
    description: parsed.description,
    text: request.kind === 'url' ? text : null
  }
}

/** The document behind a folder or a link, read the way the import reads it. */
async function sourceText(
  request: Extract<SkillImport, { kind: 'path' | 'url' }>,
  download: Download
): Promise<string> {
  if (request.kind === 'url') return fetched(request.url, download)

  const info = await stat(request.path)
  if (!info.isDirectory()) return readFile(request.path, 'utf8')

  const raw = await readText(join(request.path, SKILL_FILE))
  if (raw === null) {
    throw new SkillError('skillFrontmatterMissing', {}, `The folder holds no ${SKILL_FILE}.`)
  }

  return raw
}
