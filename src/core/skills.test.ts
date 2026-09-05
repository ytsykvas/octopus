import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type Download,
  ensureStore,
  importFromPath,
  importFromText,
  inspectImport,
  importFromUrl,
  readSkill,
  readSkillsIn,
  removeSkill,
  renameSkill,
  SkillError,
  skillEnabled,
  writeRawSkill,
  writeSkill
} from './skills.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-skills-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A skill on disk, written the way something outside octopus would write it. */
async function place(dir: string, name: string, contents: string): Promise<string> {
  const path = join(dir, name)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'SKILL.md'), contents, 'utf8')

  return path
}

function document(name: string, description: string, body = '# Title\n'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`
}

/** The error, so a test can name the code rather than assert on prose. */
async function refusal(run: () => Promise<unknown>): Promise<SkillError> {
  try {
    await run()
  } catch (error) {
    if (error instanceof SkillError) return error
    throw error
  }

  throw new Error('the call was expected to be refused')
}

describe('readSkillsIn', () => {
  it('reads a skill by its frontmatter, not by its directory', async () => {
    await place(root, 'folder-name', document('real-name', 'When asked to do the thing.'))

    expect(await readSkillsIn(root)).toEqual([
      {
        name: 'real-name',
        description: 'When asked to do the thing.',
        folder: 'folder-name',
        path: join(root, 'folder-name')
      }
    ])
  })

  // The listing has always said which directory it found; nothing that wrote
  // used it, and re-deriving one from the name reached a different place.
  /*
   * Two directories, one name — and that is why a name cannot address a row.
   * The frontmatter is what the agent calls the skill, so the listing is right
   * to report both as `review`; what nothing had was a way to say which of the
   * two a click meant.
   */
  it('reports two directories that claim one name as two skills', async () => {
    await place(root, 'alpha', document('review', 'The hand-placed one.'))
    await place(root, 'review', document('review', 'The one the app made.'))

    const found = await readSkillsIn(root)

    expect(found.map((skill) => skill.name)).toEqual(['review', 'review'])
    expect(found.map((skill) => skill.folder)).toEqual(['alpha', 'review'])
  })

  it('says which directory it found the skill in', async () => {
    await place(root, 'folder-name', document('real-name', 'When asked to do the thing.'))

    expect((await readSkillsIn(root))[0]?.folder).toBe('folder-name')
  })

  it('falls back to the directory when the frontmatter does not name the skill', async () => {
    await place(root, 'folder-name', '---\ndescription: No name here.\n---\n\nBody\n')

    expect((await readSkillsIn(root))[0]?.name).toBe('folder-name')
  })

  it('takes a description that is folded over several lines', async () => {
    await place(
      root,
      'wrapped',
      '---\nname: wrapped\ndescription: >-\n  One sentence\n  wrapped.\n---\n\nBody\n'
    )

    expect((await readSkillsIn(root))[0]?.description).toBe('One sentence wrapped.')
  })

  it('reads nothing from a description that is not a scalar', async () => {
    await place(root, 'listy', '---\nname: listy\ndescription:\n  - a\n  - b\n---\n\nBody\n')

    expect((await readSkillsIn(root))[0]?.description).toBe('')
  })

  /*
   * This reads three directories — two of ours and the checkout's own — and
   * any of them can hold something that is not a skill. A list that refuses to
   * be drawn because one entry is malformed is worse than one missing that
   * entry, so every failure here is a skip.
   */
  it('skips what is not a skill rather than refusing the whole list', async () => {
    await place(root, 'good', document('good', 'Fine.'))
    await mkdir(join(root, 'no-document'), { recursive: true })
    await place(root, 'no-frontmatter', '# Just prose\n')
    await place(root, 'unterminated', '---\nname: x\n')
    await writeFile(join(root, 'loose.md'), 'not a directory', 'utf8')

    expect((await readSkillsIn(root)).map((skill) => skill.name)).toEqual(['good'])
  })

  /*
   * Real frontmatter is often not valid YAML, and the agent reads it anyway. A
   * description is one long unquoted sentence and a sentence has colons in it;
   * YAML sees `Triggers on: access_denied` as a nested mapping and refuses the
   * block. Two skills shipped in a repository this app was opened on did
   * exactly that, and the panel said "no skills yet" while the agent was using
   * both.
   */
  it('reads frontmatter no parser will take, rather than calling it not a skill', async () => {
    await place(
      root,
      'colons',
      '---\nname: colons\ndescription: Use it when there is an artifact. Triggers on: access_denied, "is this a bug".\nallowed-tools: Read\n---\n\nBody\n'
    )

    expect(await readSkillsIn(root)).toEqual([
      {
        name: 'colons',
        description:
          'Use it when there is an artifact. Triggers on: access_denied, "is this a bug".',
        folder: 'colons',
        path: join(root, 'colons')
      }
    ])
  })

  it('unwraps a quoted value the parser never got to', async () => {
    await place(root, 'quoted', '---\nname: quoted\ndescription: "One: two"\nbad: [\n---\n\nBody\n')

    expect((await readSkillsIn(root))[0]?.description).toBe('One: two')
  })

  it('reads nothing for a field that is not on any line', async () => {
    await place(root, 'nameless', '---\ndescription: No name. Colon: here.\nbad: [\n---\n\nBody\n')

    expect((await readSkillsIn(root))[0]?.name).toBe('nameless')
  })

  it('answers with nothing for a directory that is not there', async () => {
    expect(await readSkillsIn(join(root, 'absent'))).toEqual([])
  })

  it('sorts by name, so the list does not reshuffle between openings', async () => {
    await place(root, 'c', document('cherry', 'C.'))
    await place(root, 'a', document('apple', 'A.'))
    await place(root, 'b', document('banana', 'B.'))

    expect((await readSkillsIn(root)).map((skill) => skill.name)).toEqual([
      'apple',
      'banana',
      'cherry'
    ])
  })

  it('reads a document written with CRLF line endings', async () => {
    await place(
      root,
      'windows',
      '---\r\nname: windows\r\ndescription: From another editor.\r\n---\r\n\r\nBody\r\n'
    )

    expect((await readSkillsIn(root))[0]?.description).toBe('From another editor.')
  })

  it('reads a document that ends on its closing delimiter', async () => {
    await place(root, 'bare', '---\nname: bare\ndescription: Nothing follows.\n---')

    expect((await readSkillsIn(root))[0]?.description).toBe('Nothing follows.')
  })
})

describe('readSkill', () => {
  it('opens the document for editing, form and raw alike', async () => {
    await place(root, 'review', document('review', 'When reviewing.', '# Review\n\nSteps.\n'))

    const skill = await readSkill(root, 'review')

    expect(skill.description).toBe('When reviewing.')
    expect(skill.body).toBe('# Review\n\nSteps.\n')
    expect(skill.raw).toContain('name: review')
  })

  /*
   * Read, write, read used to grow the file by a blank line each time: the
   * body kept the line that ended the delimiter and the composer wrote a fresh
   * one in front of it. Nobody typing anything is the point of the test.
   */
  it('round-trips a body without growing it', async () => {
    await place(root, 'review', document('review', 'When reviewing.', '# Review\n'))

    for (let pass = 0; pass < 3; pass += 1) {
      const opened = await readSkill(root, 'review')
      await writeSkill(root, 'review', {
        description: opened.description,
        body: opened.body
      })
    }

    expect((await readSkill(root, 'review')).body).toBe('# Review\n')
  })

  it('says the skill is missing rather than answering with an empty one', async () => {
    expect((await refusal(() => readSkill(root, 'absent'))).code).toBe('skillMissing')
  })

  it('refuses a name that would leave the store', async () => {
    expect((await refusal(() => readSkill(root, '../elsewhere'))).code).toBe('skillNameInvalid')
  })

  // The listing falls back to the directory for a document that names nothing;
  // opening one has to say the same thing, or the editor shows a blank name for
  // a skill the panel lists under its folder.
  it('falls back to the directory when the document names nothing', async () => {
    await place(root, 'folder-name', '---\ndescription: No name here.\n---\n\nBody\n')

    expect((await readSkill(root, 'folder-name')).name).toBe('folder-name')
  })
})

describe('writeSkill', () => {
  it('writes a document the reader can parse back', async () => {
    await writeSkill(root, 'review', { description: 'When reviewing.', body: '# Review\n' })

    expect(await readSkillsIn(root)).toEqual([
      {
        name: 'review',
        description: 'When reviewing.',
        folder: 'review',
        path: join(root, 'review')
      }
    ])
  })

  /*
   * The form edits two fields, and a skill brought in from elsewhere carries
   * more than two: `allowed-tools` decides what it may run, `when_to_use` is
   * half of why it triggers. Writing frontmatter from scratch on every save
   * would drop them silently — the save would look like it worked.
   */
  it('keeps frontmatter the form knows nothing about', async () => {
    await place(
      root,
      'review',
      '---\nname: review\ndescription: Old.\nallowed-tools: Read, Bash(npm run:*)\nwhen_to_use: On a diff.\n---\n\nOld body\n'
    )

    await writeSkill(root, 'review', { description: 'New.', body: 'New body\n' })
    const raw = await readFile(join(root, 'review', 'SKILL.md'), 'utf8')

    expect(raw).toContain('allowed-tools: Read, Bash(npm run:*)')
    expect(raw).toContain('when_to_use: On a diff.')
    expect(raw).toContain('description: New.')
    expect(raw).toContain('New body')
    expect(raw).not.toContain('Old body')
  })

  /*
   * The two fields are replaced where they stand and everything else is copied
   * through. Rewriting the block as YAML would tidy away the `allowed-tools`
   * beside them, and writing back what the parser made of a block it could not
   * read would be worse than either.
   */
  it('edits frontmatter no parser will take without disturbing the rest', async () => {
    await place(
      root,
      'colons',
      '---\nname: colons\ndescription: Triggers on: old.\nallowed-tools: Read, Bash(npm run:*)\n---\n\nOld body\n'
    )

    await writeSkill(root, 'colons', { description: 'Triggers on: new.', body: 'New body\n' })
    const raw = await readFile(join(root, 'colons', 'SKILL.md'), 'utf8')

    expect(raw).toContain('description: Triggers on: new.')
    expect(raw).toContain('allowed-tools: Read, Bash(npm run:*)')
    expect(raw).not.toContain('old.')
  })

  it('adds a field the unreadable frontmatter never had', async () => {
    await place(root, 'partial', '---\nname: partial\nbad: [\n---\n\nBody\n')

    await writeSkill(root, 'partial', { description: 'Now it has one.', body: 'Body\n' })

    expect((await readSkill(root, 'partial')).description).toBe('Now it has one.')
  })

  it('refuses a document longer than a skill has any business being', async () => {
    const refused = await refusal(() =>
      writeSkill(root, 'huge', { description: 'Big.', body: 'x'.repeat(64_001) })
    )

    expect(refused.code).toBe('skillTooLarge')
  })

  it('refuses a name that would leave the store', async () => {
    const refused = await refusal(() => writeSkill(root, 'a/b', { description: 'x', body: 'y' }))

    expect(refused.code).toBe('skillNameInvalid')
  })
})

describe('writeRawSkill', () => {
  it('writes exactly what it was given', async () => {
    const raw = document('review', 'When reviewing.')
    await writeRawSkill(root, 'review', raw)

    expect(await readFile(join(root, 'review', 'SKILL.md'), 'utf8')).toBe(raw)
  })

  /*
   * Every key stored against a skill — the default marks, each chat's
   * overrides — is its name. A document naming one thing inside a directory
   * named another would point all of them at nothing.
   */
  it('refuses a document that names a different skill than the directory', async () => {
    const refused = await refusal(() =>
      writeRawSkill(root, 'review', document('something-else', 'x'))
    )

    expect(refused.code).toBe('skillNameMismatch')
    expect(refused.params.found).toBe('something-else')
  })

  it('refuses a document with no frontmatter at all', async () => {
    expect((await refusal(() => writeRawSkill(root, 'review', '# Just prose\n'))).code).toBe(
      'skillFrontmatterMissing'
    )
  })

  it('takes a document whose frontmatter no parser will read', async () => {
    const raw = '---\nname: review\ndescription: Triggers on: this.\n---\n\nBody\n'

    await expect(writeRawSkill(root, 'review', raw)).resolves.toMatchObject({
      description: 'Triggers on: this.'
    })
  })

  it('refuses a document past the cap', async () => {
    expect((await refusal(() => writeRawSkill(root, 'review', 'x'.repeat(64_001)))).code).toBe(
      'skillTooLarge'
    )
  })
  /*
   * The case the whole change is for: a folder placed by hand whose document
   * names something else. Raw mode used to compare the document against the
   * directory, so this save was refused and raw mode was the one place that
   * could not edit such a skill at all.
   */
  it('takes a raw save into a folder whose document names something else', async () => {
    await place(root, 'alpha', document('review', 'The hand-placed one.'))

    const written = await writeRawSkill(root, 'alpha', document('review', 'Edited.'))

    expect(written).toMatchObject({ name: 'review', folder: 'alpha' })
    expect((await readSkillsIn(root))[0]).toMatchObject({ name: 'review', folder: 'alpha' })
  })

  // What that check was always guarding, and still does: the name is the key
  // every stored answer uses, so moving it would leave all of them pointing at
  // a skill that no longer answers to it. A rename is a migration.
  it('refuses a raw save that would rename the skill', async () => {
    await place(root, 'alpha', document('review', 'The hand-placed one.'))

    const refused = await refusal(() => writeRawSkill(root, 'alpha', document('audit', 'x')))

    expect(refused.code).toBe('skillNameMismatch')
    expect(refused.params).toMatchObject({ name: 'review', found: 'audit' })
  })

  // Creating rather than editing: there is no document to compare against, so
  // the directory is what the save must name. This is the shape `importFromText`
  // uses, and the only one where the two agree by construction.
  it('takes a raw save into a directory that does not exist yet', async () => {
    const written = await writeRawSkill(root, 'fresh', document('fresh', 'Brand new.'))

    expect(written).toMatchObject({ name: 'fresh', folder: 'fresh' })
    expect((await readSkillsIn(root)).map((skill) => skill.folder)).toEqual(['fresh'])
  })

  // The same fallback the reader makes: a document that names nothing is filed
  // under its directory, so that is what a raw save must not change it away
  // from.
  it('takes a raw save into a skill whose document named nothing', async () => {
    await place(root, 'folder-name', '---\ndescription: No name here.\n---\n\nBody\n')

    const written = await writeRawSkill(root, 'folder-name', document('folder-name', 'Named now.'))

    expect(written).toMatchObject({ name: 'folder-name', folder: 'folder-name' })
  })
})

describe('removeSkill', () => {
  it('takes the whole skill, references and all', async () => {
    const path = await place(root, 'review', document('review', 'x'))
    await writeFile(join(path, 'reference.md'), 'more', 'utf8')

    await removeSkill(root, 'review')

    expect(await readSkillsIn(root)).toEqual([])
  })

  /*
   * The folder decides, not the name.
   *
   * A folder placed by hand whose document names something else is a supported
   * route in — the store is documented as ordinary files — so two directories
   * can carry one name. Every write used to resolve that name back to
   * `join(dir, name)` rather than to the directory the listing found, and the
   * renderer had only the name to send: Remove on the hand-placed row deleted
   * the *other* skill, and the one aimed at stayed on screen.
   */
  it('takes the directory it was pointed at, not the one whose name it shares', async () => {
    await place(root, 'alpha', document('review', 'The hand-placed one.'))
    await place(root, 'review', document('review', 'The one the app made.'))

    await removeSkill(root, 'alpha')

    expect(await readSkillsIn(root)).toEqual([
      {
        name: 'review',
        description: 'The one the app made.',
        folder: 'review',
        path: join(root, 'review')
      }
    ])
  })

  it('is quiet about a skill that is already gone', async () => {
    await expect(removeSkill(root, 'absent')).resolves.toBeUndefined()
  })

  it('refuses a name that would delete something else', async () => {
    expect((await refusal(() => removeSkill(root, '..'))).code).toBe('skillNameInvalid')
  })
})

describe('renameSkill', () => {
  /*
   * The name **is** the directory, so this moves it — and the frontmatter with
   * it, or the file claims to be a skill the store has filed under another
   * name, which is the drift `writeRawSkill` refuses.
   */
  it('moves the directory and the name inside it together', async () => {
    await place(root, 'review', document('review', 'Reviews code.', '# How\n'))

    await expect(renameSkill(root, 'review', 'reviewer')).resolves.toMatchObject({
      name: 'reviewer',
      folder: 'reviewer'
    })

    const raw = await readFile(join(root, 'reviewer', 'SKILL.md'), 'utf8')
    expect(raw).toContain('name: reviewer')
    expect(raw).toContain('# How')
    await expect(readFile(join(root, 'review', 'SKILL.md'), 'utf8')).rejects.toThrow()
  })

  // Everything else in the frontmatter is copied through, the way an edit does:
  // a rename is not an invitation to tidy away an `allowed-tools` beside it.
  it('keeps the rest of the frontmatter', async () => {
    await place(
      root,
      'review',
      '---\nname: review\ndescription: Reviews code.\nallowed-tools: Read\n---\n\nBody\n'
    )

    await renameSkill(root, 'review', 'reviewer')

    expect(await readFile(join(root, 'reviewer', 'SKILL.md'), 'utf8')).toContain(
      'allowed-tools: Read'
    )
  })

  /*
   * Refused before anything moves, and that is what makes the ordering safe
   * rather than a rollback: with the new name proved free, what is left to fail
   * is exotic.
   */
  it('refuses a name the store already has, leaving both alone', async () => {
    await place(root, 'review', document('review', 'One.'))
    await place(root, 'reviewer', document('reviewer', 'Two.'))

    expect((await refusal(() => renameSkill(root, 'review', 'reviewer'))).code).toBe('skillExists')
    await expect(readFile(join(root, 'review', 'SKILL.md'), 'utf8')).resolves.toContain('One.')
  })

  // A skill is keyed by its bare name wherever it came from, so the other store
  // is in the same namespace and its names are refused here too.
  it('refuses a name the other store has', async () => {
    await place(root, 'review', document('review', 'One.'))

    expect((await refusal(() => renameSkill(root, 'review', 'ship', ['ship']))).code).toBe(
      'skillExists'
    )
  })

  it('refuses a name that could not be a directory', async () => {
    await place(root, 'review', document('review', 'One.'))

    expect((await refusal(() => renameSkill(root, 'review', '..'))).code).toBe('skillNameInvalid')
  })

  /*
   * Renaming to the name it already has is not a collision with itself, and it
   * is not a no-op either: it rewrites the frontmatter to match the directory,
   * which repairs a skill whose two names had drifted.
   */
  it('takes the name it already has, and makes the document agree', async () => {
    await place(root, 'review', document('other', 'Reviews code.'))

    await expect(renameSkill(root, 'review', 'review')).resolves.toMatchObject({ name: 'review' })
    expect(await readFile(join(root, 'review', 'SKILL.md'), 'utf8')).toContain('name: review')
  })

  it('says so when there is nothing there to rename', async () => {
    expect((await refusal(() => renameSkill(root, 'absent', 'present'))).code).toBe('skillMissing')
  })
})

describe('ensureStore', () => {
  /*
   * The shape a session discovers skills in: a root with `.claude/skills`
   * inside it. A local plugin was the obvious answer and cannot be switched
   * off — measured against a live session, `skillOverrides` does not touch a
   * plugin's skills under any spelling of the key.
   */
  it('gives the store the shape a working-directory root has', async () => {
    expect(await ensureStore(root)).toBe(join(root, '.claude', 'skills'))
  })

  it('is content with a store that already has it', async () => {
    await ensureStore(root)

    await expect(ensureStore(root)).resolves.toBe(join(root, '.claude', 'skills'))
  })
})

describe('importFromText', () => {
  it('files a pasted document under the name it gives itself', async () => {
    const entry = await importFromText(root, document('pdf-forms', 'When filling a PDF.'))

    expect(entry).toEqual({
      name: 'pdf-forms',
      description: 'When filling a PDF.',
      folder: 'pdf-forms',
      path: join(root, 'pdf-forms')
    })
  })

  it('refuses to overwrite a skill that is already here', async () => {
    await place(root, 'review', document('review', 'Mine.'))

    const refused = await refusal(() => importFromText(root, document('review', 'Theirs.')))

    expect(refused.code).toBe('skillExists')
    expect((await readSkill(root, 'review')).description).toBe('Mine.')
  })

  it('refuses a document whose name could not be a directory', async () => {
    expect((await refusal(() => importFromText(root, document('../escape', 'x')))).code).toBe(
      'skillNameInvalid'
    )
  })

  it('refuses a document with no frontmatter', async () => {
    expect((await refusal(() => importFromText(root, '# Prose only\n'))).code).toBe(
      'skillFrontmatterMissing'
    )
  })

  it('refuses a document past the cap', async () => {
    expect((await refusal(() => importFromText(root, 'x'.repeat(64_001)))).code).toBe(
      'skillTooLarge'
    )
  })
})

describe('importFromPath', () => {
  it('copies a folder whole, so a skill keeps its references', async () => {
    const source = await place(root, 'source', document('with-refs', 'When asked.'))
    await mkdir(join(source, 'references'), { recursive: true })
    await writeFile(join(source, 'references', 'notes.md'), 'notes', 'utf8')

    const store = join(root, 'store')
    const entry = await importFromPath(store, source)

    expect(entry.name).toBe('with-refs')
    expect(await readFile(join(store, 'with-refs', 'references', 'notes.md'), 'utf8')).toBe('notes')
  })

  it('takes a lone document and gives it a directory of its own', async () => {
    const file = join(root, 'loose.md')
    await writeFile(file, document('loose', 'When loose.'), 'utf8')

    const store = join(root, 'store')
    await importFromPath(store, file)

    expect((await readSkillsIn(store)).map((skill) => skill.name)).toEqual(['loose'])
  })

  it('says which folder was wrong rather than importing nothing quietly', async () => {
    const source = join(root, 'not-a-skill')
    await mkdir(source, { recursive: true })

    expect((await refusal(() => importFromPath(join(root, 'store'), source))).code).toBe(
      'skillFrontmatterMissing'
    )
  })

  it('refuses a folder that names a skill it cannot be filed as', async () => {
    const source = await place(root, 'source', document('Not A Name', 'x'))

    expect((await refusal(() => importFromPath(join(root, 'store'), source))).code).toBe(
      'skillNameInvalid'
    )
  })

  it('refuses to import over a skill already in the store', async () => {
    const source = await place(root, 'source', document('review', 'Theirs.'))
    const store = join(root, 'store')
    await place(store, 'review', document('review', 'Mine.'))

    expect((await refusal(() => importFromPath(store, source))).code).toBe('skillExists')
  })

  /*
   * "Choose a folder" is one mis-click away from a home directory, and what is
   * copied here is read by the agent afterwards. The count and the size are
   * two different ways of noticing that the folder is not a skill.
   */
  it('refuses a folder holding more files than a skill has', async () => {
    const source = await place(root, 'source', document('many', 'x'))
    for (let index = 0; index < 70; index += 1) {
      await writeFile(join(source, `file-${String(index)}.txt`), 'x', 'utf8')
    }

    expect((await refusal(() => importFromPath(join(root, 'store'), source))).code).toBe(
      'skillTooLarge'
    )
  })

  it('refuses a folder larger than a skill could be', async () => {
    const source = await place(root, 'source', document('heavy', 'x'))
    await writeFile(join(source, 'blob.bin'), 'x'.repeat(2 * 1024 * 1024 + 1), 'utf8')

    expect((await refusal(() => importFromPath(join(root, 'store'), source))).code).toBe(
      'skillTooLarge'
    )
  })

  /*
   * A link would make "what this store holds" a question about somewhere else
   * on the disk, and the agent reads this store later. Refusing them is also
   * what lets the copy stay in its plain, link-preserving mode.
   */
  it('refuses a folder that links out of itself', async () => {
    const source = await place(root, 'source', document('linked', 'x'))
    await symlink(root, join(source, 'outside'))

    expect((await refusal(() => importFromPath(join(root, 'store'), source))).code).toBe(
      'skillLinkRefused'
    )
  })
})

describe('inspectImport', () => {
  const download = (body: string): Download => ({
    fetch: () => Promise.resolve(new Response(body, { status: 200 })),
    timeoutMs: 100
  })

  /*
   * The route this exists for. A folder somebody picked they know and pasted
   * text they can read; an address shows nothing at all until it is fetched,
   * and what comes back is prose the agent will later follow.
   */
  it('names what a link would write, and writes nothing', async () => {
    const preview = await inspectImport(
      root,
      { kind: 'url', url: 'https://example.test/SKILL.md' },
      download(document('pdf-forms', 'Fills PDF forms.'))
    )

    expect(preview).toMatchObject({ name: 'pdf-forms', description: 'Fills PDF forms.' })
    await expect(readSkillsIn(root)).resolves.toEqual([])
  })

  // The document comes back with it, so importing what was previewed does not
  // ask the address again — the second answer need not be the first.
  it('carries the document back for a link, and not for the other two', async () => {
    const fetched = await inspectImport(
      root,
      { kind: 'url', url: 'https://example.test/SKILL.md' },
      download(document('review', 'Reviews.'))
    )
    expect(fetched.text).toContain('name: review')

    const pasted = await inspectImport(
      root,
      { kind: 'text', text: document('review', 'Reviews.') },
      download('')
    )
    expect(pasted.text).toBeNull()
  })

  it('reads a folder without copying it', async () => {
    const source = await place(root, 'source', document('pdf-forms', 'Fills PDF forms.'))

    await expect(
      inspectImport(root, { kind: 'path', path: source }, download(''))
    ).resolves.toMatchObject({ name: 'pdf-forms' })
  })

  it('reads a single file that is a skill', async () => {
    const source = await place(root, 'source', document('pdf-forms', 'Fills PDF forms.'))

    await expect(
      inspectImport(root, { kind: 'path', path: join(source, 'SKILL.md') }, download(''))
    ).resolves.toMatchObject({ name: 'pdf-forms' })
  })

  /*
   * Every refusal the write makes, made here — so it arrives before the round
   * trip and about a name the reader has now seen, rather than after it and
   * about one they never did.
   */
  it('refuses a document with no frontmatter', async () => {
    const refused = await refusal(() =>
      inspectImport(root, { kind: 'text', text: 'no frontmatter' }, download(''))
    )

    expect(refused.code).toBe('skillFrontmatterMissing')
  })

  it('refuses a name that could not be a folder', async () => {
    const refused = await refusal(() =>
      inspectImport(root, { kind: 'text', text: document('Code Review', 'x') }, download(''))
    )

    expect(refused.code).toBe('skillNameInvalid')
  })

  it('refuses a name the store already holds', async () => {
    await place(root, 'review', document('review', 'One.'))

    const refused = await refusal(() =>
      inspectImport(root, { kind: 'text', text: document('review', 'Two.') }, download(''))
    )

    expect(refused.code).toBe('skillExists')
  })

  it('refuses an address that is not https', async () => {
    const refused = await refusal(() =>
      inspectImport(root, { kind: 'url', url: 'http://example.test/SKILL.md' }, download(''))
    )

    expect(refused.code).toBe('skillUrlRefused')
  })

  it('refuses a folder with no SKILL.md in it', async () => {
    await mkdir(join(root, 'empty'), { recursive: true })

    const refused = await refusal(() =>
      inspectImport(root, { kind: 'path', path: join(root, 'empty') }, download(''))
    )

    expect(refused.code).toBe('skillFrontmatterMissing')
  })
})

describe('importFromUrl', () => {
  function transport(handler: Download['fetch'], timeoutMs = 1_000): Download {
    return { fetch: handler, timeoutMs }
  }

  function answering(body: string | null, init?: ResponseInit, url?: string): Download['fetch'] {
    return () => {
      const response = new Response(body, init)
      if (url !== undefined) Object.defineProperty(response, 'url', { value: url })

      return Promise.resolve(response)
    }
  }

  it('files a downloaded document', async () => {
    const entry = await importFromUrl(
      root,
      'https://example.test/SKILL.md',
      transport(answering(document('fetched', 'When fetched.')))
    )

    expect(entry.name).toBe('fetched')
    expect((await readSkill(root, 'fetched')).description).toBe('When fetched.')
  })

  it('refuses anything that is not an https address', async () => {
    for (const value of ['http://example.test/SKILL.md', 'not a url', 'file:///etc/passwd']) {
      const refused = await refusal(() =>
        importFromUrl(root, value, transport(answering(document('x', 'x'))))
      )
      expect(refused.code).toBe('skillUrlRefused')
    }
  })

  it('says what the server answered rather than failing blankly', async () => {
    const refused = await refusal(() =>
      importFromUrl(root, 'https://example.test/x', transport(answering('nope', { status: 404 })))
    )

    expect(refused.code).toBe('skillUrlRefused')
    expect(refused.params.status).toBe('404')
  })

  /* A redirect down to plaintext is the case the scheme check exists for. */
  it('refuses a redirect that left https', async () => {
    const refused = await refusal(() =>
      importFromUrl(
        root,
        'https://example.test/x',
        transport(answering(document('x', 'x'), undefined, 'http://elsewhere.test/x'))
      )
    )

    expect(refused.code).toBe('skillUrlRefused')
  })

  it('accepts a redirect that stayed on https', async () => {
    const entry = await importFromUrl(
      root,
      'https://example.test/x',
      transport(answering(document('moved', 'x'), undefined, 'https://elsewhere.test/x'))
    )

    expect(entry.name).toBe('moved')
  })

  it('treats an answer with no body as a document with no frontmatter', async () => {
    expect(
      (
        await refusal(() =>
          importFromUrl(root, 'https://example.test/x', transport(answering(null)))
        )
      ).code
    ).toBe('skillFrontmatterMissing')
  })

  /*
   * The length is the one thing about a download the user does not decide, so
   * it is checked as the bytes arrive rather than after they are all held.
   */
  it('stops reading a body too large to be one skill', async () => {
    const refused = await refusal(() =>
      importFromUrl(
        root,
        'https://example.test/x',
        transport(answering('x'.repeat(256 * 1024 + 1)))
      )
    )

    expect(refused.code).toBe('skillTooLarge')
  })

  it('gives up on a server that never answers', async () => {
    const hanging: Download['fetch'] = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })

    await expect(
      importFromUrl(root, 'https://example.test/x', transport(hanging, 1))
    ).rejects.toThrow('aborted')
  })
})

describe('skillEnabled', () => {
  const none = { global: [], project: [] }

  /*
   * Nothing said anywhere means on, which is how Claude Code treats a skill it
   * discovers. A default of off would leave a skill somebody has just written
   * doing nothing until they found a second control.
   */
  it('offers a skill nobody has said anything about', () => {
    expect(skillEnabled('octopus:review', none, {})).toBe(true)
  })

  it('withholds one either default list names', () => {
    expect(skillEnabled('octopus:review', { global: ['octopus:review'], project: [] }, {})).toBe(
      false
    )
    expect(skillEnabled('octopus:review', { global: [], project: ['octopus:review'] }, {})).toBe(
      false
    )
  })

  it("lets the conversation's own answer win over both", () => {
    const off = { global: ['octopus:review'], project: ['octopus:review'] }

    expect(skillEnabled('octopus:review', off, { 'octopus:review': true })).toBe(true)
    expect(skillEnabled('octopus:review', none, { 'octopus:review': false })).toBe(false)
  })

  it('answers for the key it was asked about and no other', () => {
    const defaults = { global: ['octopus:review'], project: [] }

    expect(skillEnabled('review', defaults, {})).toBe(true)
    expect(skillEnabled('octopus-project:review', defaults, {})).toBe(true)
  })
})
