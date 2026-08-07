import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'

export interface AccountCardProps {
  readonly title: string
  readonly hint: string
  readonly connected: boolean
  /** The account's own identifier — an email or a login. */
  readonly primary: string | null
  readonly details: readonly { label: string; value: string | null }[]
  readonly onSignIn: () => void
  readonly onSignOut: () => void
  readonly busy: boolean
}

/**
 * One connected service.
 *
 * Shared by the Claude and Git sections, which show the same thing about
 * different tools.
 */
export function AccountCard({
  title,
  hint,
  connected,
  primary,
  details,
  onSignIn,
  onSignOut,
  busy
}: AccountCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const shown = details.filter((detail) => detail.value !== null)

  return (
    <article className="panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${connected ? 'bg-success' : 'bg-ink-faint'}`}
            />
            <span className={connected ? 'text-success' : 'text-ink-faint'}>
              {connected ? t('settings.connected') : t('settings.notConnected')}
            </span>
          </div>

          {primary !== null && (
            <p className="text-ink-soft mt-1 truncate font-mono text-[11px]">{primary}</p>
          )}

          <p className="text-ink-faint mt-1.5 leading-relaxed">{hint}</p>
        </div>

        <Button
          variant={connected ? 'quiet' : 'accent'}
          onClick={connected ? onSignOut : onSignIn}
          disabled={busy}
        >
          {busy
            ? t('settings.signingOut')
            : connected
              ? t('settings.signOut')
              : t('settings.signIn')}
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
