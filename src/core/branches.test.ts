import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { cleanBranchPrefix, shortBranchName } from './branches.js'

const run = promisify(execFile)

describe('shortBranchName', () => {
  it('drops the origin prefix', () => {
    expect(shortBranchName('origin/main')).toBe('main')
  })

  // A repository with no remote falls back to local branches, where a first
  // segment is part of the name rather than a remote.
  it('leaves a local branch with slashes intact', () => {
    expect(shortBranchName('feature/x')).toBe('feature/x')
  })

  it('keeps everything after the remote, slashes included', () => {
    expect(shortBranchName('origin/release/0.1.1')).toBe('release/0.1.1')
  })

  it('leaves another remote alone — only origin is assumed', () => {
    expect(shortBranchName('upstream/main')).toBe('upstream/main')
  })

  // A branch may legitimately be called `origin`; the prefix is `origin/`.
  it('does not touch a branch named origin', () => {
    expect(shortBranchName('origin')).toBe('origin')
  })

  it('copes with an empty name', () => {
    expect(shortBranchName('')).toBe('')
  })

  it('strips only the leading occurrence', () => {
    expect(shortBranchName('origin/origin/main')).toBe('origin/main')
  })
})

/*
 * Every workspace branch is `<prefix>/<name>`, so a prefix git refuses makes
 * every "New workspace" fail — with git's own words, nothing about the setting.
 * The way it was hit: `ytsykvas/`, typed the way the branch reads on GitHub,
 * gave `ytsykvas//magda`.
 */
describe('cleanBranchPrefix', () => {
  it('drops the slashes around it and the empty parts inside', () => {
    expect(cleanBranchPrefix('ytsykvas/')).toBe('ytsykvas')
    expect(cleanBranchPrefix('/team//anna/')).toBe('team/anna')
  })

  // A username keeps its case: git takes capitals, and lowering them would
  // name branches after somebody else's spelling.
  it('leaves a prefix git takes as it is', () => {
    expect(cleanBranchPrefix('YTsykvas')).toBe('YTsykvas')
    expect(cleanBranchPrefix('team/anna-k_2')).toBe('team/anna-k_2')
  })

  it('turns what git refuses into something it takes', () => {
    expect(cleanBranchPrefix('anna k')).toBe('anna-k')
    expect(cleanBranchPrefix('.hidden/x.lock')).toBe('hidden/x')
    expect(cleanBranchPrefix('a..b')).toBe('a.b')
  })

  // Pasted from somewhere, a username often carries a space at the end.
  it('trims each part rather than turning its edges into dashes', () => {
    expect(cleanBranchPrefix('ytsykvas ')).toBe('ytsykvas')
    expect(cleanBranchPrefix(' ytsykvas /')).toBe('ytsykvas')
    expect(cleanBranchPrefix('team / anna')).toBe('team/anna')
  })

  it('says nothing is left when nothing usable was typed', () => {
    expect(cleanBranchPrefix('  /// ')).toBe('')
    expect(cleanBranchPrefix('...')).toBe('')
  })

  /*
   * Asked of git itself rather than of a list of rules copied out of its
   * manual: a rule left out of the list would pass every case written from
   * the same list.
   */
  it('gives a prefix git accepts a branch under, whatever was typed', async () => {
    const typed = [
      'ytsykvas/',
      '/a//b/',
      'anna k',
      'tab\there',
      'a..b',
      '.dot',
      'end.',
      'x.lock',
      'x.lock.lock',
      'x..lock',
      'x.lock.',
      'a.lock./b',
      'x.lock.lock.',
      'we@{ird',
      'caret^tilde~colon:',
      'ask?star*[bracket',
      'back\\slash',
      '-dash',
      '--',
      '@',
      'nul\u0001char',
      'ünïcode'
    ]

    for (const value of typed) {
      const prefix = cleanBranchPrefix(value)
      // Cleaned on every read and every write, so a second pass must agree
      // with the first — or the file and the memory hold different prefixes.
      expect(cleanBranchPrefix(prefix), JSON.stringify(value)).toBe(prefix)
      if (prefix === '') continue
      await expect(
        run('git', ['check-ref-format', '--branch', `${prefix}/magda`], { cwd: tmpdir() }),
        `${JSON.stringify(value)} became ${JSON.stringify(prefix)}`
      ).resolves.toBeDefined()
    }
  })
})
