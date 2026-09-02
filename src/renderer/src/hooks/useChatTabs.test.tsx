import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Chat } from '@core/chats.js'

import type { ConfirmRequest, ConfirmResult } from './useConfirm.js'
import { chat, emitChatStatus, givenChats } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { type ChatTab, useChatTabs } from './useChatTabs.js'

const WORKSPACE = 'planner/anna'

const agreed = (): Promise<ConfirmResult> => Promise.resolve({ confirmed: true, checked: false })
const refused = (): Promise<ConfirmResult> => Promise.resolve({ confirmed: false, checked: false })

interface Options {
  readonly confirm?: (request: ConfirmRequest) => Promise<ConfirmResult>
  readonly onChats?: (workspaceId: string, tabs: readonly ChatTab[]) => void
  readonly onError?: (message: string | null) => void
}

interface Shown {
  readonly id: string | null
}

function open(
  options: Options = {}
): ReturnType<typeof renderHook<ReturnType<typeof useChatTabs>, Shown>> {
  const initialProps: Shown = { id: WORKSPACE }

  return renderHook(
    ({ id }: Shown) =>
      useChatTabs(
        id,
        options.confirm ?? agreed,
        options.onChats ?? vi.fn(),
        options.onError ?? vi.fn()
      ),
    { initialProps }
  )
}

describe('a workspace nobody has spoken to', () => {
  it('shows one tab, with no record behind it', async () => {
    const { result } = open()

    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalledWith(WORKSPACE)
    })
    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]?.id).toBeNull()
    expect(result.current.activeKey).toBe(result.current.tabs[0]?.key)
  })

  it('asks for nothing at all without a workspace', () => {
    renderHook(() => useChatTabs(null, agreed, vi.fn(), vi.fn()))

    expect(octopus().chats.list).not.toHaveBeenCalled()
  })

  it('says so when the conversations cannot be read', async () => {
    const onError = vi.fn()
    vi.mocked(octopus().chats.list).mockResolvedValue({ ok: false, error: 'state is corrupt' })

    open({ onError })

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('state is corrupt'))
    })
  })
})

describe('the conversations a workspace already has', () => {
  it('draws one tab each, in the order they were opened', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open()

    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })
    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['chat-1', 'chat-2'])
  })

  it('hands the list up so the workspace row can draw it', async () => {
    const onChats = vi.fn()
    givenChats([chat()])
    open({ onChats })

    await waitFor(() => {
      expect(onChats).toHaveBeenCalledWith(WORKSPACE, [expect.objectContaining({ id: 'chat-1' })])
    })
  })

  it('starts again when the workspace changes', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result, rerender } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    vi.mocked(octopus().chats.list).mockResolvedValue({ ok: true, value: [] })
    rerender({ id: 'planner/bob' })

    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.tabs[0]?.id).toBeNull()
  })
})

describe('opening another conversation', () => {
  /*
   * The order is the contract, not a detail. A virtual tab has no id, so it can
   * be neither drawn with a status nor told apart from a second tab nobody has
   * written to yet — and since the array's order is what numbers the tabs,
   * creating the second first would put the older conversation second.
   */
  it('materialises the first conversation before adding a second', async () => {
    const calls: string[] = []
    vi.mocked(octopus().chats.open).mockImplementation(() => {
      calls.push('open')
      return Promise.resolve({ ok: true, value: chat() })
    })
    vi.mocked(octopus().chats.create).mockImplementation(() => {
      calls.push('create')
      return Promise.resolve({ ok: true, value: chat({ id: 'chat-2' }) })
    })
    vi.mocked(octopus().chats.list).mockResolvedValue({
      ok: true,
      value: [chat(), chat({ id: 'chat-2' })]
    })

    const { result } = open()
    await act(async () => {
      await result.current.create()
    })

    expect(calls).toEqual(['open', 'create'])
    expect(result.current.tabs).toHaveLength(2)
  })

  it('adds to a workspace that already has one, without opening again', async () => {
    givenChats([chat()])
    vi.mocked(octopus().chats.create).mockResolvedValue({
      ok: true,
      value: chat({ id: 'chat-2' })
    })
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    vi.mocked(octopus().chats.list).mockResolvedValue({
      ok: true,
      value: [chat(), chat({ id: 'chat-2' })]
    })
    await act(async () => {
      await result.current.create()
    })

    expect(octopus().chats.open).not.toHaveBeenCalled()
    expect(result.current.activeKey).toBe('chat-2')
  })

  it('stops offering at the cap', async () => {
    givenChats([chat(), chat({ id: 'chat-2' }), chat({ id: 'chat-3' })])
    const { result } = open()

    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(3)
    })
    expect(result.current.canCreate).toBe(false)
  })

  it('says so when the first conversation cannot be written', async () => {
    const onError = vi.fn()
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: false, error: 'disk is full' })
    const { result } = open({ onError })

    await act(async () => {
      await result.current.create()
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('disk is full'))
    expect(octopus().chats.create).not.toHaveBeenCalled()
  })

  it('says so when the core refuses another', async () => {
    const onError = vi.fn()
    givenChats([chat()])
    vi.mocked(octopus().chats.create).mockResolvedValue({ ok: false, error: 'too many' })
    const { result } = open({ onError })
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    await act(async () => {
      await result.current.create()
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('too many'))
  })
})

describe('the key a tab keeps', () => {
  /*
   * The sharpest trap in the strip. The obvious key is the chat id, which moves
   * on the first message of every new workspace — and the pane, which is keyed
   * by it, remounts in the middle of the turn that created the record.
   */
  it('does not change when the first tab’s record appears', async () => {
    const { result } = open()
    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalled()
    })
    const before = result.current.tabs[0]?.key

    act(() => {
      result.current.bind(before ?? '', chat())
    })

    expect(result.current.tabs[0]?.key).toBe(before)
    expect(result.current.tabs[0]?.id).toBe('chat-1')
  })

  // Only the tab it names. The strip holds up to three, and binding one must
  // leave the others exactly as they were.
  it('leaves the other tabs alone', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    act(() => {
      result.current.bind(result.current.tabs[0]?.key ?? '', chat({ sessionId: 'sess-1' }))
    })

    expect(result.current.tabs[0]?.started).toBe(true)
    expect(result.current.tabs[1]?.id).toBe('chat-2')
  })

  // The same, one step later: the list is read again after a tab is opened or
  // closed, and rebuilding it from the core would move every key.
  it('survives the list being read again', async () => {
    const { result } = open()
    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalled()
    })
    const before = result.current.tabs[0]?.key

    act(() => {
      result.current.bind(before ?? '', chat())
    })

    givenChats([chat(), chat({ id: 'chat-2' })])
    vi.mocked(octopus().chats.create).mockResolvedValue({
      ok: true,
      value: chat({ id: 'chat-2' })
    })
    await act(async () => {
      await result.current.create()
    })

    expect(result.current.tabs[0]?.key).toBe(before)
    expect(result.current.tabs.map((tab) => tab.id)).toEqual(['chat-1', 'chat-2'])
  })

  /*
   * The list is asked for the moment a workspace opens, and the first message
   * can be sent before the answer arrives. That answer is empty, and applying
   * it would put the strip back to a workspace nobody had spoken to.
   */
  it('is not undone by a read that started before the record existed', async () => {
    let settle: ((value: { ok: true; value: Chat[] }) => void) | null = null
    vi.mocked(octopus().chats.list).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )

    const { result } = open()
    act(() => {
      result.current.bind(result.current.tabs[0]?.key ?? '', chat())
    })

    await act(async () => {
      settle?.({ ok: true, value: [] })
      await Promise.resolve()
    })

    expect(result.current.tabs[0]?.id).toBe('chat-1')
  })
})

/*
 * A workspace can be left while any of these is in flight. Applying the answer
 * then would draw one workspace's conversations over another's.
 */
describe('an answer that arrives after the workspace has been left', () => {
  function held<T>(): { promise: Promise<T>; settle: (value: T) => void } {
    let settle: ((value: T) => void) | null = null
    const promise = new Promise<T>((resolve) => {
      settle = resolve
    })
    return { promise, settle: (value) => settle?.(value) }
  }

  it('drops a list read that outlives the pane', async () => {
    const onChats = vi.fn()
    const list = held<{ ok: true; value: Chat[] }>()
    vi.mocked(octopus().chats.list).mockReturnValue(list.promise)

    const { unmount } = open({ onChats })
    unmount()

    await act(async () => {
      list.settle({ ok: true, value: [chat()] })
      await list.promise
    })

    expect(onChats).not.toHaveBeenCalled()
  })

  it('drops a conversation opened for a workspace no longer shown', async () => {
    const opening = held<{ ok: true; value: Chat }>()
    vi.mocked(octopus().chats.open).mockReturnValue(opening.promise)

    const { result, rerender } = open()
    const creating = result.current.create()
    rerender({ id: 'planner/bob' })

    await act(async () => {
      opening.settle({ ok: true, value: chat() })
      await creating
    })

    expect(octopus().chats.create).not.toHaveBeenCalled()
  })

  it('drops a second conversation created for a workspace no longer shown', async () => {
    const onChats = vi.fn()
    givenChats([chat()])
    const creating = held<{ ok: true; value: Chat }>()
    vi.mocked(octopus().chats.create).mockReturnValue(creating.promise)

    const { result, rerender } = open({ onChats })
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    const adding = result.current.create()
    rerender({ id: 'planner/bob' })
    onChats.mockClear()

    await act(async () => {
      creating.settle({ ok: true, value: chat({ id: 'chat-2' }) })
      await adding
    })

    expect(onChats).not.toHaveBeenCalledWith(WORKSPACE, expect.anything())
  })

  it('drops a fork answered for a workspace no longer shown', async () => {
    givenChats([chat({ sessionId: 'sess-1' })])
    const forking = held<{ ok: true; value: Chat }>()
    vi.mocked(octopus().chats.fork).mockReturnValue(forking.promise)

    const { result, rerender } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    const forked = result.current.fork('chat-1')
    rerender({ id: 'planner/bob' })

    await act(async () => {
      forking.settle({ ok: true, value: chat({ id: 'chat-2' }) })
      await forked
    })

    expect(result.current.tabs.map((tab) => tab.id)).not.toContain('chat-2')
  })

  it('drops a close answered for a workspace no longer shown', async () => {
    const onChats = vi.fn()
    givenChats([chat(), chat({ id: 'chat-2' })])
    const closing = held<{ ok: true; value: undefined }>()
    vi.mocked(octopus().chats.close).mockReturnValue(closing.promise)

    const { result, rerender } = open({ onChats })
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    const closed = result.current.close('chat-1')
    rerender({ id: 'planner/bob' })
    onChats.mockClear()

    await act(async () => {
      closing.settle({ ok: true, value: undefined })
      await closed
    })

    expect(onChats).not.toHaveBeenCalledWith(WORKSPACE, expect.anything())
  })
})

describe('which tab is showing', () => {
  it('follows a choice', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    act(() => {
      result.current.select('chat-2')
    })

    expect(result.current.activeKey).toBe('chat-2')
  })

  /*
   * The same argument the drafts make: looking at another workspace mid-task is
   * this application's premise, and coming back to conversation 1 when you left
   * on conversation 2 is losing your place for no reason.
   */
  it('is remembered per workspace', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result, rerender } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })
    act(() => {
      result.current.select('chat-2')
    })

    rerender({ id: 'planner/bob' })
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })
    rerender({ id: WORKSPACE })

    await waitFor(() => {
      expect(result.current.activeKey).toBe('chat-2')
    })
  })

  // A strip with no current tab draws an empty pane, so a key nothing answers
  // to falls back to the first rather than to none.
  it('falls back to the first tab when the one it held has gone', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })
    act(() => {
      result.current.select('chat-2')
    })

    givenChats([chat()])
    await act(async () => {
      await result.current.close('chat-2')
    })

    expect(result.current.tabs).toHaveLength(1)
    expect(result.current.activeKey).toBe(result.current.tabs[0]?.key)
  })
})

describe('closing a conversation', () => {
  it('asks first when there is a conversation to lose', async () => {
    const confirm = vi.fn(agreed)
    givenChats([chat({ sessionId: 'sess-1' }), chat({ id: 'chat-2' })])
    const { result } = open({ confirm })
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    givenChats([chat({ id: 'chat-2' })])
    await act(async () => {
      await result.current.close('chat-1')
    })

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Claude 1 and everything said in it.' })
    )
    expect(octopus().chats.close).toHaveBeenCalledWith('chat-1')
  })

  // A conversation that has never run has no transcript, and nothing to lose.
  it('closes a conversation that never started without asking', async () => {
    const confirm = vi.fn(agreed)
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open({ confirm })
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    givenChats([chat({ id: 'chat-2' })])
    await act(async () => {
      await result.current.close('chat-1')
    })

    expect(confirm).not.toHaveBeenCalled()
    expect(octopus().chats.close).toHaveBeenCalledWith('chat-1')
  })

  it('leaves the tab alone when the question is answered no', async () => {
    givenChats([chat({ sessionId: 'sess-1' }), chat({ id: 'chat-2' })])
    const { result } = open({ confirm: refused })
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    await act(async () => {
      await result.current.close('chat-1')
    })

    expect(octopus().chats.close).not.toHaveBeenCalled()
    expect(result.current.tabs).toHaveLength(2)
  })

  it('says so when the core refuses', async () => {
    const onError = vi.fn()
    givenChats([chat(), chat({ id: 'chat-2' })])
    vi.mocked(octopus().chats.close).mockResolvedValue({ ok: false, error: 'the last one' })
    const { result } = open({ onError })
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    await act(async () => {
      await result.current.close('chat-1')
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('the last one'))
  })
})

describe('naming a conversation', () => {
  it('sends the name and closes the field', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })
    act(() => {
      result.current.setEditingKey('chat-2')
    })

    givenChats([chat(), chat({ id: 'chat-2', title: 'auth refactor' })])
    await act(async () => {
      await result.current.rename('chat-2', 'auth refactor')
    })

    expect(octopus().chats.rename).toHaveBeenCalledWith('chat-2', 'auth refactor')
    expect(result.current.editingKey).toBeNull()
    expect(result.current.tabs[1]?.title).toBe('auth refactor')
  })

  it('says so when the core refuses', async () => {
    const onError = vi.fn()
    givenChats([chat()])
    vi.mocked(octopus().chats.rename).mockResolvedValue({ ok: false, error: 'too long' })
    const { result } = open({ onError })
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    await act(async () => {
      await result.current.rename('chat-1', 'x')
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('too long'))
  })

  // A field left open over a conversation no longer on screen would rename
  // whichever tab took its place.
  it('closes the field when the workspace changes', async () => {
    givenChats([chat()])
    const { result, rerender } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })
    act(() => {
      result.current.setEditingKey('chat-1')
    })

    rerender({ id: 'planner/bob' })

    expect(result.current.editingKey).toBeNull()
  })

  it('drops a rename answered for a workspace no longer shown', async () => {
    const onChats = vi.fn()
    givenChats([chat()])
    let settle: ((value: { ok: true; value: undefined }) => void) | null = null
    vi.mocked(octopus().chats.rename).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )

    const { result, rerender } = open({ onChats })
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    const renaming = result.current.rename('chat-1', 'auth refactor')
    rerender({ id: 'planner/bob' })
    onChats.mockClear()

    await act(async () => {
      settle?.({ ok: true, value: undefined })
      await renaming
    })

    expect(onChats).not.toHaveBeenCalledWith(WORKSPACE, expect.anything())
  })
})

describe('continuing a conversation in a new tab', () => {
  it('shows the fork and moves to it', async () => {
    givenChats([chat({ sessionId: 'sess-1' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    vi.mocked(octopus().chats.fork).mockResolvedValue({
      ok: true,
      value: chat({ id: 'chat-2', sessionId: 'sess-2' })
    })
    givenChats([chat({ sessionId: 'sess-1' }), chat({ id: 'chat-2', sessionId: 'sess-2' })])
    await act(async () => {
      await result.current.fork('chat-1')
    })

    expect(octopus().chats.fork).toHaveBeenCalledWith('chat-1')
    expect(result.current.activeKey).toBe('chat-2')
  })

  it('says so when the agent cannot fork', async () => {
    const onError = vi.fn()
    givenChats([chat({ sessionId: 'sess-1' })])
    vi.mocked(octopus().chats.fork).mockResolvedValue({ ok: false, error: 'no such session' })
    const { result } = open({ onError })
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    await act(async () => {
      await result.current.fork('chat-1')
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('no such session'))
    expect(result.current.tabs).toHaveLength(1)
  })
})

describe('what each conversation is doing', () => {
  it('patches the tab the core named', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    emitChatStatus('chat-2', 'running')

    expect(result.current.tabs.map((tab) => tab.status)).toEqual(['idle', 'running'])
  })

  // Broadcast to every window and covering every workspace; this strip draws
  // one, and a status from elsewhere is not about any tab it has.
  it('ignores what another workspace is doing', async () => {
    givenChats([chat()])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    emitChatStatus('chat-1', 'running', 'planner/bob')

    expect(result.current.tabs[0]?.status).toBe('idle')
  })
})
