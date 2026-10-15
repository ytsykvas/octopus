import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { SourceLayer, SourceLayerView, SourceView } from '@core/sourceItems.js'

import type { Result } from '../../../preload/index.js'

import { FileEditor } from './FileEditor.js'
import { Segmented } from './Segmented.js'
import { LAYER_LABELS, SourceBadge } from './SourceBadge.js'
import { Switch } from './Switch.js'

interface LayeredEditorProps {
  readonly label: string
  readonly hint: string
  readonly placeholder?: string
  readonly rows?: number
  /** Where this item comes from, or undefined while it is still being read. */
  readonly view: SourceView | undefined
  /** The project's own copy — the one layer edited here. */
  readonly read: () => Promise<string | null>
  readonly save: (contents: string) => Promise<Result<void>>
  /** "Use mine instead": the project's own over the repository's. */
  readonly onPreferLocal: (preferLocal: boolean) => void
  /** Called after a save, because writing the project's copy can change which layer applies. */
  readonly onSaved: () => void
}

/**
 * A script or an instruction, with every place it can come from.
 *
 * The editor alone answered the wrong question. It showed this project's copy
 * — and, for a project that wrote none, the template — while what applied
 * could be the repository's, or the installation's, and nothing said so. A
 * repository's instruction overrode a text somebody was editing in front of
 * them, silently.
 *
 * So: a badge for the layer in effect, a tab for each layer that exists, and
 * the project's own as the one that can be edited. The others are shown as they
 * are, with where they live, because that is where they are changed. Where the
 * repository supplies one, a switch takes the project's own instead.
 */
export function LayeredEditor({
  label,
  hint,
  placeholder,
  rows,
  view,
  read,
  save,
  onPreferLocal,
  onSaved
}: LayeredEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const [chosen, setChosen] = useState<SourceLayer | null>(null)

  // The project's own is always a tab, written or not: it is the one edited here.
  const own = view?.layers.find((layer) => layer.layer === 'project') ?? OWN
  const layers = [...(view?.layers ?? []).filter((layer) => layer.layer !== 'project'), own].sort(
    (a, b) => ORDER.indexOf(a.layer) - ORDER.indexOf(b.layer)
  )
  const supplied = layers.some((layer) => layer.layer === 'repository')
  // What was picked, else what is in effect, else the project's own — a script
  // nobody wrote has nothing in effect to show.
  const showing = layers.find((layer) => layer.layer === (chosen ?? view?.effective)) ?? own
  const isScript = view?.id.startsWith('script.') === true

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<SourceLayer>
          label={t('sources.layers', { setting: label })}
          value={showing.layer}
          options={layers.map((layer) => ({
            value: layer.layer,
            label: t(LAYER_LABELS[layer.layer])
          }))}
          onChange={setChosen}
        />
        {view !== undefined && <SourceBadge effective={view.effective} />}
      </div>

      {supplied && view !== undefined && (
        <div className="flex max-w-lg items-start gap-3">
          <Switch
            checked={view.preferLocal}
            onChange={onPreferLocal}
            label={t('sources.useMine')}
          />
          <div className="space-y-0.5">
            <p>{t('sources.useMine')}</p>
            <p className="text-ink-faint leading-relaxed">{t('sources.useMineHint')}</p>
          </div>
        </div>
      )}

      {showing.layer === 'project' ? (
        <FileEditor
          label={label}
          hint={hint}
          {...(placeholder === undefined ? {} : { placeholder })}
          {...(rows === undefined ? {} : { rows })}
          read={read}
          save={async (contents) => {
            const result = await save(contents)
            onSaved()
            return result
          }}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">{label}</p>
          <p className="text-ink-faint leading-relaxed">
            {showing.layer === 'repository'
              ? t('sources.fromRepository', { path: showing.from })
              : showing.layer === 'global'
                ? t('sources.fromGlobal')
                : t(isScript ? 'sources.scriptTemplate' : 'sources.fromTemplate')}
          </p>
          <pre className="border-line bg-muted text-ink-soft max-h-64 overflow-auto rounded-[var(--radius-control)] border px-2 py-1.5 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap">
            {showing.body}
          </pre>
        </div>
      )}
    </div>
  )
}

/** The project's own layer, which is always there to be written even before it has been. */
const OWN: SourceLayerView = { layer: 'project', from: null, body: '' }

const ORDER: readonly SourceLayer[] = ['repository', 'project', 'global', 'template']
