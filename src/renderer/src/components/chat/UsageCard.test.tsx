import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UsageReport } from '@core/usage.js'

import { UsageCard } from './UsageCard.js'

/**
 * A fixed now, because the card writes reset times against it.
 *
 * Without one, a window that resets "tomorrow at 01:00" is dated on some runs
 * and bare on others, depending on the hour the suite happens to run at.
 */
const NOW = new Date('2026-08-27T17:00:00+03:00')

function report(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    session: {
      costUsd: 1.8432,
      apiDurationMs: 252_000,
      wallDurationMs: 931_000,
      linesAdded: 180,
      linesRemoved: 21,
      inputTokens: 2_000,
      outputTokens: 35_000,
      cacheReadTokens: 8_412_000,
      cacheWriteTokens: 100_000
    },
    subscriptionType: 'max',
    limitsApply: true,
    limits: [
      {
        key: 'five_hour',
        label: null,
        utilization: 32,
        resetsAt: '2026-08-27T19:10:00+03:00',
        severity: null,
        binding: false
      },
      {
        key: 'model_scoped',
        label: 'Fable',
        utilization: 7,
        resetsAt: null,
        severity: null,
        binding: false
      }
    ],
    extraUsage: null,
    contributing: {
      day: {
        requests: 9,
        sessions: 1,
        // Names arrive without a leading slash — `core-module`, not
        // `/core-module`. Measured against a live response.
        behaviors: [{ key: 'long_context', pct: 97, count: 9 }],
        skills: [{ name: 'core-module', pct: 53 }],
        agents: [],
        plugins: [],
        mcpServers: []
      },
      week: {
        requests: 376,
        sessions: 8,
        behaviors: [],
        skills: [],
        agents: [{ name: 'Explore', pct: 11 }],
        plugins: [],
        mcpServers: []
      }
    },
    ...overrides
  }
}

describe('the card /usage draws', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists what the session has spent, cost included', () => {
    render(<UsageCard report={report()} />)

    // The one surface in the app that shows the figure. It is what the tokens
    // would have cost through the API, and this is the question being asked.
    expect(screen.getByText('$1.84')).toBeInTheDocument()
    expect(screen.getByText('2.0k in · 35k out')).toBeInTheDocument()
    expect(screen.getByText('8412k read · 100k written')).toBeInTheDocument()
    expect(screen.getByText('4m 12s')).toBeInTheDocument()
    expect(screen.getByText('+180 / −21 lines')).toBeInTheDocument()
  })

  it('names the plan the account is on', () => {
    render(<UsageCard report={report()} />)

    expect(screen.getByText('max')).toBeInTheDocument()
  })

  it('says nothing about a plan when the session is not on one', () => {
    render(<UsageCard report={report({ subscriptionType: null })} />)

    expect(screen.queryByText('max')).not.toBeInTheDocument()
  })

  it('draws a bar for every window, named and per-model alike', () => {
    render(<UsageCard report={report()} />)

    expect(screen.getByRole('progressbar', { name: 'Current session — 32% used' })).toHaveAttribute(
      'aria-valuenow',
      '32'
    )
    expect(
      screen.getByRole('progressbar', { name: 'Current week (Fable) — 7% used' })
    ).toBeInTheDocument()
  })

  it('says when a window comes back, and stays quiet when it cannot', () => {
    render(<UsageCard report={report()} />)

    expect(screen.getByText('resets 19:10')).toBeInTheDocument()
    // The per-model window carries no reset time; one row saying so would be
    // a blank under a heading rather than an answer.
    expect(screen.getAllByText(/^resets /)).toHaveLength(1)
  })

  // The reading is a snapshot taken when the command ran. A window that has
  // reset since must not still promise a moment in the past.
  it('drops a reset that has already happened', () => {
    const stale = report({
      limits: [
        {
          key: 'five_hour',
          label: null,
          utilization: 32,
          resetsAt: '2026-08-27T09:00:00Z',
          severity: null,
          binding: false
        }
      ]
    })
    render(<UsageCard report={stale} />)

    expect(screen.queryByText(/^resets /)).not.toBeInTheDocument()
  })

  // An API-key, Bedrock or Vertex session. Not a failed reading — there is no
  // plan for it to be near the end of, and the card says which of the two.
  it('says plan limits do not apply rather than drawing empty bars', () => {
    render(<UsageCard report={report({ limitsApply: false, limits: [] })} />)

    expect(screen.getByText('Plan limits do not apply to this session.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: /used$/ })).not.toBeInTheDocument()
  })

  it('draws no window section at all when a plan reported none', () => {
    render(<UsageCard report={report({ limits: [], contributing: null })} />)

    expect(screen.queryByText('Limits')).not.toBeInTheDocument()
    expect(screen.queryByText('Plan limits do not apply to this session.')).not.toBeInTheDocument()
  })

  it('shows extra usage only once it is switched on', () => {
    const { unmount } = render(<UsageCard report={report()} />)
    expect(screen.queryByText('Extra usage')).not.toBeInTheDocument()
    unmount()

    const credits = report({
      extraUsage: { monthlyLimit: 50, usedCredits: 12.5, utilization: 25 }
    })
    render(<UsageCard report={credits} />)

    expect(screen.getByRole('progressbar', { name: 'Extra usage — 25% used' })).toBeInTheDocument()
    expect(screen.getByText('12.5 of 50')).toBeInTheDocument()
  })

  // Not an invented state: the SDK types every figure on `extra_usage` as
  // nullable, so a heading with nothing under it is a shape it can send.
  it('draws extra usage with whichever half of it arrived', () => {
    const bare = report({
      extraUsage: { monthlyLimit: null, usedCredits: null, utilization: null }
    })
    render(<UsageCard report={bare} />)

    expect(screen.getByText('Extra usage')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: /Extra usage/ })).not.toBeInTheDocument()
  })

  describe('the breakdown of what is contributing', () => {
    it('starts on the day and names what the scan found', () => {
      render(<UsageCard report={report()} />)

      expect(screen.getByText('9 requests · 1 session')).toBeInTheDocument()
      expect(screen.getByRole('progressbar', { name: 'Long context — 97%' })).toBeInTheDocument()
      expect(screen.getByRole('progressbar', { name: 'core-module — 53%' })).toBeInTheDocument()
    })

    it('only names the groups that have anything in them', () => {
      render(<UsageCard report={report()} />)

      expect(screen.getByText('Skills')).toBeInTheDocument()
      expect(screen.queryByText('Agents')).not.toBeInTheDocument()
      expect(screen.queryByText('MCP servers')).not.toBeInTheDocument()
    })

    it('switches to the week when asked', async () => {
      render(<UsageCard report={report()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Last 7d' }))

      expect(screen.getByText('376 requests · 8 sessions')).toBeInTheDocument()
      expect(screen.getByRole('progressbar', { name: 'Explore — 11%' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Last 7d' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    // The vocabulary belongs to the CLI's scan, so one added upstream has to
    // appear under its own name rather than vanish from the list.
    it('shows a characteristic it has no name for under the name it came with', () => {
      const unknown = report({
        contributing: {
          day: {
            requests: 1,
            sessions: 1,
            behaviors: [{ key: 'moon_phase', pct: 40, count: 1 }],
            skills: [],
            agents: [],
            plugins: [],
            mcpServers: []
          },
          week: {
            requests: 0,
            sessions: 0,
            behaviors: [],
            skills: [],
            agents: [],
            plugins: [],
            mcpServers: []
          }
        }
      })
      render(<UsageCard report={unknown} />)

      expect(screen.getByRole('progressbar', { name: 'moon_phase — 40%' })).toBeInTheDocument()
    })

    it('carries the caveat the figures come with', () => {
      render(<UsageCard report={report()} />)

      expect(screen.getByText(/other devices and claude\.ai are not counted/)).toBeInTheDocument()
    })

    it('is absent entirely when the scan did not run', () => {
      render(<UsageCard report={report({ contributing: null })} />)

      expect(screen.queryByText('What is contributing')).not.toBeInTheDocument()
    })
  })

  // Silence under a `/usage` bubble reads as a hang.
  it('says so when the session could not answer at all', () => {
    render(<UsageCard report={null} />)

    expect(screen.getByText('This session cannot say how much has been used.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('groups the plugins and servers the scan attributed usage to', () => {
    const everything = report({
      contributing: {
        day: {
          requests: 2,
          sessions: 1,
          behaviors: [],
          skills: [],
          agents: [],
          plugins: [{ name: 'commit-commands', pct: 2 }],
          mcpServers: [{ name: 'jetbrains', pct: 1 }]
        },
        week: {
          requests: 0,
          sessions: 0,
          behaviors: [],
          skills: [],
          agents: [],
          plugins: [],
          mcpServers: []
        }
      }
    })
    render(<UsageCard report={everything} />)

    expect(screen.getByText('Plugins')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'commit-commands — 2%' })).toBeInTheDocument()
    expect(screen.getByText('MCP servers')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'jetbrains — 1%' })).toBeInTheDocument()
  })

  /*
   * Every window under its own name, which no live response can show: a Max
   * account reports the Opus, Sonnet and connected-apps windows as null, so
   * three of these six never arrive together. Two keys pointing at one string
   * would otherwise sit here passing every other test in the file.
   */
  it('has a name of its own for every window it can be given', () => {
    const every = report({
      limits: [
        {
          key: 'five_hour',
          label: null,
          utilization: 1,
          resetsAt: null,
          severity: null,
          binding: false
        },
        {
          key: 'seven_day',
          label: null,
          utilization: 2,
          resetsAt: null,
          severity: null,
          binding: false
        },
        {
          key: 'seven_day_opus',
          label: null,
          utilization: 3,
          resetsAt: null,
          severity: null,
          binding: false
        },
        {
          key: 'seven_day_sonnet',
          label: null,
          utilization: 4,
          resetsAt: null,
          severity: null,
          binding: false
        },
        {
          key: 'seven_day_oauth_apps',
          label: null,
          utilization: 5,
          resetsAt: null,
          severity: null,
          binding: false
        },
        {
          key: 'model_scoped',
          label: 'Fable',
          utilization: 6,
          resetsAt: null,
          severity: null,
          binding: false
        }
      ],
      contributing: null
    })
    render(<UsageCard report={every} />)

    const names = screen
      .getAllByRole('progressbar')
      .map((bar) => bar.getAttribute('aria-label') ?? '')

    expect(names).toEqual([
      'Current session — 1% used',
      'Current week (all models) — 2% used',
      'Current week (Opus) — 3% used',
      'Current week (Sonnet) — 4% used',
      'Current week (connected apps) — 5% used',
      'Current week (Fable) — 6% used'
    ])
  })
  /*
   * Three windows drawn at equal weight left the reader to work out which one
   * would stop the next turn. The server already knows, and says so.
   */
  it('marks the window the account says is binding', () => {
    render(
      <UsageCard
        report={report({
          limits: [
            {
              key: 'five_hour',
              label: null,
              utilization: 32,
              resetsAt: null,
              severity: null,
              binding: true
            },
            {
              key: 'seven_day',
              label: null,
              utilization: 4,
              resetsAt: null,
              severity: null,
              binding: false
            }
          ]
        })}
      />
    )

    expect(screen.getAllByText('binding now')).toHaveLength(1)
  })

  /* Marked rather than moved: an account has three of these and the reader
     learns where each sits. */
  it('leaves the windows in the order they were given', () => {
    render(
      <UsageCard
        report={report({
          limits: [
            {
              key: 'five_hour',
              label: null,
              utilization: 32,
              resetsAt: null,
              severity: null,
              binding: false
            },
            {
              key: 'seven_day',
              label: null,
              utilization: 4,
              resetsAt: null,
              severity: null,
              binding: true
            }
          ]
        })}
      />
    )

    const names = screen.getAllByText(/Current session|Current week \(all models\)/)
    expect(names.map((node) => node.textContent)).toEqual([
      'Current session',
      'Current week (all models)'
    ])
  })

  it('takes the account\u2019s word over its own thresholds', () => {
    render(
      <UsageCard
        report={report({
          limits: [
            {
              key: 'five_hour',
              label: null,
              utilization: 95,
              resetsAt: null,
              severity: 'normal',
              binding: false
            }
          ]
        })}
      />
    )

    expect(screen.getByText('95%')).toHaveClass('text-ink-faint')
  })
})
