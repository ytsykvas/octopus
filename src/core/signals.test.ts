import { describe, expect, it, vi } from 'vitest'

import { killProcess, signalQuietly } from './signals.js'

describe('signalQuietly', () => {
  it('sends the signal to the target it is given', () => {
    const kill = vi.fn()

    signalQuietly(kill, -42, 'SIGTERM')

    expect(kill).toHaveBeenCalledWith(-42, 'SIGTERM')
  })

  it('takes a target that has already gone as done', () => {
    const kill = vi.fn(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' })
    })

    expect(() => {
      signalQuietly(kill, 42, 'SIGKILL')
    }).not.toThrow()
  })
})

describe('killProcess', () => {
  it('asks the system, which answers for a process that is not there', () => {
    expect(() => {
      killProcess(2 ** 22 + 1, 0)
    }).toThrow()
  })
})
