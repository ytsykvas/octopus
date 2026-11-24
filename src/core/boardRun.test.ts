import { describe, expect, it } from 'vitest'

import { foldRunUsage } from './boardRun.js'
import type { ChatEntry } from './transcript.js'

const A = '2026-11-21T10:00:00.000Z'
const B = '2026-11-21T10:05:00.000Z'
const C = '2026-11-21T10:10:00.000Z'

const resultOf = (
  at: string,
  durationMs: number | null,
  inputTokens: number | null,
  outputTokens: number | null,
  costUsd = 1
): ChatEntry => ({
  role: 'agent',
  at,
  event: {
    type: 'result',
    ok: true,
    costUsd,
    durationMs,
    inputTokens,
    outputTokens,
    terminalReason: null
  }
})

describe('foldRunUsage', () => {
  it('counts nothing in no transcripts', () => {
    expect(foldRunUsage([])).toEqual({ turns: 0, activeMs: 0, tokensIn: 0, tokensOut: 0 })
  })

  it('sums the turns and treats a missing figure as zero', () => {
    expect(
      foldRunUsage([
        [
          resultOf(A, 1000, 10, 20),
          resultOf(B, null, 5, null),
          resultOf(C, 500, null, 3),
          { role: 'user', at: A, text: 'go' },
          { role: 'agent', at: A, event: { type: 'text', text: 'Done.' } }
        ]
      ])
    ).toEqual({ turns: 3, activeMs: 1500, tokensIn: 15, tokensOut: 23 })
  })

  it('counts a result a fork copied only once', () => {
    expect(
      foldRunUsage([
        [resultOf(A, 1000, 10, 20)],
        [resultOf(A, 1000, 10, 20), resultOf(B, 500, 1, 2)]
      ])
    ).toEqual({ turns: 2, activeMs: 1500, tokensIn: 11, tokensOut: 22 })
  })

  it('never reads the cost', () => {
    const cheap = foldRunUsage([[resultOf(A, 1000, 10, 20)]])
    expect(foldRunUsage([[resultOf(A, 1000, 10, 20, 999)]])).toEqual(cheap)
    expect(cheap).toEqual({ turns: 1, activeMs: 1000, tokensIn: 10, tokensOut: 20 })
  })
})
