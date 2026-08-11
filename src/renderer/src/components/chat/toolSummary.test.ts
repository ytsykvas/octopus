import { describe, expect, it } from 'vitest'

import { describeToolInput } from './toolSummary.js'

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
