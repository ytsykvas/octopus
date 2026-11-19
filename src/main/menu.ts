import type { MenuItemConstructorOptions } from 'electron'

const PACKAGED_VIEW: MenuItemConstructorOptions = {
  label: 'View',
  submenu: [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ]
}

export function menuTemplate(options: {
  readonly packaged: boolean
  readonly openSettings: () => void
}): MenuItemConstructorOptions[] {
  return [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            options.openSettings()
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
    // A reload ends every terminal the window started; the inspector is a console
    // with `window.octopus`.
    options.packaged ? PACKAGED_VIEW : { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
}
