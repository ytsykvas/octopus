import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { CardRunEntry } from '@core/boardSchema.js'
import type { WorkspaceView } from '@core/workspaces.js'

import i18n, { DEFAULT_LANGUAGE } from '../../i18n/index.js'
import { workspaceView } from '../../test/workspaces.js'
import { CardRuns } from './CardRuns.js'

const RUN: CardRunEntry = {
  started: '2026-11-21T12:00:00.000Z',
  device: 'device-one',
  machine: 'Mac-One',
  branch: 'ytsykvas/anna'
}
const ENDED = '2026-11-22T12:00:00.000Z'

function renderRuns(
  runs: readonly CardRunEntry[],
  linked: WorkspaceView | null = null
): HTMLElement {
  return render(<CardRuns runs={runs} deviceId="device-one" linked={linked} />).container
}

describe('CardRuns', () => {
  it('shows nothing for a card never run', () => {
    expect(renderRuns([])).toBeEmptyDOMElement()
  })

  it('is a region named Runs', () => {
    renderRuns([{ ...RUN, ended: ENDED }])

    expect(screen.getByRole('region', { name: 'Runs' })).toBeInTheDocument()
  })

  it('lists the newest run first, whatever order the file keeps', () => {
    renderRuns([
      { ...RUN, ended: ENDED },
      { ...RUN, started: '2026-11-22T12:00:00.000Z', ended: ENDED },
      { ...RUN, started: '2026-11-20T12:00:00.000Z', ended: ENDED }
    ])

    const [newest, , oldest] = screen.getAllByRole('listitem')
    expect(newest).toHaveTextContent('Nov 22, 2026')
    expect(oldest).toHaveTextContent('Nov 20, 2026')
  })

  it('says a run was merged and links its pull request', () => {
    const pr = 'https://github.com/o/r/pull/310'
    renderRuns([{ ...RUN, merged: ENDED, ended: ENDED, pr }])

    expect(screen.getByRole('listitem')).toHaveTextContent('Nov 21, 2026 · Mac-One · merged · #310')
    expect(screen.getByRole('link', { name: '#310' })).toHaveAttribute('href', pr)
  })

  it('names a pull request with no number by its address', () => {
    renderRuns([{ ...RUN, ended: ENDED, pr: 'https://example.com/merge/4' }])

    expect(screen.getByRole('link', { name: 'https://example.com/merge/4' })).toBeInTheDocument()
  })

  it("says a run's workspace was removed", () => {
    renderRuns([{ ...RUN, ended: ENDED }])

    expect(screen.getByRole('listitem')).toHaveTextContent(
      /^Nov 21, 2026 · Mac-One · workspace removed$/
    )
  })

  it("says another Mac's run is in work", () => {
    renderRuns([{ ...RUN, device: 'device-two', machine: 'Mac-Two' }])

    expect(screen.getByRole('listitem')).toHaveTextContent('Nov 21, 2026 · Mac-Two · in work')
  })

  it("says this Mac's run is in work while its workspace is here", () => {
    renderRuns([RUN], workspaceView('anna', { createdAt: RUN.started }))

    expect(screen.getByRole('listitem')).toHaveTextContent('· in work')
  })

  it("adds up a removed run's figures", () => {
    renderRuns([
      {
        ...RUN,
        ended: ENDED,
        turns: 14,
        activeMs: 5_340_000,
        tokensIn: 1_830_000,
        tokensOut: 92_000,
        accounts: ['a@x', 'b@x']
      }
    ])

    expect(
      screen.getByText('14 turns · 89m 0s · 1.8M in / 92k out tokens · a@x, b@x')
    ).toBeInTheDocument()
  })

  it('writes a short run in seconds', () => {
    renderRuns([
      { ...RUN, ended: ENDED, turns: 3, activeMs: 38_400, tokensIn: 1180, tokensOut: 860 }
    ])

    expect(screen.getByText('3 turns · 38s · 1.2k in / 860 out tokens')).toBeInTheDocument()
  })

  it('counts a missing figure as zero', () => {
    renderRuns([{ ...RUN, ended: ENDED, turns: 1 }])

    expect(screen.getByText('1 turn · 0s · 0 in / 0 out tokens')).toBeInTheDocument()
  })

  it('adds no accounts for an empty list', () => {
    renderRuns([{ ...RUN, ended: ENDED, turns: 1, accounts: [] }])

    expect(screen.getByText('1 turn · 0s · 0 in / 0 out tokens')).toBeInTheDocument()
  })

  it("shows no figures before the run's summary is written", () => {
    renderRuns([{ ...RUN, device: 'device-two' }])

    expect(screen.queryByText(/turns?/)).toBeNull()
  })

  describe('in another language', () => {
    // Unmounted first: switching back under a mounted list re-renders it outside act.
    afterEach(async () => {
      cleanup()
      await i18n.changeLanguage(DEFAULT_LANGUAGE)
    })

    it("counts turns in Ukrainian's forms", async () => {
      renderRuns([{ ...RUN, ended: ENDED, turns: 2, activeMs: 252_000 }])
      await act(async () => {
        await i18n.changeLanguage('uk')
      })

      expect(
        screen.getByText('2 ходи · 4хв 12с · 0 вхідних / 0 вихідних токенів')
      ).toBeInTheDocument()
    })
  })
})
