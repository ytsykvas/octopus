import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CardDetail, ColumnId } from '@core/boardSchema.js'
import { present } from '@core/present.js'
import type { QuestionAnswer } from '@core/questions.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Failure, Result } from '../../../preload/index.js'
import { isWorking, openQuestions } from '../components/board/brainstormLog.js'
import { useLatest } from './useLatest.js'

/** What the panel is for: new tasks in a column, or the new version of one card. */
export type BrainstormTarget =
  | { readonly purpose: 'tasks'; readonly column: ColumnId }
  | { readonly purpose: 'edit'; readonly card: CardDetail }

export interface Brainstorm {
  /** Never reused: the panel is keyed by it, so what it holds goes with the conversation. */
  readonly opening: number
  readonly target: BrainstormTarget
  readonly entries: readonly ChatEntry[]
  /** False until the first message started the conversation. */
  readonly started: boolean
  readonly working: boolean
  readonly answerable: ReadonlySet<string>
  /** Why the last call did not go through, until the next one does. */
  readonly failure: Failure | null
  /** False when it did not go, so the field keeps the text. */
  readonly send: (text: string) => Promise<boolean>
  readonly answer: (requestId: string, answers: readonly QuestionAnswer[]) => void
  readonly stop: () => void
}

export interface BrainstormController {
  readonly current: Brainstorm | null
  readonly open: (target: BrainstormTarget) => void
  /** Ends the conversation too: nothing of it outlives the panel. */
  readonly close: () => void
}

interface Sitting {
  /** Never reused: a start that answers after its panel closed or opened again is told apart. */
  readonly opening: number
  readonly target: BrainstormTarget
  readonly id: string | null
  /** The first message is out: a line arriving now is this sitting's, before its id is known. */
  readonly starting: boolean
  readonly entries: readonly ChatEntry[]
  readonly failure: Failure | null
}

const failureOf = (answer: Result<unknown>): Failure | null => (answer.ok ? null : answer)

/**
 * The board's brainstorm, for as long as its panel is open (`brainstorm.ts`).
 *
 * `board` is the screen's key for one project's board in one folder: another board drops the
 * sitting during render, as the screen drops its open card, and the effect below then closes the
 * session — so does unmounting, and so does `close`.
 */
export function useBrainstorm(projectId: string | null, board: string): BrainstormController {
  const [sitting, setSitting] = useState<Sitting | null>(null)
  const [shownBoard, setShownBoard] = useState(board)
  if (board !== shownBoard) {
    setShownBoard(board)
    setSitting(null)
  }
  const latest = useLatest(sitting)

  useEffect(
    () =>
      window.octopus.brainstorm.onEntry(({ brainstormId, entry }) => {
        setSitting((held) =>
          held !== null && (held.id === brainstormId || (held.id === null && held.starting))
            ? { ...held, entries: [...held.entries, entry] }
            : held
        )
      }),
    []
  )

  const openId = sitting?.id ?? null
  useEffect(() => {
    if (openId === null) return
    return () => {
      void window.octopus.brainstorm.close(openId)
    }
  }, [openId])

  const openings = useRef(0)
  // `latest` keeps the last sitting once the screen is gone, so a start that lands then is told
  // apart by this.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const open = useCallback((target: BrainstormTarget) => {
    openings.current += 1
    setSitting({
      opening: openings.current,
      target,
      id: null,
      starting: false,
      entries: [],
      failure: null
    })
  }, [])

  const close = useCallback(() => {
    setSitting(null)
  }, [])

  const report = useCallback((id: string, answer: Result<unknown>) => {
    setSitting((held) => (held?.id === id ? { ...held, failure: failureOf(answer) } : held))
  }, [])

  /** What a first message's answer leaves: a conversation, a refusal, or nothing at all. */
  const landed = useCallback(
    (opening: number, answer: Result<string>): boolean => {
      // Closed, opened again or gone with the screen while it started: the session is nobody's.
      if (!mounted.current || latest.current?.opening !== opening) {
        if (answer.ok) void window.octopus.brainstorm.close(answer.value)
        return false
      }
      // An updater, so lines heard while it started are kept; the check above leaves it open.
      setSitting((now) => ({
        ...present(now, 'the brainstorm that started'),
        starting: false,
        id: answer.ok ? answer.value : null,
        failure: failureOf(answer)
      }))
      return answer.ok
    },
    [latest]
  )

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const held = latest.current
      if (held === null || projectId === null) return false
      if (held.id !== null) {
        const answer = await window.octopus.brainstorm.send(held.id, text)
        report(held.id, answer)
        return answer.ok
      }
      setSitting({ ...held, starting: true, failure: null })
      const { target, opening } = held
      const answer =
        target.purpose === 'tasks'
          ? await window.octopus.brainstorm.start(projectId, text)
          : await window.octopus.brainstorm.startEdit(projectId, target.card.ref, text)
      return landed(opening, answer)
    },
    [latest, projectId, report, landed]
  )

  const answer = useCallback(
    (requestId: string, answers: readonly QuestionAnswer[]) => {
      const id = latest.current?.id ?? null
      if (id !== null)
        void window.octopus.brainstorm.answer(id, requestId, answers).then((done) => {
          report(id, done)
        })
    },
    [latest, report]
  )

  const stop = useCallback(() => {
    const id = latest.current?.id ?? null
    if (id !== null)
      void window.octopus.brainstorm.stop(id).then((done) => {
        report(id, done)
      })
  }, [latest, report])

  const current = useMemo<Brainstorm | null>(
    () =>
      sitting === null
        ? null
        : {
            opening: sitting.opening,
            target: sitting.target,
            entries: sitting.entries,
            started: sitting.id !== null,
            working: sitting.starting || isWorking(sitting.entries),
            answerable: openQuestions(sitting.entries),
            failure: sitting.failure,
            send,
            answer,
            stop
          },
    [sitting, send, answer, stop]
  )

  return { current, open, close }
}
