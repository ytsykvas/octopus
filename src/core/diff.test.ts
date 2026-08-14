/**
 * Driven against a real repository, like `worktree.test.ts`.
 *
 * The parsers are tested on strings — that is what they are split out for — but
 * everything that decides which git command to run is tested against real git.
 * Diff output is exactly the kind of format assumptions turn out wrong about:
 * the rename record with an empty path field, the tab appended to a path with a
 * space, and the carriage return that is content rather than punctuation were
 * all read off a real repository rather than guessed.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DIFF_LIMITS,
  DiffError,
  looksBinary,
  parseNameStatus,
  parseNumstat,
  parseUnifiedDiff,
  readWorkspaceDiff,
  unquotePath,
  untrackedHunk
} from './diff.js'
import { type GitExec, gitIn } from './git.js'

const run = promisify(execFile)

let dir: string
let exec: GitExec

/** Commits everything in the tree under one message. */
async function commit(message: string): Promise<void> {
  await run('git', ['add', '-A'], { cwd: dir })
  await run('git', ['commit', '-q', '-m', message], { cwd: dir })
}

/** Reads the workspace diff against `main`, which every test branches from. */
async function readDiff(
  options: Partial<Parameters<typeof readWorkspaceDiff>[1]> = {}
): ReturnType<typeof readWorkspaceDiff> {
  return readWorkspaceDiff(exec, { baseBranch: 'main', root: dir, ...options })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-diff-'))
  await run('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await run('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\nthree\n', 'utf8')
  // Seeded on the base branch on purpose: a file created on the workspace's own
  // branch is an addition against the merge base, so both sides of a change to
  // it can only be seen when the base already has it.
  await writeFile(join(dir, 'crlf.txt'), 'one\r\n', 'utf8')
  await commit('first')
  await run('git', ['checkout', '-q', '-b', 'work'], { cwd: dir })
  exec = gitIn(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('looksBinary', () => {
  it('calls bytes binary when a NUL appears early', () => {
    expect(looksBinary(Uint8Array.from([0x61, 0x00, 0x62]))).toBe(true)
  })

  it('calls plain text bytes text', () => {
    expect(looksBinary(new TextEncoder().encode('hello\nworld\n'))).toBe(false)
  })

  it('ignores a NUL beyond the bytes git itself reads', () => {
    const bytes = new Uint8Array(9_000)
    bytes.fill(0x61)
    bytes[8_500] = 0
    expect(looksBinary(bytes)).toBe(false)
  })

  it('calls nothing text', () => {
    expect(looksBinary(new Uint8Array(0))).toBe(false)
  })
})

describe('unquotePath', () => {
  it('leaves an unquoted path alone', () => {
    expect(unquotePath('src/core/diff.ts')).toBe('src/core/diff.ts')
  })

  it('leaves a lone quote character alone', () => {
    expect(unquotePath('"')).toBe('"')
  })

  it('unwraps a quoted path', () => {
    expect(unquotePath('"plain.txt"')).toBe('plain.txt')
  })

  it('restores an escaped quote', () => {
    expect(unquotePath('"has\\"quote.txt"')).toBe('has"quote.txt')
  })

  it('restores an escaped backslash', () => {
    expect(unquotePath('"back\\\\slash.txt"')).toBe('back\\slash.txt')
  })

  it('restores the control characters git names', () => {
    expect(unquotePath('"tab\\there\\nand\\rmore\\bx\\fy\\vz.txt"')).toBe(
      'tab\there\nand\rmore\bx\fy\vz.txt'
    )
  })

  it('restores a character escaped for no reason', () => {
    expect(unquotePath('"od\\d.txt"')).toBe('odd.txt')
  })

  it('reassembles octal escapes as UTF-8 rather than as bytes', () => {
    // What `core.quotePath` leaves behind when it is not turned off.
    expect(unquotePath('"\\320\\272.txt"')).toBe('к.txt')
  })
})

describe('parseNumstat', () => {
  it('reads an ordinary record', () => {
    expect(parseNumstat('2\t1\ta.txt\0')).toEqual([
      { path: 'a.txt', oldPath: null, added: 2, removed: 1, binary: false }
    ])
  })

  it('reads the two records a rename adds after its empty path field', () => {
    expect(parseNumstat('0\t0\t\0old.txt\0new.txt\0')).toEqual([
      { path: 'new.txt', oldPath: 'old.txt', added: 0, removed: 0, binary: false }
    ])
  })

  it('reads a binary file as changed by no countable lines', () => {
    expect(parseNumstat('-\t-\tlogo.png\0')).toEqual([
      { path: 'logo.png', oldPath: null, added: 0, removed: 0, binary: true }
    ])
  })

  it('keeps a tab inside a path, which -z is what makes possible', () => {
    expect(parseNumstat('1\t0\ttab\there.txt\0')[0]?.path).toBe('tab\there.txt')
  })

  it('reads several records in one output', () => {
    expect(parseNumstat('2\t1\ta.txt\0-\t-\tb.png\0')).toHaveLength(2)
  })

  it('answers nothing for an empty diff', () => {
    expect(parseNumstat('')).toEqual([])
  })
})

describe('parseNameStatus', () => {
  it('reads a status and the path it applies to', () => {
    expect(parseNameStatus('M\0a.txt\0')).toEqual([
      { path: 'a.txt', oldPath: null, status: 'modified' }
    ])
  })

  it('reads the two paths a rename carries, ignoring its similarity score', () => {
    expect(parseNameStatus('R100\0old.txt\0new.txt\0')).toEqual([
      { path: 'new.txt', oldPath: 'old.txt', status: 'renamed' }
    ])
  })

  it('reads a copy the same way as a rename', () => {
    expect(parseNameStatus('C075\0from.txt\0to.txt\0')).toEqual([
      { path: 'to.txt', oldPath: 'from.txt', status: 'copied' }
    ])
  })

  it('reads the remaining letters git uses', () => {
    expect(parseNameStatus('A\0new.txt\0D\0gone.txt\0T\0link.txt\0').map((e) => e.status)).toEqual([
      'added',
      'deleted',
      'typeChanged'
    ])
  })

  it('stays in step with the fields when a letter it does not know turns up', () => {
    // `U` for an unmerged file is the real case. What matters is that the path
    // after it is read as a path rather than as the next status.
    expect(parseNameStatus('U\0conflicted.txt\0M\0a.txt\0')).toEqual([
      { path: 'conflicted.txt', oldPath: null, status: 'modified' },
      { path: 'a.txt', oldPath: null, status: 'modified' }
    ])
  })

  it('answers nothing for an empty diff', () => {
    expect(parseNameStatus('')).toEqual([])
  })
})

describe('parseUnifiedDiff', () => {
  it('numbers both sides of a modification', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        'index 111..222 100644',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,3 +1,3 @@',
        ' one',
        '-two',
        '+TWO',
        ' three',
        ''
      ].join('\n')
    )

    expect(file?.path).toBe('a.txt')
    expect(file?.hunks[0]?.lines).toEqual([
      { kind: 'context', text: 'one', oldNumber: 1, newNumber: 1, noNewline: false },
      { kind: 'removed', text: 'two', oldNumber: 2, newNumber: null, noNewline: false },
      { kind: 'added', text: 'TWO', oldNumber: null, newNumber: 2, noNewline: false },
      { kind: 'context', text: 'three', oldNumber: 3, newNumber: 3, noNewline: false }
    ])
  })

  it('gives each hunk its own range and heading', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,1 +1,1 @@ function one()',
        '-a',
        '+A',
        '@@ -10,1 +10,1 @@ function two()',
        '-b',
        '+B',
        ''
      ].join('\n')
    )

    expect(file?.hunks.map((hunk) => [hunk.oldStart, hunk.heading])).toEqual([
      [1, 'function one()'],
      [10, 'function two()']
    ])
  })

  it('reads a range with the count left off as one line', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-a',
        '+A',
        ''
      ].join('\n')
    )

    expect(file?.hunks[0]).toMatchObject({ oldLines: 1, newLines: 1 })
  })

  it('reads a new file as additions with no old numbers', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,2 @@',
        '+one',
        '+two',
        ''
      ].join('\n')
    )

    expect(file?.path).toBe('new.txt')
    expect(file?.hunks[0]?.lines.every((line) => line.oldNumber === null)).toBe(true)
  })

  it('takes a deletion’s path from the header that is not /dev/null', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/gone.txt b/gone.txt',
        'deleted file mode 100644',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-x',
        ''
      ].join('\n')
    )

    expect(file?.path).toBe('gone.txt')
  })

  it('takes a rename’s path from the line that states it', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/old name.txt b/new name.txt',
        'similarity index 100%',
        'rename from old name.txt',
        'rename to new name.txt',
        ''
      ].join('\n')
    )

    expect(file?.path).toBe('new name.txt')
    expect(file?.hunks).toEqual([])
  })

  it('drops the tab git appends to a path containing a space', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/with space.txt b/with space.txt',
        '--- a/with space.txt\t',
        '+++ b/with space.txt\t',
        '@@ -1 +1 @@',
        '-x',
        '+y',
        ''
      ].join('\n')
    )

    expect(file?.path).toBe('with space.txt')
  })

  it('unquotes a path git had to quote', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git "a/has\\"quote.txt" "b/has\\"quote.txt"',
        'new file mode 100644',
        '--- /dev/null',
        '+++ "b/has\\"quote.txt"',
        '@@ -0,0 +1 @@',
        '+q',
        ''
      ].join('\n')
    )

    expect(file?.path).toBe('has"quote.txt')
  })

  it('opens a block for a quoted rename before any header corrects it', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git "a/one\\"x.txt" "b/two\\"y.txt"',
        'similarity index 100%',
        'rename from "one\\"x.txt"',
        'rename to "two\\"y.txt"',
        ''
      ].join('\n')
    )

    expect(file?.path).toBe('two"y.txt')
  })

  it('reads a path that carries no a/ or b/ prefix', () => {
    // What `diff.noprefix` in a user's config produces.
    const [file] = parseUnifiedDiff(
      ['diff --git a.txt a.txt', '--- a.txt', '+++ a.txt', '@@ -1 +1 @@', '-x', '+y', ''].join('\n')
    )

    expect(file?.path).toBe('a.txt')
  })

  it('does not hang on a quoted path that is never closed', () => {
    const [file] = parseUnifiedDiff(
      ['diff --git "a/unterminated.txt', '@@ -1 +1 @@', '-x', '+y', ''].join('\n')
    )

    expect(file?.hunks[0]?.lines).toHaveLength(2)
  })

  it('marks a file git calls binary and gives it no lines', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/logo.png b/logo.png',
        'index 111..222 100644',
        'Binary files a/logo.png and b/logo.png differ',
        ''
      ].join('\n')
    )

    expect(file).toMatchObject({ path: 'logo.png', binary: true, hunks: [] })
  })

  it('marks a binary patch as binary too', () => {
    const [file] = parseUnifiedDiff(
      ['diff --git a/logo.png b/logo.png', 'GIT binary patch', 'literal 4', ''].join('\n')
    )

    expect(file?.binary).toBe(true)
  })

  it('marks the removed line a missing trailing newline belongs to', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-old',
        '\\ No newline at end of file',
        '+new',
        ''
      ].join('\n')
    )

    expect(file?.hunks[0]?.lines.map((line) => [line.kind, line.noNewline])).toEqual([
      ['removed', true],
      ['added', false]
    ])
  })

  it('marks the added line a missing trailing newline belongs to', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-old',
        '+new',
        '\\ No newline at end of file',
        ''
      ].join('\n')
    )

    expect(file?.hunks[0]?.lines.at(-1)?.noNewline).toBe(true)
  })

  it('ignores the marker when no line precedes it', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '\\ No newline at end of file',
        '-old',
        '+new',
        ''
      ].join('\n')
    )

    expect(file?.hunks[0]?.lines).toHaveLength(2)
  })

  it('keeps a carriage return, which belongs to the file rather than to git', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-old\r',
        '+new\r',
        ''
      ].join('\n')
    )

    expect(file?.hunks[0]?.lines.map((line) => line.text)).toEqual(['old\r', 'new\r'])
  })

  it('reads a removed line that looks like a header as content', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,2 +1,1 @@',
        '--- a/elsewhere.txt',
        ' kept',
        ''
      ].join('\n')
    )

    expect(parseUnifiedDiff.length).toBe(1)
    expect(file?.hunks[0]?.lines[0]).toMatchObject({ kind: 'removed', text: '-- a/elsewhere.txt' })
  })

  it('reads an empty context line git wrote as a lone space', () => {
    const [file] = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1,2 +1,2 @@',
        ' ',
        '-x',
        '+y',
        ''
      ].join('\n')
    )

    expect(file?.hunks[0]?.lines[0]).toMatchObject({ kind: 'context', text: '' })
  })

  it('stops a hunk when the output ends mid-way through it', () => {
    const [file] = parseUnifiedDiff(
      ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1,9 +1,9 @@', ' one'].join(
        '\n'
      )
    )

    expect(file?.hunks[0]?.lines).toHaveLength(1)
  })

  it('ignores anything before the first file', () => {
    expect(parseUnifiedDiff('warning: something\n')).toEqual([])
  })

  it('answers nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('reads several files in one output', () => {
    const files = parseUnifiedDiff(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1 @@',
        '-a',
        '+A',
        'diff --git a/b.txt b/b.txt',
        '--- a/b.txt',
        '+++ b/b.txt',
        '@@ -1 +1 @@',
        '-b',
        '+B',
        ''
      ].join('\n')
    )

    expect(files.map((file) => file.path)).toEqual(['a.txt', 'b.txt'])
  })
})

describe('untrackedHunk', () => {
  it('reports every line as an addition numbered from one', () => {
    expect(untrackedHunk('one\ntwo\n')?.lines).toEqual([
      { kind: 'added', text: 'one', oldNumber: null, newNumber: 1, noNewline: false },
      { kind: 'added', text: 'two', oldNumber: null, newNumber: 2, noNewline: false }
    ])
  })

  it('marks the last line when the file does not end with a newline', () => {
    expect(untrackedHunk('only')?.lines.at(-1)).toMatchObject({ noNewline: true })
  })

  it('says an empty file has nothing to draw', () => {
    expect(untrackedHunk('')).toBeNull()
  })

  it('reports a file that is one empty line', () => {
    expect(untrackedHunk('\n')?.lines).toEqual([
      { kind: 'added', text: '', oldNumber: null, newNumber: 1, noNewline: false }
    ])
  })
})

describe('readWorkspaceDiff', () => {
  it('reports a file changed in the working tree', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\nTWO\nthree\n', 'utf8')

    const diff = await readDiff()

    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({ path: 'a.txt', status: 'modified', added: 1, removed: 1 })
    expect(diff.files[0]?.hunks[0]?.lines.some((line) => line.text === 'TWO')).toBe(true)
    expect(diff).toMatchObject({ added: 1, removed: 1, baseBranch: 'main', omittedFiles: 0 })
  })

  it('reports committed and uncommitted work together', async () => {
    await writeFile(join(dir, 'committed.txt'), 'c\n', 'utf8')
    await commit('second')
    await writeFile(join(dir, 'pending.txt'), 'p\n', 'utf8')
    await run('git', ['add', 'pending.txt'], { cwd: dir })

    const diff = await readDiff()

    expect(diff.files.map((file) => file.path)).toEqual(['committed.txt', 'pending.txt'])
  })

  it('leaves out what landed on the base branch after the fork', async () => {
    await run('git', ['checkout', '-q', 'main'], { cwd: dir })
    await writeFile(join(dir, 'theirs.txt'), 'theirs\n', 'utf8')
    await commit('on main')
    await run('git', ['checkout', '-q', 'work'], { cwd: dir })
    await writeFile(join(dir, 'ours.txt'), 'ours\n', 'utf8')
    await commit('on work')

    const diff = await readDiff()

    expect(diff.files.map((file) => file.path)).toEqual(['ours.txt'])
  })

  it('reports a file nobody has added yet', async () => {
    await writeFile(join(dir, 'fresh.txt'), 'one\ntwo\n', 'utf8')

    const diff = await readDiff()

    expect(diff.files[0]).toMatchObject({ path: 'fresh.txt', status: 'untracked', added: 2 })
    expect(diff.files[0]?.hunks[0]?.lines).toHaveLength(2)
  })

  it('leaves out a file the repository ignores', async () => {
    await writeFile(join(dir, '.gitignore'), 'secret.txt\n', 'utf8')
    await commit('ignore')
    await writeFile(join(dir, 'secret.txt'), 'hidden\n', 'utf8')

    const diff = await readDiff()

    expect(diff.files.map((file) => file.path)).not.toContain('secret.txt')
  })

  it('reports an untracked file that is empty as having nothing to draw', async () => {
    await writeFile(join(dir, 'empty.txt'), '', 'utf8')

    const diff = await readDiff()

    expect(diff.files[0]).toMatchObject({ path: 'empty.txt', added: 0, omitted: 'none', hunks: [] })
  })

  it('still draws an untracked file when a tracked one was left out', async () => {
    await writeFile(join(dir, 'one.txt'), 'a\n', 'utf8')
    await writeFile(join(dir, 'two.txt'), 'b\n', 'utf8')
    await commit('two files')
    await writeFile(join(dir, 'fresh.txt'), 'f\n', 'utf8')

    const diff = await readDiff({ limits: { ...DIFF_LIMITS, maxFiles: 1 } })

    expect(diff.files.find((file) => file.path === 'fresh.txt')).toMatchObject({
      status: 'untracked',
      omitted: 'none'
    })
    expect(diff.files.find((file) => file.path === 'two.txt')?.omitted).toBe('tooLarge')
  })

  it('draws no lines for an untracked file that is binary', async () => {
    await writeFile(join(dir, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62]))

    const diff = await readDiff()

    expect(diff.files[0]).toMatchObject({ path: 'blob.bin', omitted: 'binary', hunks: [] })
  })

  it('draws no lines for a tracked file git calls binary', async () => {
    await writeFile(join(dir, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62]))
    await commit('add blob')
    await writeFile(join(dir, 'blob.bin'), Buffer.from([0x61, 0x00, 0x63]))

    const diff = await readDiff()

    expect(diff.files[0]).toMatchObject({ omitted: 'binary', added: 0, removed: 0, hunks: [] })
  })

  it('reports an untracked file it can no longer read as having nothing to draw', async () => {
    await writeFile(join(dir, 'vanishes.txt'), 'gone\n', 'utf8')

    const diff = await readDiff({
      readBytes: () => Promise.reject(new Error('ENOENT'))
    })

    expect(diff.files[0]).toMatchObject({ path: 'vanishes.txt', omitted: 'binary', added: 0 })
  })

  it('reports a deleted file', async () => {
    await rm(join(dir, 'a.txt'))

    const diff = await readDiff()

    expect(diff.files[0]).toMatchObject({ path: 'a.txt', status: 'deleted', removed: 3 })
  })

  it('reports a rename as one file that knows where it came from', async () => {
    await run('git', ['mv', 'a.txt', 'b.txt'], { cwd: dir })
    await commit('move')

    const diff = await readDiff()

    expect(diff.files[0]).toMatchObject({ path: 'b.txt', oldPath: 'a.txt', status: 'renamed' })
  })

  it('reports a rename that also changed the file', async () => {
    await run('git', ['mv', 'a.txt', 'b.txt'], { cwd: dir })
    await writeFile(join(dir, 'b.txt'), 'one\nTWO\nthree\n', 'utf8')
    await commit('move and edit')

    const diff = await readDiff()

    expect(diff.files[0]).toMatchObject({ path: 'b.txt', oldPath: 'a.txt', added: 1, removed: 1 })
    expect(diff.files[0]?.hunks).not.toHaveLength(0)
  })

  it('keeps a path containing a space intact', async () => {
    await writeFile(join(dir, 'with space.txt'), 'x\n', 'utf8')
    await commit('spaced')
    await writeFile(join(dir, 'with space.txt'), 'y\n', 'utf8')

    const diff = await readDiff()

    expect(diff.files[0]?.path).toBe('with space.txt')
    expect(diff.files[0]?.hunks).not.toHaveLength(0)
  })

  it('keeps a path written in another alphabet intact', async () => {
    await writeFile(join(dir, 'кирилиця.txt'), 'x\n', 'utf8')
    await commit('cyrillic')
    await writeFile(join(dir, 'кирилиця.txt'), 'y\n', 'utf8')

    const diff = await readDiff()

    expect(diff.files[0]?.path).toBe('кирилиця.txt')
    expect(diff.files[0]?.hunks).not.toHaveLength(0)
  })

  it('keeps a path that would otherwise read as a glob intact', async () => {
    await writeFile(join(dir, 'x[1].txt'), 'x\n', 'utf8')
    await writeFile(join(dir, 'big.txt'), 'y\n', 'utf8')
    await commit('bracketed')
    await writeFile(join(dir, 'x[1].txt'), 'changed\n', 'utf8')
    await writeFile(join(dir, 'big.txt'), 'y\ny\ny\n', 'utf8')

    // A limit that leaves one file out is what forces the pathspec to be used
    // at all — without it every file is drawn and no path reaches an argument.
    const diff = await readDiff({ limits: { ...DIFF_LIMITS, maxTotalLines: 2 } })

    expect(diff.files.find((file) => file.path === 'x[1].txt')?.hunks).not.toHaveLength(0)
  })

  it('keeps a file’s carriage returns, which belong to the file', async () => {
    await writeFile(join(dir, 'crlf.txt'), 'two\r\n', 'utf8')

    const diff = await readDiff()

    expect(diff.files[0]?.hunks[0]?.lines.map((line) => line.text)).toEqual(['one\r', 'two\r'])
  })

  it('marks a file that does not end with a newline', async () => {
    await writeFile(join(dir, 'tail.txt'), 'no newline', 'utf8')
    await commit('tail')
    await writeFile(join(dir, 'tail.txt'), 'still none', 'utf8')

    const diff = await readDiff()

    expect(diff.files[0]?.hunks[0]?.lines.at(-1)?.noNewline).toBe(true)
  })

  it('answers with nothing for a workspace that changed nothing', async () => {
    const diff = await readDiff()

    expect(diff).toMatchObject({ files: [], added: 0, removed: 0, omittedFiles: 0 })
  })

  it('measures against the merge base, which it names', async () => {
    const expected = (await run('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim()

    expect((await readDiff()).baseCommit).toBe(expected)
  })

  it('refuses when the base branch does not resolve', async () => {
    await expect(readDiff({ baseBranch: 'no-such-branch' })).rejects.toThrow(DiffError)
  })

  it('names the branch it could not resolve, so the message can say which', async () => {
    await expect(readDiff({ baseBranch: 'gone' })).rejects.toMatchObject({
      code: 'baseUnknown',
      params: { branch: 'gone' }
    })
  })

  it('refuses when the two branches share no history', async () => {
    await run('git', ['checkout', '-q', '--orphan', 'unrelated'], { cwd: dir })
    await writeFile(join(dir, 'alone.txt'), 'alone\n', 'utf8')
    await commit('orphan')

    await expect(readDiff()).rejects.toMatchObject({ code: 'baseUnknown' })
  })

  it('keeps a file’s counts but draws none of it when it changes too much', async () => {
    await writeFile(join(dir, 'big.txt'), 'x\n'.repeat(10), 'utf8')

    const diff = await readDiff({ limits: { ...DIFF_LIMITS, maxFileLines: 3 } })

    expect(diff.files[0]).toMatchObject({ added: 10, omitted: 'tooLarge', hunks: [] })
    expect(diff.omittedFiles).toBe(1)
  })

  it('draws files until the budget for the whole diff is spent', async () => {
    await writeFile(join(dir, 'one.txt'), 'a\na\na\n', 'utf8')
    await writeFile(join(dir, 'two.txt'), 'b\nb\nb\n', 'utf8')
    await commit('two files')

    // Three added lines each against the merge base, so a budget of three pays
    // for the first file and leaves nothing for the second.
    const diff = await readDiff({ limits: { ...DIFF_LIMITS, maxTotalLines: 3 } })

    expect(diff.files.map((file) => file.omitted)).toEqual(['none', 'tooLarge'])
    expect(diff.added).toBe(6)
  })

  it('draws no more files than it was told to', async () => {
    await writeFile(join(dir, 'one.txt'), 'a\n', 'utf8')
    await writeFile(join(dir, 'two.txt'), 'b\n', 'utf8')
    await commit('two files')
    await writeFile(join(dir, 'one.txt'), 'A\n', 'utf8')
    await writeFile(join(dir, 'two.txt'), 'B\n', 'utf8')

    const diff = await readDiff({ limits: { ...DIFF_LIMITS, maxFiles: 1 } })

    expect(diff.files.map((file) => file.omitted)).toEqual(['none', 'tooLarge'])
  })

  it('does not count an untracked file against the drawing budget', async () => {
    await writeFile(join(dir, 'fresh.txt'), 'x\n'.repeat(50), 'utf8')

    const diff = await readDiff({ limits: { ...DIFF_LIMITS, maxTotalLines: 1 } })

    expect(diff.files[0]?.omitted).toBe('none')
  })

  it('says an untracked file is too large to draw when it is', async () => {
    await writeFile(join(dir, 'fresh.txt'), 'x\n'.repeat(50), 'utf8')

    const diff = await readDiff({ limits: { ...DIFF_LIMITS, maxFileLines: 5 } })

    expect(diff.files[0]).toMatchObject({ added: 50, omitted: 'tooLarge', hunks: [] })
  })

  it('leaves a workspace alone when there is nothing to draw at all', async () => {
    await writeFile(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01]))

    const diff = await readDiff()

    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]?.hunks).toEqual([])
  })

  it('falls back to modified when only one of the two listings knows a file', async () => {
    // Real git answers both listings with the same set, so the pairing is fed a
    // reply it does not produce — the case exists to pin what the code does
    // rather than to describe git.
    const fake: GitExec = (args) => {
      if (args.includes('--numstat')) return Promise.resolve('1\t0\tghost.txt\0')
      if (args.includes('--name-status')) return Promise.resolve('')
      if (args[0] === 'merge-base') return Promise.resolve('abc123\n')
      if (args[0] === 'ls-files') return Promise.resolve('')
      return Promise.resolve('')
    }

    const diff = await readWorkspaceDiff(fake, { baseBranch: 'main', root: dir })

    expect(diff.files[0]).toMatchObject({ path: 'ghost.txt', status: 'modified' })
  })

  it('leaves a file without lines when the diff never described it', async () => {
    const fake: GitExec = (args) => {
      if (args.includes('--numstat')) return Promise.resolve('1\t0\tghost.txt\0')
      if (args.includes('--name-status')) return Promise.resolve('M\0ghost.txt\0')
      if (args[0] === 'merge-base') return Promise.resolve('abc123\n')
      if (args[0] === 'ls-files') return Promise.resolve('')
      return Promise.resolve('')
    }

    const diff = await readWorkspaceDiff(fake, { baseBranch: 'main', root: dir })

    expect(diff.files[0]?.hunks).toEqual([])
  })

  it('treats a merge base that answers with nothing as a base it cannot find', async () => {
    const fake: GitExec = () => Promise.resolve('')

    await expect(readWorkspaceDiff(fake, { baseBranch: 'main', root: dir })).rejects.toMatchObject({
      code: 'baseUnknown'
    })
  })
})
