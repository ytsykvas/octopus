import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'

import { type AccountKind, checkAccounts, signOut } from '../core/accounts.js'
import type { Config, ThemePreference } from '../core/config.js'
import { describeError } from '../core/persist.js'
import { GitHubError, type RemoteRepository } from '../core/github.js'
import { ProjectValidationError } from '../core/projects.js'
import { createService, type OctopusService } from '../core/service.js'
import { TerminalSpecSchema } from '../core/terminal.js'
import type { ThemeName } from '../core/types.js'
import { TerminalManager } from './terminals.js'

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
    if (error instanceof ProjectValidationError || error instanceof GitHubError) {
      return { ok: false, error: error.message, code: error.code, params: error.params }
    }
    return { ok: false, error: describeError(error) }
  }
}

/**
 * Resolves the effective theme.
 *
 * The config wins over the system: 'system' defers to macOS, while an
 * explicit choice is honoured regardless of what the OS is doing.
 */
function resolveTheme(preference: ThemePreference): ThemeName {
  if (preference === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return preference
}

function canvasColor(theme: ThemeName): string {
  return theme === 'dark' ? CANVAS_DARK : CANVAS_LIGHT
}

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
 * Registers IPC handlers.
 *
 * They are deliberately one-liners: all logic lives in the core service and
 * this layer only forwards calls (§11.1).
 */
function registerIpc(service: OctopusService, terminals: TerminalManager): void {
  ipcMain.handle('theme:get', () => resolveTheme(service.getConfig().theme))

  ipcMain.handle('config:get', () => attempt(() => service.getConfig()))

  ipcMain.handle('config:update', (_event, patch: Partial<Config>) =>
    attempt(async () => {
      const updated = await service.updateConfig(patch)
      broadcastTheme(resolveTheme(updated.theme))
      return updated
    })
  )

  ipcMain.handle('projects:list', () => attempt(() => service.listProjects()))

  ipcMain.handle('accounts:status', () => attempt(() => checkAccounts()))

  // Signing out asks nothing, so it runs silently rather than in a terminal.
  ipcMain.handle('accounts:signOut', (_event, kind: AccountKind, login: string | null) =>
    attempt(() => signOut(kind, login))
  )

  // Terminal sessions. The spec is validated rather than trusted: it arrives
  // over IPC and ends up as a working directory and a command line.
  ipcMain.handle('terminal:create', (event, spec: unknown) =>
    attempt(() => terminals.create(TerminalSpecSchema.parse(spec), event.sender))
  )

  ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
    terminals.write(id, data)
  })

  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    terminals.resize(id, cols, rows)
  })

  ipcMain.handle('terminal:dispose', (_event, id: string) => {
    terminals.dispose(id)
  })

  ipcMain.handle('projects:remove', (_event, projectId: string) =>
    attempt(() => service.removeProjectById(projectId))
  )

  ipcMain.handle('projects:listRemote', () => attempt(() => service.listRemoteRepositories()))

  // Choosing a directory needs Electron's dialog, so it lives here.
  ipcMain.handle('dialog:pickDirectory', async (event, title: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title,
      properties: ['openDirectory', 'createDirectory']
    }

    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    const [chosen] = picked.filePaths
    return { ok: true, value: picked.canceled ? null : (chosen ?? null) }
  })

  ipcMain.handle('projects:addFromGitHub', async (event, repository: RemoteRepository) => {
    const destination = await resolveCloneDirectory(service, event)
    if (destination === null) return { ok: true, value: null }

    return attempt(() => service.addProjectFromGitHub(repository, destination))
  })

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

/**
 * Where a cloned repository should land.
 *
 * A configured directory is used silently; otherwise the user picks one and
 * the choice is remembered, so the question is asked once rather than on
 * every clone.
 */
async function resolveCloneDirectory(
  service: OctopusService,
  event: Electron.IpcMainInvokeEvent
): Promise<string | null> {
  const configured = service.getConfig().cloneDirectory
  if (configured !== '') return configured

  const window = BrowserWindow.fromWebContents(event.sender)
  const picked = window
    ? await dialog.showOpenDialog(window, {
        title: 'Where should repositories be cloned?',
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: 'Clone here'
      })
    : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })

  const [chosen] = picked.filePaths
  if (picked.canceled || chosen === undefined) return null

  await service.updateConfig({ cloneDirectory: chosen })
  return chosen
}

function broadcastTheme(theme: ThemeName): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.setBackgroundColor(canvasColor(theme))
    window.webContents.send('theme:changed', theme)
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
  })

  registerIpc(service, terminals)
  watchSystemTheme(service)
  registerMenu()
  createWindow(resolveTheme(service.getConfig().theme))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(resolveTheme(service.getConfig().theme))
    }
  })
}

void app.whenReady().then(start)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
