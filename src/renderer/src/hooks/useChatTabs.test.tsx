import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Chat, ClosedChat } from '@core/chats.js'

import { chat, emitChatsChanged, emitChatStatus, givenChats } from '../test/chat.js'
import { octopus } from '../test/octopus.js'
import { type ChatTab, useChatTabs } from './useChatTabs.js'

const WORKSPACE = 'planner/anna'

interface Options {
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
    ({ id }: Shown) => useChatTabs(id, options.onChats ?? vi.fn(), options.onError ?? vi.fn()),
    { initialProps }
  )
}

/** A promise the test settles by hand, to answer after something has moved on. */
function held<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: ((value: T) => void) | null = null
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle: (value) => settle?.(value) }
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
    renderHook(() => useChatTabs(null, vi.fn(), vi.fn()))

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

  /*
   * The failure as reported, and nothing below this level reproduces it: two
   * windows on one workspace, one of them creating a conversation.
   *
   * The strip reads its list once per workspace, so the second window drew what
   * was true when it opened — a tab it never saw created, and one it kept
   * drawing after the other closed it. Pressing `+` there then failed against a
   * cap it could not see.
   */
  it('redraws when another window changes the set of conversations', async () => {
    givenChats([chat()])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(1)
    })

    // What the other window did, seen only as a list that now reads differently.
    givenChats([chat(), chat({ id: 'chat-2' })])
    emitChatsChanged()

    await waitFor(() => {
      expect(result.current.tabs.map((tab) => tab.id)).toEqual(['chat-1', 'chat-2'])
    })
  })

  it('stops drawing a conversation another window closed', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    givenChats([chat()])
    emitChatsChanged()

    await waitFor(() => {
      expect(result.current.tabs.map((tab) => tab.id)).toEqual(['chat-1'])
    })
  })

  // Broadcast to every window and covering every workspace; this strip draws
  // one, and re-reading for another's would replace its tabs with theirs.
  it('ignores a change announced for another workspace', async () => {
    givenChats([chat()])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(1)
    })

    givenChats([chat(), chat({ id: 'chat-2' })])
    emitChatsChanged('planner/bob')

    expect(result.current.tabs).toHaveLength(1)
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

  it('names the new conversation before its tab is drawn', async () => {
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
    const beforeShown = vi.fn()
    await act(async () => {
      await result.current.create(beforeShown)
    })

    // Ordered against the `chats.list` that draws the tab: inside `act` the
    // callback would see the old tabs either way, so reading them proves nothing.
    expect(beforeShown).toHaveBeenCalledExactlyOnceWith('chat-2')
    const created = vi.mocked(octopus().chats.create).mock.invocationCallOrder[0] ?? 0
    const drawn = vi
      .mocked(octopus().chats.list)
      .mock.invocationCallOrder.find((order) => order > created)
    expect(beforeShown.mock.invocationCallOrder[0]).toBeLessThan(drawn ?? 0)
    expect(result.current.activeKey).toBe('chat-2')
  })

  // Help sends its message from here; the pane drawn before the send landed
  // would read a history without it.
  it('draws the new conversation only once what it was handed has finished', async () => {
    givenChats([chat()])
    vi.mocked(octopus().chats.create).mockResolvedValue({
      ok: true,
      value: chat({ id: 'chat-2' })
    })
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    const sending = held<undefined>()
    const listed = vi.mocked(octopus().chats.list).mock.calls.length
    let adding: Promise<void> = Promise.resolve()
    await act(async () => {
      adding = result.current.create(() => sending.promise)
      await Promise.resolve()
    })
    expect(octopus().chats.list).toHaveBeenCalledTimes(listed)

    await act(async () => {
      sending.settle(undefined)
      await adding
    })
    expect(vi.mocked(octopus().chats.list).mock.calls.length).toBeGreaterThan(listed)
  })

  // Help in a workspace nobody has spoken to: the first tab is made real, and
  // the text goes to the second.
  it('names the second conversation when the first had not been written yet', async () => {
    vi.mocked(octopus().chats.open).mockResolvedValue({ ok: true, value: chat() })
    vi.mocked(octopus().chats.create).mockImplementation(() => {
      givenChats([chat(), chat({ id: 'chat-2' })])
      return Promise.resolve({ ok: true, value: chat({ id: 'chat-2' }) })
    })
    const { result } = open()
    await waitFor(() => {
      expect(octopus().chats.list).toHaveBeenCalled()
    })

    const beforeShown = vi.fn()
    await act(async () => {
      await result.current.create(beforeShown)
    })

    expect(beforeShown).toHaveBeenCalledExactlyOnceWith('chat-2')
    expect(result.current.tabs.map((tab) => tab.key)).toEqual(['first', 'chat-2'])
    expect(result.current.activeKey).toBe('chat-2')
  })

  it('names nothing when the conversation could not be created', async () => {
    givenChats([chat()])
    vi.mocked(octopus().chats.create).mockResolvedValue({ ok: false, error: 'full' })
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    const beforeShown = vi.fn()
    await act(async () => {
      await result.current.create(beforeShown)
    })

    expect(beforeShown).not.toHaveBeenCalled()
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

  // The conversation exists and takes a place: Help's text has to be on it
  // when its workspace is opened again.
  it('still names a conversation created for a workspace no longer shown', async () => {
    givenChats([chat()])
    const creating = held<{ ok: true; value: Chat }>()
    vi.mocked(octopus().chats.create).mockReturnValue(creating.promise)

    const { result, rerender } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    const beforeShown = vi.fn()
    const adding = result.current.create(beforeShown)
    rerender({ id: 'planner/bob' })

    await act(async () => {
      creating.settle({ ok: true, value: chat({ id: 'chat-2' }) })
      await adding
    })

    expect(beforeShown).toHaveBeenCalledExactlyOnceWith('chat-2')
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
      await expect(forked).resolves.toBe(false)
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

function closedEntry(id: string, preview = 'fix the login bug'): ClosedChat {
  return {
    chat: chat({ id, closedAt: '2026-08-20T10:00:00.000Z' }),
    closedAt: '2026-08-20T10:00:00.000Z',
    preview
  }
}

describe('closing a conversation', () => {
  /*
   * No question. Closing moves the conversation to the history, so a slip costs
   * a tab, and a dialog saying it "cannot be brought back" would be untrue.
   */
  it('closes without asking, even a conversation that has run', async () => {
    givenChats([chat({ sessionId: 'sess-1' }), chat({ id: 'chat-2' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    givenChats([chat({ id: 'chat-2' })])
    await act(async () => {
      await result.current.close('chat-1')
    })

    expect(octopus().chats.close).toHaveBeenCalledWith('chat-1')
    expect(result.current.tabs).toHaveLength(1)
  })

  // Each entry costs a read of its transcript, and the list is read when the
  // menu is opened — which it is before anything can be chosen from it.
  it('does not read the history just because a tab was closed', async () => {
    givenChats([chat(), chat({ id: 'chat-2' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    givenChats([chat({ id: 'chat-2' })])
    await act(async () => {
      await result.current.close('chat-1')
    })

    expect(octopus().chats.closed).not.toHaveBeenCalled()
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

  // What the guard keeps from the window now showing another workspace is the
  // refusal of a close that belonged to the one it left.
  it('does not report a refusal for a workspace no longer shown', async () => {
    const onError = vi.fn()
    givenChats([chat(), chat({ id: 'chat-2' })])
    let settle: ((value: { ok: false; error: string }) => void) | null = null
    vi.mocked(octopus().chats.close).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    const { result, rerender } = open({ onError })
    await waitFor(() => {
      expect(result.current.tabs).toHaveLength(2)
    })

    const closing = result.current.close('chat-1')
    rerender({ id: 'planner/bob' })
    onError.mockClear()

    await act(async () => {
      settle?.({ ok: false, error: 'the last one' })
      await closing
    })

    expect(onError).not.toHaveBeenCalled()
  })
})

describe('the history of closed conversations', () => {
  it('is read when asked for, and starts empty', async () => {
    vi.mocked(octopus().chats.closed).mockResolvedValue({
      ok: true,
      value: [closedEntry('chat-9', 'add a retry')]
    })
    givenChats([chat()])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })
    expect(result.current.history).toEqual([])
    expect(octopus().chats.closed).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.refreshHistory()
    })

    expect(result.current.history).toMatchObject([{ preview: 'add a retry' }])
  })

  it('says so when it cannot be read', async () => {
    const onError = vi.fn()
    vi.mocked(octopus().chats.closed).mockResolvedValue({ ok: false, error: 'unreadable' })
    givenChats([chat()])
    const { result } = open({ onError })
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    await act(async () => {
      await result.current.refreshHistory()
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('unreadable'))
  })

  // Another workspace's closed conversation would be offered here, and
  // reopening it would fail against a workspace it does not belong to.
  it('is dropped when the workspace changes', async () => {
    vi.mocked(octopus().chats.closed).mockResolvedValue({
      ok: true,
      value: [closedEntry('chat-9')]
    })
    givenChats([chat()])
    const { result, rerender } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })
    await act(async () => {
      await result.current.refreshHistory()
    })
    expect(result.current.history).toHaveLength(1)

    vi.mocked(octopus().chats.closed).mockResolvedValue({ ok: true, value: [] })
    rerender({ id: 'planner/bob' })

    await waitFor(() => {
      expect(result.current.history).toEqual([])
    })
  })

  it('drops a reading answered for a workspace no longer shown', async () => {
    let settle: ((value: { ok: true; value: ClosedChat[] }) => void) | null = null
    vi.mocked(octopus().chats.closed).mockReturnValue(
      new Promise((resolve) => {
        settle = resolve
      })
    )
    givenChats([chat()])
    const { result, rerender } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    const reading = result.current.refreshHistory()
    rerender({ id: 'planner/bob' })

    await act(async () => {
      settle?.({ ok: true, value: [closedEntry('chat-9')] })
      await reading
    })

    expect(result.current.history).toEqual([])
  })

  describe('reopening', () => {
    it('brings the conversation back as a tab and shows it', async () => {
      givenChats([chat()])
      const { result } = open()
      await waitFor(() => {
        expect(result.current.tabs[0]?.id).toBe('chat-1')
      })

      vi.mocked(octopus().chats.reopen).mockResolvedValue({
        ok: true,
        value: chat({ id: 'chat-2', sessionId: 'sess-2' })
      })
      givenChats([chat(), chat({ id: 'chat-2', sessionId: 'sess-2' })])
      await act(async () => {
        await result.current.reopen('chat-2')
      })

      expect(octopus().chats.reopen).toHaveBeenCalledWith('chat-2')
      expect(result.current.tabs).toHaveLength(2)
      expect(result.current.activeKey).toBe('chat-2')
    })

    // Three tabs are open, and the core says so.
    it('says so when there is no room', async () => {
      const onError = vi.fn()
      givenChats([chat()])
      vi.mocked(octopus().chats.reopen).mockResolvedValue({ ok: false, error: 'too many' })
      const { result } = open({ onError })
      await waitFor(() => {
        expect(result.current.tabs[0]?.id).toBe('chat-1')
      })

      await act(async () => {
        await result.current.reopen('chat-2')
      })

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('too many'))
      expect(result.current.tabs).toHaveLength(1)
    })

    // `select` writes to whichever workspace is showing, so a reopening that
    // landed after the switch would have moved the tab of another one.
    it('does not move the tab of the workspace now shown', async () => {
      givenChats([chat(), chat({ id: 'chat-2' })])
      let settle: ((value: { ok: true; value: Chat }) => void) | null = null
      vi.mocked(octopus().chats.reopen).mockReturnValue(
        new Promise((resolve) => {
          settle = resolve
        })
      )
      const { result, rerender } = open()
      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2)
      })

      const reopening = result.current.reopen('chat-2')
      rerender({ id: 'planner/bob' })
      await waitFor(() => {
        expect(result.current.tabs).toHaveLength(2)
      })

      await act(async () => {
        settle?.({ ok: true, value: chat({ id: 'chat-2' }) })
        await reopening
      })

      // Still on the first, as a workspace is when it is first looked at.
      expect(result.current.activeKey).toBe(result.current.tabs[0]?.key)
    })
  })

  describe('reopening the one closed last', () => {
    it('asks the core rather than trusting a list that may be stale', async () => {
      givenChats([chat()])
      vi.mocked(octopus().chats.closed).mockResolvedValue({
        ok: true,
        value: [closedEntry('chat-8'), closedEntry('chat-7')]
      })
      vi.mocked(octopus().chats.reopen).mockResolvedValue({
        ok: true,
        value: chat({ id: 'chat-8' })
      })
      const { result } = open()
      await waitFor(() => {
        expect(result.current.tabs[0]?.id).toBe('chat-1')
      })

      await act(async () => {
        await result.current.reopenLast()
      })

      expect(octopus().chats.reopen).toHaveBeenCalledExactlyOnceWith('chat-8')
    })

    it('does nothing when nothing was closed', async () => {
      givenChats([chat()])
      vi.mocked(octopus().chats.closed).mockResolvedValue({ ok: true, value: [] })
      const { result } = open()
      await waitFor(() => {
        expect(result.current.tabs[0]?.id).toBe('chat-1')
      })

      await act(async () => {
        await result.current.reopenLast()
      })

      expect(octopus().chats.reopen).not.toHaveBeenCalled()
    })

    it('says so when the history cannot be read', async () => {
      const onError = vi.fn()
      givenChats([chat()])
      vi.mocked(octopus().chats.closed).mockResolvedValue({ ok: false, error: 'unreadable' })
      const { result } = open({ onError })
      await waitFor(() => {
        expect(result.current.tabs[0]?.id).toBe('chat-1')
      })

      await act(async () => {
        await result.current.reopenLast()
      })

      expect(onError).toHaveBeenCalledWith(expect.stringContaining('unreadable'))
      expect(octopus().chats.reopen).not.toHaveBeenCalled()
    })

    it('drops an answer for a workspace no longer shown', async () => {
      givenChats([chat()])
      let settle: ((value: { ok: true; value: ClosedChat[] }) => void) | null = null
      vi.mocked(octopus().chats.closed).mockReturnValue(
        new Promise((resolve) => {
          settle = resolve
        })
      )
      const { result, rerender } = open()
      await waitFor(() => {
        expect(result.current.tabs[0]?.id).toBe('chat-1')
      })

      const reopening = result.current.reopenLast()
      rerender({ id: 'planner/bob' })

      await act(async () => {
        settle?.({ ok: true, value: [closedEntry('chat-8')] })
        await reopening
      })

      expect(octopus().chats.reopen).not.toHaveBeenCalled()
    })
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
    let opened = false
    await act(async () => {
      opened = await result.current.fork('chat-1')
    })

    expect(octopus().chats.fork).toHaveBeenCalledWith('chat-1', undefined)
    expect(result.current.activeKey).toBe('chat-2')
    expect(opened).toBe(true)
  })

  it('carries the side answer a fork starts from', async () => {
    givenChats([chat({ sessionId: 'sess-1' })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    const aside = { question: 'why?', response: 'Because.' }
    await act(async () => {
      await result.current.fork('chat-1', aside)
    })

    expect(octopus().chats.fork).toHaveBeenCalledWith('chat-1', aside)
  })

  it('says so when the agent cannot fork', async () => {
    const onError = vi.fn()
    givenChats([chat({ sessionId: 'sess-1' })])
    vi.mocked(octopus().chats.fork).mockResolvedValue({ ok: false, error: 'no such session' })
    const { result } = open({ onError })
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })

    let opened = true
    await act(async () => {
      opened = await result.current.fork('chat-1')
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('no such session'))
    expect(result.current.tabs).toHaveLength(1)
    expect(opened).toBe(false)
  })
})

describe('carrying a plan out in a new tab', () => {
  const PLAN = { mode: 'acceptEdits', message: 'Carry out the plan “Tests”.' } as const

  async function opened(onError = vi.fn()): Promise<ReturnType<typeof open>> {
    givenChats([chat({ sessionId: 'sess-1' })])
    const rendered = open({ onError })
    await waitFor(() => {
      expect(rendered.result.current.tabs[0]?.id).toBe('chat-1')
    })
    vi.mocked(octopus().chats.fork).mockResolvedValue({
      ok: true,
      value: chat({ id: 'chat-2', sessionId: 'sess-2' })
    })
    givenChats([chat({ sessionId: 'sess-1' }), chat({ id: 'chat-2', sessionId: 'sess-2' })])
    return rendered
  }

  // The mode before the message, so the turn the message opens runs in it; the
  // message before the tab is shown, so the pane reads it with the history.
  it('moves the fork to the mode, tells it the plan, then shows it', async () => {
    const { result } = await opened()
    const order: string[] = []
    vi.mocked(octopus().chats.setWorkingMode).mockImplementation((id, mode) => {
      order.push(`mode ${id} ${mode}`)
      return Promise.resolve({ ok: true, value: undefined })
    })
    vi.mocked(octopus().chats.send).mockImplementation((id, text) => {
      order.push(`send ${id} ${text}`)
      return Promise.resolve({ ok: true, value: null })
    })
    vi.mocked(octopus().chats.list).mockImplementation(() => {
      order.push('list')
      return Promise.resolve({
        ok: true,
        value: [chat({ sessionId: 'sess-1' }), chat({ id: 'chat-2', sessionId: 'sess-2' })]
      })
    })

    let started = false
    await act(async () => {
      started = await result.current.forkPlan('chat-1', PLAN)
    })

    expect(octopus().chats.fork).toHaveBeenCalledWith('chat-1', undefined)
    expect(order).toEqual(['mode chat-2 acceptEdits', `send chat-2 ${PLAN.message}`, 'list'])
    expect(result.current.activeKey).toBe('chat-2')
    expect(started).toBe(true)
  })

  // A fork keeps its source's working mode; asking for it again is a round
  // trip that can only fail.
  it('leaves the mode alone when the fork is already in it', async () => {
    const { result } = await opened()

    await act(async () => {
      await result.current.forkPlan('chat-1', { ...PLAN, mode: 'default' })
    })

    expect(octopus().chats.setWorkingMode).not.toHaveBeenCalled()
    expect(octopus().chats.send).toHaveBeenCalledWith('chat-2', PLAN.message)
  })

  // The fork exists either way, so it is shown; what did not happen is said,
  // and the answer tells the caller to leave the source's question standing.
  it('shows the fork and says so when the mode cannot be set', async () => {
    const onError = vi.fn()
    const { result } = await opened(onError)
    vi.mocked(octopus().chats.setWorkingMode).mockResolvedValue({ ok: false, error: 'no mode' })

    let started = true
    await act(async () => {
      started = await result.current.forkPlan('chat-1', PLAN)
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('no mode'))
    expect(octopus().chats.send).not.toHaveBeenCalled()
    expect(result.current.activeKey).toBe('chat-2')
    expect(started).toBe(false)
  })

  it('shows the fork and says so when the plan cannot be sent', async () => {
    const onError = vi.fn()
    const { result } = await opened(onError)
    vi.mocked(octopus().chats.send).mockResolvedValue({ ok: false, error: 'agent is gone' })

    let started = true
    await act(async () => {
      started = await result.current.forkPlan('chat-1', PLAN)
    })

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('agent is gone'))
    expect(result.current.activeKey).toBe('chat-2')
    expect(started).toBe(false)
  })

  it('sends nothing when the agent cannot fork', async () => {
    const { result } = await opened()
    vi.mocked(octopus().chats.fork).mockResolvedValue({ ok: false, error: 'no such session' })

    let started = true
    await act(async () => {
      started = await result.current.forkPlan('chat-1', PLAN)
    })

    expect(octopus().chats.send).not.toHaveBeenCalled()
    expect(started).toBe(false)
  })

  it('drops a plan started for a workspace no longer shown', async () => {
    const { result, rerender } = await opened()
    const sending = held<{ ok: true; value: null }>()
    vi.mocked(octopus().chats.send).mockReturnValue(sending.promise)

    const started = result.current.forkPlan('chat-1', PLAN)
    await waitFor(() => {
      expect(octopus().chats.send).toHaveBeenCalled()
    })
    rerender({ id: 'planner/bob' })

    await act(async () => {
      sending.settle({ ok: true, value: null })
      await expect(started).resolves.toBe(false)
    })

    expect(result.current.activeKey).not.toBe('chat-2')
  })
})

describe('copying a conversation to brief another', () => {
  const AT = '2026-08-11T09:00:00.000Z'

  /** A clipboard to watch; jsdom ships none. */
  function withClipboard(writeText: () => Promise<void>): void {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  }

  async function opened(onError = vi.fn()): Promise<ReturnType<typeof open>> {
    givenChats([chat({ sessionId: 'sess-1' })])
    const shown = open({ onError })
    await waitFor(() => {
      expect(shown.result.current.tabs[0]?.id).toBe('chat-1')
    })

    return shown
  }

  it('puts the conversation, under its name, on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    withClipboard(writeText)
    const { result } = await opened()
    vi.mocked(octopus().chats.history).mockResolvedValue({
      ok: true,
      value: [{ role: 'user', at: AT, text: 'add a test' }]
    })

    let copied = false
    await act(async () => {
      copied = await result.current.copyTranscript('chat-1', 'Claude 1')
    })

    expect(copied).toBe(true)
    expect(octopus().chats.history).toHaveBeenCalledWith('chat-1')
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('# Earlier conversation: Claude 1')
    )
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('add a test'))
  })

  it('clears a message left by an earlier failure before it tries', async () => {
    withClipboard(vi.fn(() => Promise.resolve()))
    const onError = vi.fn()
    const { result } = await opened(onError)

    await act(async () => {
      await result.current.copyTranscript('chat-1', 'Claude 1')
    })

    expect(onError).toHaveBeenCalledWith(null)
  })

  it('says so, and copies nothing, when the history cannot be read', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    withClipboard(writeText)
    const onError = vi.fn()
    const { result } = await opened(onError)
    vi.mocked(octopus().chats.history).mockResolvedValue({ ok: false, error: 'disk on fire' })

    let copied = true
    await act(async () => {
      copied = await result.current.copyTranscript('chat-1', 'Claude 1')
    })

    expect(copied).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('disk on fire'))
  })

  it('reports false rather than throwing when the clipboard refuses', async () => {
    withClipboard(() => Promise.reject(new Error('not focused')))
    const { result } = await opened()

    let copied = true
    await act(async () => {
      copied = await result.current.copyTranscript('chat-1', 'Claude 1')
    })

    expect(copied).toBe(false)
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

/*
 * Cleared by the core on any move and said on the event, so the strip copies
 * it rather than working the rule out — a tab left holding `true` would come
 * back "interrupted" at the end of the very turn that resumed it.
 */
describe('a conversation the quit cut off', () => {
  it('stops being interrupted once its status moves', async () => {
    givenChats([chat({ interrupted: true })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.interrupted).toBe(true)
    })

    emitChatStatus('chat-1', 'running')

    expect(result.current.tabs[0]).toMatchObject({ status: 'running', interrupted: false })
  })

  // The status alone is not what decides whether the tab moved.
  it('takes the flag even when the status holds', async () => {
    givenChats([chat({ interrupted: true })])
    const { result } = open()
    await waitFor(() => {
      expect(result.current.tabs[0]?.interrupted).toBe(true)
    })

    emitChatStatus('chat-1', 'idle')

    expect(result.current.tabs[0]?.interrupted).toBe(false)
  })
})

describe('a status that moves nothing', () => {
  // Announced several times a turn, and every tab is memoised on the list.
  it('leaves the tabs as they were', async () => {
    givenChats([chat()])
    const { result } = open()
    // The record, not the placeholder tab drawn before the list has landed.
    await waitFor(() => {
      expect(result.current.tabs[0]?.id).toBe('chat-1')
    })
    const before = result.current.tabs

    emitChatStatus('chat-1', 'idle')
    expect(result.current.tabs).toBe(before)

    emitChatStatus('chat-9', 'running')
    expect(result.current.tabs).toBe(before)

    emitChatStatus('chat-1', 'running')
    expect(result.current.tabs).not.toBe(before)
    expect(result.current.tabs[0]?.status).toBe('running')
  })
})
