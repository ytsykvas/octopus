import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CATALOG_BUSY, type PluginsController } from '../../hooks/usePlugins.js'
import { Modal } from '../Modal.js'
import { IconButton } from '../paneControls.js'
import { InstalledPlugins } from './InstalledPlugins.js'
import { PluginStore } from './PluginStore.js'

type Tab = 'installed' | 'store'

/**
 * Claude Code's plugins: what is installed, and the store.
 *
 * Everything here goes through Claude Code's own CLI, and every change reaches
 * the conversations already open — the line under the tabs says how many, so a
 * switch that worked is seen to have worked.
 */
export function PluginsWindow({
  plugins,
  userLayerLoaded,
  onOpenAgentSettings,
  onClose
}: {
  readonly plugins: PluginsController
  /**
   * Whether the Agent setting loads the user's own settings, which is where a
   * plugin installed for every project is switched on. Without it the plugins
   * are installed and nothing here loads them, and the window has to say so.
   */
  readonly userLayerLoaded: boolean
  readonly onOpenAgentSettings: () => void
  readonly onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('installed')

  const choose = (next: Tab): void => {
    setTab(next)
    // The catalog is a slow listing, so it is read the first time the store is
    // shown rather than with the window.
    if (next === 'store' && plugins.catalog === null && !plugins.catalogLoading) {
      void plugins.readCatalog()
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    {
      id: 'installed',
      label:
        plugins.installed === null
          ? t('plugins.tabInstalled')
          : t('plugins.tabInstalledCount', { count: plugins.installed.length })
    },
    { id: 'store', label: t('plugins.tabStore') }
  ]

  // A failure outranks the count: it is the newer news, and the count it
  // would hide is the previous action's.
  const note =
    plugins.error ??
    (plugins.applied === null
      ? null
      : plugins.applied === 0
        ? t('plugins.appliedNone')
        : t('plugins.applied', { count: plugins.applied }))

  return (
    <Modal title={t('plugins.title')} onClose={onClose} size="lg">
      <div className="border-line flex shrink-0 items-center gap-1 border-b px-3 py-2">
        <div role="tablist" aria-label={t('plugins.title')} className="flex flex-1 gap-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`plugins-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls="plugins-panel"
              onClick={() => {
                choose(item.id)
              }}
              className={`focus-ring h-7 rounded-[var(--radius-control)] px-3 text-[12px] font-medium transition-colors ${
                tab === item.id
                  ? 'bg-accent/12 text-accent'
                  : 'text-ink-soft hover:bg-muted hover:text-ink'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'store' && (
          <IconButton
            label={t('plugins.refresh')}
            disabled={plugins.busy.has(CATALOG_BUSY) || plugins.catalog === null}
            onClick={() => void plugins.refreshCatalog()}
          >
            <RefreshCw aria-hidden size={14} />
          </IconButton>
        )}
      </div>

      {!userLayerLoaded && (
        <div className="bg-warning-bg text-warning border-line flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-[12px]">
          <span className="leading-relaxed">{t('plugins.userLayerOff')}</span>
          <button
            type="button"
            onClick={onOpenAgentSettings}
            className="focus-ring shrink-0 font-medium underline-offset-2 hover:underline"
          >
            {t('plugins.openAgentSettings')}
          </button>
        </div>
      )}

      {note !== null && (
        <p
          role="status"
          className={`border-line shrink-0 border-b px-4 py-2 text-[12px] ${
            plugins.error === null ? 'text-ink-soft' : 'text-danger'
          }`}
        >
          {note}
        </p>
      )}

      <div
        role="tabpanel"
        id="plugins-panel"
        aria-labelledby={`plugins-tab-${tab}`}
        // The scroller itself, so the tabs and the notes above stay put and the
        // search pins to the top of the list rather than of the dialog.
        className="flex min-h-0 flex-1 flex-col overflow-auto"
      >
        {tab === 'installed' ? (
          <InstalledPlugins
            plugins={plugins}
            onBrowseStore={() => {
              choose('store')
            }}
          />
        ) : (
          <PluginStore plugins={plugins} />
        )}
      </div>
    </Modal>
  )
}
