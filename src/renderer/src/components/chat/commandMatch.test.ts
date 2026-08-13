import { describe, expect, it } from 'vitest'

import type { AgentCommand } from '@core/chats.js'

import { completeCommand, matchCommands, readCommandQuery } from './commandMatch.js'

function command(name: string, overrides: Partial<AgentCommand> = {}): AgentCommand {
  return { name, description: '', argumentHint: '', aliases: [], ...overrides }
}

describe('deciding whether a command is being typed', () => {
  it('reads the name after the slash', () => {
    expect(readCommandQuery('/cle')).toBe('cle')
    expect(readCommandQuery('/deploy')).toBe('deploy')
  })

  // A real answer, not an absence of one: every command matches nothing typed.
  it('treats a bare slash as the beginning of any command', () => {
    expect(readCommandQuery('/')).toBe('')
  })

  /*
   * The list opens only when the whole draft is the command. Matching a slash
   * anywhere in the text would offer completions inside a path, a date, or a
   * regular sentence — and then take Enter away from the person writing one.
   */
  it('says nothing when the slash is not the whole of the draft', () => {
    expect(readCommandQuery('look at src/core/')).toBeNull()
    expect(readCommandQuery('due 12/08')).toBeNull()
    expect(readCommandQuery('/clear the log')).toBeNull()
    expect(readCommandQuery('/clear ')).toBeNull()
    expect(readCommandQuery('')).toBeNull()
    expect(readCommandQuery('clear')).toBeNull()
  })

  // Names come from directories and skills, and a plugin qualifies its own
  // with a colon.
  it('accepts the characters a command name is made of', () => {
    expect(readCommandQuery('/fewer-permission-prompts')).toBe('fewer-permission-prompts')
    expect(readCommandQuery('/pr-review:check')).toBe('pr-review:check')
  })
})

describe('choosing which commands to offer', () => {
  const clear = command('clear', { aliases: ['reset', 'new'] })
  const compact = command('compact')
  const recap = command('recap')

  it('offers everything for a bare slash', () => {
    expect(matchCommands([clear, compact], '')).toEqual([clear, compact])
  })

  // What starts with these letters comes first: it is what the reader is
  // reaching for, and burying it under a substring match is why lists get
  // ignored.
  it('puts a name that starts with the query above one that merely contains it', () => {
    const found = matchCommands([recap, command('cap')], 'cap')

    expect(found.map((match) => match.name)).toEqual(['cap', 'recap'])
  })

  it('finds a command by an alias, and reports it under its own name', () => {
    const found = matchCommands([clear, compact], 'res')

    expect(found.map((match) => match.name)).toEqual(['clear'])
  })

  // A command matching by both its name and an alias is still one command.
  it('offers a command once however many ways it matched', () => {
    const found = matchCommands([command('new', { aliases: ['new'] })], 'new')

    expect(found).toHaveLength(1)
  })

  /*
   * Descriptions are sentences, and `/clear`'s mentions "session" — as do half
   * a dozen unrelated commands. A list that answers three letters with
   * everything is a list nobody reads.
   */
  it('does not search the descriptions', () => {
    const documented = command('recap', { description: 'Summarise the session so far' })

    expect(matchCommands([documented], 'session')).toEqual([])
  })

  it('offers nothing when nothing matches', () => {
    expect(matchCommands([clear, compact], 'zzz')).toEqual([])
  })
})

describe('putting a chosen command in the field', () => {
  // The space is where the argument goes.
  it('leaves room for an argument when the command takes one', () => {
    expect(completeCommand(command('clear', { argumentHint: '[name]' }))).toBe('/clear ')
  })

  // And does not, when it does not: a trailing space on a command that takes
  // nothing is one the user has to delete before they can send.
  it('adds nothing when the command takes none', () => {
    expect(completeCommand(command('usage'))).toBe('/usage')
  })
})
