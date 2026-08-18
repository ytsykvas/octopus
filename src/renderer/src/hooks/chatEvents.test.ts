import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatEvent } from '@core/service.js'

import { octopus } from '../test/octopus.js'
import { onChatEvent } from './chatEvents.js'

/** Hands back whatever the module gave the bridge, so a test can drive it. */
function deliverer(): (event: ChatEvent) => void {
  const calls = vi.mocked(octopus().chats.onEvent).mock.calls
  const last = calls.at(-1)
  if (!last) throw new Error('nothing subscribed to the bridge')
  return last[0]
}

function event(chatId: string): ChatEvent {
  return {
    chatId,
    workspaceId: 'planner/anna',
    event: { type: 'text_delta', text: 'x' }
  }
}

let stop: () => void

beforeEach(() => {
  stop = vi.fn<() => void>()
  vi.mocked(octopus().chats.onEvent).mockReturnValue(stop)
})

describe('the window’s one subscription to the agent’s events', () => {
  /*
   * The bridge registers an `ipcRenderer` listener per call, and a conversation
   * pane is one call. Three conversations and a few workspaces crossed Node's
   * ceiling of ten and turned a leak diagnostic into noise.
   */
  it('takes the bridge once however many are listening', () => {
    const off = [
      onChatEvent(vi.fn()),
      onChatEvent(vi.fn(), 'chat-1'),
      onChatEvent(vi.fn(), 'chat-2')
    ]

    expect(octopus().chats.onEvent).toHaveBeenCalledTimes(1)

    for (const release of off) release()
  })

  // The other half of the cost: a pane used to be woken for every fragment of
  // every other conversation's stream and drop it after comparing an id.
  it('wakes a conversation only for its own events', () => {
    const mine = vi.fn()
    const theirs = vi.fn()
    const off = [onChatEvent(mine, 'chat-1'), onChatEvent(theirs, 'chat-2')]

    deliverer()(event('chat-1'))

    expect(mine).toHaveBeenCalledOnce()
    expect(theirs).not.toHaveBeenCalled()

    for (const release of off) release()
  })

  // The readings that belong to the window rather than to a pane — the models,
  // the rate limit, the workspace list — are about whichever chat spoke.
  it('wakes a listener with no conversation for all of them', () => {
    const all = vi.fn()
    const off = onChatEvent(all)

    deliverer()(event('chat-1'))
    deliverer()(event('chat-2'))

    expect(all).toHaveBeenCalledTimes(2)

    off()
  })

  it('gives the bridge back when the last listener goes, and takes it again', () => {
    const first = onChatEvent(vi.fn(), 'chat-1')
    const second = onChatEvent(vi.fn())

    first()
    expect(vi.mocked(stop)).not.toHaveBeenCalled()

    second()
    expect(vi.mocked(stop)).toHaveBeenCalledOnce()

    const third = onChatEvent(vi.fn(), 'chat-1')
    expect(octopus().chats.onEvent).toHaveBeenCalledTimes(2)

    third()
  })

  // Two panes on one conversation is what a second window looks like from here.
  it('keeps a conversation’s other listeners when one of them goes', () => {
    const staying = vi.fn()
    const leaving = onChatEvent(vi.fn(), 'chat-1')
    const off = onChatEvent(staying, 'chat-1')

    leaving()
    deliverer()(event('chat-1'))

    expect(staying).toHaveBeenCalledOnce()

    off()
  })

  /*
   * A handler that unsubscribes from inside its own call is what an effect
   * cleanup racing an event looks like. Walked over the live set, that skipped
   * whichever handler came after it.
   */
  it('delivers to everyone when one unsubscribes mid-delivery', () => {
    const after = vi.fn()
    const off: (() => void)[] = []
    off.push(
      onChatEvent(() => {
        off[0]?.()
      }, 'chat-1')
    )
    off.push(onChatEvent(after, 'chat-1'))

    deliverer()(event('chat-1'))

    expect(after).toHaveBeenCalledOnce()

    for (const release of off) release()
  })
})
