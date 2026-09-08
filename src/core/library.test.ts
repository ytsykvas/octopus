import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Download } from './download.js'
import {
  ensureLibrary,
  importLibraryItem,
  inspectLibraryImport,
  LibraryError,
  readLibraryIn,
  readLibraryItem,
  removeLibraryItem,
  renameLibraryItem,
  suggestName,
  writeLibraryItem
} from './library.js'
import { libraryDirOf } from './paths.js'

let root: string
let commands: string
let agents: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'octopus-library-'))
  commands = await ensureLibrary(root, 'command')
  agents = await ensureLibrary(root, 'subagent')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A subagent as Claude Code writes one. */
function subagent(name: string, description = 'When reviewing.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nYou review code.`
}

async function given(dir: string, file: string, text: string): Promise<void> {
  await writeFile(join(dir, file), text, 'utf8')
}

describe('where each kind is discovered', () => {
  // The two directory names are Claude Code's, and getting either wrong makes
  // everything here invisible to the session while every test still passes.
  it('is the directory Claude Code looks in', () => {
    expect(libraryDirOf('/store', 'command')).toBe('/store/.claude/commands')
    expect(libraryDirOf('/store', 'subagent')).toBe('/store/.claude/agents')
  })

  it('is made on demand rather than at start-up', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'octopus-bare-'))

    await expect(readLibraryIn(libraryDirOf(bare, 'command'), 'command')).resolves.toEqual([])
    expect(await ensureLibrary(bare, 'command')).toBe(join(bare, '.claude', 'commands'))
    await expect(readLibraryIn(libraryDirOf(bare, 'command'), 'command')).resolves.toEqual([])

    await rm(bare, { recursive: true, force: true })
  })
})

describe('reading what a store holds', () => {
  it('names each one by its file and reads the description off it', async () => {
    await given(commands, 'ship.md', '---\ndescription: Commits and pushes.\n---\n\nRun the gate.')
    await given(commands, 'check.md', 'Run the gate.')

    await expect(readLibraryIn(commands, 'command')).resolves.toEqual([
      { kind: 'command', name: 'check', description: '', path: join(commands, 'check.md') },
      {
        kind: 'command',
        name: 'ship',
        description: 'Commits and pushes.',
        path: join(commands, 'ship.md')
      }
    ])
  })

  // A command is a prompt and need not say anything about itself, so a file
  // with no frontmatter is the ordinary case rather than a broken one.
  it('accepts a command that declares nothing', async () => {
    await given(commands, 'check.md', 'Run the gate.')

    const [entry] = await readLibraryIn(commands, 'command')

    expect(entry?.description).toBe('')
  })

  it('ignores anything that is not a markdown file', async () => {
    await given(commands, 'notes.txt', 'not one')
    await mkdir(join(commands, 'folder.md'), { recursive: true })

    await expect(readLibraryIn(commands, 'command')).resolves.toEqual([])
  })

  /*
   * A file that cannot be read is still on the list, with nothing said about it.
   * It is there, and the session will find it or fail to exactly as we did —
   * leaving it out would make this pane disagree with what the agent has.
   */
  it('lists a file it could not read, saying nothing about it', async () => {
    await given(commands, 'locked.md', '---\ndescription: Hidden.\n---\n\nx')
    await chmod(join(commands, 'locked.md'), 0o000)

    await expect(readLibraryIn(commands, 'command')).resolves.toEqual([
      {
        kind: 'command',
        name: 'locked',
        description: '',
        path: join(commands, 'locked.md')
      }
    ])

    // Readable again, or the directory cannot be removed on some systems.
    await chmod(join(commands, 'locked.md'), 0o644)
  })

  it('answers with nothing for a directory that is not there', async () => {
    await expect(readLibraryIn(join(root, 'nowhere'), 'subagent')).resolves.toEqual([])
  })

  /*
   * The same decision `frontmatter.ts` records: frontmatter the parser refuses
   * is read line by line, because the agent reads the file either way and a
   * list that dropped it would describe a different set than the one in use.
   */
  it('reads a description out of frontmatter no parser will take', async () => {
    await given(
      agents,
      'odd.md',
      '---\nname: odd\ndescription: Triggers on: access_denied\n---\n\nx'
    )

    const [entry] = await readLibraryIn(agents, 'subagent')

    expect(entry?.description).toBe('Triggers on: access_denied')
  })
})

describe('opening one', () => {
  it('gives the body without its frontmatter, and the document whole', async () => {
    await given(agents, 'reviewer.md', subagent('reviewer'))

    const opened = await readLibraryItem(agents, 'subagent', 'reviewer')

    expect(opened).toMatchObject({
      kind: 'subagent',
      name: 'reviewer',
      description: 'When reviewing.',
      body: 'You review code.'
    })
    expect(opened.raw).toBe(subagent('reviewer'))
  })

  // Nothing above the prompt to strip, so the whole file is the body.
  it('gives the whole file as the body where there is no frontmatter', async () => {
    await given(commands, 'check.md', 'Run the gate.')

    await expect(readLibraryItem(commands, 'command', 'check')).resolves.toMatchObject({
      body: 'Run the gate.',
      description: ''
    })
  })

  it('says so when there is nothing under that name', async () => {
    await expect(readLibraryItem(commands, 'command', 'gone')).rejects.toMatchObject({
      name: 'LibraryError',
      code: 'libraryMissing'
    })
  })
})

describe('writing one', () => {
  it('writes a command exactly as it was given', async () => {
    const entry = await writeLibraryItem(commands, 'command', 'check', 'Run the gate.')

    expect(entry).toEqual({
      kind: 'command',
      name: 'check',
      description: '',
      path: join(commands, 'check.md')
    })
    await expect(readFile(join(commands, 'check.md'), 'utf8')).resolves.toBe('Run the gate.')
  })

  /*
   * The name the agent knows a subagent by is the one in its frontmatter, and
   * the name this module addresses it by is the file. A document naming
   * something else is corrected rather than filed under two names.
   */
  it('puts a subagent name in step with its file', async () => {
    await writeLibraryItem(agents, 'subagent', 'reviewer', subagent('something-else'))

    const written = await readFile(join(agents, 'reviewer.md'), 'utf8')
    expect(written).toContain('name: reviewer')
    expect(written).not.toContain('something-else')
  })

  // Claude Code will not offer a subagent it cannot describe, so one arriving
  // without a description is refused rather than written where nothing sees it.
  it('refuses a subagent that says nothing about when to use it', async () => {
    await expect(
      writeLibraryItem(agents, 'subagent', 'reviewer', 'You review code.')
    ).rejects.toMatchObject({ code: 'librarySubagentNeedsDescription' })
  })

  // The other half of the same refusal: frontmatter that says nothing.
  it('refuses a subagent whose frontmatter describes it as nothing', async () => {
    await expect(
      writeLibraryItem(agents, 'subagent', 'reviewer', '---\nname: reviewer\n---\n\nx')
    ).rejects.toMatchObject({ code: 'librarySubagentNeedsDescription' })
  })

  it('keeps the other fields a subagent carries', async () => {
    const source = `---\nname: reviewer\ndescription: When reviewing.\ntools: Read, Grep\nmodel: inherit\n---\n\nYou review code.`

    await writeLibraryItem(agents, 'subagent', 'reviewer', source)

    const written = await readFile(join(agents, 'reviewer.md'), 'utf8')
    expect(written).toContain('tools: Read, Grep')
    expect(written).toContain('model: inherit')
  })

  it('refuses a name that cannot be a file', async () => {
    for (const name of ['../escape', 'Upper', '-leading', 'has space', '']) {
      await expect(writeLibraryItem(commands, 'command', name, 'x')).rejects.toMatchObject({
        code: 'libraryNameInvalid'
      })
    }
  })

  // Typed by the user, so `/run_checks` is a name people write.
  it('accepts an underscore, which a skill name refuses', async () => {
    await expect(writeLibraryItem(commands, 'command', 'run_checks', 'x')).resolves.toMatchObject({
      name: 'run_checks'
    })
  })

  // Saving an edit must not be refused by the name it already has.
  it('lets an existing one be saved over', async () => {
    await writeLibraryItem(commands, 'command', 'check', 'first')

    await expect(writeLibraryItem(commands, 'command', 'check', 'second')).resolves.toMatchObject({
      name: 'check'
    })
    await expect(readFile(join(commands, 'check.md'), 'utf8')).resolves.toBe('second')
  })

  it('refuses a document past the cap', async () => {
    await expect(
      writeLibraryItem(commands, 'command', 'long', 'x'.repeat(64_001))
    ).rejects.toMatchObject({ code: 'libraryTooLarge' })
  })
})

describe('creating one', () => {
  it('writes it', async () => {
    await expect(
      importLibraryItem(commands, 'command', 'check', 'Run the gate.')
    ).resolves.toMatchObject({ name: 'check' })
  })

  // The whole difference from a save: this one must not land on anything.
  it('refuses a name already taken here', async () => {
    await writeLibraryItem(commands, 'command', 'check', 'x')

    await expect(importLibraryItem(commands, 'command', 'check', 'y')).rejects.toMatchObject({
      code: 'libraryExists'
    })
    await expect(readFile(join(commands, 'check.md'), 'utf8')).resolves.toBe('x')
  })

  /*
   * The wider half. A session is handed both stores at once, so a `check` in
   * the global one and a `check` in a project's are one command as far as the
   * agent is concerned — and which of the two answers is not ours to say.
   */
  it('refuses a name taken in the store beside this one', async () => {
    await expect(
      importLibraryItem(commands, 'command', 'check', 'x', ['check'])
    ).rejects.toMatchObject({ code: 'libraryExists' })
  })

  it('refuses a name that cannot be a file before it looks at anything', async () => {
    await expect(importLibraryItem(commands, 'command', '../out', 'x')).rejects.toMatchObject({
      code: 'libraryNameInvalid'
    })
  })
})

describe('removing one', () => {
  it('takes the file away', async () => {
    await writeLibraryItem(commands, 'command', 'check', 'x')

    await removeLibraryItem(commands, 'check')

    await expect(readLibraryIn(commands, 'command')).resolves.toEqual([])
  })

  it('is untroubled by one that is already gone', async () => {
    await expect(removeLibraryItem(commands, 'never')).resolves.toBeUndefined()
  })
})

describe('renaming one', () => {
  /*
   * An ordinary rename, where a skill's is a migration: nothing is keyed on a
   * command or a subagent, because the SDK offers no per-conversation switch
   * for either.
   */
  it('moves the file', async () => {
    await writeLibraryItem(commands, 'command', 'check', 'Run the gate.')

    const entry = await renameLibraryItem(commands, 'command', 'check', 'gate')

    expect(entry.name).toBe('gate')
    await expect(readFile(join(commands, 'gate.md'), 'utf8')).resolves.toBe('Run the gate.')
    await expect(readLibraryIn(commands, 'command')).resolves.toHaveLength(1)
  })

  it('takes a subagent frontmatter with it', async () => {
    await writeLibraryItem(agents, 'subagent', 'reviewer', subagent('reviewer'))

    await renameLibraryItem(agents, 'subagent', 'reviewer', 'critic')

    await expect(readFile(join(agents, 'critic.md'), 'utf8')).resolves.toContain('name: critic')
  })

  it('refuses a name already in use', async () => {
    await writeLibraryItem(commands, 'command', 'check', 'x')
    await writeLibraryItem(commands, 'command', 'ship', 'y')

    await expect(renameLibraryItem(commands, 'command', 'check', 'ship')).rejects.toMatchObject({
      code: 'libraryExists'
    })
    await expect(readFile(join(commands, 'check.md'), 'utf8')).resolves.toBe('x')
  })

  it('refuses a name that cannot be a file', async () => {
    await writeLibraryItem(commands, 'command', 'check', 'x')

    await expect(renameLibraryItem(commands, 'command', 'check', '../out')).rejects.toMatchObject({
      code: 'libraryNameInvalid'
    })
  })

  it('says so when there is nothing to rename', async () => {
    await expect(renameLibraryItem(commands, 'command', 'gone', 'here')).rejects.toMatchObject({
      code: 'libraryMissing'
    })
  })

  // The same name is not a collision with itself, which is what saving a
  // document from the editor under its own name amounts to.
  it('accepts the name it already has', async () => {
    await writeLibraryItem(commands, 'command', 'check', 'x')

    await expect(renameLibraryItem(commands, 'command', 'check', 'check')).resolves.toMatchObject({
      name: 'check'
    })
  })
})

describe('the name an import suggests', () => {
  /*
   * The reason the import has a preview step at all. A skill's document names
   * itself, so its import needs no answer from anybody; a command names itself
   * nowhere, and somebody has to choose.
   */
  it('is what a subagent calls itself', () => {
    expect(
      suggestName('subagent', { kind: 'text', text: subagent('reviewer') }, subagent('reviewer'))
    ).toBe('reviewer')
  })

  it('is nothing for a subagent that has no frontmatter to name it', () => {
    expect(suggestName('subagent', { kind: 'text', text: 'x' }, 'x')).toBe('')
  })

  it('is nothing for a command pasted as text', () => {
    expect(suggestName('command', { kind: 'text', text: 'Run the gate.' }, 'Run the gate.')).toBe(
      ''
    )
  })

  it('is the file a command came from', () => {
    expect(suggestName('command', { kind: 'path', path: '/x/y/ship.md' }, 'x')).toBe('ship')
  })

  it('is the last part of the address a command was fetched from', () => {
    expect(suggestName('command', { kind: 'url', url: 'https://e.test/a/ship.md' }, 'x')).toBe(
      'ship'
    )
  })

  // Tidied rather than refused: a name the user has to retype for a reason the
  // app could have handled is the worse answer.
  it('tidies a file name that could not be one as it stands', () => {
    expect(suggestName('command', { kind: 'path', path: '/x/Run Checks.md' }, 'x')).toBe(
      'run-checks'
    )
    expect(suggestName('command', { kind: 'path', path: '/x/--Ship!!.md' }, 'x')).toBe('ship')
  })

  it('is nothing where there is nothing left to suggest', () => {
    expect(suggestName('command', { kind: 'path', path: '/x/!!.md' }, 'x')).toBe('')
    expect(suggestName('command', { kind: 'url', url: 'not-a-url' }, 'x')).toBe('')
  })

  // A subagent's own field wins over the file it happened to arrive in.
  it('prefers what a subagent calls itself to the file it came in', () => {
    expect(
      suggestName('subagent', { kind: 'path', path: '/x/downloaded.md' }, subagent('critic'))
    ).toBe('critic')
  })
})

/** A fetch that answers with one document. */
function answering(body: string | null, init: ResponseInit = {}): typeof fetch {
  return () =>
    Promise.resolve(
      body === null ? new Response(null, init) : new Response(body, { status: 200, ...init })
    )
}

function transport(fetcher: typeof fetch, timeoutMs = 1_000): Download {
  return { fetch: fetcher, timeoutMs }
}

describe('inspecting an import', () => {
  it('reads a document out of a file', async () => {
    const source = join(root, 'ship.md')
    await writeFile(source, 'Commit and push.', 'utf8')

    await expect(
      inspectLibraryImport('command', { kind: 'path', path: source }, transport(answering('')))
    ).resolves.toEqual({ name: 'ship', description: '', text: 'Commit and push.' })
  })

  it('hands back the text so the import need not read the source twice', async () => {
    const preview = await inspectLibraryImport(
      'subagent',
      { kind: 'url', url: 'https://e.test/reviewer.md' },
      transport(answering(subagent('reviewer')))
    )

    expect(preview).toEqual({
      name: 'reviewer',
      description: 'When reviewing.',
      text: subagent('reviewer')
    })
  })

  it('refuses an address that is not https', async () => {
    await expect(
      inspectLibraryImport(
        'command',
        { kind: 'url', url: 'http://e.test/x.md' },
        transport(answering('x'))
      )
    ).rejects.toMatchObject({ name: 'LibraryError', code: 'libraryUrlRefused' })
  })

  it('refuses an answer that is not one', async () => {
    await expect(
      inspectLibraryImport(
        'command',
        { kind: 'url', url: 'https://e.test/x.md' },
        transport(answering('nope', { status: 404 }))
      )
    ).rejects.toMatchObject({ code: 'libraryUrlRefused' })
  })

  it('refuses a download past its cap', async () => {
    await expect(
      inspectLibraryImport(
        'command',
        { kind: 'url', url: 'https://e.test/x.md' },
        transport(answering('x'.repeat(300_000)))
      )
    ).rejects.toMatchObject({ code: 'libraryTooLarge' })
  })

  it('refuses a document past the cap however it arrived', async () => {
    await expect(
      inspectLibraryImport(
        'command',
        { kind: 'text', text: 'x'.repeat(64_001) },
        transport(answering(''))
      )
    ).rejects.toMatchObject({ code: 'libraryTooLarge' })
  })

  it('reports a file it cannot open in the words the filesystem used', async () => {
    await expect(
      inspectLibraryImport(
        'command',
        { kind: 'path', path: join(root, 'nowhere.md') },
        transport(answering(''))
      )
    ).rejects.not.toBeInstanceOf(LibraryError)
  })
})
