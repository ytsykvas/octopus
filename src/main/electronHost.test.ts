import type { BrowserWindow, Display, OpenDialogOptions, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { electronIpcHost } from './electronHost.js'

const SENDER = {} as WebContents
const WINDOW = {} as BrowserWindow
const OPTIONS: OpenDialogOptions = { properties: ['openDirectory'] }

function fakeHost(): {
  readonly ipc: ReturnType<typeof electronIpcHost>
  readonly handled: [string, unknown][]
  readonly opened: unknown[][]
} {
  const handled: [string, unknown][] = []
  const opened: unknown[][] = []
  const handle = (channel: string, listener: unknown): void => {
    handled.push([channel, listener])
  }
  const showOpenDialog = (
    ...args: unknown[]
  ): Promise<{ canceled: boolean; filePaths: string[] }> => {
    opened.push(args)
    return Promise.resolve({ canceled: true, filePaths: [] })
  }
  return {
    handled,
    opened,
    ipc: electronIpcHost({
      ipcMain: { handle },
      dialog: { showOpenDialog },
      fromWebContents: (sender) => (sender === SENDER ? WINDOW : null),
      screen: {
        getDisplayMatching: () =>
          ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }) as Display
      }
    })
  }
}

describe('electronIpcHost', () => {
  it('registers each handler on its channel as given', () => {
    const { ipc, handled } = fakeHost()
    const handler = (): string => 'answer'

    ipc.handle('theme:get', handler)

    expect(handled).toEqual([['theme:get', handler]])
  })

  it('opens a picker as a sheet on the window a call came from', async () => {
    const { ipc, opened } = fakeHost()

    await ipc.showOpenDialog(OPTIONS, WINDOW)

    expect(opened).toEqual([[WINDOW, OPTIONS]])
  })

  it('opens a free-standing picker when the window is gone', async () => {
    const { ipc, opened } = fakeHost()

    await ipc.showOpenDialog(OPTIONS)

    expect(opened).toEqual([[OPTIONS]])
  })

  it('finds the window by the contents that sent the call', () => {
    const { ipc } = fakeHost()

    expect(ipc.windowFor({ sender: SENDER })).toBe(WINDOW)
    expect(ipc.windowFor({ sender: {} as WebContents })).toBeNull()
  })

  it('holds the window to its floor, widening one narrower', () => {
    const { ipc } = fakeHost()
    const { window, setMinimumSize, setBounds } = windowAt(1000)

    ipc.setWindowFloor(window, 1200)

    expect(setMinimumSize).toHaveBeenCalledWith(1200, 620)
    expect(setBounds).toHaveBeenCalledWith({ x: 240, y: 0, width: 1200, height: 800 })
  })

  it('leaves a window already wide enough where it is', () => {
    const { ipc } = fakeHost()
    const { window, setMinimumSize, setBounds } = windowAt(1300)

    ipc.setWindowFloor(window, 1200)

    expect(setMinimumSize).toHaveBeenCalledWith(1200, 620)
    expect(setBounds).not.toHaveBeenCalled()
  })
})

function windowAt(width: number): {
  readonly window: BrowserWindow
  readonly setMinimumSize: ReturnType<typeof vi.fn>
  readonly setBounds: ReturnType<typeof vi.fn>
} {
  const setMinimumSize = vi.fn()
  const setBounds = vi.fn()
  const window = {
    getBounds: () => ({ x: 300, y: 0, width, height: 800 }),
    setMinimumSize,
    setBounds
  } as unknown as BrowserWindow
  return { window, setMinimumSize, setBounds }
}
