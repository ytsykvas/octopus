import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'

import { describeError } from '../core/persist.js'
import { claimDataRoot } from '../core/dataLock.js'
import { rootDir } from '../core/paths.js'
import { createService, type OctopusService } from '../core/service.js'
import type { ThemeName } from '../core/types.js'
import {
  pushChatEvent,
  pushChatsChanged,
  pushChatStatus,
  pushConfig,
  pushSettingsOpen,
  pushTheme,
  pushUsageWindows,
  pushWorkspaceStatus
} from './broadcast.js'
import { registerIpc } from './ipc.js'
import { applyLoginShellPath } from './loginPath.js'
import { canvasColor, resolveTheme } from './theme.js'
import { TerminalManager } from './terminals.js'
import { focusExisting } from './windows.js'

/** Canvas colours from the design system (§10) — so the window does not flash white on launch. */

function createWindow(theme: ThemeName, terminals: TerminalManager): BrowserWindow {
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

  // A reload keeps this WebContents and loses everything the renderer knew, so
  // the sessions it can no longer reach go with the document that started them.
  // Fires on the first load too, where there is nothing to end.
  window.webContents.on('did-start-loading', () => {
    void terminals.disposeFor(window.webContents)
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
            pushSettingsOpen(BrowserWindow.getFocusedWindow())
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
 * Follows the OS appearance.
 *
 * Only relevant while the preference is 'system'; an explicit choice must not
 * be overridden when macOS switches.
 */
function watchSystemTheme(service: OctopusService): void {
  nativeTheme.on('updated', () => {
    if (service.getConfig().theme !== 'system') return
    pushTheme(BrowserWindow.getAllWindows(), nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
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
  // Launched from Finder the app inherits launchd's environment, where nothing
  // installed by Homebrew, mise or nvm appears — so git, gh and claude all go
  // missing at once. Before the service exists, so the first git call already
  // sees the repaired value.
  await applyLoginShellPath()

  /*
   * The data root, not Electron's directory.
   *
   * `requestSingleInstanceLock` above is keyed on **userData**, which is not
   * the scope two copies actually share: two builds resolving that name
   * differently each take their own and both start, then both write
   * `state.json` whole and the last one wins. This is keyed on `~/.octopus`
   * itself, so it holds however the build is named — and it is what a CLI or a
   * daemon, having no Electron, would rely on alone.
   *
   * Before the service, because the service reads the root as it is built:
   * losing here must mean never having opened the file at all.
   */
  const lock = await claimDataRoot(rootDir())

  if (!lock) {
    dialog.showErrorBox(
      'octopus is already running',
      'Another copy of octopus is using ~/.octopus. Two copies overwrite each ' +
        "other's projects and conversations, so this one will not start.\n\n" +
        'Quit the other one and try again.'
    )
    app.quit()
    return
  }

  // Released on the way out as well as by the process ending: a socket dies
  // with its process either way, and unlinking the file is what spares the next
  // start a probe.
  app.on('will-quit', () => {
    void lock.release()
  })

  let service: OctopusService

  try {
    service = await createService()
  } catch (error) {
    dialog.showErrorBox('octopus could not start', describeError(error))
    app.quit()
    return
  }

  const terminals = new TerminalManager()

  /*
   * The quit waits for what the sessions were writing, and then goes.
   *
   * `will-quit` is synchronous, so waiting means the usual dance: refuse the
   * first pass, quit again once the promise settles, and a flag so the second
   * pass falls through. Thrown away with `void`, as it was, the process exited
   * with a transcript append wherever it had got to — and a transcript is
   * append-only JSONL, so a line cut in half is a conversation that will not
   * reopen.
   *
   * It cannot hang: `closeChats` is bounded by `SHUTDOWN_GRACE_MS`, and what
   * ends at that ceiling is the waiting rather than the write.
   */
  let leaving = false
  app.on('will-quit', (event) => {
    if (leaving) return

    leaving = true
    event.preventDefault()

    // First and synchronously: each holds a pseudo-terminal, and one not
    // disposed outlives the application whatever happens after this line.
    terminals.disposeAll()

    void service.closeChats().finally(() => {
      app.quit()
    })
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
    // Each one hands `broadcast.ts` the windows to reach. The channel names
    // live there, where a test can name them; here is only the window list.
    broadcastTheme: (theme) => {
      pushTheme(BrowserWindow.getAllWindows(), theme)
    },
    broadcastChatEvent: (event) => {
      pushChatEvent(BrowserWindow.getAllWindows(), event)
    },
    broadcastWorkspaceStatus: (event) => {
      pushWorkspaceStatus(BrowserWindow.getAllWindows(), event)
    },
    broadcastUsageWindows: (windows) => {
      pushUsageWindows(BrowserWindow.getAllWindows(), windows)
    },
    broadcastChatStatus: (event) => {
      pushChatStatus(BrowserWindow.getAllWindows(), event)
    },
    broadcastChatsChanged: (event) => {
      pushChatsChanged(BrowserWindow.getAllWindows(), event)
    },
    broadcastConfig: (config) => {
      pushConfig(BrowserWindow.getAllWindows(), config)
    },
    openPath: (path) => shell.openPath(path)
  })
  watchSystemTheme(service)
  registerMenu()
  createWindow(resolveTheme(service.getConfig().theme, nativeTheme.shouldUseDarkColors), terminals)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(
        resolveTheme(service.getConfig().theme, nativeTheme.shouldUseDarkColors),
        terminals
      )
    }
  })
}

/*
 * One octopus at a time.
 *
 * Two copies both open `~/.octopus/state.json`, both hold it in memory and both
 * write it whole, so the last writer wins and whatever the other did is not
 * merged or refused but simply absent next time. `commit` serialising writes
 * and `writeJsonFile` renaming into place make a write orderly and untearable
 * within one process; neither is exclusive across two.
 *
 * Asked for before `whenReady`, as Electron documents. The instance that loses
 * never reaches `start`, so it never builds a service and never reads or writes
 * the data root at all — which is the whole of the point.
 *
 * The lock is keyed on Electron's own userData directory rather than on
 * `~/.octopus`, so a build whose userData differs is still unguarded. That is a
 * known limit, stated here rather than left unsaid.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusExisting(BrowserWindow.getAllWindows())
  })

  void app.whenReady().then(start)
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
