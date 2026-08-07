import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AccountKind, AccountsStatus } from '@core/accounts.js'

import { Button } from '../Button.js'
import { Terminal } from '../Terminal.js'

/**
 * Connected accounts.
 *
 * octopus never handles credentials: both `claude` and `gh` keep them in the
 * system keychain, and this screen only reports what those tools say. Signing
 * in runs in an embedded terminal, because both CLIs are interactive.
 */
export function AccountsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const [status, setStatus] = useState<AccountsStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [session, setSession] = useState<AuthSession | null>(null)

  const refresh = useCallback(async () => {
    setChecking(true)
    try {
      const result = await window.octopus.accounts.status()
      if (result.ok) setStatus(result.value)
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.accounts.status()
      if (!controller.signal.aborted && result.ok) setStatus(result.value)
    })()

    return () => {
      controller.abort()
    }
  }, [])

  if (session) {
    return (
      <AuthTerminal
        session={session}
        onClose={() => {
          setSession(null)
          void refresh()
        }}
      />
    )
  }

  const startAuth = (kind: AccountKind, action: 'login' | 'logout', label: string): void => {
    setSession({ kind, action, label, command: window.octopus.accounts.authCommand(kind, action) })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-ink-faint max-w-md leading-relaxed">{t('settings.accountsHint')}</p>
        <Button variant="quiet" size="sm" onClick={() => void refresh()} disabled={checking}>
          {t('settings.recheck')}
        </Button>
      </div>

      <AccountCard
        title={t('settings.claudeAccount')}
        hint={t('settings.claudeAccountHint')}
        connected={status?.claude.connected ?? false}
        primary={status?.claude.email ?? null}
        details={[
          { label: t('settings.plan'), value: status?.claude.subscriptionType ?? null },
          { label: t('settings.organisation'), value: status?.claude.orgName ?? null }
        ]}
        onSignIn={() => {
          startAuth('claude', 'login', t('settings.claudeAccount'))
        }}
        onSignOut={() => {
          startAuth('claude', 'logout', t('settings.claudeAccount'))
        }}
      />

      <AccountCard
        title={t('settings.githubAccount')}
        hint={t('settings.githubAccountHint')}
        connected={status?.github.connected ?? false}
        primary={status?.github.login ?? null}
        details={[{ label: '', value: status?.github.name ?? null }]}
        onSignIn={() => {
          startAuth('github', 'login', t('settings.githubAccount'))
        }}
        onSignOut={() => {
          startAuth('github', 'logout', t('settings.githubAccount'))
        }}
      />

      <p className="text-ink-faint leading-relaxed">{t('settings.opensTerminal')}</p>
    </div>
  )
}

interface AuthSession {
  readonly kind: AccountKind
  readonly action: 'login' | 'logout'
  readonly label: string
  readonly command: readonly string[]
}

/**
 * Hosts the interactive sign-in.
 *
 * The home directory is used as the working directory: these commands are not
 * tied to any repository, and starting in one would be arbitrary.
 */
function AuthTerminal({
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
        <Terminal cwd="~" command={session.command} onExit={setExitCode} />
      </div>

      {exitCode !== undefined && (
        <p className={`mt-2 ${exitCode === 0 ? 'text-success' : 'text-danger'}`}>
          {exitCode === 0
            ? t('settings.signInDone')
            : t('settings.signInFailed', { code: exitCode ?? '—' })}
        </p>
      )}
    </div>
  )
}

interface AccountCardProps {
  readonly title: string
  readonly hint: string
  readonly connected: boolean
  readonly primary: string | null
  readonly details: readonly { label: string; value: string | null }[]
  readonly onSignIn: () => void
  readonly onSignOut: () => void
}

function AccountCard({
  title,
  hint,
  connected,
  primary,
  details,
  onSignIn,
  onSignOut
}: AccountCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const shown = details.filter((detail) => detail.value !== null)

  return (
    <article className="panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            <StatusDot connected={connected} />
            <span className={connected ? 'text-success' : 'text-ink-faint'}>
              {connected ? t('settings.connected') : t('settings.notConnected')}
            </span>
          </div>

          {primary !== null && (
            <p className="text-ink-soft mt-1 truncate font-mono text-[11px]">{primary}</p>
          )}

          <p className="text-ink-faint mt-1.5 leading-relaxed">{hint}</p>
        </div>

        <Button variant={connected ? 'quiet' : 'accent'} onClick={connected ? onSignOut : onSignIn}>
          {connected ? t('settings.signOut') : t('settings.signIn')}
        </Button>
      </div>

      {shown.length > 0 && (
        <dl className="border-line mt-3 space-y-1 border-t pt-3">
          {shown.map((detail) => (
            <div key={detail.label + String(detail.value)} className="flex justify-between gap-4">
              <dt className="text-ink-faint">{detail.label}</dt>
              <dd className="text-ink-soft truncate">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}

function StatusDot({ connected }: { connected: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`size-1.5 rounded-full ${connected ? 'bg-success' : 'bg-ink-faint'}`}
    />
  )
}
