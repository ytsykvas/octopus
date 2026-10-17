/**
 * A short, quiet chime for news from an agent.
 *
 * Made with Web Audio rather than played from a file: Vite inlines anything
 * under 4KB as a `data:` URL, which the window's CSP refuses for media, and a
 * synthesised tone needs neither an asset nor a policy change.
 */

import type { NoticeKind } from './attention.js'

/** Notes in hertz, played one after the other. */
const NOTES: Record<NoticeKind, readonly number[]> = {
  // Rising: something is done.
  done: [660, 880],
  // One note: something is waiting.
  question: [740],
  plan: [740],
  permission: [740],
  // Falling: something went wrong.
  error: [520, 390]
}

/** Low enough to sit under whatever else is playing. */
const VOLUME = 0.05
const NOTE_SECONDS = 0.25
const STEP_SECONDS = 0.12

/**
 * The shortest time between two chimes. Several agents finishing together, or
 * a run of permission asks, would otherwise ring as a burst.
 */
export const CHIME_GAP_MS = 1500

let lastAt = Number.NEGATIVE_INFINITY
let context: AudioContext | null = null

/**
 * Plays the chime for this kind of news, unless one played a moment ago.
 *
 * Does nothing where there is no Web Audio — the test environment — rather
 * than failing: a missing sound is never worth an error.
 */
export function chime(kind: NoticeKind, now: number = Date.now()): void {
  if (now - lastAt < CHIME_GAP_MS) return
  if (typeof AudioContext === 'undefined') return

  lastAt = now
  context ??= new AudioContext()
  // A context made before the window was touched can start suspended.
  if (context.state === 'suspended') void context.resume()

  const audio = context
  const start = audio.currentTime
  NOTES[kind].forEach((frequency, index) => {
    const at = start + index * STEP_SECONDS
    const tone = audio.createOscillator()
    const envelope = audio.createGain()

    tone.type = 'sine'
    tone.frequency.value = frequency
    // A soft attack and a long fade: a click at either end is what makes a
    // notification sound harsh.
    envelope.gain.setValueAtTime(0, at)
    envelope.gain.linearRampToValueAtTime(VOLUME, at + 0.01)
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_SECONDS)

    tone.connect(envelope).connect(audio.destination)
    tone.start(at)
    tone.stop(at + NOTE_SECONDS)
  })
}
