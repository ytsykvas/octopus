import { describe, expect, it } from 'vitest'

import { commandName, gitCommand, parseCommand } from './shellCommand.js'

describe('parseCommand', () => {
  it('splits on every separator and keeps quoted words whole', () => {
    expect(parseCommand(`a 'b c' && d "e f"; g | h & i`).segments).toEqual([
      ['a', 'b c'],
      ['d', 'e f'],
      ['g'],
      ['h'],
      ['i']
    ])
  })

  it('reads what runs inside $(…) and backticks as commands of their own', () => {
    expect(parseCommand('echo $(git push) `gh pr create`').segments).toEqual([
      ['echo'],
      ['git', 'push'],
      ['gh', 'pr', 'create']
    ])
  })

  it('hands back every quoted string, escapes resolved', () => {
    expect(parseCommand(`x 'one' "two \\"2\\" \\n"`).quoted).toEqual(['one', 'two "2" \\n'])
  })

  it('runs an unterminated quote to the end', () => {
    expect(parseCommand("echo 'open").segments).toEqual([['echo', 'open']])
    expect(parseCommand('echo "open').segments).toEqual([['echo', 'open']])
  })

  it('takes the character after a backslash literally', () => {
    expect(parseCommand('gi\\t a\\ b').segments).toEqual([['git', 'a b']])
  })

  it('keeps an empty quoted word', () => {
    expect(parseCommand(`git commit -m ''`).segments).toEqual([['git', 'commit', '-m', '']])
  })
})

describe('commandName', () => {
  it('drops the directory', () => {
    expect(commandName('/usr/bin/git')).toBe('git')
    expect(commandName('git')).toBe('git')
  })
})

describe('gitCommand', () => {
  it('skips git options, including those that take the next word', () => {
    expect(gitCommand(['git', '-C', '.', '--git-dir', '.git', '--no-pager', 'push', 'o'])).toEqual({
      command: 'push',
      args: ['o']
    })
  })

  it('starts where it is told', () => {
    expect(gitCommand(['env', 'git', 'push'], 1)).toEqual({ command: 'push', args: [] })
  })

  it('is null for anything that is not git, or git with no command', () => {
    expect(gitCommand(['npm', 'test'])).toBeNull()
    expect(gitCommand(['git', '--no-pager'])).toBeNull()
    expect(gitCommand([])).toBeNull()
  })
})
