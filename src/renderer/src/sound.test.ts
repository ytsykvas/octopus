import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Sound from './sound.js'

/** A Web Audio context that records the tones asked of it. */
class FakeContext {
  static made: FakeContext[] = []
  state: 'running' | 'suspended' = 'running'
  readonly currentTime = 0
  readonly destination = {}
  readonly tones: number[] = []
  readonly resume = vi.fn(() => {
    this.state = 'running'
    return Promise.resolve()
  })
  readonly suspend = vi.fn(() => {
    this.state = 'suspended'
    return Promise.resolve()
  })

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

/** An audio element that records what it was asked to play. */
class FakeAudio {
  static made: FakeAudio[] = []
  static refuse = false
  src = ''
  volume = 1
  readonly played: string[] = []

  constructor() {
    FakeAudio.made.push(this)
  }

  play(): Promise<void> {
    this.played.push(this.src)
    return FakeAudio.refuse ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve()
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
  FakeAudio.made = []
  FakeAudio.refuse = false
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('Audio', FakeAudio)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('chime', () => {
  it('rises for a finished turn, falls for an error and holds one note for a wait', async () => {
    const { chime, CHIME_GAP_MS } = await load()

    chime('done', 'chime', 0)
    chime('error', 'chime', CHIME_GAP_MS)
    chime('permission', 'chime', CHIME_GAP_MS * 2)

    expect(FakeContext.made).toHaveLength(1)
    expect(FakeContext.made[0]?.tones).toEqual([660, 880, 520, 390, 740])
  })

  // Several agents finishing at once would otherwise ring as a burst.
  it('plays once for a burst and again after the gap', async () => {
    const { chime, CHIME_GAP_MS } = await load()

    chime('done', 'chime', 1000)
    chime('done', 'chime', 1000 + CHIME_GAP_MS - 1)
    expect(FakeContext.made[0]?.tones).toHaveLength(2)

    chime('done', 'chime', 1000 + CHIME_GAP_MS)
    expect(FakeContext.made[0]?.tones).toHaveLength(4)
  })

  // Asked on every chime rather than when the state says so: the state says
  // `suspended` only once a suspension has settled.
  it('asks the context to run on every chime, so one that was suspended wakes', async () => {
    const { chime } = await load()
    chime('done', 'chime', 0)
    const context = FakeContext.made[0]
    if (!context) throw new Error('no context was made')

    context.state = 'suspended'
    chime('done', 'chime', 10_000)

    expect(context.resume).toHaveBeenCalledTimes(2)
  })

  /*
   * A running context keeps the audio thread and the device awake for as long
   * as the window lives, after a sound that lasted half a second.
   */
  it('puts the context to rest once the chime is over, unless another comes first', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { chime, CHIME_GAP_MS, REST_AFTER_MS } = await load()
      chime('done', 'chime', 0)
      const context = FakeContext.made[0]
      if (!context) throw new Error('no context was made')

      // Another chime while the first is still sounding: the rest is put off.
      vi.advanceTimersByTime(300)
      chime('done', 'chime', CHIME_GAP_MS)
      vi.advanceTimersByTime(300)
      expect(context.suspend).not.toHaveBeenCalled()

      vi.advanceTimersByTime(REST_AFTER_MS + 300)
      expect(context.suspend).toHaveBeenCalledOnce()

      // And the next chime wakes it.
      chime('done', 'chime', CHIME_GAP_MS * 2)
      expect(context.state).toBe('running')
    } finally {
      vi.useRealTimers()
    }
  })

  // A missing sound is never worth an error.
  it('does nothing where there is no Web Audio', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('AudioContext', undefined)
    const { chime } = await load()

    expect(() => {
      chime('done', 'chime', 0)
    }).not.toThrow()
  })

  it('reads the clock and the chime itself when not handed them', async () => {
    const { chime } = await load()

    chime('question')

    expect(FakeContext.made[0]?.tones).toEqual([740])
  })

  it('plays the chosen file, the same for every kind, and quieter than recorded', async () => {
    const { chime, soundFor, CHIME_GAP_MS } = await load()
    const gong = soundFor('gong').url

    chime('done', 'gong', 0)
    chime('error', 'gong', CHIME_GAP_MS)

    expect(FakeContext.made).toHaveLength(0)
    expect(FakeAudio.made).toHaveLength(1)
    expect(FakeAudio.made[0]?.played).toEqual([gong, gong])
    expect(FakeAudio.made[0]?.volume).toBeLessThan(1)
  })

  // Several agents finishing at once ring once, whatever the sound.
  it('keeps the gap for a file too', async () => {
    const { chime, CHIME_GAP_MS } = await load()

    chime('done', 'gong', 0)
    chime('done', 'gong', CHIME_GAP_MS - 1)

    expect(FakeAudio.made[0]?.played).toHaveLength(1)
  })

  // A sound removed from a later build is still named in an older config.
  it('plays the chime for a sound this build does not ship', async () => {
    const { chime } = await load()

    chime('done', 'kazoo', 0)

    expect(FakeAudio.made).toHaveLength(0)
    expect(FakeContext.made[0]?.tones).toEqual([660, 880])
  })

  it('swallows a file the window refuses to play', async () => {
    FakeAudio.refuse = true
    const { chime } = await load()

    expect(() => {
      chime('done', 'gong', 0)
    }).not.toThrow()
    await Promise.resolve()
  })

  it('does nothing for a file where there is no audio element', async () => {
    vi.stubGlobal('Audio', undefined)
    const { chime } = await load()

    expect(() => {
      chime('done', 'gong', 0)
    }).not.toThrow()
  })
})

describe('preview', () => {
  // The second of two quick clicks is the one being listened for.
  it('plays at once, inside the gap, and cuts off the sound before it', async () => {
    const { chime, preview, soundFor } = await load()

    chime('done', 'gong', 0)
    preview('wow')
    preview('drum')

    expect(FakeAudio.made).toHaveLength(1)
    expect(FakeAudio.made[0]?.played).toEqual([
      soundFor('gong').url,
      soundFor('wow').url,
      soundFor('drum').url
    ])
  })

  it('plays the chime as it sounds for a finished turn', async () => {
    const { preview } = await load()

    preview('chime')

    expect(FakeContext.made[0]?.tones).toEqual([660, 880])
  })
})

describe('the catalogue', () => {
  it('lists the chime first and every file once', async () => {
    const { SOUND_IDS, CHIME_ID, soundFor } = await load()

    expect(SOUND_IDS[0]).toBe(CHIME_ID)
    expect(new Set(SOUND_IDS).size).toBe(SOUND_IDS.length)
    for (const id of SOUND_IDS.slice(1))
      expect(soundFor(id)).toMatchObject({ id, url: expect.any(String) })
  })
})
