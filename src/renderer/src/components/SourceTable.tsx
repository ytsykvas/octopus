import { useTranslation } from 'react-i18next'

import {
  SOURCE_ITEM_IDS,
  type SourceItemId,
  type SourceLayer,
  type SourceView
} from '@core/sourceItems.js'

import { LAYER_LABELS } from './SourceBadge.js'
import { Switch } from './Switch.js'

const COLUMNS: readonly SourceLayer[] = ['repository', 'project', 'global', 'template']

interface SourceTableProps {
  readonly sources: ReadonlyMap<SourceItemId, SourceView>
  /** What each item is called, as its own editor calls it. */
  readonly labelOf: (id: SourceItemId) => string
  readonly onOpen: (id: SourceItemId) => void
  readonly onPreferLocal: (id: SourceItemId, preferLocal: boolean) => void
}

/**
 * Every setting that can come from more than one place, and which one it comes
 * from, on one screen.
 *
 * The question "what is this project working from" used to need a visit to
 * four sections and a reading of `docs/repo-config.md`. A row per item, a
 * column per layer: a dot where the layer has something, the dot filled where
 * it is the one in effect.
 *
 * Read from the same answer as the editors' badges, so the table and the
 * section it opens cannot disagree.
 */
export function SourceTable({
  sources,
  labelOf,
  onOpen,
  onPreferLocal
}: SourceTableProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="flex flex-col gap-2">
      <p className="section-label">{t('sources.tableTitle')}</p>
      <p className="text-ink-faint max-w-lg leading-relaxed">{t('sources.tableHint')}</p>

      <div className="panel overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-line text-ink-faint border-b">
              <th scope="col" className="px-2 py-1.5 font-medium">
                {t('sources.columnSetting')}
              </th>
              {COLUMNS.map((layer) => (
                <th key={layer} scope="col" className="px-2 py-1.5 text-center font-medium">
                  {t(LAYER_LABELS[layer])}
                </th>
              ))}
              <th scope="col" className="px-2 py-1.5 text-center font-medium">
                {t('sources.columnUseMine')}
              </th>
            </tr>
          </thead>
          <tbody>
            {SOURCE_ITEM_IDS.map((id) => {
              const view = sources.get(id)
              const label = labelOf(id)
              const supplied = view?.layers.some((layer) => layer.layer === 'repository') ?? false

              return (
                <tr key={id} className="border-line border-b last:border-b-0">
                  <th scope="row" className="px-2 py-1 font-normal">
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(id)
                      }}
                      className="focus-ring text-ink hover:text-accent rounded-[var(--radius-control)] text-left"
                      aria-label={t('sources.open', { setting: label })}
                    >
                      {label}
                    </button>
                  </th>
                  {COLUMNS.map((layer) => (
                    <td key={layer} className="px-2 py-1 text-center">
                      <Mark
                        present={view?.layers.some((entry) => entry.layer === layer) ?? false}
                        effective={view?.effective === layer}
                        label={`${label}: ${t(LAYER_LABELS[layer])}`}
                        inEffect={t('sources.columnInEffect')}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    <div className="flex justify-center">
                      <Switch
                        checked={view?.preferLocal ?? false}
                        disabled={!supplied}
                        onChange={(on) => {
                          onPreferLocal(id, on)
                        }}
                        label={`${t('sources.useMine')}: ${label}`}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * One cell: nothing, a hollow dot for a layer that has something, a filled one
 * for the layer in effect. Named for a screen reader, which sees no dots.
 */
function Mark({
  present,
  effective,
  label,
  inEffect
}: {
  readonly present: boolean
  readonly effective: boolean
  readonly label: string
  readonly inEffect: string
}): React.JSX.Element | null {
  if (!present) return null

  return (
    <span
      role="img"
      aria-label={effective ? `${label} — ${inEffect}` : label}
      className={`inline-block size-2 rounded-full border ${
        effective ? 'border-accent bg-accent' : 'border-line-strong'
      }`}
    />
  )
}
