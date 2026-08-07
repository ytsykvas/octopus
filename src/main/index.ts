import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'

import { describeError } from '../core/persist.js'
import { ProjectValidationError } from '../core/projects.js'
import { createService, type MaestroService } from '../core/service.js'

/** Canvas colours from the design system (§10) — so the window does not flash white on launch. */
const CANVAS_LIGHT = '#ffffff'
const CANVAS_DARK = '#0f1115'

/**
 * Operation outcome as a value rather than an exception.
 *
 * Core errors are meaningful and meant for the user (e.g. "not a git
 * repository"), so they must reach the UI intact instead of collapsing into
 * a generic "Error invoking remote method" (§13 docs/PROJECT.md).
 *
 * Validation failures also carry a code and params, so the renderer can
 * render a localised message rather than the raw English fallback.
 */
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: string; params?: Readonly<Record<string, string>> }

async function attempt<T>(operation: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    if (error instanceof ProjectValidationError) {
      return { ok: false, error: error.message, code: error.code, params: error.params }
    }
    return { ok: false, error: describeError(error) }
  }
}

function canvasColor(): string {
  return nativeTheme.shouldUseDarkColors ? CANVAS_DARK : CANVAS_LIGHT
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    show: false,
    backgroundColor: canvasColor(),
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
 * Registers IPC handlers.
 *
 * They are deliberately one-liners: all logic lives in the core service and
 * this layer only forwards calls (§11.1).
 */
function registerIpc(service: MaestroService): void {
  ipcMain.handle('theme:get', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))

  ipcMain.handle('config:get', () => attempt(() => service.getConfig()))

  ipcMain.handle('projects:list', () => attempt(() => service.listProjects()))

  ipcMain.handle('projects:remove', (_event, projectId: string) =>
    attempt(() => service.removeProjectById(projectId))
  )

  // Picking a directory is the one part that genuinely belongs to main:
  // the dialog is an Electron API.
  ipcMain.handle('projects:add', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const picked = window
      ? await dialog.showOpenDialog(window, {
          title: 'Select a repository',
          properties: ['openDirectory'],
          buttonLabel: 'Add'
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })

    const [path] = picked.filePaths
    if (picked.canceled || !path) return { ok: true, value: null }

    return attempt(() => service.addProjectFromPath(path))
  })
}

function broadcastThemeChanges(): void {
  nativeTheme.on('updated', () => {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(canvasColor())
      window.webContents.send('theme:changed', theme)
    }
  })
}

void app.whenReady().then(async () => {
  const service = await createService()

  registerIpc(service)
  broadcastThemeChanges()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
