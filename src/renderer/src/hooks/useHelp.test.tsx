import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
  const create = vi.fn((beforeShown?: (id: string) => void) => {
    beforeShown?.('chat-9')
    return Promise.resolve()
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
  it('puts the setup instruction and the facts down as a new conversation’s draft', async () => {
    vi.mocked(octopus().workspaces.instruction).mockResolvedValue({ ok: true, value: 'Set up.' })
    const { ask, create, keepDraft } = open()

    act(() => {
      ask()('setupScripts')
    })

    await waitFor(() => {
      expect(keepDraft).toHaveBeenCalledOnce()
    })
    expect(octopus().workspaces.instruction).toHaveBeenCalledWith(WORKSPACE, 'setupScripts')
    expect(octopus().workspaces.helpContext).toHaveBeenCalledWith(WORKSPACE)
    expect(create).toHaveBeenCalledOnce()

    const [workspaceId, tabKey, text] = keepDraft.mock.calls[0] ?? []
    expect(workspaceId).toBe(WORKSPACE)
    expect(tabKey).toBe('chat-9')
    expect(text).toMatch(/^Set up\.\n\n— What octopus knows/)
    expect(text).toContain('/tmp/planner')
  })

  it('puts the last runs down as well when asked why Run does not work', async () => {
    const context = await octopus().workspaces.helpContext(WORKSPACE)
    if (!context.ok) throw new Error('the stub answers')
    vi.mocked(octopus().workspaces.helpContext).mockResolvedValue({
      ok: true,
      value: {
        ...context.value,
        lastRuns: [{ purpose: 'setup', outcome: { kind: 'running' }, output: 'bundling' }]
      }
    })
    const { ask, keepDraft } = open()

    act(() => {
      ask()('diagnoseRun')
    })

    await waitFor(() => {
      expect(keepDraft).toHaveBeenCalledOnce()
    })
    expect(octopus().workspaces.instruction).toHaveBeenCalledWith(WORKSPACE, 'diagnoseRun')
    expect(keepDraft.mock.calls[0]?.[2]).toContain('bundling')
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
  // it would land in the one that is.
  it('opens nothing once the workspace has changed under it', async () => {
    let answer: (value: { ok: true; value: string }) => void = () => undefined
    vi.mocked(octopus().workspaces.instruction).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    const { ask, create, report, rerender } = open()

    act(() => {
      ask()('setupScripts')
    })
    rerender({ id: 'planner/bob' })
    await act(async () => {
      answer({ ok: true, value: 'Set up.' })
      await Promise.resolve()
    })

    expect(create).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('drops a failed read once the workspace has changed under it', async () => {
    let answer: (value: { ok: false; error: string }) => void = () => undefined
    vi.mocked(octopus().workspaces.instruction).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    const { ask, report, rerender } = open()

    act(() => {
      ask()('setupScripts')
    })
    rerender({ id: 'planner/bob' })
    await act(async () => {
      answer({ ok: false, error: 'could not read it' })
      await Promise.resolve()
    })

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
    let answer: (value: { ok: true; value: string }) => void = () => undefined
    vi.mocked(octopus().workspaces.instruction).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      })
    )
    const { ask, create } = open()

    act(() => {
      ask()('setupScripts')
      ask()('setupScripts')
    })
    await act(async () => {
      answer({ ok: true, value: 'Set up.' })
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
