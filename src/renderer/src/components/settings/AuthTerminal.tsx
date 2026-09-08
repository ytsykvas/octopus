import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'
import { Terminal } from '../Terminal.js'
import type { AuthSession } from './useAccounts.js'

/**
 * Hosts an interactive sign-in.
 *
 * The home directory is used as the working directory: these commands are not
 * tied to any repository, and starting in one would be arbitrary.
 */
export function AuthTerminal({
  session,
  onClose
}: {
  session: AuthSession
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [exitCode, setExitCode] = useState<number | null | undefined>(undefined)

  return (
    <div className="flex h-[28rem] flex-col">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">{t('settings.signInRunning', { service: session.label })}</p>
          <p className="text-ink-faint mt-0.5 truncate font-mono text-[11px]">
            {session.command.join(' ')}
          </p>
        </div>

        <Button variant={exitCode === undefined ? 'quiet' : 'accent'} onClick={onClose}>
          {t('settings.closeTerminal')}
        </Button>
      </div>

      <div className="panel min-h-0 flex-1 overflow-hidden p-2">
        <Terminal
          cwd="~"
          command={session.command}
          owner={{ workspaceId: null, purpose: 'auth' }}
          onExit={setExitCode}
        />
      </div>

      {exitCode !== undefined && (
        <p className={`mt-2 ${exitCode === 0 ? 'text-success' : 'text-danger'}`}>
          {exitCode === 0 && t('settings.signInDone')}
          {/* null means a signal killed it — a different situation from a
              command that ran and returned a failure code. */}
          {exitCode === null && t('settings.signInKilled')}
          {typeof exitCode === 'number' &&
            exitCode !== 0 &&
            t('settings.signInFailed', { code: exitCode })}
        </p>
      )}
    </div>
  )
}
