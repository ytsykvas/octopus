import { describe, expect, it } from 'vitest'

import type { AgentModel } from '@core/chats.js'

import { modelRows } from './modelRows.js'

/**
 * A live catalogue, copied from one the CLI actually sent.
 *
 * It keeps `Default (recommended)` on purpose: every assertion below that the
 * words never reach the screen is only worth something because they arrive.
 */
const CATALOGUE: AgentModel[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: '',
    supportedEffortLevels: null,
    supportsEffort: null
  },
  {
    value: 'opus[1m]',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Opus (1M context)',
    description: 'The most capable one',
    supportedEffortLevels: null,
    supportsEffort: null
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5',
    displayName: 'Sonnet',
    description: 'Fast',
    supportedEffortLevels: null,
    supportsEffort: null
  }
]

const LABELS = { fallback: 'Default model', note: 'by default' }

describe('the rows the model picker offers', () => {
  it('names the default row after the model it runs, and says that is what it is', () => {
    const [head] = modelRows(CATALOGUE, LABELS, null)

    expect(head.value).toBe('default')
    expect(head.displayName).toBe('Opus (1M context)')
    expect(head.description).toBe('by default')
  })

  it('never shows the name the catalogue gives that row', () => {
    const names = modelRows(CATALOGUE, LABELS, null).map((row) => row.displayName)

    expect(names).not.toContain('Default (recommended)')
  })

  // The whole point of folding: `default` and `opus[1m]` are one model, and two
  // rows under one name is a menu that cannot be chosen from.
  it('draws the model behind the default only once', () => {
    const names = modelRows(CATALOGUE, LABELS, null).map((row) => row.displayName)

    expect(names).toEqual(['Opus (1M context)', 'Sonnet'])
  })

  it('leaves every other row as the catalogue described it', () => {
    const rows = modelRows(CATALOGUE, LABELS, null)

    expect(rows[1]).toEqual(CATALOGUE[2])
  })

  /*
   * A first run, before any session has reported a catalogue. The row still has
   * to exist — a chat that chose nothing has to be able to say so — but there
   * is no model name to put on it.
   */
  it('offers the default alone, unnamed, when no catalogue has arrived', () => {
    const rows = modelRows([], LABELS, null)

    expect(rows).toHaveLength(1)
    expect(rows[0].displayName).toBe('Default model')
  })

  // "Default model / by default" would say the same thing twice, and neither
  // time usefully.
  it('drops the note when it has no real name to put above it', () => {
    expect(modelRows([], LABELS, null)[0].description).toBe('')
  })

  it('keeps what the default row said about effort even when it cannot be named', () => {
    const lonely: AgentModel[] = [
      {
        value: 'default',
        resolvedModel: null,
        displayName: 'Default (recommended)',
        description: '',
        supportedEffortLevels: ['low', 'high'],
        supportsEffort: true
      }
    ]

    const [head] = modelRows(lonely, LABELS, null)

    expect(head.displayName).toBe('Default model')
    expect(head.supportedEffortLevels).toEqual(['low', 'high'])
  })

  /*
   * Two rows reading alike, on purpose. This chat pinned `opus[1m]` back when
   * the picker offered it, and folding it away would leave the interface unable
   * to name the model the chat is actually on.
   */
  it('keeps the folded row when this chat is the one that pinned it', () => {
    const names = modelRows(CATALOGUE, LABELS, 'opus[1m]').map((row) => row.displayName)

    expect(names).toEqual(['Opus (1M context)', 'Opus (1M context)', 'Sonnet'])
  })

  it('offers a model the catalogue has forgotten as itself', () => {
    const names = modelRows(CATALOGUE, LABELS, 'claude-retired-3').map((row) => row.displayName)

    expect(names).toEqual(['Opus (1M context)', 'Sonnet', 'claude-retired-3'])
  })

  // The full name the default already stands for is not a forgotten model, and
  // adding a row for it would draw the same thing twice for no reason.
  it('adds nothing for a pinned name the default itself answers to', () => {
    const rows = modelRows(CATALOGUE, LABELS, 'claude-opus-5[1m]')

    expect(rows.map((row) => row.displayName)).toEqual(['Opus (1M context)', 'Sonnet'])
  })

  it('adds nothing when this chat pinned nothing', () => {
    expect(modelRows(CATALOGUE, LABELS, null)).toHaveLength(2)
  })

  /*
   * The shape the CLI in hand actually sends: nothing resolves, and the only
   * link between the default row and the model it runs is the description they
   * share. The folding has to work the same way through it.
   */
  it('folds by description when the catalogue resolves nothing', () => {
    const asSent: AgentModel[] = [
      {
        value: 'default',
        resolvedModel: null,
        displayName: 'Default (recommended)',
        description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
        supportedEffortLevels: null,
        supportsEffort: true
      },
      {
        value: 'opus[1m]',
        resolvedModel: null,
        displayName: 'Opus (1M context)',
        description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
        supportedEffortLevels: null,
        supportsEffort: true
      },
      {
        value: 'haiku',
        resolvedModel: null,
        displayName: 'Haiku',
        description: 'Haiku 4.5 · Fastest for quick answers',
        supportedEffortLevels: null,
        supportsEffort: null
      }
    ]

    const rows = modelRows(asSent, LABELS, null)

    expect(rows.map((row) => row.displayName)).toEqual(['Opus (1M context)', 'Haiku'])
    expect(rows[0].description).toBe('by default')
  })
})
