import { describe, expect, it } from 'vitest'

import { parseNameStatus } from './nameStatus.js'

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
