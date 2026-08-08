import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useErrorMessage } from './useErrorMessage.js'

/**
 * Every code core sends, with the parameter its message interpolates.
 *
 * Each code is a branch of its own in the hook, and a branch nobody exercises
 * is a message nobody has ever read — the kind that ships as a bare key or with
 * an unfilled placeholder in it.
 */
const CODES: readonly {
  readonly code: string
  readonly parameter?: readonly [name: string, value: string]
}[] = [
  { code: 'notARepository', parameter: ['path', '/Users/someone/code/planner'] },
  { code: 'emptyRepository', parameter: ['path', '/Users/someone/code/fresh'] },
  { code: 'noBaseBranch', parameter: ['path', '/Users/someone/code/detached'] },
  { code: 'duplicateProject', parameter: ['name', 'planner'] },
  { code: 'notConnected' },
  { code: 'listFailed' },
  { code: 'cloneFailed', parameter: ['repository', 'ytsykvas/planner'] },
  { code: 'alreadyExists', parameter: ['path', '/Users/someone/code/planner'] },
  { code: 'branchUnmerged', parameter: ['branch', 'ytsykvas/anna'] },
  { code: 'branchExists', parameter: ['branch', 'ytsykvas/anna'] },
  { code: 'pathExists', parameter: ['path', '/tmp/planner/anna'] },
  { code: 'uncommittedChanges', parameter: ['name', 'anna'] },
  { code: 'nameEmpty' },
  { code: 'worktreeMissing' }
]

const WITH_PARAMETER = CODES.filter((entry) => entry.parameter !== undefined)

describe('useErrorMessage', () => {
  it('turns a known code into a localised message', () => {
    const { result } = renderHook(() => useErrorMessage())

    const message = result.current({
      ok: false,
      error: 'raw english fallback',
      code: 'notARepository',
      params: { path: '/tmp/x' }
    })

    expect(message).toContain('/tmp/x')
    expect(message).not.toBe('raw english fallback')
  })

  // Core sends the English text as a fallback for logs. An unknown code still
  // has to say something, so the text is carried into a localised frame rather
  // than dropped.
  it('carries the raw text through when the code is unknown', () => {
    const { result } = renderHook(() => useErrorMessage())

    expect(
      result.current({ ok: false, error: 'something specific', code: 'nonexistent' })
    ).toContain('something specific')
  })

  it('does the same when there is no code at all', () => {
    const { result } = renderHook(() => useErrorMessage())
    expect(result.current({ ok: false, error: 'plain failure' })).toContain('plain failure')
  })

  it('never returns a bare key', () => {
    const { result } = renderHook(() => useErrorMessage())

    for (const code of ['notARepository', 'branchExists', 'nameEmpty', 'worktreeMissing']) {
      const message = result.current({ ok: false, error: 'x', code, params: {} })
      expect(message).not.toContain('errors.')
    }
  })

  it.each(CODES)('reads $code as a sentence rather than a key', ({ code, parameter }) => {
    const { result } = renderHook(() => useErrorMessage())

    const message = result.current({
      ok: false,
      error: 'raw english fallback',
      code,
      ...(parameter ? { params: { [parameter[0]]: parameter[1] } } : {})
    })

    expect(message).not.toContain('errors.')
    // An unfilled placeholder means the hook passed the wrong parameter name.
    expect(message).not.toContain('{{')
    expect(message).not.toBe('raw english fallback')
    expect(message.length).toBeGreaterThan(0)
  })

  it.each(WITH_PARAMETER)('puts the $code parameter into the message', ({ code, parameter }) => {
    const { result } = renderHook(() => useErrorMessage())
    if (parameter === undefined) throw new Error('this list only holds codes with a parameter')
    const [name, value] = parameter

    const message = result.current({
      ok: false,
      error: 'raw english fallback',
      code,
      params: { [name]: value }
    })

    expect(message).toContain(value)
  })

  // Core owns the parameters, and an older build of it may send a code without
  // the one this message expects. The sentence still has to be readable rather
  // than showing the user a template.
  it.each(WITH_PARAMETER)('still reads as a sentence when $code arrives bare', ({ code }) => {
    const { result } = renderHook(() => useErrorMessage())

    const message = result.current({ ok: false, error: 'raw english fallback', code })

    expect(message).not.toContain('errors.')
    expect(message).not.toContain('{{')
    expect(message).not.toBe('raw english fallback')
  })
})
