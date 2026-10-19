import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CarriedFile } from './carry.js'
import { narrowCarried } from './carriedTrust.js'
import { GitError, type GitExec, gitIn, type GitOptions } from './git.js'
import { capabilityFiles, type CapabilityFile, trustDigest } from './repoTrust.js'

const run = promisify(execFile)

/** Whether this disk folds case, as macOS's does by default and CI's does. */
async function foldsCase(): Promise<boolean> {
  const probe = await mkdtemp(join(tmpdir(), 'octopus-case-'))
  try {
    await writeFile(join(probe, 'A'), '', 'utf8')
    return await access(join(probe, 'a')).then(
      () => true,
      () => false
    )
  } finally {
    await rm(probe, { recursive: true, force: true })
  }
}

const caseFolding = await foldsCase()

let root: string
let checkout: string
let worktree: string

async function git(cwd: string, ...args: string[]): Promise<void> {
  await run('git', args, { cwd })
}

async function write(base: string, path: string, contents = '{}'): Promise<void> {
  await mkdir(dirname(join(base, path)), { recursive: true })
  await writeFile(join(base, path), contents, 'utf8')
}

const LOCAL = '.claude/settings.local.json'

/** The worktree's capability files once the carried local settings are narrowed. */
async function narrowed(carried: CarriedFile[], execIn = gitIn): Promise<CapabilityFile[]> {
  const files = await capabilityFiles(worktree)
  return narrowCarried(files, { cwd: worktree, repoPath: checkout, carried, execIn })
}

/** The paths still counted, for the tests where only that is the question. */
async function left(carried: CarriedFile[], execIn = gitIn): Promise<string[]> {
  return (await narrowed(carried, execIn)).map(({ path }) => path)
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'octopus-carried-trust-')))
  checkout = join(root, 'checkout')
  worktree = join(root, 'worktree')

  await mkdir(checkout)
  await git(checkout, 'init', '-q', '-b', 'main')
  await git(checkout, 'config', 'user.email', 'test@example.com')
  await git(checkout, 'config', 'user.name', 'Test')
  await write(checkout, 'README.md', 'x')
  await git(checkout, 'add', '.')
  await git(checkout, 'commit', '-q', '-m', 'init')
  await git(checkout, 'worktree', 'add', '-q', '-b', 'work', worktree)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('withoutCarried', () => {
  it("leaves out the local settings the user's carry list put in the worktree", async () => {
    await write(checkout, LOCAL)
    await write(worktree, LOCAL, '{"permissions":{"allow":["Bash(ls)"]}}')

    await expect(left([{ path: LOCAL, from: null }])).resolves.toEqual([])
  })

  it('keeps a file no carry line names', async () => {
    await write(worktree, LOCAL)

    await expect(left([{ path: '.env', from: null }])).resolves.toEqual([LOCAL])
  })

  // The case the lower-casing exists for: on macOS the line names the
  // repository's committed settings, and those are what the gate is for.
  // A branch that commits the file: the repository's, whatever the line says.
  it('keeps a file git tracks in the worktree, however the line spells it', async () => {
    // Untracked in the checkout, so only the worktree's own answer can keep it.
    await write(checkout, '.CLAUDE/settings.local.json')
    await write(worktree, LOCAL)
    await git(worktree, 'add', '-f', '.')
    await git(worktree, 'commit', '-q', '-m', 'settings')

    await expect(left([{ path: '.CLAUDE/settings.local.json', from: null }])).resolves.toEqual([
      LOCAL
    ])
  })

  // The CLI rewrites only the permissions; anything else in there is what a
  // hook written by an agent would look like, and is asked about.
  it('keeps what is not permissions, and shows only that', async () => {
    await write(checkout, LOCAL)
    await write(
      worktree,
      LOCAL,
      '{"permissions":{"allow":["Bash(ls)"]},"hooks":{"Stop":[]},"env":{"A":"1"}}'
    )

    await expect(narrowed([{ path: LOCAL, from: null }])).resolves.toEqual([
      {
        path: LOCAL,
        contents: '{\n  "hooks": {\n    "Stop": []\n  },\n  "env": {\n    "A": "1"\n  }\n}'
      }
    ])
  })

  // "always allow" writes `allow` and nothing else; a mode or a directory the
  // file gains is still a change somebody should see.
  it.each([
    [
      'the rest of the permissions',
      '{"permissions":{"allow":["Bash"],"defaultMode":"bypassPermissions"}}',
      '{\n  "permissions": {\n    "defaultMode": "bypassPermissions"\n  }\n}'
    ],
    ['permissions that are not an object', '{"permissions":"all"}', '{\n  "permissions": "all"\n}']
  ])('keeps %s', async (_, written, shown) => {
    await write(checkout, LOCAL)
    await write(worktree, LOCAL, written)

    await expect(narrowed([{ path: LOCAL, from: null }])).resolves.toEqual([
      { path: LOCAL, contents: shown }
    ])
  })

  it('digests the same whatever the allow rules say', async () => {
    await write(checkout, LOCAL)
    const carried = [{ path: LOCAL, from: null }]
    await write(worktree, LOCAL, '{"permissions":{"allow":["Bash(ls)"]},"hooks":{}}')
    const before = trustDigest(await narrowed(carried))

    await write(worktree, LOCAL, '{"permissions":{"allow":["Bash(ls)","Read"]},"hooks":{}}')
    expect(trustDigest(await narrowed(carried))).toBe(before)

    await write(worktree, LOCAL, '{"permissions":{},"hooks":{"Stop":[]}}')
    expect(trustDigest(await narrowed(carried))).not.toBe(before)
  })

  it.each([
    ['not JSON', '{"permissions":'],
    ['an array', '[{"permissions":{}}]'],
    ['a string', '"permissions"']
  ])('keeps whole a file that is %s', async (_, contents) => {
    await write(checkout, LOCAL)
    await write(worktree, LOCAL, contents)

    await expect(narrowed([{ path: LOCAL, from: null }])).resolves.toEqual([
      { path: LOCAL, contents }
    ])
  })

  // Only the file the CLI rewrites: a carried `.mcp.json` starts servers, and
  // nothing rewrites it behind the user's back.
  it('counts any other carried capability file whole', async () => {
    await write(checkout, '.mcp.json')
    await write(worktree, '.mcp.json', '{"permissions":{}}')

    await expect(narrowed([{ path: '.mcp.json', from: null }])).resolves.toEqual([
      { path: '.mcp.json', contents: '{"permissions":{}}' }
    ])
  })

  it('matches a line written in another case to the file it names', async () => {
    await write(checkout, LOCAL)
    await write(worktree, LOCAL)

    await expect(left([{ path: '.claude/./Settings.Local.json', from: null }])).resolves.toEqual([])
  })

  it('keeps a link at the carried path', async () => {
    await write(checkout, LOCAL)
    await write(root, 'elsewhere.json')
    await mkdir(join(worktree, '.claude'))
    await symlink(join(root, 'elsewhere.json'), join(worktree, LOCAL))

    await expect(left([{ path: LOCAL, from: null }])).resolves.toEqual([LOCAL])
  })

  // A checkout on a branch that commits the file carries it in untracked: the
  // repository's settings, arriving as the user's.
  it('keeps a file the checkout it was carried from tracks', async () => {
    await write(checkout, LOCAL)
    await git(checkout, 'add', '-f', LOCAL)
    await git(checkout, 'commit', '-q', '-m', 'local settings')
    await write(worktree, LOCAL)

    await expect(left([{ path: LOCAL, from: null }])).resolves.toEqual([LOCAL])
  })

  it('never leaves out a hook script, carried or not', async () => {
    await write(checkout, '.claude/hooks/run.sh', 'echo')
    await write(worktree, '.claude/hooks/run.sh', 'echo')

    await expect(left([{ path: '.claude/hooks/run.sh', from: null }])).resolves.toEqual([
      '.claude/hooks/run.sh'
    ])
  })

  it('leaves out a file carried from a folder outside any repository', async () => {
    const source = join(root, 'loose', 'settings.local.json')
    await write(root, 'loose/settings.local.json')
    await write(worktree, LOCAL)

    await expect(left([{ path: LOCAL, from: source }])).resolves.toEqual([])
  })

  it('keeps a file carried from another repository that tracks it', async () => {
    const other = join(root, 'other')
    await mkdir(other)
    await git(other, 'init', '-q')
    await write(other, LOCAL)
    await git(other, 'add', '-f', LOCAL)
    await write(worktree, LOCAL)

    await expect(left([{ path: LOCAL, from: join(other, LOCAL) }])).resolves.toEqual([LOCAL])
  })

  // Without `--literal-pathspecs` the `*` matches the tracked `a.json` beside
  // it, and the file would be kept for a reason that is not true.
  it('reads a source name as a name, not a pattern', async () => {
    const other = join(root, 'other')
    await mkdir(other)
    await git(other, 'init', '-q')
    await write(other, 'a.json')
    await git(other, 'add', 'a.json')
    await write(other, '*.json')
    await write(worktree, LOCAL)

    await expect(left([{ path: LOCAL, from: join(other, '*.json') }])).resolves.toEqual([])
  })

  // git compares pathspecs by case even on a disk that does not, so without
  // `icase` the committed `.Claude/…` — the very file macOS reads — is
  // "untracked", and the repository's settings pass as the user's.
  it.runIf(caseFolding)('keeps a committed file whose name differs only in case', async () => {
    await write(checkout, LOCAL)
    await write(worktree, '.Claude/settings.local.json', '{"permissions":{"allow":["Bash"]}}')
    await git(worktree, 'add', '-f', '.')
    await git(worktree, 'commit', '-q', '-m', 'settings in another case')

    await expect(left([{ path: LOCAL, from: null }])).resolves.toEqual([LOCAL])
  })

  // The outer repository sees only the link to a submodule, never its files.
  it('keeps a file a submodule at .claude tracks', async () => {
    const sub = join(root, 'sub')
    await mkdir(sub)
    await git(sub, 'init', '-q', '-b', 'main')
    await git(sub, 'config', 'user.email', 'test@example.com')
    await git(sub, 'config', 'user.name', 'Test')
    await write(sub, 'settings.local.json', '{"permissions":{"allow":["Bash"]}}')
    await git(sub, 'add', '-f', '.')
    await git(sub, 'commit', '-q', '-m', 'settings')
    await write(checkout, LOCAL)
    await git(
      worktree,
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      '-q',
      sub,
      '.claude'
    )

    await expect(left([{ path: LOCAL, from: null }])).resolves.toEqual([LOCAL])
  })

  // git lists nothing beyond a committed link, so only the walk sees it.
  it('keeps a file reached through a committed link to a folder', async () => {
    await write(checkout, LOCAL)
    await write(worktree, 'vendor/c/settings.local.json', '{"permissions":{"allow":["Bash"]}}')
    await symlink(join('vendor', 'c'), join(worktree, '.claude'))
    await git(worktree, 'add', '-f', '.')
    await git(worktree, 'commit', '-q', '-m', 'linked settings')

    await expect(left([{ path: LOCAL, from: null }])).resolves.toEqual([LOCAL])
  })

  // The worktree and the checkout always are repositories; one that says it is
  // not — a pruned worktree — has gone wrong, and is not an answer.
  it.each([
    ['the worktree', (): string => join(worktree, '.claude')],
    ['the checkout', (): string => join(checkout, '.claude')]
  ])('keeps the file when %s says it is no repository', async (_, broken) => {
    await write(checkout, LOCAL)
    await write(worktree, LOCAL)
    const loose = (cwd: string, options?: GitOptions): GitExec =>
      cwd === broken()
        ? () => Promise.reject(new GitError(['ls-files'], 'fatal: not a git repository'))
        : gitIn(cwd, options)

    await expect(left([{ path: LOCAL, from: null }], loose)).resolves.toEqual([LOCAL])
  })

  // The refusal is matched as text, and git translates it under `LANG`.
  it('asks git in English', async () => {
    await write(checkout, LOCAL)
    await write(worktree, LOCAL)
    const asked: (GitOptions | undefined)[] = []
    const spy = (cwd: string, options?: GitOptions): GitExec => {
      asked.push(options)
      return gitIn(cwd, options)
    }

    await left([{ path: LOCAL, from: null }], spy)
    expect(asked).toEqual([{ env: { LC_ALL: 'C' } }, { env: { LC_ALL: 'C' } }])
  })

  it('keeps the file when git fails for any other reason', async () => {
    await write(checkout, LOCAL)
    await write(worktree, LOCAL)
    const broken = (): (() => Promise<string>) => () =>
      Promise.reject(new Error('spawn git EACCES'))

    await expect(left([{ path: LOCAL, from: null }], broken)).resolves.toEqual([LOCAL])
  })

  it('keeps the other capability files beside a carried one', async () => {
    await write(checkout, LOCAL)
    await write(worktree, LOCAL)
    await write(worktree, '.mcp.json')

    const files: CapabilityFile[] = await capabilityFiles(worktree)
    expect(files.map(({ path }) => path)).toEqual([LOCAL, '.mcp.json'])
    await expect(left([{ path: LOCAL, from: null }])).resolves.toEqual(['.mcp.json'])
  })
})
