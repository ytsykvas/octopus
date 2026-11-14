/** What main does when a window's renderer dies, or a promise fails with nobody listening. */
import type { RenderProcessGoneDetails, WebContents } from 'electron'

import { describeError } from '../core/persist.js'

export type CrashableContents = Pick<WebContents, 'on' | 'reload'>

export interface CrashRecovery {
  dispose: () => Promise<void>
  askReload: (reason: RenderProcessGoneDetails['reason']) => Promise<boolean>
  close: () => void
}

// A crash keeps the WebContents, so `destroyed` never comes; close, destroy and quit
// raise no `render-process-gone` at all (Electron 45), so every reason is a crash.
export function watchRendererCrash(contents: CrashableContents, recovery: CrashRecovery): void {
  contents.on('render-process-gone', (_event, { reason }) => {
    void recovery
      .dispose()
      .then(() => recovery.askReload(reason))
      .then((reload) => {
        if (reload) contents.reload()
        else recovery.close()
      })
  })
}

export function reportRejection(
  showError: (title: string, content: string) => void
): (reason: unknown) => void {
  return (reason) => {
    showError('octopus hit an unexpected error', describeError(reason))
  }
}
