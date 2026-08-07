import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { AccountKind, AccountsStatus } from '@core/accounts.js'

export interface AuthSession {
  readonly kind: AccountKind
  readonly label: string
  readonly command: readonly string[]
}

export interface AccountsController {
  readonly status: AccountsStatus | null
  readonly checking: boolean
  readonly signingOut: AccountKind | null
  readonly error: string | null
  readonly session: AuthSession | null
  readonly refresh: () => Promise<void>
  readonly signIn: (kind: AccountKind, label: string) => void
  readonly signOut: (kind: AccountKind, label: string) => Promise<void>
  readonly endSession: () => void
}

/**
 * Account state shared by the Claude and Git sections.
 *
 * Both sections read the same status and drive the same two actions, so the
 * logic lives here rather than being duplicated in each of them.
 */
export function useAccounts(): AccountsController {
  const { t } = useTranslation()
  const [status, setStatus] = useState<AccountsStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [signingOut, setSigningOut] = useState<AccountKind | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  const signIn = useCallback((kind: AccountKind, label: string) => {
    setError(null)
    setSession({ kind, label, command: window.octopus.accounts.signInCommand(kind) })
  }, [])

  /** Signing out asks nothing, so it happens in place without a terminal. */
  const signOut = useCallback(
    async (kind: AccountKind, label: string) => {
      setSigningOut(kind)
      setError(null)

      try {
        const login = kind === 'github' ? (status?.github.login ?? null) : null
        const result = await window.octopus.accounts.signOut(kind, login)

        if (!result.ok || !result.value) {
          setError(t('settings.signOutFailed', { service: label }))
        }
        await refresh()
      } finally {
        setSigningOut(null)
      }
    },
    [refresh, status, t]
  )

  const endSession = useCallback(() => {
    setSession(null)
    void refresh()
  }, [refresh])

  return { status, checking, signingOut, error, session, refresh, signIn, signOut, endSession }
}
