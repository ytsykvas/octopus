import type { BrowserWindow, OpenDialogOptions, WebContents } from 'electron'
import { describe, expect, it } from 'vitest'

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
      fromWebContents: (sender) => (sender === SENDER ? WINDOW : null)
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
})
