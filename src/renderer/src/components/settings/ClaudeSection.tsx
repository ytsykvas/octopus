import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'
import { AccountCard } from './AccountCard.js'
import { AuthTerminal } from './AuthTerminal.js'
import type { AccountsController } from './useAccounts.js'

/**
 * The Claude account — the one the agent runs on.
 *
 * octopus never handles credentials: the CLI keeps them in the system
 * keychain, and this screen only reports what it says.
 */
export function ClaudeSection({ accounts }: { accounts: AccountsController }): React.JSX.Element {
  const { t } = useTranslation()
  const label = t('settings.claudeAccount')

  if (accounts.session?.kind === 'claude') {
    return <AuthTerminal session={accounts.session} onClose={accounts.endSession} />
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-ink-faint max-w-md leading-relaxed">{t('settings.accountsHint')}</p>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => void accounts.refresh()}
          disabled={accounts.checking}
        >
          {t('settings.recheck')}
        </Button>
      </div>

      <AccountCard
        title={label}
        hint={t('settings.claudeAccountHint')}
        connected={accounts.status?.claude.connected ?? false}
        primary={accounts.status?.claude.email ?? null}
        details={[
          { label: t('settings.plan'), value: accounts.status?.claude.subscriptionType ?? null },
          { label: t('settings.organisation'), value: accounts.status?.claude.orgName ?? null }
        ]}
        busy={accounts.signingOut === 'claude'}
        onSignIn={() => {
          accounts.signIn('claude', label)
        }}
        onSignOut={() => {
          void accounts.signOut('claude', label)
        }}
      />

      {accounts.error !== null && <p className="text-danger">{accounts.error}</p>}

      <p className="text-ink-faint leading-relaxed">{t('settings.opensTerminal')}</p>
    </div>
  )
}
