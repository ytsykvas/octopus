import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Result } from '../../../preload/index.js'
import { held } from '../test/held.js'
import { octopus } from '../test/octopus.js'
import { useHelp } from './useHelp.js'

const WORKSPACE = 'planner/anna'

interface Shown {
  readonly id: string | null
}

/** The hook, with a `create` that hands its callback the id a real one would. */
function open(initial: Shown = { id: WORKSPACE }): {
  readonly ask: () => ReturnType<typeof useHelp>
  readonly create: ReturnType<typeof vi.fn>
  readonly keepDraft: ReturnType<typeof vi.fn>
  readonly report: ReturnType<typeof vi.fn>
  readonly rerender: (props: Shown) => void
} {
  const create = vi.fn(async (beforeShown?: (id: string) => void | Promise<void>) => {
    await beforeShown?.('chat-9')
  })
  const keepDraft = vi.fn()
  const report = vi.fn()

  const { result, rerender } = renderHook(
    ({ id }: Shown) => useHelp(id, create, keepDraft, report),
    { initialProps: initial }
  )

  return { ask: () => result.current, create, keepDraft, report, rerender }
}

describe('useHelp', () => {
  it('sends the setup instruction and the facts as a new conversation’s first message', async () => {
    vi.mocked(octopus().workspaces.instruction).mockResolvedValue({ ok: true, value: 'Set up.' })
    const { ask, create, keepDraft, report } = open()

    act(() => {
      ask()('setupScripts')
    })

    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledOnce()
    })
    expect(octopus().workspaces.instruction).toHaveBeenCalledWith(WORKSPACE, 'setupScripts')
    expect(octopus().workspaces.helpContext).toHaveBeenCalledWith(WORKSPACE)
    expect(create).toHaveBeenCalledOnce()

    const [chatId, text] = vi.mocked(octopus().chats.send).mock.calls[0] ?? []
    expect(chatId).toBe('chat-9')
    expect(text).toMatch(/^Set up\.\n\n— What octopus knows/)
    expect(text).toContain('/tmp/planner')
    expect(keepDraft).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  // The tab is drawn once `create` is done; a send still in flight then would
  // race the pane that reads the history.
  it('has sent before the conversation is shown', async () => {
    const sending = held<Result<string | null>>()
    vi.mocked(octopus().chats.send).mockReturnValue(sending.promise)
    const { ask, create } = open()

    act(() => {
      ask()('setupScripts')
    })
    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledOnce()
    })
    const shown = vi.fn()
    void (create.mock.results[0]?.value as Promise<void>).then(shown)
    await act(async () => {
      await Promise.resolve()
    })
    expect(shown).not.toHaveBeenCalled()

    await act(async () => {
      sending.resolve({ ok: true, value: null })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(shown).toHaveBeenCalledOnce()
    })
  })

  // Lost text would have to be asked for again; in the composer it is one press.
  it.each<[string, () => void, string]>([
    [
      'refused',
      () => {
        vi.mocked(octopus().chats.send).mockResolvedValue({ ok: false, error: 'agent is busy' })
      },
      'Something went wrong: agent is busy'
    ],
    [
      'rejected',
      () => {
        vi.mocked(octopus().chats.send).mockRejectedValue(new Error('main is gone'))
      },
      'Error: main is gone'
    ]
  ])('puts a message whose send was %s in the composer, and says so', async (_, fail, reason) => {
    vi.mocked(octopus().workspaces.instruction).mockResolvedValue({ ok: true, value: 'Set up.' })
    fail()
    const { ask, create, keepDraft, report } = open()

    act(() => {
      ask()('setupScripts')
    })

    await waitFor(() => {
      expect(keepDraft).toHaveBeenCalledOnce()
    })
    const [workspaceId, tabKey, text] = keepDraft.mock.calls[0] ?? []
    expect(workspaceId).toBe(WORKSPACE)
    expect(tabKey).toBe('chat-9')
    expect(text).toMatch(/^Set up\./)
    expect(report).toHaveBeenCalledExactlyOnceWith(
      `Help could not send its message, so it is waiting in the composer: ${reason}`
    )
    // Caught inside, so `create` goes on to show the conversation that exists.
    await expect(create.mock.results[0]?.value as Promise<void>).resolves.toBeUndefined()
  })

  it('sends the last runs as well when asked why Run does not work', async () => {
    const context = await octopus().workspaces.helpContext(WORKSPACE)
    if (!context.ok) throw new Error('the stub answers')
    vi.mocked(octopus().workspaces.helpContext).mockResolvedValue({
      ok: true,
      value: {
        ...context.value,
        lastRuns: [{ purpose: 'setup', outcome: { kind: 'running' }, output: 'bundling' }]
      }
    })
    const { ask } = open()

    act(() => {
      ask()('diagnoseRun')
    })

    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalledOnce()
    })
    expect(octopus().workspaces.instruction).toHaveBeenCalledWith(WORKSPACE, 'diagnoseRun')
    expect(vi.mocked(octopus().chats.send).mock.calls[0]?.[1]).toContain('bundling')
  })

  it.each([
    ['the instruction', () => vi.mocked(octopus().workspaces.instruction)],
    ['the facts', () => vi.mocked(octopus().workspaces.helpContext)]
  ])('reports %s that could not be read, and opens nothing', async (_, read) => {
    read().mockResolvedValue({ ok: false, error: 'could not read it' } as never)
    const { ask, create, report } = open()

    act(() => {
      ask()('diagnoseRun')
    })

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(expect.stringContaining('could not read it'))
    })
    expect(create).not.toHaveBeenCalled()
  })

  // The answer is about a workspace no longer on screen, and a tab opened for
  // it — or a failure said — would land in the one that is.
  it.each<[string, Result<string>]>([
    ['an answer', { ok: true, value: 'Set up.' }],
    ['a failed read', { ok: false, error: 'could not read it' }]
  ])('drops %s once the workspace has changed under it', async (_, answer) => {
    const reading = held<Result<string>>()
    vi.mocked(octopus().workspaces.instruction).mockReturnValue(reading.promise)
    const { ask, create, report, rerender } = open()

    act(() => {
      ask()('setupScripts')
    })
    rerender({ id: 'planner/bob' })
    await act(async () => {
      reading.resolve(answer)
      await Promise.resolve()
    })

    expect(create).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  // Main gone, or a channel an older build has not got: the invoke rejects.
  it('says why when a read is rejected, and opens nothing', async () => {
    vi.mocked(octopus().workspaces.helpContext).mockRejectedValue(
      new Error("No handler registered for 'workspaces:helpContext'")
    )
    const { ask, create, report } = open()

    act(() => {
      ask()('diagnoseRun')
    })

    await waitFor(() => {
      expect(report).toHaveBeenCalledWith(
        "Help could not read this workspace: Error: No handler registered for 'workspaces:helpContext'"
      )
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('opens one conversation for a second press while the first is reading, and more after', async () => {
    const reading = held<Result<string>>()
    vi.mocked(octopus().workspaces.instruction).mockReturnValueOnce(reading.promise)
    const { ask, create } = open()

    act(() => {
      ask()('setupScripts')
      ask()('setupScripts')
    })
    await act(async () => {
      reading.resolve({ ok: true, value: 'Set up.' })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(create).toHaveBeenCalledOnce()
    })

    act(() => {
      ask()('setupScripts')
    })
    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(2)
    })
  })
})
