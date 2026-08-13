import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { RateLimit, SessionUsage } from '@core/service.js'

import { ComposerAttic } from './ComposerAttic.js'

const FULL: SessionUsage = {
  context: { percentage: 48, usedTokens: 48_000, maxTokens: 200_000, model: 'claude-opus-5' },
  subscription: {
    fiveHour: { utilization: 31, resetsAt: null },
    sevenDay: { utilization: 84, resetsAt: null }
  }
}

const NOTHING: SessionUsage = { context: null, subscription: null }

function limitWith(status: RateLimit['status']): RateLimit {
  return { type: 'rate_limit', status, window: 'five_hour', utilization: null, resetsAt: null }
}

function renderAttic(usage: SessionUsage = FULL, limit: RateLimit | null = null): void {
  render(<ComposerAttic usage={usage} limit={limit} />)
}

describe('what the next message is up against', () => {
  it('shows the context share and both windows', () => {
    renderAttic()

    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
    expect(screen.getByText(/5h 31%/)).toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
  })

  // A workspace nobody has spoken to, an API-key session with no plan windows,
  // and a CLI too old to answer all land here. An empty rule above the field
  // would be chrome asserting a measurement exists.
  it('is not there at all when there is nothing to say', () => {
    const { container } = render(<ComposerAttic usage={NOTHING} limit={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('drops the context share on its own without taking the windows with it', () => {
    renderAttic({ ...FULL, context: null })

    expect(screen.queryByText(/Context/)).not.toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
  })

  it('keeps the window that has a share when the other has none', () => {
    renderAttic({
      ...FULL,
      subscription: { fiveHour: null, sevenDay: { utilization: 84, resetsAt: null } }
    })

    expect(screen.queryByText(/5h/)).not.toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
  })

  it('shows the context alone when the account reports no windows', () => {
    renderAttic({ ...FULL, subscription: null })

    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
    expect(screen.queryByText(/Week/)).not.toBeInTheDocument()
  })

  // A refusal says something no percentage can — that the next turn will not
  // run — so it is worth a word. Beside the figures, not over them: covering
  // them was the first attempt and it hid the very numbers the strip is for.
  it('names a refusal without covering the figures', () => {
    renderAttic(FULL, limitWith('rejected'))

    expect(screen.getByText('limit reached')).toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
    expect(screen.getByText(/Context 48%/)).toBeInTheDocument()
  })

  // "Close to the limit" is vaguer than "Week 84%", and the colour already says
  // it. A word here would only take the reader's attention off the number.
  it('leaves being close to the limit to the colour', () => {
    renderAttic(FULL, limitWith('allowed_warning'))

    expect(screen.queryByText('close to the limit')).not.toBeInTheDocument()
    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
  })

  // The percentages come from a pull that an older CLI cannot answer; the
  // refusal comes from an event that every session sends.
  it('names a refusal even when there are no figures at all', () => {
    renderAttic(NOTHING, limitWith('rejected'))

    expect(screen.getByText('limit reached')).toBeInTheDocument()
  })

  it('says nothing extra while everything is fine', () => {
    renderAttic(FULL, limitWith('allowed'))

    expect(screen.getByText(/Week 84%/)).toBeInTheDocument()
    expect(screen.queryByText('limit reached')).not.toBeInTheDocument()
  })

  it('puts the token counts and the reset time where they can be read on demand', () => {
    renderAttic({
      context: { percentage: 48, usedTokens: 48_000, maxTokens: 200_000, model: 'claude-opus-5' },
      subscription: {
        fiveHour: { utilization: 31, resetsAt: new Date(Date.now() + 7_200_000).toISOString() },
        sevenDay: null
      }
    })

    expect(screen.getByText(/Context 48%/)).toHaveAttribute('title', 'Context window — 48k of 200k')
    expect(screen.getByText(/5h 31%/).getAttribute('title')).toContain('Five-hour window —')
  })
})
