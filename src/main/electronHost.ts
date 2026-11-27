import type { BrowserWindow, Dialog, IpcMain, Screen, WebContents } from 'electron'

import { fitWindow, WINDOW_MIN_HEIGHT } from '../core/windowFit.js'
import type { IpcHost } from './ipc.js'

export interface ElectronParts {
  readonly ipcMain: Pick<IpcMain, 'handle'>
  readonly dialog: Pick<Dialog, 'showOpenDialog'>
  readonly fromWebContents: (sender: WebContents) => BrowserWindow | null
  readonly screen: Pick<Screen, 'getDisplayMatching'>
}

export function electronIpcHost(
  parts: ElectronParts
): Pick<IpcHost, 'handle' | 'showOpenDialog' | 'windowFor' | 'setWindowFloor'> {
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
    windowFor: (event) => parts.fromWebContents(event.sender),
    // `target` is what `windowFor` above answered.
    setWindowFloor: (target, minWidth) => {
      const window = target as BrowserWindow
      const bounds = window.getBounds()
      const fitted = fitWindow(bounds, parts.screen.getDisplayMatching(bounds).workArea, minWidth)
      window.setMinimumSize(fitted.minWidth, WINDOW_MIN_HEIGHT)
      if (fitted.bounds !== null) window.setBounds(fitted.bounds)
    }
  }
}
