import { ArrowLeft, Check, ExternalLink, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CatalogPlugin } from '@core/plugins.js'

import { useConfirm } from '../../hooks/useConfirm.js'
import { CATALOG_BUSY, type PluginsController } from '../../hooks/usePlugins.js'
import { Button } from '../Button.js'
import { Placeholder } from '../Placeholder.js'
import { PluginAvatar } from './PluginAvatar.js'
import { compactCount, matches, safeHomepage } from './pluginFormat.js'
import { PluginSearch } from './PluginSearch.js'

/**
 * The categories the official marketplace uses, which have words of their own.
 * Anything else a marketplace calls a category is shown as it wrote it.
 */
const KNOWN_CATEGORIES = [
  'development',
  'productivity',
  'database',
  'monitoring',
  'security',
  'deployment',
  'design',
  'automation',
  'learning',
  'location',
  'testing',
  'math',
  'migration'
] as const

/** The pill for plugins with no category; not a name a marketplace can use. */
const OTHER = '#other'

/**
 * What the connected marketplaces offer: a search, a row of categories, and
 * cards ordered by how many people installed them.
 *
 * Popularity rather than the alphabet because the official catalog runs to
 * some three hundred plugins, and the first screen of an alphabetical one is
 * whatever happens to start with a digit.
 */
export function PluginStore({
  plugins
}: {
  readonly plugins: PluginsController
}): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const { confirm, dialog } = useConfirm()
  const { catalog } = plugins

  const install = async (plugin: CatalogPlugin): Promise<void> => {
    const consent = await plugins.install(plugin.id)
    if (consent === null) return

    // The command is the marketplace's, it runs on this machine, and the CLI
    // will not run it unseen — so it is shown whole before anything happens.
    const { confirmed } = await confirm({
      title: t('plugins.consentTitle'),
      message: t('plugins.consentMessage', { name: plugin.name }),
      detail: consent.command,
      confirmLabel: t('plugins.consentConfirm'),
      cancelLabel: t('plugins.cancel'),
      destructive: true
    })
    if (confirmed) await plugins.install(plugin.id, consent.sha256)
  }

  if (catalog === null) return <Skeleton />

  const connecting = plugins.busy.has(CATALOG_BUSY)
  const connect = (
    <Button variant="accent" disabled={connecting} onClick={() => void plugins.connectOfficial()}>
      {connecting ? t('plugins.connecting') : t('plugins.connect')}
    </Button>
  )

  if (catalog.plugins.length === 0 && !catalog.officialConnected) {
    return (
      <Placeholder title={t('plugins.connectTitle')} actions={connect}>
        {t('plugins.connectHint')}
      </Placeholder>
    )
  }

  // Installed for every project, which is what the button would do. A plugin
  // installed in one project only can still be installed for all — measured:
  // the CLI adds the user-scope install beside the project's own.
  const installed = new Set(
    (plugins.installed ?? [])
      .filter((plugin) => plugin.scope === 'user' || plugin.scope === 'managed')
      .map((plugin) => plugin.id)
  )
  const card = (plugin: CatalogPlugin): CardState => ({
    installed: installed.has(plugin.id),
    busy: plugins.busy.has(plugin.id)
  })

  const opened = catalog.plugins.find((plugin) => plugin.id === openId)
  if (opened !== undefined) {
    return (
      <>
        <PluginDetail
          plugin={opened}
          state={card(opened)}
          onBack={() => {
            setOpenId(null)
          }}
          onInstall={() => void install(opened)}
        />
        {dialog}
      </>
    )
  }

  const categories = categoriesOf(catalog.plugins)
  const shown = catalog.plugins
    .filter((plugin) => matches(plugin, query))
    .filter((plugin) => category === null || (plugin.category ?? OTHER) === category)
    .toSorted(byPopularity)

  return (
    <>
      <PluginSearch value={query} onChange={setQuery} placeholder={t('plugins.searchStore')}>
        {categories.length > 1 && (
          <div
            role="radiogroup"
            aria-label={t('plugins.tabStore')}
            className="flex flex-wrap gap-1"
          >
            {[null, ...categories].map((value) => (
              <button
                key={value ?? ''}
                type="button"
                role="radio"
                aria-checked={category === value}
                onClick={() => {
                  setCategory(value)
                }}
                className={`focus-ring h-6 rounded-[var(--radius-control)] px-2.5 text-[12px] transition-colors ${
                  category === value
                    ? 'bg-accent/12 text-accent'
                    : 'text-ink-soft hover:bg-muted hover:text-ink'
                }`}
              >
                {value === null ? t('plugins.allCategories') : <CategoryName category={value} />}
              </button>
            ))}
          </div>
        )}
      </PluginSearch>

      <div className="space-y-3 p-4">
        {!catalog.officialConnected && (
          <div className="border-line flex items-center justify-between gap-3 rounded-[var(--radius-panel)] border px-3 py-2">
            <span className="text-ink-soft">{t('plugins.officialMissing')}</span>
            {connect}
          </div>
        )}

        {shown.length === 0 ? (
          <p className="text-ink-faint">{t('plugins.noMatch', { query })}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {shown.map((plugin) => (
              <li key={plugin.id} className="min-w-0">
                <PluginCard
                  plugin={plugin}
                  state={card(plugin)}
                  onOpen={() => {
                    setOpenId(plugin.id)
                  }}
                  onInstall={() => void install(plugin)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog}
    </>
  )
}

interface CardState {
  readonly installed: boolean
  readonly busy: boolean
}

/** Most installed first; a plugin with no count after every one that has one. */
function byPopularity(a: CatalogPlugin, b: CatalogPlugin): number {
  return (b.installs ?? -1) - (a.installs ?? -1) || a.name.localeCompare(b.name)
}

/** The categories present, the largest first, and the uncategorised after them. */
function categoriesOf(plugins: readonly CatalogPlugin[]): string[] {
  const counts = new Map<string, number>()
  for (const plugin of plugins) {
    const key = plugin.category ?? OTHER
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  // "Other" last whatever its size: it is the absence of a category, and a
  // pill for it in the middle of the row reads as one of them.
  const last = (key: string): number => (key === OTHER ? 1 : 0)

  return [...counts.entries()]
    .toSorted(
      ([a, countA], [b, countB]) => last(a) - last(b) || countB - countA || a.localeCompare(b)
    )
    .map(([key]) => key)
}

function CategoryName({ category }: { readonly category: string }): React.JSX.Element {
  const { t } = useTranslation()
  const known = KNOWN_CATEGORIES.find((name) => name === category)

  if (known !== undefined) return <>{t(`plugins.categories.${known}`)}</>
  if (category === OTHER) return <>{t('plugins.otherCategory')}</>

  return <>{category}</>
}

function Installs({ count }: { readonly count: number | null }): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  if (count === null) return null

  return (
    <span>{t('plugins.installs', { count, formatted: compactCount(count, i18n.language) })}</span>
  )
}

function InstallButton({
  state,
  onInstall
}: {
  readonly state: CardState
  readonly onInstall: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  if (state.installed) {
    return (
      <span className="text-success inline-flex items-center gap-1 text-[12px]">
        <Check aria-hidden size={13} />
        {t('plugins.installed')}
      </span>
    )
  }

  return (
    <Button variant="accent" size="sm" disabled={state.busy} onClick={onInstall}>
      {state.busy ? t('plugins.installing') : t('plugins.install')}
    </Button>
  )
}

function PluginCard({
  plugin,
  state,
  onOpen,
  onInstall
}: {
  readonly plugin: CatalogPlugin
  readonly state: CardState
  readonly onOpen: () => void
  readonly onInstall: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <article className="panel hover:border-line-strong flex h-full flex-col p-3 transition-colors">
      {/* The card's text is one button — the way into the details — and the
          install is another beside it, since a button cannot hold a button. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={plugin.name}
        className="focus-ring -m-1 flex min-w-0 flex-1 flex-col rounded-[var(--radius-control)] p-1 text-left"
      >
        <span className="flex items-center gap-2.5">
          <PluginAvatar id={plugin.id} name={plugin.name} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{plugin.name}</span>
            {plugin.author !== null && (
              <span className="text-ink-faint block truncate text-[11px]">
                {t('plugins.by', { author: plugin.author })}
              </span>
            )}
          </span>
        </span>

        <span className="text-ink-soft mt-2 line-clamp-3 leading-relaxed">
          {plugin.description ?? t('plugins.noDescription')}
        </span>
      </button>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-ink-faint flex min-w-0 gap-2 truncate text-[11px]">
          <Installs count={plugin.installs} />
          {plugin.category !== null && <CategoryName category={plugin.category} />}
        </span>
        <InstallButton state={state} onInstall={onInstall} />
      </div>
    </article>
  )
}

function PluginDetail({
  plugin,
  state,
  onBack,
  onInstall
}: {
  readonly plugin: CatalogPlugin
  readonly state: CardState
  readonly onBack: () => void
  readonly onInstall: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const homepage = safeHomepage(plugin.homepage)

  return (
    <div className="space-y-4 p-4">
      <Button variant="quiet" size="sm" onClick={onBack}>
        <ArrowLeft aria-hidden size={13} />
        {t('plugins.closeDetails')}
      </Button>

      <div className="flex items-start gap-3">
        <PluginAvatar id={plugin.id} name={plugin.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold">{plugin.name}</h3>
          <p className="text-ink-faint text-[12px]">
            {[
              plugin.author === null ? null : t('plugins.by', { author: plugin.author }),
              t('plugins.from', { marketplace: plugin.marketplace }),
              plugin.version === null ? null : t('plugins.version', { version: plugin.version })
            ]
              .filter((part) => part !== null)
              .join(' · ')}
          </p>
          <p className="text-ink-faint mt-0.5 flex gap-2 text-[12px]">
            <Installs count={plugin.installs} />
            {plugin.category !== null && <CategoryName category={plugin.category} />}
          </p>
        </div>
        <InstallButton state={state} onInstall={onInstall} />
      </div>

      <p className="text-ink-soft max-w-prose leading-relaxed whitespace-pre-line">
        {plugin.description ?? t('plugins.noDescription')}
      </p>

      {plugin.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {plugin.keywords.map((keyword) => (
            <span
              key={keyword}
              className="bg-muted text-ink-soft rounded-[4px] px-1.5 py-px text-[11px]"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}

      {homepage !== null && (
        <a
          href={homepage}
          target="_blank"
          rel="noreferrer"
          className="text-accent focus-ring inline-flex items-center gap-1 rounded hover:underline"
        >
          <ExternalLink aria-hidden size={13} />
          {t('plugins.homepage')}
        </a>
      )}

      <p className="bg-warning-bg text-warning flex max-w-prose gap-2 rounded-[var(--radius-control)] px-3 py-2 text-[12px] leading-relaxed">
        <ShieldAlert aria-hidden size={14} className="mt-0.5 shrink-0" />
        {t('plugins.trustNote')}
      </p>
    </div>
  )
}

/** Cards in outline while the CLI reads the catalog, which takes a second or two. */
function Skeleton(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="p-4" role="status" aria-label={t('plugins.loading')}>
      <ul className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <li
            key={index}
            className="panel bg-muted/40 h-32 animate-pulse motion-reduce:animate-none"
          />
        ))}
      </ul>
    </div>
  )
}
