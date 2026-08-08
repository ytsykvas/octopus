import { describe, expect, it } from 'vitest'

import { shortBranchName } from './branches.js'

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
