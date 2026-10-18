import { ExternalLink, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InstalledPlugin, PluginTarget } from '@core/plugins.js'

import { useConfirm } from '../../hooks/useConfirm.js'
import { type PluginsController, rowKey, targetOf } from '../../hooks/usePlugins.js'
import { Button } from '../Button.js'
import { IconButton } from '../paneControls.js'
import { Placeholder } from '../Placeholder.js'
import { Switch } from '../Switch.js'
import { PluginAvatar } from './PluginAvatar.js'
import { matches, safeHomepage } from './pluginFormat.js'
import { PluginSearch } from './PluginSearch.js'

/**
 * What is installed, with a switch and a removal on each row.
 *
 * Every scope is listed, a project's own installs included, because a plugin
 * somebody installed from a terminal in one checkout is as much a plugin as one
 * installed here — and a row octopus cannot change (`managed`) is shown and
 * says why, rather than left out to be wondered about.
 */
export function InstalledPlugins({
  plugins,
  onBrowseStore
}: {
  readonly plugins: PluginsController
  readonly onBrowseStore: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const { confirm, dialog } = useConfirm()

  if (plugins.installed === null) {
    return <p className="text-ink-faint p-4">{t('plugins.loading')}</p>
  }

  if (plugins.installed.length === 0) {
    return (
      <Placeholder
        title={t('plugins.noneInstalled')}
        actions={
          <Button variant="accent" onClick={onBrowseStore}>
            {t('plugins.browseStore')}
          </Button>
        }
      >
        {t('plugins.noneInstalledHint')}
      </Placeholder>
    )
  }

  const shown = plugins.installed.filter((plugin) => matches(plugin, query))

  const remove = async (plugin: InstalledPlugin, target: PluginTarget): Promise<void> => {
    const { confirmed } = await confirm({
      title: t('plugins.removeTitle'),
      message: t('plugins.removeMessage', { name: plugin.name }),
      detail: t('plugins.removeDetail'),
      confirmLabel: t('plugins.removeConfirm'),
      cancelLabel: t('plugins.cancel'),
      destructive: true
    })
    if (confirmed) await plugins.uninstall(plugin.id, target)
  }

  return (
    <>
      <PluginSearch value={query} onChange={setQuery} placeholder={t('plugins.searchInstalled')} />

      <div className="p-4">
        {shown.length === 0 ? (
          <p className="text-ink-faint">{t('plugins.noMatch', { query })}</p>
        ) : (
          <ul className="panel divide-line divide-y">
            {shown.map((plugin) => (
              <InstalledRow
                key={`${plugin.id} ${plugin.scope} ${plugin.projectPath ?? ''}`}
                plugin={plugin}
                busy={plugins.busy}
                onToggle={(enabled, target) => void plugins.setEnabled(plugin.id, enabled, target)}
                onRemove={(target) => void remove(plugin, target)}
              />
            ))}
          </ul>
        )}
      </div>

      {dialog}
    </>
  )
}

function InstalledRow({
  plugin,
  busy,
  onToggle,
  onRemove
}: {
  readonly plugin: InstalledPlugin
  readonly busy: ReadonlySet<string>
  readonly onToggle: (enabled: boolean, target: PluginTarget) => void
  readonly onRemove: (target: PluginTarget) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const target = targetOf(plugin)
  const held = target !== null && busy.has(rowKey(plugin.id, target))
  const homepage = safeHomepage(plugin.homepage)
  const scope = (['user', 'project', 'local', 'managed'] as const).find(
    (known) => known === plugin.scope
  )

  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <PluginAvatar id={plugin.id} name={plugin.name} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium">{plugin.name}</span>
          <span className="text-ink-faint truncate text-[11px]">
            {[
              plugin.marketplace,
              plugin.version === null ? null : t('plugins.version', { version: plugin.version }),
              scope === undefined ? plugin.scope : t(`plugins.scope.${scope}`)
            ]
              .filter((part) => part !== null && part !== '')
              .join(' · ')}
          </span>
        </div>

        {plugin.projectPath !== null && (
          <p className="text-ink-faint mt-0.5 truncate font-mono text-[11px]">
            {plugin.projectPath}
          </p>
        )}

        {plugin.description !== null && (
          <p className="text-ink-soft mt-1 line-clamp-2 leading-relaxed">{plugin.description}</p>
        )}

        {plugin.components.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {plugin.components.map((component) => (
              <span
                key={component}
                className="bg-muted text-ink-soft rounded-[4px] px-1.5 py-px text-[11px]"
              >
                {t(`plugins.components.${component}`)}
              </span>
            ))}
          </div>
        )}

        {plugin.errors.length > 0 && (
          <p className="text-danger mt-2 text-[12px]">
            {t('plugins.loadErrors', { errors: plugin.errors.join('; ') })}
          </p>
        )}

        {target === null && (
          <p className="text-ink-faint mt-1 text-[12px]">
            {plugin.scope === 'managed' ? t('plugins.managedNote') : t('plugins.unreachableNote')}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {homepage !== null && (
          <a
            href={homepage}
            target="_blank"
            rel="noreferrer"
            title={t('plugins.homepage')}
            aria-label={t('plugins.homepage')}
            className="focus-ring text-ink-faint hover:text-ink hover:bg-muted rounded-[var(--radius-control)] p-1"
          >
            <ExternalLink aria-hidden size={14} />
          </a>
        )}

        {target !== null && (
          <IconButton
            label={t('plugins.remove', { name: plugin.name })}
            disabled={held}
            onClick={() => {
              onRemove(target)
            }}
          >
            <Trash2 aria-hidden size={14} />
          </IconButton>
        )}

        {target === null ? (
          // Words rather than a switch nobody can move: a disabled control
          // reads as "not now", and this one is "not here".
          <span className="text-ink-faint ml-1 text-[11px]">
            {plugin.enabled ? t('plugins.stateOn') : t('plugins.stateOff')}
          </span>
        ) : (
          <span className="ml-1 flex">
            <Switch
              checked={plugin.enabled}
              label={t('plugins.switchLabel', { name: plugin.name })}
              disabled={held}
              onChange={(enabled) => {
                onToggle(enabled, target)
              }}
            />
          </span>
        )}
      </div>
    </li>
  )
}
