import { useTranslation } from 'react-i18next'

import type { SourceLayer } from '@core/sourceItems.js'

/** What each layer is called to the reader: where it lives, which is where it is changed. */
export const LAYER_LABELS = {
  repository: 'sources.layerRepository',
  project: 'sources.layerProject',
  global: 'sources.layerGlobal',
  template: 'sources.layerTemplate'
} as const satisfies Record<SourceLayer, string>

/**
 * Which layer a setting is taken from, as a small label beside it.
 *
 * Neutral on purpose: which layer applies is information, not a warning, and
 * a coloured chip on every editor would make a dialog of them read as a list
 * of problems. A refused repository value says so in words below the editor.
 */
export function SourceBadge({
  effective
}: {
  readonly effective: SourceLayer | null
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <span className="border-line text-ink-soft rounded-[var(--radius-control)] border px-1.5 py-px text-[11px] whitespace-nowrap">
      {effective === null
        ? t('sources.nothingInEffect')
        : t('sources.inEffect', { layer: t(LAYER_LABELS[effective]) })}
    </span>
  )
}
