import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkingLine } from './WorkingLine.js'

const START = '2026-10-19T10:00:00.000Z'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(START))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the line under a turn that is going', () => {
  it('counts up from when the turn began', () => {
    render(<WorkingLine since={START} />)
    expect(screen.getByRole('status')).toHaveTextContent('Working… 0s')

    act(() => {
      vi.advanceTimersByTime(65_000)
    })

    expect(screen.getByRole('status')).toHaveTextContent('Working… 1m 5s')
  })

  // Nothing said since the last turn closed: no start to count from.
  it('says only that it is working when it has no start', () => {
    render(<WorkingLine since={null} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^Working…$/)
  })

  it('stops its clock when it goes', () => {
    const { unmount } = render(<WorkingLine since={START} />)
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
