import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { menuTemplate } from './menu.js'

function roles(items: readonly MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role === undefined ? [] : [item.role]),
    ...(Array.isArray(item.submenu) ? roles(item.submenu) : [])
  ])
}

describe('menuTemplate', () => {
  it('leaves reload and the inspector out of a packaged app, and keeps the rest', () => {
    expect(roles(menuTemplate({ packaged: true, openSettings: vi.fn() }))).toEqual([
      'appMenu',
      'about',
      'services',
      'hide',
      'hideOthers',
      'unhide',
      'quit',
      'editMenu',
      'resetZoom',
      'zoomIn',
      'zoomOut',
      'togglefullscreen',
      'windowMenu'
    ])
  })

  it('keeps the whole View menu outside a packaged app', () => {
    expect(roles(menuTemplate({ packaged: false, openSettings: vi.fn() }))).toContain('viewMenu')
  })

  it('opens settings from ⌘,', () => {
    const openSettings = vi.fn<() => void>()
    const settings = menuTemplate({ packaged: true, openSettings })
      .flatMap((item) => (Array.isArray(item.submenu) ? item.submenu : []))
      .find((item) => item.label === 'Settings…')
    const click = settings?.click as (() => void) | undefined

    click?.()

    expect(settings?.accelerator).toBe('CmdOrCtrl+,')
    expect(openSettings).toHaveBeenCalledTimes(1)
  })
})
