import { join } from 'node:path'

import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'

/** Кольори полотна з дизайн-системи (§10.7) — щоб вікно не блимало білим при старті. */
const CANVAS_LIGHT = '#ffffff'
const CANVAS_DARK = '#16161a'

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

function registerIpc(): void {
  ipcMain.handle('theme:get', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
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

void app.whenReady().then(() => {
  registerIpc()
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
