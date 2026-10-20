import { describe, expect, it } from 'vitest'

import { commandName, ghWords, gitCommand, parseCommand, programs } from './shellCommand.js'

const words = (text: string): (readonly string[])[] =>
  parseCommand(text).segments.map((segment) => segment.words)

describe('parseCommand', () => {
  it('splits on every separator and keeps quoted words whole', () => {
    expect(words(`a 'b c' && d "e f"; g | h & i`)).toEqual([
      ['a', 'b c'],
      ['d', 'e f'],
      ['g'],
      ['h'],
      ['i']
    ])
  })

  it('reads what runs inside $(…) and backticks as commands of their own', () => {
    expect(words('echo $(git push) `gh pr create`')).toEqual([
      ['echo'],
      ['git', 'push'],
      ['gh', 'pr', 'create']
    ])
  })

  it('hands back a double-quoted string only when the shell would run something in it', () => {
    expect(
      parseCommand(`git commit -m "plain" -m "with $(date)" -m "\\$(not)"`).substitutions
    ).toEqual(['with $(date)'])
    expect(parseCommand('echo "`date`"').substitutions).toEqual(['`date`'])
  })

  it('resolves the escapes double quotes allow, and leaves the rest', () => {
    expect(words(`x "two \\"2\\" \\n"`)).toEqual([['x', 'two "2" \\n']])
  })

  it('reads $\'…\' and $"…" as quotes', () => {
    expect(words(`$'gh' $"pr"`)).toEqual([['gh', 'pr']])
  })

  it("resolves the escapes $'…' allows, as the shell would", () => {
    expect(
      words(`$'\\x67h' $'\\147h' $'\\u0067h' $'\\U00000067h' $'a\\tb' $'\\q' $'it\\'s' $'a\\`)
    ).toEqual([['gh', 'gh', 'gh', 'gh', 'a\tb', 'q', "it's", 'a']])
  })

  it("ends a $'…' string at a NUL and keeps an octal escape to one byte, as bash does", () => {
    expect(words(`$'gh\\0 ignored' $'g\\x00h' $'\\547h' $'gh\\0\\'x' pr`)).toEqual([
      ['gh', 'g', 'gh', 'gh', 'pr']
    ])
  })

  it('runs an unterminated quote to the end', () => {
    expect(words("echo 'open")).toEqual([['echo', 'open']])
    expect(words('echo "open')).toEqual([['echo', 'open']])
  })

  it('takes the character after a backslash literally, and joins a line it ends', () => {
    expect(words('gi\\t a\\ b')).toEqual([['git', 'a b']])
    expect(words('git \\\n  push')).toEqual([['git', 'push']])
    expect(words('echo "a\\\nb"')).toEqual([['echo', 'ab']])
  })

  it('keeps an empty quoted word', () => {
    expect(words(`git commit -m ''`)).toEqual([['git', 'commit', '-m', '']])
  })

  it('gives a heredoc body to its command as data, whatever the delimiter is quoted with', () => {
    for (const opener of ['EOF', "'EOF'", '"EOF"', ' EOF']) {
      const parsed = parseCommand(`cat <<${opener}\ngit push\nEOF\necho after`)
      expect(parsed.segments).toEqual([
        { words: ['cat'], heredocs: ['git push'] },
        { words: ['echo', 'after'], heredocs: [] }
      ])
    }
  })

  it('strips leading tabs from a <<- heredoc when looking for its end', () => {
    expect(parseCommand('cat <<-EOF\n\tline\n\tEOF').segments[0]?.heredocs).toEqual(['\tline'])
  })

  it('runs a heredoc with no end to the end of the text', () => {
    expect(parseCommand('cat <<EOF\nline').segments[0]?.heredocs).toEqual(['line'])
  })

  it('ignores << with no delimiter, and leaves <<< alone', () => {
    expect(words('cat <<')).toEqual([['cat']])
    expect(words('cat <<< hi')).toEqual([['cat', '<<<', 'hi']])
  })
})

describe('commandName', () => {
  it('drops the directory', () => {
    expect(commandName('/usr/bin/git')).toBe('git')
    expect(commandName('git')).toBe('git')
  })
})

describe('programs', () => {
  it('finds the program past assignments and through wrappers and their options', () => {
    expect(
      programs(['FOO=1', 'sudo', '-u', 'me', 'env', 'BAR=2', 'nice', '-n', '5', 'git', 'push'])
    ).toEqual([
      { at: 1, name: 'sudo' },
      { at: 4, name: 'env' },
      { at: 6, name: 'nice' },
      { at: 9, name: 'git' }
    ])
  })

  it('skips the duration timeout takes', () => {
    expect(programs(['timeout', '30', '/usr/bin/git', 'push'])).toEqual([
      { at: 0, name: 'timeout' },
      { at: 2, name: 'git' }
    ])
  })

  it('finds nothing in a line of assignments', () => {
    expect(programs(['FOO=1'])).toEqual([])
    expect(programs(['env'])).toEqual([{ at: 0, name: 'env' }])
  })
})

describe('gitCommand', () => {
  it('skips git options, including those that take the next word, and keeps them', () => {
    expect(gitCommand(['git', '-C', '.', '--git-dir', '.git', '--no-pager', 'push', 'o'])).toEqual({
      options: ['-C', '.', '--git-dir', '.git', '--no-pager'],
      command: 'push',
      args: ['o']
    })
  })

  it('starts where it is told', () => {
    expect(gitCommand(['env', 'git', 'push'], 1)).toEqual({
      options: [],
      command: 'push',
      args: []
    })
  })

  it('is null for anything that is not git, or git with no command', () => {
    expect(gitCommand(['npm', 'test'])).toBeNull()
    expect(gitCommand(['git', '--no-pager'])).toBeNull()
    expect(gitCommand([])).toBeNull()
  })
})

describe('ghWords', () => {
  it('lists the positional words, gh options and their values skipped', () => {
    expect(ghWords(['gh', '-R', 'o/r', 'pr', '--draft', 'create'])).toEqual(['pr', 'create'])
    expect(ghWords(['xargs', 'gh', 'pr'], 1)).toEqual(['pr'])
  })
})
