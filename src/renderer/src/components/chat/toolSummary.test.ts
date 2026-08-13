import { describe, expect, it } from 'vitest'

import { describeToolInput, planTitle, readPlan } from './toolSummary.js'

describe('what a tool call acted on', () => {
  // A tool call is only legible if the row says what it touched, and every
  // tool names that differently.
  it('reads the field each tool uses to name its target', () => {
    expect(describeToolInput({ file_path: '/src/auth.rb' })).toBe('/src/auth.rb')
    expect(describeToolInput({ command: 'npm test' })).toBe('npm test')
    expect(describeToolInput({ pattern: 'useEffect' })).toBe('useEffect')
    expect(describeToolInput({ path: '/src' })).toBe('/src')
    expect(describeToolInput({ url: 'https://example.com' })).toBe('https://example.com')
    expect(describeToolInput({ description: 'run the suite' })).toBe('run the suite')
  })

  // Bash carries both a command and a description; the command is what was run.
  it('prefers the more specific field when a tool carries several', () => {
    expect(describeToolInput({ command: 'npm test', description: 'run the suite' })).toBe(
      'npm test'
    )
  })

  it('trims what it shows', () => {
    expect(describeToolInput({ file_path: '  /src/auth.rb  ' })).toBe('/src/auth.rb')
  })

  it('says nothing rather than showing an empty field', () => {
    expect(describeToolInput({ file_path: '   ' })).toBeNull()
    expect(describeToolInput({})).toBeNull()
  })

  // The shape belongs to whichever tool the model picked, so anything may turn
  // up here — including nothing shaped like an object at all.
  it('says nothing for an input it cannot read', () => {
    expect(describeToolInput(null)).toBeNull()
    expect(describeToolInput('a string')).toBeNull()
    expect(describeToolInput({ file_path: 42 })).toBeNull()
    expect(describeToolInput({ todos: [{ content: 'x' }] })).toBeNull()
  })
})

// In plan mode the agent writes no prose: it calls `ExitPlanMode` and puts the
// whole plan in an argument. Summarised like any other tool call it vanished —
// the row showed a name and nothing else, and the plan was never on screen.
describe('a plan handed over as a tool call', () => {
  it('is read out of the call that carries it', () => {
    expect(readPlan('ExitPlanMode', { plan: '# Add a farewell\n\nOne export.' })).toBe(
      '# Add a farewell\n\nOne export.'
    )
  })

  it('is not looked for in any other tool', () => {
    expect(readPlan('Edit', { plan: 'not a plan' })).toBeNull()
  })

  it('is absent when the call carries none', () => {
    expect(readPlan('ExitPlanMode', { file_path: '/a.ts' })).toBeNull()
    expect(readPlan('ExitPlanMode', { plan: '' })).toBeNull()
    expect(readPlan('ExitPlanMode', null)).toBeNull()
  })

  // The summary looks for `file_path`, `command` and their like, and a plan has
  // none of them — which is exactly how it came to be invisible.
  it('is what the ordinary summary cannot see', () => {
    expect(describeToolInput({ plan: '# Add a farewell' })).toBeNull()
  })
})

describe('what a plan calls itself', () => {
  it('takes the first heading, without its hashes', () => {
    expect(planTitle('# Normalising the locales\n\n## Context\n\nSome prose.')).toBe(
      'Normalising the locales'
    )
  })

  it('falls back to the first line when the plan opens with prose', () => {
    expect(planTitle('\n\nRename the config field.\n\nThen the rest.')).toBe(
      'Rename the config field.'
    )
  })

  // This becomes part of a sentence asking for the plan by name, so a plan
  // whose first line is a paragraph would otherwise become the whole message.
  it('shortens a first line too long to be a name', () => {
    const title = planTitle(`# ${'a'.repeat(200)}`)

    expect(title).toHaveLength(81)
    expect(title.endsWith('…')).toBe(true)
  })

  it('answers nothing for a plan with nothing in it', () => {
    expect(planTitle('\n   \n')).toBe('')
  })
})
