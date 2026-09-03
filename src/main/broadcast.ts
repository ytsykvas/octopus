/**
 * Every channel the main process pushes on, and the only place their names are
 * written.
 *
 * Lifted out of `index.ts` because that file is the composition root: it is on
 * `bootstrapOnly`, nothing in `src` imports it, and no test can reach it
 * whatever the coverage config says. Six channel names lived there and nowhere
 * else, so a rename was invisible to the whole gate — `usage:windows` was
 * changed to `usage:window` and 2 099 tests passed with a clean typecheck.
 *
 * The asymmetry is what makes a test here worth writing. Every listening half
 * is already asserted by name in `preload/index.test.ts`, and because preload
 * holds an independently written second copy, naming the string on this side
 * catches a one-sided rename the way `EXPECTED` and `CALLS` do for the invoke
 * channels.
 *
 * The windows arrive as a parameter rather than through
 * `BrowserWindow.getAllWindows()`, which is the seam `terminals.ts` already
 * uses: a test fills it with objects that collect what was sent.
 */

import type { ThemeName } from '../core/types.js'
import { canvasColor } from './theme.js'

/**
 * What a push needs of a window.
 *
 * Structural rather than `BrowserWindow`, so the module imports no Electron and
 * a test needs no framework. A real `BrowserWindow` satisfies it as it stands.
 */
export interface PushTarget {
  readonly webContents: { readonly send: (channel: string, payload?: unknown) => void }
  readonly setBackgroundColor: (color: string) => void
}

function pushAll(targets: readonly PushTarget[], channel: string, payload: unknown): void {
  for (const target of targets) target.webContents.send(channel, payload)
}

/**
 * The appearance, with the canvas colour applied first.
 *
 * The background is set as well as announced because the window paints it
 * before the renderer has drawn anything: without it a dark window flashes
 * white on every switch.
 */
export function pushTheme(targets: readonly PushTarget[], theme: ThemeName): void {
  for (const target of targets) {
    target.setBackgroundColor(canvasColor(theme))
    target.webContents.send('theme:changed', theme)
  }
}

export function pushChatEvent(targets: readonly PushTarget[], event: unknown): void {
  pushAll(targets, 'chats:event', event)
}

export function pushWorkspaceStatus(targets: readonly PushTarget[], event: unknown): void {
  pushAll(targets, 'workspaces:status', event)
}

export function pushUsageWindows(targets: readonly PushTarget[], windows: unknown): void {
  pushAll(targets, 'usage:windows', windows)
}

export function pushChatStatus(targets: readonly PushTarget[], event: unknown): void {
  pushAll(targets, 'chats:status', event)
}

/**
 * Opens Settings in the window the user is looking at.
 *
 * The one push that is not a broadcast, which is why it takes a single target
 * and why nobody grepping for the broadcast pattern ever found it. Absent when
 * the application is focused with no window open, and then there is nobody to
 * open Settings for.
 */
export function pushSettingsOpen(target: PushTarget | null): void {
  target?.webContents.send('settings:open')
}
