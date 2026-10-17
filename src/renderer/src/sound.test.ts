import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Sound from './sound.js'

/** A Web Audio context that records the tones asked of it. */
class FakeContext {
  static made: FakeContext[] = []
  state: 'running' | 'suspended' = 'running'
  readonly currentTime = 0
  readonly destination = {}
  readonly tones: number[] = []
  readonly resume = vi.fn(() => Promise.resolve())

  constructor() {
    FakeContext.made.push(this)
  }

  createOscillator(): unknown {
    const tone = {
      type: '',
      frequency: { value: 0 },
      connect: (next: unknown) => next,
      start: () => {
        this.tones.push(tone.frequency.value)
      },
      stop: vi.fn()
    }
    return tone
  }

  createGain(): unknown {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: (next: unknown) => next
    }
  }
}

// The module keeps its context and the time of its last chime, so each test
// takes a fresh copy of it.
async function load(): Promise<typeof Sound> {
  vi.resetModules()
  return import('./sound.js')
}

beforeEach(() => {
  FakeContext.made = []
  vi.stubGlobal('AudioContext', FakeContext)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chime', () => {
  it('rises for a finished turn, falls for an error and holds one note for a wait', async () => {
    const { chime, CHIME_GAP_MS } = await load()

    chime('done', 0)
    chime('error', CHIME_GAP_MS)
    chime('permission', CHIME_GAP_MS * 2)

    expect(FakeContext.made).toHaveLength(1)
    expect(FakeContext.made[0]?.tones).toEqual([660, 880, 520, 390, 740])
  })

  // Several agents finishing at once would otherwise ring as a burst.
  it('plays once for a burst and again after the gap', async () => {
    const { chime, CHIME_GAP_MS } = await load()

    chime('done', 1000)
    chime('done', 1000 + CHIME_GAP_MS - 1)
    expect(FakeContext.made[0]?.tones).toHaveLength(2)

    chime('done', 1000 + CHIME_GAP_MS)
    expect(FakeContext.made[0]?.tones).toHaveLength(4)
  })

  it('wakes a context that started suspended', async () => {
    const { chime } = await load()
    chime('done', 0)
    const context = FakeContext.made[0]
    if (!context) throw new Error('no context was made')

    context.state = 'suspended'
    chime('done', 10_000)

    expect(context.resume).toHaveBeenCalledOnce()
  })

  // A missing sound is never worth an error.
  it('does nothing where there is no Web Audio', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('AudioContext', undefined)
    const { chime } = await load()

    expect(() => {
      chime('done', 0)
    }).not.toThrow()
  })

  it('reads the clock itself when not handed one', async () => {
    const { chime } = await load()

    chime('question')

    expect(FakeContext.made[0]?.tones).toEqual([740])
  })
})
