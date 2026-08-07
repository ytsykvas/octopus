import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  Config,
  LanguagePreference,
  SettingSourcesMode,
  ThemePreference
} from '@core/config.js'

import { Button } from './Button.js'
import { AccountCard } from './settings/AccountCard.js'
import { AuthTerminal } from './settings/AuthTerminal.js'
import { ClaudeSection } from './settings/ClaudeSection.js'
import { type AccountsController, useAccounts } from './settings/useAccounts.js'

interface SettingsProps {
  readonly config: Config
  readonly onChange: (patch: Partial<Config>) => Promise<void>
  readonly onClose: () => void
}

type SectionId = 'general' | 'git' | 'agent' | 'accounts' | 'about'

const SECTIONS: readonly {
  readonly id: SectionId
  readonly labelKey:
    | 'settings.sectionGeneral'
    | 'settings.sectionGit'
    | 'settings.sectionAgent'
    | 'settings.sectionAccounts'
    | 'settings.sectionAbout'
  readonly icon: string
}[] = [
  { id: 'general', labelKey: 'settings.sectionGeneral', icon: '◐' },
  { id: 'git', labelKey: 'settings.sectionGit', icon: '⑂' },
  { id: 'agent', labelKey: 'settings.sectionAgent', icon: '✦' },
  { id: 'accounts', labelKey: 'settings.sectionAccounts', icon: '◉' },
  { id: 'about', labelKey: 'settings.sectionAbout', icon: 'ⓘ' }
]

/**
 * Settings, split into sections with a navigation rail — the shape macOS
 * System Settings uses, so the layout is already familiar.
 *
 * Changes apply immediately; there is no Save button. For a local tool with a
 * handful of options a confirmation step only adds friction.
 */
export function Settings({ config, onChange, onClose }: SettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<SectionId>('general')
  // Shared between the Claude and Git sections, which show the same accounts.
  const accounts = useAccounts()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="bg-canvas absolute inset-0 z-10 flex flex-col">
      <header className="titlebar-drag border-line flex h-11 shrink-0 items-center justify-between border-b px-4 pl-24">
        <span className="font-medium">{t('settings.title')}</span>
        <Button variant="quiet" size="sm" onClick={onClose}>
          {t('settings.close')}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="border-line bg-surface w-48 shrink-0 border-r p-2">
          <ul className="space-y-px">
            {SECTIONS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSection(item.id)
                  }}
                  className={`row focus-ring flex w-full items-center gap-2 px-2 py-1.5 ${
                    section === item.id ? 'row-selected font-medium' : 'text-ink-soft'
                  }`}
                >
                  <span aria-hidden className="w-4 text-center">
                    {item.icon}
                  </span>
                  {t(item.labelKey)}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex-1 overflow-auto">
          <div className="max-w-2xl space-y-6 p-8">
            {section === 'general' && <GeneralSection config={config} onChange={onChange} />}
            {section === 'git' && (
              <GitSection config={config} onChange={onChange} accounts={accounts} />
            )}
            {section === 'agent' && <AgentSection config={config} onChange={onChange} />}
            {section === 'accounts' && <ClaudeSection accounts={accounts} />}
            {section === 'about' && <AboutSection config={config} />}
          </div>
        </div>
      </div>
    </div>
  )
}

interface SectionProps {
  readonly config: Config
  readonly onChange: (patch: Partial<Config>) => Promise<void>
}

function GeneralSection({ config, onChange }: SectionProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <Field label={t('settings.theme')}>
        <Segmented<ThemePreference>
          value={config.theme}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'light', label: t('settings.themeLight') },
            { value: 'dark', label: t('settings.themeDark') }
          ]}
          onChange={(theme) => void onChange({ theme })}
        />
      </Field>

      <Field label={t('settings.language')} hint={t('settings.languageHint')}>
        <Segmented<LanguagePreference>
          value={config.language}
          options={[
            { value: 'en', label: 'English' },
            { value: 'uk', label: 'Українська' }
          ]}
          onChange={(language) => void onChange({ language })}
        />
      </Field>
    </div>
  )
}

/**
 * Git settings, including the GitHub account.
 *
 * The account lives here rather than under Claude because everything it
 * affects — branches, pull requests, checks — is git work.
 */
function GitSection({
  config,
  onChange,
  accounts
}: SectionProps & { accounts: AccountsController }): React.JSX.Element {
  const { t } = useTranslation()
  const label = t('settings.githubAccount')

  if (accounts.session?.kind === 'github') {
    return <AuthTerminal session={accounts.session} onClose={accounts.endSession} />
  }

  return (
    <div className="space-y-6">
      <Field label={t('settings.branchPrefix')} hint={t('settings.branchPrefixHint')}>
        {/* key resets the draft when the stored value changes — the
            React-recommended alternative to syncing props into state. */}
        <BranchPrefixInput
          key={config.branchPrefix}
          value={config.branchPrefix}
          onCommit={(branchPrefix) => void onChange({ branchPrefix })}
        />
      </Field>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <p className="text-ink-faint max-w-md leading-relaxed">{t('settings.gitHint')}</p>
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
          hint={t('settings.githubAccountHint')}
          connected={accounts.status?.github.connected ?? false}
          primary={accounts.status?.github.login ?? null}
          details={[{ label: '', value: accounts.status?.github.name ?? null }]}
          busy={accounts.signingOut === 'github'}
          onSignIn={() => {
            accounts.signIn('github', label)
          }}
          onSignOut={() => {
            void accounts.signOut('github', label)
          }}
        />

        {accounts.error !== null && <p className="text-danger">{accounts.error}</p>}
      </div>
    </div>
  )
}

function AgentSection({ config, onChange }: SectionProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Field label={t('settings.settingSources')} hint={t('settings.settingSourcesHint')}>
      <RadioList<SettingSourcesMode>
        value={config.settingSources}
        options={[
          {
            value: 'none',
            label: t('settings.settingSourcesNone'),
            hint: t('settings.settingSourcesNoneHint')
          },
          {
            value: 'project',
            label: t('settings.settingSourcesProject'),
            hint: t('settings.settingSourcesProjectHint')
          },
          {
            value: 'all',
            label: t('settings.settingSourcesAll'),
            hint: t('settings.settingSourcesAllHint')
          }
        ]}
        onChange={(settingSources) => void onChange({ settingSources })}
      />
    </Field>
  )
}

function AboutSection({ config }: { config: Config }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <ReadOnlyRow label={t('settings.deviceId')} value={config.deviceId} />
      <ReadOnlyRow
        label={t('settings.installedAt')}
        value={new Date(config.installedAt).toLocaleString()}
      />
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div>
      <p className="mb-1.5 font-medium">{label}</p>
      {children}
      {hint !== undefined && (
        <p className="text-ink-faint mt-1.5 max-w-lg leading-relaxed">{hint}</p>
      )}
    </div>
  )
}

/** A value the user can read and copy but not change. */
function ReadOnlyRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-ink-soft">{label}</span>
      <span className="text-ink-faint truncate font-mono text-[11px]" title={value}>
        {value}
      </span>
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="border-line bg-muted inline-flex rounded-[var(--radius-control)] border p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            onChange(option.value)
          }}
          className={`focus-ring h-6 rounded-[4px] px-3 font-medium transition-colors ${
            value === option.value ? 'bg-canvas text-ink' : 'text-ink-soft hover:text-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function RadioList<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: readonly { value: T; label: string; hint: string }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="max-w-lg space-y-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            onChange(option.value)
          }}
          className={`focus-ring border-line block w-full rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors ${
            value === option.value ? 'row-selected' : 'hover:bg-muted'
          }`}
        >
          <span className="font-medium">{option.label}</span>
          <span className="text-ink-faint mt-0.5 block leading-relaxed">{option.hint}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Committed on blur rather than on every keystroke — writing the config on
 * each character would hammer the disk for no benefit.
 */
function BranchPrefixInput({
  value,
  onCommit
}: {
  value: string
  onCommit: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(value)

  const trimmed = draft.trim()
  const invalid = trimmed.length === 0

  return (
    <div>
      <input
        type="text"
        value={draft}
        spellCheck={false}
        onChange={(event) => {
          setDraft(event.target.value)
        }}
        onBlur={() => {
          if (invalid) {
            setDraft(value)
            return
          }
          if (trimmed !== value) onCommit(trimmed)
        }}
        className={`focus-ring bg-canvas h-7 w-64 rounded-[var(--radius-control)] border px-2 font-mono ${
          invalid ? 'border-danger' : 'border-line'
        }`}
      />
      {invalid && <p className="text-danger mt-1.5">{t('settings.branchPrefixEmpty')}</p>}
    </div>
  )
}
