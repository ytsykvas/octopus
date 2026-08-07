import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Right pane — changes and terminal in tabs (§10.8).
 *
 * Both tabs get their content in later steps; for now the pane carries the
 * structure and switching, so it does not have to be retrofitted.
 */
type RightTab = 'diff' | 'terminal'

const TABS: readonly {
  readonly id: RightTab
  readonly labelKey: 'panel.changes' | 'panel.terminal'
}[] = [
  { id: 'diff', labelKey: 'panel.changes' },
  { id: 'terminal', labelKey: 'panel.terminal' }
]

interface RightPanelProps {
  readonly onCollapse: () => void
}

export function RightPanel({ onCollapse }: RightPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [tab, setTab] = useState<RightTab>('diff')

  return (
    <section className="border-line bg-surface flex w-[22rem] shrink-0 flex-col border-l">
      <div className="border-line flex h-11 shrink-0 items-center gap-1 border-b px-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id)
            }}
            className={`focus-ring h-7 rounded-[var(--radius-control)] px-2.5 font-medium transition-colors ${
              tab === item.id ? 'bg-muted text-ink' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {t(item.labelKey)}
          </button>
        ))}

        <button
          type="button"
          onClick={onCollapse}
          title={t('panel.collapse')}
          className="text-ink-faint hover:text-ink focus-ring ml-auto rounded px-2 transition-colors"
        >
          →
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <p className="text-ink-faint leading-relaxed">
          {tab === 'diff' ? t('panel.changesPlaceholder') : t('panel.terminalPlaceholder')}
        </p>
      </div>
    </section>
  )
}
