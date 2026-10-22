/**
 * The sound that goes with news from an agent.
 *
 * The default is a chime made with Web Audio, the one sound that tells the
 * kinds of news apart. The others are files, chosen in Settings → General.
 * They can be files because every one is over 4KB: Vite inlines anything
 * smaller as a `data:` URL, which the window's CSP refuses for media, and
 * emits the rest as same-origin files the CSP already allows.
 */

import type { NoticeKind } from './attention.js'
import airport from './assets/sounds/airport.mp3'
import alarmClock from './assets/sounds/alarm-clock.mp3'
import bam from './assets/sounds/bam.mp3'
import cellPhone from './assets/sounds/cell-phone.mp3'
import craw from './assets/sounds/craw.mp3'
import doorBell from './assets/sounds/door-bell.mp3'
import drum from './assets/sounds/drum.mp3'
import fairy from './assets/sounds/fairy.mp3'
import funnySound from './assets/sounds/funny-sound.mp3'
import gong from './assets/sounds/gong.mp3'
import holaPapa from './assets/sounds/hola-papa.mp3'
import japanese from './assets/sounds/japanese.mp3'
import oyoy from './assets/sounds/oyoy.mp3'
import smsIncoming from './assets/sounds/sms-incoming.mp3'
import uhOh from './assets/sounds/uh-oh.mp3'
import waterDrop from './assets/sounds/water-drop.mp3'
import whistle from './assets/sounds/whistle.mp3'
import whistleHere from './assets/sounds/whistle-here.mp3'
import wow from './assets/sounds/wow.mp3'

export const CHIME_ID = 'chime'

/**
 * The files, in the order the picker lists them.
 *
 * Written out rather than globbed so that `SoundId` is a union: each id is
 * also a key under `settings.sounds`, and a file without a name there, or a
 * name without a file, then fails the type check instead of the window.
 */
const FILES = [
  ['airport', airport],
  ['alarm-clock', alarmClock],
  ['bam', bam],
  ['cell-phone', cellPhone],
  ['craw', craw],
  ['door-bell', doorBell],
  ['drum', drum],
  ['fairy', fairy],
  ['funny-sound', funnySound],
  ['gong', gong],
  ['hola-papa', holaPapa],
  ['japanese', japanese],
  ['oyoy', oyoy],
  ['sms-incoming', smsIncoming],
  ['uh-oh', uhOh],
  ['water-drop', waterDrop],
  ['whistle', whistle],
  ['whistle-here', whistleHere],
  ['wow', wow]
] as const

export type SoundId = typeof CHIME_ID | (typeof FILES)[number][0]

/** Every sound, the chime first. */
export const SOUND_IDS: readonly SoundId[] = [CHIME_ID, ...FILES.map(([id]) => id)]

export interface Sound {
  readonly id: SoundId
  /** The file to play, or `null` for the chime. */
  readonly url: string | null
}

/**
 * The sound a stored id names, or the chime for one this build does not ship —
 * the config keeps whatever was chosen, including a sound since removed.
 */
export function soundFor(id: string): Sound {
  const file = FILES.find(([fileId]) => fileId === id)
  return file === undefined ? { id: CHIME_ID, url: null } : { id: file[0], url: file[1] }
}

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
/** The files are recorded at full level; this brings them near the chime. */
const FILE_VOLUME = 0.3
const NOTE_SECONDS = 0.25
const STEP_SECONDS = 0.12
/** How long after the last note the context is put to rest. */
export const REST_AFTER_MS = 200

/**
 * The shortest time between two chimes. Several agents finishing together, or
 * a run of permission asks, would otherwise ring as a burst.
 */
export const CHIME_GAP_MS = 1500

let lastAt = Number.NEGATIVE_INFINITY
let context: AudioContext | null = null
// One element for every file, so a new sound cuts off the last instead of
// playing over it — clicking through the previews must not pile up.
let player: HTMLAudioElement | null = null

/**
 * Plays the sound for this kind of news, unless one played a moment ago.
 *
 * Does nothing where there is no audio — the test environment — rather than
 * failing: a missing sound is never worth an error.
 */
export function chime(
  kind: NoticeKind,
  soundId: string = CHIME_ID,
  now: number = Date.now()
): void {
  if (now - lastAt < CHIME_GAP_MS) return

  lastAt = now
  play(soundFor(soundId), kind)
}

/**
 * Plays a sound because somebody asked to hear it.
 *
 * Without the gap: it is one click, and the second of two quick clicks on
 * different rows is the one being listened for.
 */
export function preview(soundId: string): void {
  play(soundFor(soundId), 'done')
}

function play(sound: Sound, kind: NoticeKind): void {
  if (sound.url === null) playTones(kind)
  else playFile(sound.url)
}

function playFile(url: string): void {
  if (typeof Audio === 'undefined') return

  player ??= new Audio()
  player.src = url
  player.volume = FILE_VOLUME
  // Refused until the window has been touched, and by a file that will not
  // decode; neither is worth more than the silence.
  player.play().catch(() => undefined)
}

/**
 * The suspension waiting for the chime to end, so a chime that comes before
 * it does not have its context taken away under it.
 */
let rest: ReturnType<typeof setTimeout> | null = null

function playTones(kind: NoticeKind): void {
  if (typeof AudioContext === 'undefined') return

  context ??= new AudioContext()
  // A context made before the window was touched can start suspended, and one
  // that has played is suspended on purpose, below. Asked unconditionally: the
  // state says `suspended` only once the suspension has settled, and a chime
  // landing in that moment would be scheduled into a context about to sleep.
  // Resuming one that runs is a no-op.
  void context.resume()
  if (rest !== null) clearTimeout(rest)

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

  // Suspended once the chime is over: a running context keeps the audio
  // thread and the device awake for as long as the window lives, after a
  // sound that lasted half a second. The next chime wakes it, above.
  const over = ((NOTES[kind].length - 1) * STEP_SECONDS + NOTE_SECONDS) * 1000
  rest = setTimeout(() => {
    rest = null
    void audio.suspend()
  }, over + REST_AFTER_MS)
}
