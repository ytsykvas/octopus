import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'

import { describeError } from '../core/persist.js'
import { type ChatEvent, createService, type OctopusService } from '../core/service.js'
import type { ThemeName } from '../core/types.js'
import { registerIpc } from './ipc.js'
import { canvasColor, resolveTheme } from './theme.js'
import { TerminalManager } from './terminals.js'

/** Canvas colours from the design system (§10) — so the window does not flash white on launch. */

function createWindow(theme: ThemeName): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: canvasColor(theme),
    // §10.5: hiddenInset stays; vibrancy is deliberately unused — translucent
    // materials make dense text harder to read.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  // External links open in the browser, not inside the application.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

/**
 * Native menu.
 *
 * Exists mainly for ⌘, — on macOS that is where users expect settings, and
 * an app without it feels foreign.
 */
function registerMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send('settings:open')
          }
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function broadcastTheme(theme: ThemeName): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(canvasColor(theme))
    window.webContents.send('theme:changed', theme)
  }
}

function broadcastChatEvent(event: ChatEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('chats:event', event)
  }
}

/**
 * Follows the OS appearance.
 *
 * Only relevant while the preference is 'system'; an explicit choice must not
 * be overridden when macOS switches.
 */
function watchSystemTheme(service: OctopusService): void {
  nativeTheme.on('updated', () => {
    if (service.getConfig().theme !== 'system') return
    broadcastTheme(nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })
}

/**
 * Startup failures must be visible.
 *
 * If the config or state on disk cannot be read, the app previously died with
 * an unhandled rejection and an empty window. Showing the reason lets the user
 * act on it.
 */
async function start(): Promise<void> {
  let service: OctopusService

  try {
    service = await createService()
  } catch (error) {
    dialog.showErrorBox('octopus could not start', describeError(error))
    app.quit()
    return
  }

  const terminals = new TerminalManager()
  app.on('will-quit', () => {
    terminals.disposeAll()
    // Each live session holds a child process of its own; unclosed, they
    // outlive the application exactly as an orphaned pseudo-terminal would.
    void service.closeChats()
  })

  registerIpc(service, terminals, {
    // The cast goes through `unknown`: the injected signature is deliberately
    // narrower than Electron's, which types its arguments as `any`.
    handle: (channel, handler) => {
      ipcMain.handle(channel, handler as unknown as Parameters<typeof ipcMain.handle>[1])
    },
    showOpenDialog: async (options, parent) =>
      parent
        ? dialog.showOpenDialog(parent as BrowserWindow, options)
        : dialog.showOpenDialog(options),
    windowFor: (event) =>
      BrowserWindow.fromWebContents((event as Electron.IpcMainInvokeEvent).sender),
    prefersDark: () => nativeTheme.shouldUseDarkColors,
    broadcastTheme,
    broadcastChatEvent,
    openPath: (path) => shell.openPath(path)
  })
  watchSystemTheme(service)
  registerMenu()
  createWindow(resolveTheme(service.getConfig().theme, nativeTheme.shouldUseDarkColors))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(resolveTheme(service.getConfig().theme, nativeTheme.shouldUseDarkColors))
    }
  })
}

void app.whenReady().then(start)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
