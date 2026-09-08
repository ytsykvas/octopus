import {
  Blocks,
  BookText,
  Bot,
  GitBranch,
  Info,
  type LucideIcon,
  Monitor,
  Sparkles,
  SquareSlash
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentModel, DEFAULT_MODEL, type Effort, type WorkingMode } from '@core/chats.js'
import type {
  Config,
  LanguagePreference,
  SettingSourcesMode,
  ThemePreference
} from '@core/config.js'
import { type StandingPermission, standingKey } from '@core/standingPermissions.js'

import { useModels } from '../hooks/useModels.js'
import { InstructionEditors } from './InstructionEditors.js'
import { Button } from './Button.js'
import { modelRows } from './chat/modelRows.js'
import { Field } from './Field.js'
import { Mascot } from './Mascot.js'
import { Modal } from './Modal.js'
import { SectionRail } from './SectionRail.js'
import { AccountCard } from './settings/AccountCard.js'
import { AuthTerminal } from './settings/AuthTerminal.js'
import { ClaudeSection } from './settings/ClaudeSection.js'
import { LibrarySection } from './settings/LibrarySection.js'
import { SkillsSection } from './settings/SkillsSection.js'
import { type AccountsController, useAccounts } from './settings/useAccounts.js'

interface SettingsProps {
  readonly config: Config
  readonly onChange: (patch: Partial<Config>) => Promise<void>
  readonly onClose: () => void
  /**
   * Which section to land on, for callers sending the user somewhere specific —
   * "connect GitHub" means nothing if it opens on Appearance.
   *
   * Read once, when the dialog mounts. That is only correct because App renders
   * it conditionally, so closing unmounts it and the next open reads the prop
   * afresh. Hoist it out of that conditional and this silently stops working.
   */
  readonly initialSection?: SectionId
}

export type SectionId =
  'general' | 'git' | 'agent' | 'skills' | 'library' | 'instructions' | 'accounts' | 'about'

const SECTIONS: readonly {
  readonly id: SectionId
  readonly labelKey:
    | 'settings.sectionGeneral'
    | 'settings.sectionGit'
    | 'settings.sectionAgent'
    | 'settings.sectionSkills'
    | 'settings.sectionLibrary'
    | 'settings.sectionInstructions'
    | 'settings.sectionAccounts'
    | 'settings.sectionAbout'
  readonly Icon: LucideIcon
}[] = [
  { id: 'general', labelKey: 'settings.sectionGeneral', Icon: Monitor },
  { id: 'git', labelKey: 'settings.sectionGit', Icon: GitBranch },
  { id: 'agent', labelKey: 'settings.sectionAgent', Icon: Sparkles },
  { id: 'skills', labelKey: 'settings.sectionSkills', Icon: Blocks },
  { id: 'library', labelKey: 'settings.sectionLibrary', Icon: SquareSlash },
  { id: 'instructions', labelKey: 'settings.sectionInstructions', Icon: BookText },
  { id: 'accounts', labelKey: 'settings.sectionAccounts', Icon: Bot },
  { id: 'about', labelKey: 'settings.sectionAbout', Icon: Info }
]

/**
 * Settings, split into sections with a navigation rail.
 *
 * A dialog rather than a full-screen page: settings are something you glance at
 * and adjust, and replacing the whole window to change a theme loses sight of
 * the thing being changed. It also means the project dialog and this one behave
 * the same way, down to the close button.
 *
 * Changes apply immediately; there is no Save button. For a local tool with a
 * handful of options a confirmation step only adds friction.
 */
export function Settings({
  config,
  onChange,
  onClose,
  initialSection
}: SettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [section, setSection] = useState<SectionId>(initialSection ?? 'general')
  // Shared between the Claude and Git sections, which show the same accounts.
  const accounts = useAccounts()

  return (
    <Modal size="lg" title={t('settings.title')} onClose={onClose}>
      <div className="flex min-h-0 flex-1">
        <SectionRail
          sections={SECTIONS.map((item) => ({ ...item, label: t(item.labelKey) }))}
          active={section}
          onSelect={setSection}
        />

        <div className="min-w-0 flex-1 space-y-6 overflow-auto p-6">
          {section === 'general' && <GeneralSection config={config} onChange={onChange} />}
          {section === 'git' && (
            <GitSection config={config} onChange={onChange} accounts={accounts} />
          )}
          {section === 'agent' && <AgentSection config={config} onChange={onChange} />}
          {section === 'skills' && (
            <SkillsSection
              store={{ kind: 'global' }}
              disabledDefaults={config.disabledSkillDefaults}
              onDefaults={(disabledSkillDefaults) => {
                void onChange({ disabledSkillDefaults })
              }}
            />
          )}
          {/* Commands and subagents, in the same two stores as the skills and
              found by the session the same way — a section of their own because
              neither has a per-conversation switch, so the list beside them is
              answering a different question. */}
          {section === 'library' && (
            <>
              <LibrarySection store={{ kind: 'global' }} kind="command" />
              <LibrarySection store={{ kind: 'global' }} kind="subagent" />
            </>
          )}
          {section === 'instructions' && <InstructionsSection />}
          {section === 'accounts' && <ClaudeSection accounts={accounts} />}
          {section === 'about' && <AboutSection config={config} />}
        </div>
      </div>
    </Modal>
  )
}

interface SectionProps {
  readonly config: Config
  readonly onChange: (patch: Partial<Config>) => Promise<void>
}

/**
 * The instruction every project falls back to.
 *
 * A file rather than a setting, which is why this section takes no `config`:
 * instructions grow past what a text field holds, are worth reading in a diff,
 * and can be edited outside the app — the same reasoning `instructions.ts`
 * gives for the per-project ones, and the reason `ConfigSchema` holds no long
 * text at all.
 *
 * The same editor the project dialog uses, pointed at a null project. Two
 * editors for one kind of thing would be two places for them to disagree.
 */
function InstructionsSection(): React.JSX.Element {
  return <InstructionEditors projectId={null} />
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
      {/* The account comes first: it is what everything below depends on. */}
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

      <div className="border-line border-t pt-6">
        <Field label={t('settings.branchPrefix')} hint={t('settings.branchPrefixHint')}>
          {/* key resets the draft when the stored value changes — the
              React-recommended alternative to syncing props into state. */}
          <BranchPrefixInput
            key={config.branchPrefix}
            value={config.branchPrefix}
            onCommit={(branchPrefix) => void onChange({ branchPrefix })}
          />
        </Field>
      </div>

      <Field label={t('settings.cloneDirectory')} hint={t('settings.cloneDirectoryHint')}>
        <DirectoryField
          value={config.cloneDirectory}
          placeholder={t('settings.cloneDirectoryUnset')}
          title={t('settings.cloneDirectory')}
          onPick={(cloneDirectory) => void onChange({ cloneDirectory })}
        />
      </Field>
    </div>
  )
}

function AgentSection({ config, onChange }: SectionProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
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

      <div className="border-line border-t pt-6">
        {/* Planning is deliberately not a third choice here. Whether to plan is
            a judgement about one task, made with the toggle in the composer; a
            standing answer to it is not a habit but a way of never being asked
            the question. */}
        <Field label={t('settings.permissionMode')} hint={t('settings.permissionModeHint')}>
          <RadioList<WorkingMode>
            value={config.workingMode}
            options={[
              {
                value: 'default',
                label: t('settings.permissionAsk'),
                hint: t('settings.permissionAskHint')
              },
              {
                value: 'acceptEdits',
                label: t('settings.permissionAcceptEdits'),
                hint: t('settings.permissionAcceptEditsHint')
              }
            ]}
            onChange={(workingMode) => void onChange({ workingMode })}
          />
        </Field>
      </div>

      <div className="border-line border-t pt-6">
        <Field label={t('settings.effort')} hint={t('settings.effortHint')}>
          <RadioList<Effort>
            value={config.effort}
            options={[
              { value: 'low', label: t('chat.effortLow') },
              { value: 'medium', label: t('chat.effortMedium') },
              { value: 'high', label: t('chat.effortHigh') },
              { value: 'xhigh', label: t('chat.effortXhigh') },
              { value: 'max', label: t('chat.effortMax') }
            ]}
            onChange={(effort) => {
              void onChange({ effort })
            }}
          />
        </Field>
      </div>

      <DefaultModels config={config} onChange={onChange} />

      <AlwaysAllowed tools={config.alwaysAllowedTools} onChange={onChange} />
    </div>
  )
}

/**
 * The row standing for "no split", where the config holds null.
 *
 * The empty string rather than a word, because `ConfigSchema` bounds a model
 * name at one character: nothing can ever be called this, where a sentinel
 * like `same` merely has not been so far.
 */
const NO_SPLIT = ''

/**
 * Which model a new conversation plans with, and which it writes code with.
 *
 * Global for the reason the mode and the effort above are: which model does
 * which job is a working habit, and answering it again in every conversation
 * is the friction that gets a setting left alone. A conversation may then
 * diverge without moving this.
 *
 * The catalogue is the agent's, so before any session has run there is one row
 * to offer and it is the default — the same first-run state the composer's
 * picker has, and honest about it rather than empty.
 */
function DefaultModels({
  config,
  onChange
}: {
  config: Config
  onChange: (patch: Partial<Config>) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const models = useModels()

  const labels = { fallback: t('chat.modelDefault'), note: t('chat.modelDefaultNote') }
  const codeRows = modelRows(models, labels, config.model)
  const planRows = modelRows(models, labels, config.planModel)

  const named = (rows: readonly AgentModel[]): { value: string; label: string; hint?: string }[] =>
    rows.map((row, index) => ({
      value: row.value,
      label: row.displayName,
      // Only under the head row, and only the wording `modelRows` chose: it
      // empties the description when the default cannot be named, which is
      // exactly when "by default" underneath would say it twice.
      ...(index === 0 && row.description !== '' && { hint: row.description })
    }))

  return (
    <>
      <div className="border-line border-t pt-6">
        <Field label={t('settings.model')} hint={t('settings.modelHint')}>
          <RadioList<string>
            value={config.model ?? DEFAULT_MODEL}
            options={named(codeRows)}
            onChange={(value) => {
              // Null is how "the agent's own choice" is stored, the round trip
              // the composer's picker makes too.
              void onChange({ model: value === DEFAULT_MODEL ? null : value })
            }}
          />
        </Field>
      </div>

      <div className="border-line border-t pt-6">
        <Field label={t('settings.planModel')} hint={t('settings.planModelHint')}>
          <RadioList<string>
            value={config.planModel ?? NO_SPLIT}
            options={[{ value: NO_SPLIT, label: t('chat.modelsSame') }, ...named(planRows)]}
            onChange={(value) => {
              // Everything but the sentinel is stored as it stands, the word
              // `default` included: null is already spoken for on this side —
              // it is the row above, and means one model does both jobs.
              void onChange({ planModel: value === NO_SPLIT ? null : value })
            }}
          />
        </Field>
      </div>
    </>
  )
}

/**
 * Tools the user has answered "always" for.
 *
 * Shown rather than only stored: an answer given once in a chat, weeks ago,
 * quietly changes what every future session may do without asking. Listing it
 * here is what makes that answer something the user can take back (§4).
 */
/**
 * A row per standing answer, not per tool.
 *
 * An entry used to be a bare tool name, so this list read `Edit` for an answer
 * that was given about one file — an approval an order of magnitude wider than
 * the question asked, and a list that could not say so. A row now names the
 * place the answer was about when there is one, which is what makes it
 * revocable in the sense §4 means: the reader can see what they granted.
 */
function AlwaysAllowed({
  tools,
  onChange
}: {
  tools: readonly StandingPermission[]
  onChange: (patch: Partial<Config>) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="border-line border-t pt-6">
      <Field label={t('settings.alwaysAllowed')} hint={t('settings.alwaysAllowedHint')}>
        {tools.length === 0 ? (
          <p className="text-ink-faint">{t('settings.alwaysAllowedEmpty')}</p>
        ) : (
          <ul className="max-w-lg space-y-1">
            {tools.map((rule) => (
              <li
                key={standingKey(rule)}
                className="border-line flex items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3 py-1.5"
              >
                <span className="min-w-0">
                  <span className="font-mono text-[11px]">{rule.toolName}</span>
                  {/* The place under the tool rather than beside it: a path is
                      long, and a row that truncates the tool name to fit one
                      stops saying which permission it is. */}
                  <span className="text-ink-faint block truncate font-mono text-[11px]">
                    {rule.ruleContent ?? t('settings.alwaysAllowedEverywhere')}
                  </span>
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    void onChange({
                      alwaysAllowedTools: tools.filter(
                        (existing) => standingKey(existing) !== standingKey(rule)
                      )
                    })
                  }
                >
                  {t('settings.alwaysAllowedRemove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Field>
    </div>
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

      {/* The space is on a wrapper, not on the image: `size-20` sets the box,
          and padding inside it would eat the picture rather than move it.
          No separator either — a rule would read as the start of another group
          of settings, and there is nothing here to set. */}
      <div className="pt-8">
        <Mascot className="mx-auto block size-20" />
      </div>
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
  /** The hint is optional: a scale whose labels are the whole story needs none. */
  options: readonly { value: T; label: string; hint?: string }[]
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
          {option.hint !== undefined && (
            <span className="text-ink-faint mt-0.5 block leading-relaxed">{option.hint}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * A directory chosen through the system picker.
 *
 * Read-only by design: typing a path invites typos that only surface later,
 * when something fails to clone.
 */
function DirectoryField({
  value,
  placeholder,
  title,
  onPick
}: {
  value: string
  placeholder: string
  title: string
  onPick: (path: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-2">
      <span
        className={`border-line bg-muted flex h-7 min-w-0 flex-1 items-center truncate rounded-[var(--radius-control)] border px-2 font-mono text-[11px] ${
          value === '' ? 'text-ink-faint' : 'text-ink-soft'
        }`}
        title={value || placeholder}
      >
        {value === '' ? placeholder : value}
      </span>

      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          void (async () => {
            const result = await window.octopus.dialog.pickDirectory(title)
            if (result.ok && result.value !== null) onPick(result.value)
          })()
        }}
      >
        {t('settings.change')}
      </Button>
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
        className={`input focus-ring w-64 font-mono ${invalid ? 'border-danger' : ''}`}
      />
      {invalid && <p className="text-danger mt-1.5">{t('settings.branchPrefixEmpty')}</p>}
    </div>
  )
}
