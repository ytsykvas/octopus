import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  branchStatuses,
  buildTree,
  collectTreeEntries,
  compareNodes,
  folderStatuses,
  drawnOpen,
  foldersFromDisk,
  withFoldersOnDisk,
  nodeAt,
  listingNodes,
  listsFolder,
  MAX_TREE_ENTRIES,
  parseUntrackedFolders,
  parseIgnored,
  parseStaged,
  parseStatus,
  readFileTree,
  type TreeEntry,
  type TreeEntryKind
} from './fileTree.js'
import { gitIn } from './git.js'
import { parseNameStatus } from './nameStatus.js'

const run = promisify(execFile)

const file = (path: string, ignored = false): TreeEntry => ({ path, kind: 'file', ignored })
const files = (...paths: string[]): TreeEntry[] => paths.map((path) => file(path))

describe('parseStatus', () => {
  it('reads one state per path from the two-letter code', () => {
    const output = [
      ' M edited.ts',
      'M  staged.ts',
      'MM both.ts',
      'A  new.ts',
      'AM new-and-edited.ts',
      'D  removed.ts',
      ' D gone.ts',
      'AD added-then-gone.ts',
      ' T link.ts',
      'T  staged-link.ts',
      '?? fresh.ts',
      ''
    ].join('\0')

    expect(parseStatus(output).statuses).toEqual({
      'edited.ts': 'modified',
      'staged.ts': 'modified',
      'both.ts': 'modified',
      'new.ts': 'added',
      'new-and-edited.ts': 'added',
      'removed.ts': 'deleted',
      'gone.ts': 'deleted',
      'added-then-gone.ts': 'deleted',
      'link.ts': 'typeChanged',
      'staged-link.ts': 'typeChanged',
      'fresh.ts': 'untracked'
    })
  })

  // git names a repository nested in the worktree as `nested/`, and never
  // looks inside: the mark belongs on the folder's own row.
  it('marks a nested repository on its folder', () => {
    expect(parseStatus('?? nested/\0').statuses).toEqual({ nested: 'untracked' })
  })

  it('calls every unmerged code a conflict', () => {
    const codes = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']
    const output = codes.map((code) => `${code} ${code}.ts`).join('\0')

    expect(Object.values(parseStatus(output).statuses)).toEqual(codes.map(() => 'conflicted'))
  })

  // Under -z the new path comes first and the old one is its own record. Read
  // as an ordinary record, the old path would turn into a file called
  // `old.ts` with the status `d.`.
  it('marks the new side of a rename or copy and skips the old one', () => {
    const output = 'R  renamed.ts\0old.ts\0C  copy.ts\0source.ts\0 M after.ts\0'

    expect(parseStatus(output).statuses).toEqual({
      'renamed.ts': 'renamed',
      'copy.ts': 'copied',
      'after.ts': 'modified'
    })
  })

  // ` R` is a rename git found in the worktree column, after `git add -N`.
  // Read as ordinary records, its old path became a phantom file.
  it('skips the old side of a rename found in the worktree column', () => {
    expect(parseStatus(' R new.txt\0old.txt\0 C dup.txt\0src.txt\0').statuses).toEqual({
      'new.txt': 'renamed',
      'dup.txt': 'copied'
    })
  })

  it('names the old side of a rename as moved away, and not that of a copy', () => {
    expect(parseStatus('R  new.ts\0old.ts\0 C dup.ts\0src.ts\0').movedAway).toEqual(['old.ts'])
  })

  // Output cut off after a rename's first record: nothing to name.
  it('survives a rename with its second record missing', () => {
    expect(parseStatus('R  new.ts').movedAway).toEqual([])
  })

  it('keeps names git would otherwise quote, untouched', () => {
    const output = ' M with space.ts\0?? odd\nname.ts\0 M папка/файл.ts\0'

    expect(Object.keys(parseStatus(output).statuses)).toEqual([
      'with space.ts',
      'odd\nname.ts',
      'папка/файл.ts'
    ])
  })

  it('reads nothing from a clean tree', () => {
    expect(parseStatus('')).toEqual({ statuses: {}, movedAway: [], untracked: [] })
  })

  // What `ls-files --others --exclude-standard` listed, read from the status
  // instead: under `-uall` it names every untracked file, and a nested
  // repository as `nested/`, which is a folder read from disk like a submodule.
  it('lists the untracked files, and a nested repository as a folder', () => {
    const output = '?? new.ts\0?? deep/nested/\0 M edited.ts\0A  staged.ts\0'

    expect(parseStatus(output).untracked).toEqual([
      file('new.ts'),
      { path: 'deep/nested', kind: 'directory', ignored: false }
    ])
  })
})

describe('parseIgnored', () => {
  it('reads a trailing slash as a folder ignored whole', () => {
    expect(parseIgnored('node_modules/\0.env\0src/dist/\0')).toEqual([
      { path: 'node_modules', kind: 'directory', ignored: true },
      { path: '.env', kind: 'file', ignored: true },
      { path: 'src/dist', kind: 'directory', ignored: true }
    ])
  })
})

/*
 * A submodule is one entry in the index, a commit rather than a blob, and
 * `--cached` names it like any file — which drew it as a file the viewer then
 * found to be a folder, and its contents could not be opened at all.
 */
describe('parseStaged', () => {
  it('tells a submodule from a file by its mode', () => {
    expect(
      parseStaged(
        [
          '100644 a09ef9334a022405ac5f08b981bdaa1d5c194e8c 0\t.gitmodules',
          '160000 a16a57ce22daca2d5424b4ba00748ef1f06fb2fe 0\tlib/inner',
          '100755 975fbec8256d3e8a3797e7a3611380f27c49f4ac 0\tbin/run',
          ''
        ].join('\0')
      )
    ).toEqual([
      file('.gitmodules'),
      { path: 'lib/inner', kind: 'directory', ignored: false },
      file('bin/run')
    ])
  })

  // An unmerged path is in the index once per stage.
  it('lists a conflicted path once', () => {
    const staged = ['1', '2', '3']
      .map((stage) => `100644 a09ef9334a022405ac5f08b981bdaa1d5c194e8c ${stage}\tclash.ts`)
      .join('\0')

    expect(parseStaged(staged)).toEqual([file('clash.ts')])
  })

  it('keeps a tab inside a path', () => {
    expect(parseStaged('100644 a09ef9334a022405ac5f08b981bdaa1d5c194e8c 0\ta\tb.txt')).toEqual([
      file('a\tb.txt')
    ])
  })
})

describe('parseUntrackedFolders', () => {
  const untracked = parseStatus('?? u/f.ts\0?? nested/\0').untracked
  const ignored = parseIgnored(['logs/', 'logs/x.log', ''].join('\0'))

  // What `--directory` printed for a worktree holding all of these, measured.
  const listed = ['a/', 'e/', 'logs/', 'nested/', 'src/new/', 'u/', ''].join('\0')

  it('keeps as empty only the folders with no file in them', () => {
    expect(parseUntrackedFolders(listed, untracked, ignored).empty).toEqual([
      { path: 'a', kind: 'directory', ignored: false },
      { path: 'e', kind: 'directory', ignored: false },
      { path: 'src/new', kind: 'directory', ignored: false }
    ])
  })

  // `--directory` names a folder of untracked files `u/` too, and the files
  // are already rows of their own.
  it('leaves out of the empty a folder whose untracked files are listed', () => {
    expect(parseUntrackedFolders('u/\0', untracked, []).empty).toEqual([])
  })

  it('leaves out of the empty a nested repository and a folder git ignores', () => {
    expect(parseUntrackedFolders('nested/\0logs/\0', untracked, ignored).empty).toEqual([])
  })

  // The tree drops the hidden name, so the folder is all that is left to draw.
  it('keeps a folder holding only a hidden name', () => {
    expect(
      parseUntrackedFolders('ds/\0', parseStatus('?? ds/.DS_Store\0').untracked, []).empty
    ).toEqual([{ path: 'ds', kind: 'directory', ignored: false }])
  })

  // `u2` only shares a prefix with `u`, which holds a file.
  it('compares whole folder names, not prefixes', () => {
    expect(parseUntrackedFolders('u2/\0', untracked, []).empty).toEqual([
      { path: 'u2', kind: 'directory', ignored: false }
    ])
  })

  /*
   * git names only the topmost untracked folder, so an empty folder beside a
   * written one inside it is never printed. These are the folders it could be
   * in, kept for the disk to complete.
   */
  it('names the untracked folders that hold something', () => {
    expect(parseUntrackedFolders(listed, untracked, ignored).holding).toEqual(['u'])
  })

  // Each is a folder entry of its own, read from disk whole.
  it('leaves a nested repository and an ignored folder out of those', () => {
    expect(parseUntrackedFolders('nested/\0logs/\0', untracked, ignored).holding).toEqual([])
  })
})

describe('collectTreeEntries', () => {
  // A submodule git reports as changed is in the status too, which on its own
  // would add it back as a file.
  it('keeps a listed folder a folder when the status names it too', () => {
    const inner: TreeEntry = { path: 'lib/inner', kind: 'directory', ignored: false }

    const { entries } = collectTreeEntries([inner, file('a.ts')], [], { 'lib/inner': 'modified' })

    expect(entries).toEqual([inner, file('a.ts')])
  })

  it('leaves out a path renamed away though the index still lists it', () => {
    const { entries } = collectTreeEntries(files('old.ts', 'new.ts'), [], { 'new.ts': 'renamed' }, [
      'old.ts'
    ])

    expect(entries.map((entry) => entry.path)).toEqual(['new.ts'])
  })

  it('adds a deletion that only the status knows about', () => {
    const { entries } = collectTreeEntries(files('kept.ts'), [], { 'removed.ts': 'deleted' })

    expect(entries.map((entry) => entry.path)).toEqual(['kept.ts', 'removed.ts'])
  })

  it('lists a path once however many listings name it', () => {
    const { entries } = collectTreeEntries(files('a.ts', 'a.ts'), [file('a.ts', true)], {
      'a.ts': 'modified'
    })

    expect(entries).toEqual([file('a.ts')])
  })

  it('hides .git, .DS_Store and Thumbs.db at any depth', () => {
    const { entries } = collectTreeEntries(
      files('.git', 'src/.DS_Store', 'deep/er/Thumbs.db', 'kept.ts', 'a.git'),
      [{ path: 'nested/.git', kind: 'directory', ignored: true }],
      {}
    )

    expect(entries.map((entry) => entry.path)).toEqual(['kept.ts', 'a.git'])
  })

  it('stops at the cap and says so', () => {
    const many = Array.from({ length: MAX_TREE_ENTRIES + 1 }, (_, index) =>
      file(`f${String(index)}`)
    )

    const result = collectTreeEntries(many, [], {})

    expect(result.entries).toHaveLength(MAX_TREE_ENTRIES)
    expect(result.truncated).toBe(true)
  })

  it('says nothing was cut when nothing was', () => {
    expect(collectTreeEntries(files('a'), [], {}).truncated).toBe(false)
  })
})

describe('compareNodes', () => {
  const node = (
    name: string,
    kind: TreeEntryKind = 'file'
  ): { name: string; kind: TreeEntryKind } => ({ name, kind })

  it('puts folders first, then names as a person reads them', () => {
    const sorted = [
      node('file10'),
      node('b'),
      node('file2'),
      node('B-folder', 'directory'),
      node('a-folder', 'directory'),
      node('A')
    ].sort(compareNodes)

    expect(sorted.map((entry) => entry.name)).toEqual([
      'a-folder',
      'B-folder',
      'A',
      'b',
      'file2',
      'file10'
    ])
  })

  // `a` and `A` collate equal; the order must still not depend on arrival.
  it('breaks a tie the collation calls equal the same way every time', () => {
    expect([node('a'), node('A')].sort(compareNodes)).toEqual([node('A'), node('a')])
    expect([node('A'), node('a')].sort(compareNodes)).toEqual([node('A'), node('a')])
    expect(compareNodes(node('a'), node('a'))).toBe(0)
  })
})

describe('buildTree', () => {
  it('creates the folders a path implies and sorts every level', () => {
    const tree = buildTree([file('src/z.ts'), file('README.md'), file('src/core/a.ts')])

    expect(tree.get('')).toEqual([
      { name: 'src', path: 'src', kind: 'directory', ignored: false, childrenFromDisk: false },
      {
        name: 'README.md',
        path: 'README.md',
        kind: 'file',
        ignored: false,
        childrenFromDisk: false
      }
    ])
    expect(tree.get('src')?.map((node) => node.name)).toEqual(['core', 'z.ts'])
    expect(tree.get('src/core')?.map((node) => node.path)).toEqual(['src/core/a.ts'])
  })

  it('keeps a folder git ignored whole greyed, with nothing under it yet', () => {
    const tree = buildTree([{ path: 'node_modules', kind: 'directory', ignored: true }])

    expect(tree.get('')).toEqual([
      {
        name: 'node_modules',
        path: 'node_modules',
        kind: 'directory',
        ignored: true,
        childrenFromDisk: true
      }
    ])
    expect(tree.has('node_modules')).toBe(false)
  })

  // Not greyed: its files are the submodule's own, not ones git leaves out.
  it('reads a submodule from disk without greying it', () => {
    const tree = buildTree([{ path: 'lib/inner', kind: 'directory', ignored: false }])

    expect(tree.get('lib')).toEqual([
      {
        name: 'inner',
        path: 'lib/inner',
        kind: 'directory',
        ignored: false,
        childrenFromDisk: true
      }
    ])
  })

  // A folder holding tracked files is not ignored, whichever listing named it
  // first.
  it('does not grey a folder that also holds tracked files', () => {
    const ignoredFirst = buildTree([
      { path: 'build', kind: 'directory', ignored: true },
      file('build/kept.ts')
    ])
    const trackedFirst = buildTree([
      file('build/kept.ts'),
      { path: 'build', kind: 'directory', ignored: true }
    ])

    expect(ignoredFirst.get('')?.[0]).toMatchObject({ ignored: false, childrenFromDisk: false })
    expect(trackedFirst.get('')?.[0]).toMatchObject({ ignored: false, childrenFromDisk: false })
  })

  it('answers an empty root for an empty tree', () => {
    expect(buildTree([]).get('')).toEqual([])
  })
})

describe('foldersFromDisk', () => {
  const entries: TreeEntry[] = [
    file('src/a.ts'),
    { path: 'node_modules', kind: 'directory', ignored: true },
    { path: 'vendor/lib', kind: 'directory', ignored: false }
  ]

  it('names a folder git lists whole, and every folder inside one', () => {
    expect(
      foldersFromDisk({ entries, untrackedFolders: [] }, [
        'node_modules',
        'node_modules/pkg/dist',
        'vendor/lib',
        'vendor/lib/src'
      ])
    ).toEqual(['node_modules', 'node_modules/pkg/dist', 'vendor/lib', 'vendor/lib/src'])
  })

  // `vendor` holds a submodule and is git's own; `node_modules2` only shares a
  // prefix with an ignored folder.
  it('leaves out a folder git lists the inside of', () => {
    expect(
      foldersFromDisk({ entries, untrackedFolders: [] }, ['src', 'vendor', 'node_modules2'])
    ).toEqual([])
  })

  // Completed from disk rather than read from it: an empty folder in there is
  // one git never prints.
  it('names an untracked folder that holds something, and every folder inside one', () => {
    expect(
      foldersFromDisk({ entries, untrackedFolders: ['feature'] }, [
        'feature',
        'feature/a',
        'features'
      ])
    ).toEqual(['feature', 'feature/a'])
  })
})

describe('drawnOpen', () => {
  it('keeps a folder whose every folder above is open', () => {
    expect(drawnOpen(new Set(['src', 'src/a', 'src/a/b', 'lib']))).toEqual(
      new Set(['src', 'src/a', 'src/a/b', 'lib'])
    )
  })

  // Left open inside a folder closed since: the panel remembers it, nothing draws it.
  it('leaves out one under a closed folder, at any depth', () => {
    expect(drawnOpen(new Set(['node_modules/pkg', 'src', 'src/a/b']))).toEqual(new Set(['src']))
    // Its own parent open, the one above that closed.
    expect(drawnOpen(new Set(['node_modules/pkg', 'node_modules/pkg/lib']))).toEqual(new Set())
  })
})

describe('nodeAt', () => {
  const index = buildTree([file('src/core/a.ts'), file('README.md')])

  it('finds a row at any depth, and at the top', () => {
    expect(nodeAt(index, 'src/core/a.ts')?.kind).toBe('file')
    expect(nodeAt(index, 'README.md')?.name).toBe('README.md')
  })

  it('finds nothing where its folder does not name it, or is not in the index', () => {
    expect(nodeAt(index, 'src/b.ts')).toBeUndefined()
    expect(nodeAt(index, 'lib/c.ts')).toBeUndefined()
  })
})

describe('listingNodes', () => {
  const listing = {
    entries: [
      { name: 'z.js', kind: 'file' },
      { name: 'pkg', kind: 'directory' }
    ],
    truncated: false
  } as const

  it('turns an ignored folder read from disk into ignored rows under it, sorted', () => {
    expect(listingNodes({ path: 'node_modules', ignored: true }, listing)).toEqual([
      {
        name: 'pkg',
        path: 'node_modules/pkg',
        kind: 'directory',
        ignored: true,
        childrenFromDisk: true
      },
      {
        name: 'z.js',
        path: 'node_modules/z.js',
        kind: 'file',
        ignored: true,
        childrenFromDisk: false
      }
    ])
  })

  // What is inside a submodule is its own files, and a folder in there is read
  // from disk in turn: git has nothing to say about the inside of one.
  it('keeps the rows of a submodule ungreyed, its folders read from disk', () => {
    expect(listingNodes({ path: 'lib/inner', ignored: false }, listing)).toEqual([
      {
        name: 'pkg',
        path: 'lib/inner/pkg',
        kind: 'directory',
        ignored: false,
        childrenFromDisk: true
      },
      {
        name: 'z.js',
        path: 'lib/inner/z.js',
        kind: 'file',
        ignored: false,
        childrenFromDisk: false
      }
    ])
  })
})

describe('listsFolder', () => {
  const listing = {
    entries: [
      { name: 'cafe\u0301', kind: 'directory' },
      { name: 'pkg.js', kind: 'file' }
    ],
    truncated: false
  } as const

  it('names a folder however its name is composed, and not a file', () => {
    expect(listsFolder(listing, 'caf\u00e9')).toBe(true)
    expect(listsFolder(listing, 'pkg.js')).toBe(false)
    expect(listsFolder(listing, 'cafe')).toBe(false)
  })
})

describe('withFoldersOnDisk', () => {
  const index = buildTree([
    { path: 'feature/a/x.ts', kind: 'file', ignored: false },
    { path: 'feature/z.ts', kind: 'file', ignored: false }
  ])

  it('adds the folders on disk git does not name, sorted, each read from disk', () => {
    expect(
      withFoldersOnDisk(
        index,
        { path: 'feature', ignored: false },
        {
          entries: [
            { name: 'a', kind: 'directory' },
            { name: 'b', kind: 'directory' },
            { name: 'z.ts', kind: 'file' },
            { name: 'new.ts', kind: 'file' }
          ],
          truncated: false
        }
      ).map(({ path, childrenFromDisk }) => [path, childrenFromDisk])
    ).toEqual([
      ['feature/a', false],
      ['feature/b', true],
      ['feature/z.ts', false]
    ])
  })

  /*
   * git prints a name composed on macOS (`core.precomposeunicode`), while the
   * disk gives it back as Finder stored it, often decomposed: compared as
   * they come, `café` was drawn twice.
   */
  it('takes a name stored decomposed for the one git prints composed', () => {
    const composed = buildTree([{ path: 'feature/caf\u00e9/x.ts', kind: 'file', ignored: false }])

    expect(
      withFoldersOnDisk(
        composed,
        { path: 'feature', ignored: false },
        { entries: [{ name: 'cafe\u0301', kind: 'directory' }], truncated: false }
      ).map(({ name }) => name)
    ).toEqual(['caf\u00e9'])
  })

  it('answers with the folders on disk alone for a folder the index holds nothing of', () => {
    expect(
      withFoldersOnDisk(
        index,
        { path: 'other', ignored: false },
        { entries: [{ name: 'b', kind: 'directory' }], truncated: false }
      ).map(({ path }) => path)
    ).toEqual(['other/b'])
  })
})

describe('folderStatuses', () => {
  it('gives every ancestor the strongest status below it', () => {
    expect(
      folderStatuses({
        'src/a/new.ts': 'untracked',
        'src/a/gone.ts': 'deleted',
        'src/b/edit.ts': 'modified',
        'src/b/clash.ts': 'conflicted',
        'docs/new.md': 'added',
        'top.ts': 'modified'
      })
    ).toEqual({
      src: 'conflicted',
      'src/a': 'deleted',
      'src/b': 'conflicted',
      docs: 'added'
    })
  })

  it('does not let a weaker status replace a stronger one', () => {
    expect(folderStatuses({ 'x/edit.ts': 'modified', 'x/new.ts': 'untracked' })).toEqual({
      x: 'modified'
    })
  })
})

describe('branchStatuses', () => {
  const none = { statuses: {}, movedAway: [] }

  it('marks what the diff against the base names', () => {
    expect(branchStatuses(parseNameStatus('A\0new.ts\0M\0edited.ts\0D\0gone.ts\0'), none)).toEqual({
      statuses: { 'new.ts': 'added', 'edited.ts': 'modified', 'gone.ts': 'deleted' },
      movedAway: []
    })
  })

  it('names the old side of a rename as moved away', () => {
    expect(branchStatuses(parseNameStatus('R100\0old.ts\0new.ts\0'), none)).toEqual({
      statuses: { 'new.ts': 'renamed' },
      movedAway: ['old.ts']
    })
  })

  it('lets the status say untracked and conflicted, which the diff never sees', () => {
    const worktree = {
      statuses: {
        'both.ts': 'conflicted',
        'fresh.ts': 'untracked',
        'edited.ts': 'added'
      } as const,
      movedAway: []
    }

    expect(
      branchStatuses(parseNameStatus('U\0both.ts\0M\0edited.ts\0'), worktree).statuses
    ).toEqual({ 'both.ts': 'conflicted', 'edited.ts': 'modified', 'fresh.ts': 'untracked' })
  })

  it('leaves unmarked a file the status calls edited but the base already had', () => {
    const worktree = { statuses: { 'back.ts': 'modified' } as const, movedAway: [] }

    expect(branchStatuses([], worktree).statuses).toEqual({})
  })

  it('keeps the moved-away paths the status found', () => {
    expect(branchStatuses([], { statuses: {}, movedAway: ['a.txt'] }).movedAway).toEqual(['a.txt'])
  })
})

describe('readFileTree', () => {
  it('asks git for the status without its optional lock, and for three listings', async () => {
    const calls: string[][] = []

    await readFileTree((args) => {
      calls.push([...args])
      return Promise.resolve('')
    })

    expect(calls).toEqual([
      ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall'],
      ['ls-files', '-z', '--stage'],
      ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
      ['ls-files', '-z', '--others', '--exclude-standard', '--directory']
    ])
  })

  it('asks for the diff against the base when given one', async () => {
    const calls: string[][] = []

    await readFileTree((args) => {
      calls.push([...args])
      return Promise.resolve('')
    }, 'abc123')

    expect(calls).toEqual([
      ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '-uall'],
      ['ls-files', '-z', '--stage'],
      ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory'],
      ['ls-files', '-z', '--others', '--exclude-standard', '--directory'],
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '--name-status',
        '-z',
        '--no-ext-diff',
        '--no-textconv',
        '--no-color',
        '--find-renames',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        'abc123'
      ]
    ])
  })

  describe('against a real repository', () => {
    let dir: string

    const git = async (...args: string[]): Promise<void> => {
      await run('git', args, { cwd: dir })
    }

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'octopus-tree-'))
      await git('init', '-q', '--initial-branch=main')
      await git('config', 'user.email', 'test@example.com')
      await git('config', 'user.name', 'Test')
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.env\n', 'utf8')
      for (const name of ['a.txt', 'staged-gone.txt', 'disk-gone.txt', 'edited.txt']) {
        await writeFile(join(dir, name), `${name}\n`, 'utf8')
      }
      await git('add', '-A')
      await git('commit', '-q', '-m', 'first')
    })

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    const headOf = async (): Promise<string> =>
      (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()

    it('marks what the branch changed since its base, committed or not', async () => {
      const base = await headOf()
      await git('checkout', '-q', '-b', 'feature')
      await writeFile(join(dir, 'added.txt'), 'added\n', 'utf8')
      await writeFile(join(dir, 'edited.txt'), 'changed\n', 'utf8')
      await git('rm', '-q', 'staged-gone.txt')
      await git('mv', 'a.txt', 'renamed.txt')
      await git('add', '-A')
      await git('commit', '-q', '-m', 'branch')
      await writeFile(join(dir, 'disk-gone.txt'), 'changed\n', 'utf8')
      await writeFile(join(dir, 'fresh.ts'), 'new\n', 'utf8')

      const tree = await readFileTree(gitIn(dir), base)

      expect(tree.statuses).toEqual({
        'added.txt': 'added',
        'edited.txt': 'modified',
        'staged-gone.txt': 'deleted',
        'renamed.txt': 'renamed',
        'disk-gone.txt': 'modified',
        'fresh.ts': 'untracked'
      })
      // A deletion made in a commit is no longer in the index, and is kept.
      expect(tree.entries).toContainEqual(file('staged-gone.txt'))
      expect(tree.entries.map((entry) => entry.path)).not.toContain('a.txt')

      // Without a base it is HEAD that is measured against, as it was.
      expect((await readFileTree(gitIn(dir))).statuses).toEqual({
        'disk-gone.txt': 'modified',
        'fresh.ts': 'untracked'
      })
    })

    it('leaves no mark on an edit put back to what the base had', async () => {
      const base = await headOf()
      await git('checkout', '-q', '-b', 'feature')
      await writeFile(join(dir, 'edited.txt'), 'changed\n', 'utf8')
      await git('commit', '-q', '-am', 'edit')
      await writeFile(join(dir, 'edited.txt'), 'edited.txt\n', 'utf8')

      expect((await readFileTree(gitIn(dir), base)).statuses).toEqual({})
    })

    it('marks what has not been committed and keeps both kinds of deletion', async () => {
      await git('rm', '-q', 'staged-gone.txt')
      await unlink(join(dir, 'disk-gone.txt'))
      await git('mv', 'a.txt', 'renamed.txt')
      await writeFile(join(dir, 'edited.txt'), 'changed\n', 'utf8')
      await mkdir(join(dir, 'fresh', 'deep'), { recursive: true })
      await writeFile(join(dir, 'fresh', 'deep', 'new.ts'), 'new\n', 'utf8')
      await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
      await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), '', 'utf8')
      await writeFile(join(dir, '.env'), 'SECRET=1\n', 'utf8')

      const tree = await readFileTree(gitIn(dir))

      expect(tree.statuses).toEqual({
        'staged-gone.txt': 'deleted',
        'disk-gone.txt': 'deleted',
        'renamed.txt': 'renamed',
        'edited.txt': 'modified',
        'fresh/deep/new.ts': 'untracked'
      })
      expect(tree.entries).toEqual(
        expect.arrayContaining([
          file('staged-gone.txt'),
          file('disk-gone.txt'),
          file('renamed.txt'),
          file('fresh/deep/new.ts'),
          { path: 'node_modules', kind: 'directory', ignored: true },
          file('.env', true)
        ])
      )
      // The old side of the rename is not on disk and not in the tree.
      expect(tree.entries.map((entry) => entry.path)).not.toContain('a.txt')
      expect(tree.truncated).toBe(false)
    })

    it('reads a submodule as a folder, and an edit inside it as a change to it', async () => {
      const inner = await mkdtemp(join(tmpdir(), 'octopus-inner-'))
      try {
        await run('git', ['init', '-q', '--initial-branch=main'], { cwd: inner })
        await writeFile(join(inner, 'lib.ts'), 'lib\n', 'utf8')
        await run('git', ['add', '-A'], { cwd: inner })
        await run(
          'git',
          ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'lib'],
          { cwd: inner }
        )
        await git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'vendor/lib')
        await git('commit', '-q', '-m', 'submodule')
        await writeFile(join(dir, 'vendor', 'lib', 'lib.ts'), 'changed\n', 'utf8')

        const tree = await readFileTree(gitIn(dir))

        expect(tree.entries).toContainEqual({
          path: 'vendor/lib',
          kind: 'directory',
          ignored: false
        })
        expect(tree.entries.map((entry) => entry.path)).not.toContain('vendor/lib/lib.ts')
        expect(tree.statuses['vendor/lib']).toBe('modified')
      } finally {
        await rm(inner, { recursive: true, force: true })
      }
    })

    // Cloned or initialised inside the worktree, not added as a submodule: git
    // lists it as `nested/`, which drew a folder holding a file with no name.
    it('reads a repository nested in the worktree as a folder', async () => {
      await mkdir(join(dir, 'nested'))
      await run('git', ['init', '-q'], { cwd: join(dir, 'nested') })
      await writeFile(join(dir, 'nested', 'inside.ts'), 'inside\n', 'utf8')

      const tree = await readFileTree(gitIn(dir))

      expect(tree.entries).toContainEqual({ path: 'nested', kind: 'directory', ignored: false })
      expect(tree.entries.map((entry) => entry.path)).not.toContain('nested/')
      expect(tree.statuses).toEqual({ nested: 'untracked' })
    })

    // A folder the agent just made, before it writes into it, is what an editor
    // shows and git never names.
    it('reads an empty folder, at the top and inside a tracked one', async () => {
      await mkdir(join(dir, 'fresh'))
      await mkdir(join(dir, 'src', 'new'), { recursive: true })
      await writeFile(join(dir, 'src', 'kept.ts'), 'kept\n', 'utf8')
      await git('add', 'src/kept.ts')
      await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true })
      // `--directory` prints these two as well; neither is an empty folder.
      await mkdir(join(dir, 'logs'))
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.env\n*.log\n', 'utf8')
      await writeFile(join(dir, 'logs', 'x.log'), 'x\n', 'utf8')
      await mkdir(join(dir, 'drafts'))
      await writeFile(join(dir, 'drafts', 'note.md'), 'x\n', 'utf8')

      const tree = await readFileTree(gitIn(dir))

      expect(tree.entries).toContainEqual({ path: 'fresh', kind: 'directory', ignored: false })
      expect(tree.entries).toContainEqual({ path: 'src/new', kind: 'directory', ignored: false })
      expect(tree.entries).toContainEqual({
        path: 'node_modules',
        kind: 'directory',
        ignored: true
      })
      expect(tree.entries.filter(({ path }) => path === 'logs')).toEqual([
        { path: 'logs', kind: 'directory', ignored: true }
      ])
      expect(tree.entries.map(({ path }) => path)).not.toContain('drafts')
      expect(tree.statuses).toEqual({
        '.gitignore': 'modified',
        'drafts/note.md': 'untracked',
        'src/kept.ts': 'added'
      })
    })

    /*
     * git names only `feature/` and `mixed/`, which hold a file each, and
     * never the empty folders beside it. Those two are what the disk is read
     * for, when opened.
     */
    it('names the untracked folders an empty one may hide in', async () => {
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.env\n*.log\n', 'utf8')
      await mkdir(join(dir, 'feature', 'a'), { recursive: true })
      await mkdir(join(dir, 'feature', 'b'))
      await writeFile(join(dir, 'feature', 'a', 'x.ts'), 'x\n', 'utf8')
      await mkdir(join(dir, 'mixed', 'e'), { recursive: true })
      await writeFile(join(dir, 'mixed', 'x.log'), 'x\n', 'utf8')

      const tree = await readFileTree(gitIn(dir))

      expect(tree.untrackedFolders).toEqual(['feature', 'mixed'])
      expect(tree.entries.map(({ path }) => path)).not.toContain('feature/b')
    })

    it('reads a move announced with `git add -N` as a rename, with no phantom path', async () => {
      await run('mv', [join(dir, 'a.txt'), join(dir, 'moved.txt')])
      await git('add', '-N', 'moved.txt')

      const tree = await readFileTree(gitIn(dir))

      expect(tree.statuses).toEqual({ 'moved.txt': 'renamed' })
      expect(tree.entries.map((entry) => entry.path).sort()).toEqual([
        '.gitignore',
        'disk-gone.txt',
        'edited.txt',
        'moved.txt',
        'staged-gone.txt'
      ])
    })
  })
})
