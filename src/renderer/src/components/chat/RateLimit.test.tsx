import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RateLimit as RateLimitInfo } from '@core/service.js'

import { RateLimit } from './RateLimit.js'

function limit(overrides: Partial<RateLimitInfo> = {}): RateLimitInfo {
  return {
    type: 'rate_limit',
    status: 'allowed',
    window: 'five_hour',
    utilization: 62,
    resetsAt: '2026-08-11T12:12:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-11T09:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what it shows', () => {
  it('shows how much is gone and when the window resets', () => {
    render(<RateLimit limit={limit()} />)

    expect(screen.getByText('62% · 3h 12m')).toBeInTheDocument()
  })

  // The countdown says which window this is — hours means the short one, days
  // the weekly one — so naming it as well would answer a question twice.
  it('names the window nowhere, and the reset in the title', () => {
    render(<RateLimit limit={limit()} />)

    expect(screen.queryByText(/five_hour/)).not.toBeInTheDocument()
    expect(screen.getByTitle('Subscription usage — resets in 3h 12m')).toBeInTheDocument()
  })

  it('rounds the share rather than showing a fraction of a percent', () => {
    render(<RateLimit limit={limit({ utilization: 62.4 })} />)

    expect(screen.getByText(/^62%/)).toBeInTheDocument()
  })
})

describe('when the window is running out', () => {
  // At that point the reading has stopped being information and become an
  // obstacle about to appear, which is worth more than the arithmetic.
  it('says so instead of the numbers', () => {
    render(<RateLimit limit={limit({ status: 'allowed_warning' })} />)

    expect(screen.getByText('close to the limit')).toBeInTheDocument()
    expect(screen.queryByText(/62%/)).not.toBeInTheDocument()
  })

  it('says when it is gone entirely', () => {
    render(<RateLimit limit={limit({ status: 'rejected', utilization: 100 })} />)

    expect(screen.getByText('limit reached')).toBeInTheDocument()
  })
})

describe('when there is nothing to say', () => {
  // Absent until a turn has run, and an API key session never reports one at
  // all. Holding space for a number that may never come is worse than nothing.
  it('draws nothing at all', () => {
    const { container } = render(<RateLimit limit={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the share alone when the reset time is missing', () => {
    render(<RateLimit limit={limit({ resetsAt: null })} />)

    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.getByTitle('Subscription usage')).toBeInTheDocument()
  })

  // A real event carries no `utilization` most of the time — the field is
  // optional and, measured against a live session, simply absent. A bare
  // countdown beside a green dot answers a question nobody asked.
  it('stays silent while nothing is wrong and no share was reported', () => {
    const { container } = render(<RateLimit limit={limit({ utilization: null })} />)

    expect(container).toBeEmptyDOMElement()
  })

  // The same reading, once it starts mattering, is worth the space.
  it('speaks up without a share once the window is running out', () => {
    render(<RateLimit limit={limit({ utilization: null, status: 'allowed_warning' })} />)

    expect(screen.getByText('close to the limit')).toBeInTheDocument()
  })
})
