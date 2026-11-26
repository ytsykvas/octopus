import { act, renderHook, type RenderHookResult } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BrainstormEntry } from '@core/brainstorm.js'
import type { ChatEntry } from '@core/transcript.js'

import type { Result } from '../../../preload/index.js'
import { cardDetail, refusal } from '../test/board.js'
import { held } from '../test/held.js'
import { BRAINSTORM_ID, octopus } from '../test/octopus.js'
import { type BrainstormController, type BrainstormTarget, useBrainstorm } from './useBrainstorm.js'

const AT = '2026-11-26T10:00:00.000Z'
const TASKS: BrainstormTarget = { purpose: 'tasks', column: 'backlog' }
const line = (text: string): ChatEntry => ({ role: 'user', at: AT, text })

function renderBrainstorm(
  projectId: string | null = 'planner'
): RenderHookResult<BrainstormController, { board: string }> {
  return renderHook(({ board }: { board: string }) => useBrainstorm(projectId, board), {
    initialProps: { board: 'planner\n/board' }
  })
}

/** What main pushes: the hook's own subscription, as the bridge would call it. */
function hear(entry: BrainstormEntry): void {
  const handler = vi.mocked(octopus().brainstorm.onEntry).mock.calls[0]?.[0]
  if (handler === undefined) throw new Error('nothing listens')
  act(() => {
    handler(entry)
  })
}

describe('useBrainstorm', () => {
  it('opens on nothing started, and starts with the first message', async () => {
    const { result } = renderBrainstorm()

    act(() => {
      result.current.open(TASKS)
    })
    expect(result.current.current).toMatchObject({ target: TASKS, started: false, entries: [] })

    const sent = await act(
      () => result.current.current?.send('Export the board') ?? Promise.resolve(false)
    )

    expect(sent).toBe(true)
    expect(octopus().brainstorm.start).toHaveBeenCalledWith('planner', 'Export the board')
    expect(result.current.current?.started).toBe(true)
  })

  it('keeps the lines that arrive while it starts, and only its own after', async () => {
    const starting = held<Result<string>>()
    vi.mocked(octopus().brainstorm.start).mockReturnValueOnce(starting.promise)
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })

    let sent: Promise<boolean> = Promise.resolve(false)
    act(() => {
      sent = result.current.current?.send('Plan') ?? sent
    })
    expect(result.current.current?.working).toBe(true)
    hear({ brainstormId: BRAINSTORM_ID, entry: line('Plan') })
    await act(async () => {
      starting.resolve({ ok: true, value: BRAINSTORM_ID })
      await sent
    })
    hear({ brainstormId: 'another', entry: line('Not ours') })

    expect(result.current.current?.entries).toEqual([line('Plan')])
  })

  it('starts an edit of the card it was opened on', async () => {
    const card = cardDetail({ ref: 'backlog/Export.md' })
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open({ purpose: 'edit', card })
    })

    await act(() => result.current.current?.send('Sharper') ?? Promise.resolve(false))

    expect(octopus().brainstorm.startEdit).toHaveBeenCalledWith(
      'planner',
      'backlog/Export.md',
      'Sharper'
    )
  })

  it('sends every later message to the same conversation', async () => {
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    await act(() => result.current.current?.send('Plan') ?? Promise.resolve(false))

    await act(() => result.current.current?.send('More') ?? Promise.resolve(false))

    expect(octopus().brainstorm.start).toHaveBeenCalledTimes(1)
    expect(octopus().brainstorm.send).toHaveBeenCalledWith(BRAINSTORM_ID, 'More')
  })

  it('keeps why a start or a message did not go, until one does', async () => {
    vi.mocked(octopus().brainstorm.start).mockResolvedValueOnce(refusal('boardFolderUnset'))
    vi.mocked(octopus().brainstorm.send).mockResolvedValueOnce(refusal('brainstormGone'))
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })

    expect(await act(() => result.current.current?.send('Plan') ?? Promise.resolve(true))).toBe(
      false
    )
    expect(result.current.current).toMatchObject({
      started: false,
      working: false,
      failure: { code: 'boardFolderUnset' }
    })

    await act(() => result.current.current?.send('Plan') ?? Promise.resolve(false))
    expect(result.current.current?.failure).toBeNull()
    expect(await act(() => result.current.current?.send('More') ?? Promise.resolve(true))).toBe(
      false
    )
    expect(result.current.current?.failure).toMatchObject({ code: 'brainstormGone' })
  })

  it('answers, stops, and reports a refusal of either', async () => {
    vi.mocked(octopus().brainstorm.stop).mockResolvedValueOnce(refusal('brainstormGone'))
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    await act(() => result.current.current?.send('Plan') ?? Promise.resolve(false))
    const answers = [{ question: 'Which?', selected: ['A'], other: null }]

    await act(async () => {
      result.current.current?.answer('r1', answers)
      result.current.current?.stop()
      await Promise.resolve()
    })

    expect(octopus().brainstorm.answer).toHaveBeenCalledWith(BRAINSTORM_ID, 'r1', answers)
    expect(octopus().brainstorm.stop).toHaveBeenCalledWith(BRAINSTORM_ID)
    expect(result.current.current?.failure).toMatchObject({ code: 'brainstormGone' })
  })

  it('drops a refusal that answers after its panel closed', async () => {
    const stopping = held<Result<void>>()
    vi.mocked(octopus().brainstorm.stop).mockReturnValueOnce(stopping.promise)
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    await act(() => result.current.current?.send('Plan') ?? Promise.resolve(false))

    act(() => {
      result.current.current?.stop()
      result.current.close()
    })
    await act(async () => {
      stopping.resolve(refusal('brainstormGone'))
      await stopping.promise
    })

    expect(result.current.current).toBeNull()
  })

  it('answers and stops nothing before it started', () => {
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })

    result.current.current?.answer('r1', [])
    result.current.current?.stop()

    expect(octopus().brainstorm.answer).not.toHaveBeenCalled()
    expect(octopus().brainstorm.stop).not.toHaveBeenCalled()
  })

  it('draws the questions still open from its lines', async () => {
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    await act(() => result.current.current?.send('Plan') ?? Promise.resolve(false))

    hear({
      brainstormId: BRAINSTORM_ID,
      entry: {
        role: 'agent',
        at: AT,
        event: {
          type: 'permission_request',
          requestId: 'r1',
          toolName: 'AskUserQuestion',
          input: {}
        }
      }
    })

    expect([...(result.current.current?.answerable ?? [])]).toEqual(['r1'])
  })

  it('ends the conversation when closed', async () => {
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    await act(() => result.current.current?.send('Plan') ?? Promise.resolve(false))

    act(() => {
      result.current.close()
    })

    expect(result.current.current).toBeNull()
    expect(octopus().brainstorm.close).toHaveBeenCalledWith(BRAINSTORM_ID)
  })

  it('ends a conversation that started after its panel closed', async () => {
    const starting = held<Result<string>>()
    vi.mocked(octopus().brainstorm.start).mockReturnValueOnce(starting.promise)
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    let sent: Promise<boolean> = Promise.resolve(true)
    act(() => {
      sent = result.current.current?.send('Plan') ?? sent
    })

    act(() => {
      result.current.close()
    })
    await act(async () => {
      starting.resolve({ ok: true, value: BRAINSTORM_ID })
      expect(await sent).toBe(false)
    })

    expect(result.current.current).toBeNull()
    expect(octopus().brainstorm.close).toHaveBeenCalledWith(BRAINSTORM_ID)
  })

  it('ends a conversation that started after the screen went', async () => {
    const starting = held<Result<string>>()
    vi.mocked(octopus().brainstorm.start).mockReturnValueOnce(starting.promise)
    const { result, unmount } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    const sent = result.current.current?.send('Plan') ?? Promise.resolve(true)

    unmount()
    starting.resolve({ ok: true, value: BRAINSTORM_ID })

    expect(await sent).toBe(false)
    expect(octopus().brainstorm.close).toHaveBeenCalledWith(BRAINSTORM_ID)
  })

  it('closes nothing when a start the panel left was refused anyway', async () => {
    const starting = held<Result<string>>()
    vi.mocked(octopus().brainstorm.start).mockReturnValueOnce(starting.promise)
    const { result } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    let sent: Promise<boolean> = Promise.resolve(true)
    act(() => {
      sent = result.current.current?.send('Plan') ?? sent
    })

    act(() => {
      result.current.open(TASKS)
    })
    await act(async () => {
      starting.resolve(refusal('boardFolderUnset'))
      await sent
    })

    expect(octopus().brainstorm.close).not.toHaveBeenCalled()
    expect(result.current.current).toMatchObject({ started: false, failure: null })
  })

  it('ends with its board, and with the screen', async () => {
    const { result, rerender, unmount } = renderBrainstorm()
    act(() => {
      result.current.open(TASKS)
    })
    await act(() => result.current.current?.send('Plan') ?? Promise.resolve(false))

    rerender({ board: 'esl\n/board' })

    expect(result.current.current).toBeNull()
    expect(octopus().brainstorm.close).toHaveBeenCalledWith(BRAINSTORM_ID)

    vi.mocked(octopus().brainstorm.start).mockResolvedValueOnce({ ok: true, value: 'second' })
    act(() => {
      result.current.open(TASKS)
    })
    await act(() => result.current.current?.send('Plan') ?? Promise.resolve(false))
    unmount()

    expect(octopus().brainstorm.close).toHaveBeenLastCalledWith('second')
  })

  it('sends nothing without a project', async () => {
    const { result } = renderBrainstorm(null)
    act(() => {
      result.current.open(TASKS)
    })

    expect(await act(() => result.current.current?.send('Plan') ?? Promise.resolve(true))).toBe(
      false
    )
    expect(octopus().brainstorm.start).not.toHaveBeenCalled()
  })

  it('sends nothing while closed', async () => {
    const { result } = renderBrainstorm()
    const send = await act(async () => {
      result.current.open(TASKS)
      return Promise.resolve(result.current)
    })

    act(() => {
      result.current.close()
    })

    expect(await act(() => send.current?.send('Plan') ?? Promise.resolve(false))).toBe(false)
  })
})
