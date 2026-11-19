import type { BrowserWindow, Dialog, IpcMain, WebContents } from 'electron'

import type { IpcHost } from './ipc.js'

export interface ElectronParts {
  readonly ipcMain: Pick<IpcMain, 'handle'>
  readonly dialog: Pick<Dialog, 'showOpenDialog'>
  readonly fromWebContents: (sender: WebContents) => BrowserWindow | null
}

export function electronIpcHost(
  parts: ElectronParts
): Pick<IpcHost, 'handle' | 'showOpenDialog' | 'windowFor'> {
  return {
    // Through `unknown`: the injected signature is deliberately narrower than
    // Electron's, which types its arguments as `any`.
    handle: (channel, handler) => {
      parts.ipcMain.handle(channel, handler as unknown as Parameters<IpcMain['handle']>[1])
    },
    // `parent` is what `windowFor` below answered, so a window whenever it is set.
    showOpenDialog: (options, parent) =>
      parent
        ? parts.dialog.showOpenDialog(parent as BrowserWindow, options)
        : parts.dialog.showOpenDialog(options),
    windowFor: (event) => parts.fromWebContents(event.sender)
  }
}
