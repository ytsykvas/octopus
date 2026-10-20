import { describe, expect, it } from 'vitest'

import type { AgentCommand } from '@core/chats.js'

import { commandText, rankByName, readTrigger, replaceToken } from './suggest.js'

function command(name: string, overrides: Partial<AgentCommand> = {}): AgentCommand {
  return { name, description: '', argumentHint: '', aliases: [], skill: false, ...overrides }
}

/** The trigger with the caret at the end of the draft, which is where typing happens. */
function atEnd(draft: string, sigil: '/' | '@' = '/'): ReturnType<typeof readTrigger> {
  return readTrigger(draft, draft.length, sigil)
}

describe('deciding whether a name is being typed', () => {
  it('reads the name after the slash, and where the slash is', () => {
    expect(atEnd('/cle')).toEqual({ query: 'cle', start: 0 })
    expect(atEnd('/deploy')).toEqual({ query: 'deploy', start: 0 })
  })

  // A real answer, not an absence of one: every name matches nothing typed.
  it('treats a bare sigil as the beginning of any name', () => {
    expect(atEnd('/')).toEqual({ query: '', start: 0 })
    expect(atEnd('@')).toBeNull()
    expect(atEnd('@', '@')).toEqual({ query: '', start: 0 })
  })

  // The point of reading at the caret: "use /review on this" names a skill in
  // the middle of a sentence.
  it('reads a word in the middle of the text', () => {
    expect(atEnd('please use /rev')).toEqual({ query: 'rev', start: 11 })
    expect(atEnd('first line\n/rev')).toEqual({ query: 'rev', start: 11 })
    expect(atEnd('ask @Exp', '@')).toEqual({ query: 'Exp', start: 4 })
  })

  // The caret, not the end: a word being typed before text that already exists.
  it('reads the word the caret ends, wherever the caret is', () => {
    const draft = 'run /rev on this'

    expect(readTrigger(draft, 8, '/')).toEqual({ query: 'rev', start: 4 })
    expect(readTrigger(draft, draft.length, '/')).toBeNull()
  })

  /*
   * Only a sigil that starts a word opens a list. Anything else would offer
   * completions inside a path, a date or an email address — and then take
   * Enter away from the person writing one.
   */
  it('says nothing when the sigil does not start a word', () => {
    expect(atEnd('look at src/core/')).toBeNull()
    expect(atEnd('due 12/08')).toBeNull()
    expect(atEnd('see /Users/me/project')).toBeNull()
    expect(atEnd('mail me@work', '@')).toBeNull()
    expect(atEnd('')).toBeNull()
    expect(atEnd('clear')).toBeNull()
  })

  // Once the word is finished, the list has nothing left to complete.
  it('says nothing once the word has ended', () => {
    expect(atEnd('/clear the log')).toBeNull()
    expect(atEnd('/clear ')).toBeNull()
  })

  // Names come from directories, skills and agent types, and a plugin
  // qualifies its own with a colon.
  it('accepts the characters a name is made of', () => {
    expect(atEnd('/fewer-permission-prompts')?.query).toBe('fewer-permission-prompts')
    expect(atEnd('/pr-review:check')?.query).toBe('pr-review:check')
    expect(atEnd('@my-plugin:review', '@')?.query).toBe('my-plugin:review')
  })

  // Each list hears its own sigil only.
  it('does not read one sigil as the other', () => {
    expect(atEnd('/clear', '@')).toBeNull()
    expect(atEnd('@Explore', '/')).toBeNull()
  })
})

describe('choosing what to offer', () => {
  const clear = command('clear', { aliases: ['reset', 'new'] })
  const compact = command('compact')
  const recap = command('recap')

  it('offers everything for a bare sigil', () => {
    expect(rankByName([clear, compact], '')).toEqual([clear, compact])
  })

  // What starts with these letters comes first: it is what the reader is
  // reaching for, and burying it under a substring match is why lists get
  // ignored.
  it('puts a name that starts with the query above one that merely contains it', () => {
    const found = rankByName([recap, command('cap')], 'cap')

    expect(found.map((match) => match.name)).toEqual(['cap', 'recap'])
  })

  it('finds an entry by an alias, and reports it under its own name', () => {
    const found = rankByName([clear, compact], 'res')

    expect(found.map((match) => match.name)).toEqual(['clear'])
  })

  // An agent has no aliases at all, and has to rank all the same.
  it('ranks entries that carry no aliases', () => {
    const found = rankByName([{ name: 'general-purpose' }, { name: 'Plan' }], 'Pl')

    expect(found.map((match) => match.name)).toEqual(['Plan'])
  })

  // An entry matching by both its name and an alias is still one entry.
  it('offers an entry once however many ways it matched', () => {
    const found = rankByName([command('new', { aliases: ['new'] })], 'new')

    expect(found).toHaveLength(1)
  })

  /*
   * Descriptions are sentences, and `/clear`'s mentions "session" — as do half
   * a dozen unrelated commands. A list that answers three letters with
   * everything is a list nobody reads.
   */
  it('does not search the descriptions', () => {
    const documented = command('recap', { description: 'Summarise the session so far' })

    expect(rankByName([documented], 'session')).toEqual([])
  })

  it('offers nothing when nothing matches', () => {
    expect(rankByName([clear, compact], 'zzz')).toEqual([])
  })
})

describe('putting a choice in the field', () => {
  // The token goes, the rest of the sentence stays, and the caret lands after
  // what was inserted — where the next word is typed.
  it('replaces the token at the caret and keeps the text around it', () => {
    const draft = 'please /rev this'
    const token = { query: 'rev', start: 7 }

    expect(replaceToken(draft, token, 11, '/review ')).toEqual({
      draft: 'please /review  this',
      caret: 15
    })
  })

  it('replaces a token at the very start', () => {
    expect(replaceToken('/cl', { query: 'cl', start: 0 }, 3, '/clear')).toEqual({
      draft: '/clear',
      caret: 6
    })
  })

  // The space is where the argument goes.
  it('leaves room for an argument when a leading command takes one', () => {
    expect(commandText(command('clear', { argumentHint: '[name]' }), true)).toBe('/clear ')
  })

  // And does not, when it does not: a trailing space on a command that takes
  // nothing is one the user has to delete before they can send.
  it('adds nothing after a leading command that takes no arguments', () => {
    expect(commandText(command('usage'), true)).toBe('/usage')
  })

  // Mid-sentence the name is a word, and the sentence carries on after it.
  it('always leaves a space after a name picked mid-sentence', () => {
    expect(commandText(command('review'), false)).toBe('/review ')
  })
})
