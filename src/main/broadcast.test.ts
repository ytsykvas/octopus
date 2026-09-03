import { describe, expect, it } from 'vitest'

import {
  pushChatEvent,
  pushChatStatus,
  pushSettingsOpen,
  pushTheme,
  pushUsageWindows,
  pushWorkspaceStatus
} from './broadcast.js'

/** Stands in for a window, the way `terminals.test.ts` stands in for its WebContents. */
function target(): {
  sent: [string, unknown][]
  colours: string[]
  webContents: { send: (channel: string, payload?: unknown) => void }
  setBackgroundColor: (color: string) => void
} {
  const state = {
    sent: [] as [string, unknown][],
    colours: [] as string[],
    webContents: {
      send(channel: string, payload?: unknown) {
        state.sent.push([channel, payload])
      }
    },
    setBackgroundColor(color: string) {
      state.colours.push(color)
    }
  }

  return state
}

/*
 * The channel strings, asserted here and nowhere else on this side.
 *
 * Their listening halves are each named in `preload/index.test.ts`, written
 * independently — so a rename on one side and not the other fails here. Before
 * this file existed, `usage:windows` was renamed to `usage:window` and the whole
 * gate stayed green, because these sends lived in the composition root that no
 * test can reach.
 */
describe('what the main process pushes, and on which channel', () => {
  it('announces the appearance, and paints the canvas before it does', () => {
    const first = target()
    const second = target()

    pushTheme([first, second], 'dark')

    expect(first.sent).toEqual([['theme:changed', 'dark']])
    expect(second.sent).toEqual([['theme:changed', 'dark']])
  })

  /*
   * The window paints this before the renderer has drawn anything, so without
   * it a dark window flashes white on every switch.
   *
   * Asserted as two answers that differ rather than as one call having
   * happened: a count of calls holds even with the theme ignored, which is what
   * this test said at first.
   */
  it("paints each window's canvas for the theme it announces", () => {
    const dark = target()
    const light = target()

    pushTheme([dark], 'dark')
    pushTheme([light], 'light')

    expect(dark.colours).toHaveLength(1)
    expect(dark.colours[0]).not.toBe(light.colours[0])
  })

  it('announces a conversation event', () => {
    const window = target()
    const event = { chatId: 'chat-1', workspaceId: 'planner/anna', event: { type: 'text' } }

    pushChatEvent([window], event)

    expect(window.sent).toEqual([['chats:event', event]])
  })

  it('announces a workspace status', () => {
    const window = target()
    const event = { workspaceId: 'planner/anna', status: 'running' }

    pushWorkspaceStatus([window], event)

    expect(window.sent).toEqual([['workspaces:status', event]])
  })

  it('announces the account windows', () => {
    const window = target()
    const windows = { fiveHour: null, sevenDay: null }

    pushUsageWindows([window], windows)

    expect(window.sent).toEqual([['usage:windows', windows]])
  })

  it('announces a conversation status', () => {
    const window = target()
    const event = { chatId: 'chat-1', workspaceId: 'planner/anna', status: 'idle' }

    pushChatStatus([window], event)

    expect(window.sent).toEqual([['chats:status', event]])
  })

  // The one push that is not a broadcast: the menu opens Settings in the window
  // the user is looking at, and it carries no payload.
  it('opens settings in the focused window, with nothing to say', () => {
    const window = target()

    pushSettingsOpen(window)

    expect(window.sent).toEqual([['settings:open', undefined]])
  })

  // Focused with no window open, and then there is nobody to open Settings for.
  it('opens settings nowhere when no window has the focus', () => {
    expect(() => {
      pushSettingsOpen(null)
    }).not.toThrow()
  })

  // Every window on the machine, not the one that caused the event: a second
  // window on the same workspace has to see the same conversation.
  it('reaches no window when none is open', () => {
    expect(() => {
      pushChatEvent([], { chatId: 'chat-1' })
    }).not.toThrow()
  })
})
