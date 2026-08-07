import { join } from 'node:path'

import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'

import { describeError } from '../core/persist.js'
import { createService, type MaestroService } from '../core/service.js'

/** Кольори полотна з дизайн-системи (§10.7) — щоб вікно не блимало білим при старті. */
const CANVAS_LIGHT = '#ffffff'
const CANVAS_DARK = '#0f1115'

/**
 * Результат операції у вигляді значення, а не винятку.
 *
 * Помилки ядра осмислені й призначені користувачеві (напр. «тека не є
 * git-репозиторієм»), тому вони мають дійти до UI текстом, а не перетворитися
 * на безлике «Error invoking remote method» (§13 docs/PROJECT.md).
 */
type Result<T> = { ok: true; value: T } | { ok: false; error: string }

async function attempt<T>(operation: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
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
    // §10.5: hiddenInset лишається, vibrancy свідомо не використовується —
    // напівпрозорі матеріали конфліктують із суцільними кольорами необруталізму.
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

  // Зовнішні посилання відкриваються в браузері, а не всередині застосунку.
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
 * Реєструє IPC.
 *
 * Обробники навмисно однорядкові: уся логіка живе в сервісі ядра, а цей
 * шар лише переадресовує виклики (§11.1).
 */
function registerIpc(service: MaestroService): void {
  ipcMain.handle('theme:get', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))

  ipcMain.handle('config:get', () => attempt(() => service.getConfig()))

  ipcMain.handle('projects:list', () => attempt(() => service.listProjects()))

  ipcMain.handle('projects:remove', (_event, projectId: string) =>
    attempt(() => service.removeProjectById(projectId))
  )

  // Вибір теки — єдина частина, що належить саме main: діалог дає Electron.
  ipcMain.handle('projects:add', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const picked = window
      ? await dialog.showOpenDialog(window, {
          title: 'Виберіть репозиторій',
          properties: ['openDirectory'],
          buttonLabel: 'Додати'
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
