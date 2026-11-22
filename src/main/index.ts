import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } from 'electron'

import { describeError } from '../core/persist.js'
import { claimDataRoot, type DataLock } from '../core/dataLock.js'
import { electronUserDataDir, rootDir } from '../core/paths.js'
import { diagnosticLog } from '../core/diagnostics.js'
import {
  createService,
  type OctopusService,
  type ServiceOptions,
  statePathFor
} from '../core/service.js'
import { type BackupRecovery, openWithRecovery } from '../core/stateRecovery.js'
import type { ThemeName } from '../core/types.js'
import {
  pushChatEvent,
  pushChatsChanged,
  pushChatStatus,
  pushPullRequestDraft,
  pushTasks,
  pushConfig,
  pushSettingsOpen,
  pushTheme,
  pushUsageWindows,
  pushWorkspacePushed,
  pushWorkspaceStatus
} from './broadcast.js'
import { registerIpc } from './ipc.js'
import { applyLoginShellPath } from './loginPath.js'
import { canvasColor, resolveTheme, themeOnSystemChange } from './theme.js'
import { TerminalManager } from './terminals.js'
import {
  focusExisting,
  needsWindowOnActivate,
  quitsWhenAllClosed,
  webPreferencesFor
} from './windows.js'
import { menuTemplate } from './menu.js'
import { electronIpcHost } from './electronHost.js'
import { openInBrowser } from './externalLinks.js'
import { guardNavigation } from './navigation.js'
import { guardPermissions } from './permissions.js'
import { rendererUrl } from './rendererSource.js'
import { quitAfter } from './quit.js'
import { reportLoadFailure, reportRejection, watchRendererCrash } from './crash.js'

/** The one document a window may show — what it loads, and what the guards compare against. */
const appUrl = rendererUrl(
  process.env,
  app.isPackaged,
  join(import.meta.dirname, '../renderer/index.html')
)

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
    webPreferences: webPreferencesFor(import.meta.dirname, app.isPackaged)
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

  watchRendererCrash(window.webContents, {
    dispose: () => terminals.disposeFor(window.webContents),
    askReload: async (reason) => {
      // A crash before `ready-to-show` leaves the window hidden, and its sheet with it.
      window.show()
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: ['Reload', 'Close window'],
        defaultId: 0,
        // Without it Esc answers 0, which is Reload.
        cancelId: 1,
        message: 'The octopus window stopped working',
        detail: `Its page ended (${reason}). The terminals and servers it started have been stopped.`
      })
      return response === 0
    },
    close: () => {
      window.close()
    }
  })

  void window.loadURL(appUrl).catch(
    reportLoadFailure((title, content) => {
      dialog.showErrorBox(title, content)
    })
  )

  return window
}

function registerMenu(): void {
  const template = menuTemplate({
    packaged: app.isPackaged,
    openSettings: () => {
      pushSettingsOpen(BrowserWindow.getFocusedWindow())
    }
  })
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
    const theme = themeOnSystemChange(service.getConfig().theme, nativeTheme.shouldUseDarkColors)
    if (theme !== null) pushTheme(BrowserWindow.getAllWindows(), theme)
  })
}

/** Asks whether to put the backup in place of a state that cannot be read. */
function askRestore(recovery: BackupRecovery, error: unknown): boolean {
  // Before any window exists, so no sheet and no i18n: English, as the other startup boxes.
  const response = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['Restore', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    message: 'octopus could not read its saved state',
    detail:
      `${describeError(error)}\n\n` +
      `A copy from ${recovery.savedAt.toLocaleString()} with ${String(recovery.projects)} ` +
      'project(s) is beside it. Restoring keeps the damaged file next to it.'
  })
  return response === 0
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
   * `requestSingleInstanceLock` below is keyed on **userData**, which is not
   * the scope two copies actually share: two builds resolving that name
   * differently each take their own and both start, then both write
   * `state.json` whole and the last one wins. This is keyed on `~/.octopus`
   * itself, so it holds however the build is named — and it is what a CLI or a
   * daemon, having no Electron, would rely on alone.
   *
   * Before the service, because the service reads the root as it is built:
   * losing here must mean never having opened the file at all.
   */
  let lock: DataLock | null

  try {
    lock = await claimDataRoot(rootDir())
  } catch (error) {
    dialog.showErrorBox('octopus could not start', describeError(error))
    app.quit()
    return
  }

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

  let service: OctopusService

  try {
    const options: ServiceOptions = {
      onDiagnostic: diagnosticLog(join(app.getPath('logs'), 'main.log'))
    }
    const opened = await openWithRecovery(
      () => createService(options),
      askRestore,
      statePathFor(options)
    )
    if (opened === null) {
      await lock.release()
      app.quit()
      return
    }
    service = opened
  } catch (error) {
    dialog.showErrorBox('octopus could not start', describeError(error))
    await lock.release()
    app.quit()
    return
  }

  const terminals = new TerminalManager()

  // `quit.ts` holds why the quit waits, and why its second pass waits a tick.
  quitAfter(
    app,
    // First and synchronously: each holds a pseudo-terminal, and one not
    // disposed outlives the application whatever happens after this line.
    // Then waited for, since a group is gone only once it has emptied.
    () => terminals.disposeAll(),
    () => service.closeChats(),
    // Last, after every write: a second copy may take the root the moment it goes.
    lock.release
  )

  registerIpc(service, terminals, {
    ...electronIpcHost({
      ipcMain,
      dialog,
      fromWebContents: (sender) => BrowserWindow.fromWebContents(sender)
    }),
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
    broadcastWorkspacePushed: (event) => {
      pushWorkspacePushed(BrowserWindow.getAllWindows(), event)
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
    broadcastTasks: (event) => {
      pushTasks(BrowserWindow.getAllWindows(), event)
    },
    broadcastPullRequestDraft: (event) => {
      pushPullRequestDraft(BrowserWindow.getAllWindows(), event)
    },
    broadcastConfig: (config) => {
      pushConfig(BrowserWindow.getAllWindows(), config)
    },
    openPath: (path) => shell.openPath(path)
  })
  watchSystemTheme(service)
  guardPermissions(session.defaultSession, appUrl)
  registerMenu()
  createWindow(resolveTheme(service.getConfig().theme, nativeTheme.shouldUseDarkColors), terminals)

  app.on('activate', () => {
    if (needsWindowOnActivate(BrowserWindow.getAllWindows())) {
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
 *
 * A copy given its own data root (`OCTOPUS_DATA_DIR`, how a development copy
 * runs beside the real app) moves userData into it first. Left alone, userData
 * would still be the shared one and the lock would refuse the second copy even
 * though the two no longer share any data.
 */
const userData = electronUserDataDir()
if (userData !== null) app.setPath('userData', userData)

// Electron shows a modal for an uncaught exception but only a stderr warning for a
// rejection. Never `uncaughtException`: a listener of ours would remove that modal.
process.on(
  'unhandledRejection',
  reportRejection((title, content) => {
    dialog.showErrorBox(title, content)
  })
)

// Every WebContents, so a window added later is covered without remembering to:
// neither a navigation nor a window it opens may leave the application's document.
app.on('web-contents-created', (_event, contents) => {
  guardNavigation(contents, appUrl)
  contents.setWindowOpenHandler(openInBrowser((url) => shell.openExternal(url)))
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusExisting(BrowserWindow.getAllWindows())
  })

  void app.whenReady().then(start)
}

app.on('window-all-closed', () => {
  if (quitsWhenAllClosed(process.platform)) app.quit()
})
