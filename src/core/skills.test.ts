import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  type Download,
  ensurePlugin,
  importFromPath,
  importFromText,
  importFromUrl,
  readSkill,
  readSkillsIn,
  removeSkill,
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
        path: join(root, 'folder-name')
      }
    ])
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
    await place(root, 'broken-yaml', '---\nname: [unclosed\n---\n\nBody\n')
    await writeFile(join(root, 'loose.md'), 'not a directory', 'utf8')

    expect((await readSkillsIn(root)).map((skill) => skill.name)).toEqual(['good'])
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
})

describe('writeSkill', () => {
  it('writes a document the reader can parse back', async () => {
    await writeSkill(root, 'review', { description: 'When reviewing.', body: '# Review\n' })

    expect(await readSkillsIn(root)).toEqual([
      { name: 'review', description: 'When reviewing.', path: join(root, 'review') }
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

  it('refuses a document past the cap', async () => {
    expect((await refusal(() => writeRawSkill(root, 'review', 'x'.repeat(64_001)))).code).toBe(
      'skillTooLarge'
    )
  })
})

describe('removeSkill', () => {
  it('takes the whole skill, references and all', async () => {
    const path = await place(root, 'review', document('review', 'x'))
    await writeFile(join(path, 'reference.md'), 'more', 'utf8')

    await removeSkill(root, 'review')

    expect(await readSkillsIn(root)).toEqual([])
  })

  it('is quiet about a skill that is already gone', async () => {
    await expect(removeSkill(root, 'absent')).resolves.toBeUndefined()
  })

  it('refuses a name that would delete something else', async () => {
    expect((await refusal(() => removeSkill(root, '..'))).code).toBe('skillNameInvalid')
  })
})

describe('ensurePlugin', () => {
  it('gives the store the shape the SDK loads a local plugin from', async () => {
    const skills = await ensurePlugin(root, 'octopus')

    expect(skills).toBe(join(root, 'skills'))
    expect(
      JSON.parse(await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8'))
    ).toMatchObject({ name: 'octopus' })
  })

  it('leaves a manifest that is already there alone', async () => {
    await ensurePlugin(root, 'octopus')
    await writeFile(
      join(root, '.claude-plugin', 'plugin.json'),
      '{ "name": "octopus", "edited": true }',
      'utf8'
    )

    await ensurePlugin(root, 'octopus')

    expect(await readFile(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).toContain('edited')
  })
})

describe('importFromText', () => {
  it('files a pasted document under the name it gives itself', async () => {
    const entry = await importFromText(root, document('pdf-forms', 'When filling a PDF.'))

    expect(entry).toEqual({
      name: 'pdf-forms',
      description: 'When filling a PDF.',
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
