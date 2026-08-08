/**
 * Which theme the window should use.
 *
 * The system preference arrives as a parameter rather than being read from
 * `nativeTheme` here, so the decision is testable without Electron — and the
 * one place that reads the OS stays in the bootstrap.
 */

import type { ThemePreference } from '../core/config.js'
import type { ThemeName } from '../core/types.js'

/** Window background, applied before the renderer paints. */
const CANVAS_LIGHT = '#ffffff'
const CANVAS_DARK = '#0f1115'

/**
 * Resolves the effective theme.
 *
 * The config wins over the system: `system` defers to the OS, while an explicit
 * choice is honoured regardless of what the OS is doing.
 */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ThemeName {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

/**
 * Background colour for the native window.
 *
 * Set on the window itself, not only in CSS: without it a new window flashes
 * white before the renderer has painted, which is glaring in the dark theme.
 */
export function canvasColor(theme: ThemeName): string {
  return theme === 'dark' ? CANVAS_DARK : CANVAS_LIGHT
}
