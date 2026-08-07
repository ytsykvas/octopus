import { useState } from 'react'

/**
 * Права панель — дифф і термінал у вкладках (§10.8).
 *
 * Вміст обох вкладок з'явиться на пізніших кроках; зараз панель тримає
 * структуру й перемикання, щоб її не довелося вбудовувати заднім числом.
 */
type RightTab = 'diff' | 'terminal'

const TABS: readonly { readonly id: RightTab; readonly label: string }[] = [
  { id: 'diff', label: 'Зміни' },
  { id: 'terminal', label: 'Термінал' }
]

interface RightPanelProps {
  readonly onCollapse: () => void
}

export function RightPanel({ onCollapse }: RightPanelProps): React.JSX.Element {
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
            {item.label}
          </button>
        ))}

        <button
          type="button"
          onClick={onCollapse}
          title="Згорнути панель"
          className="text-ink-faint hover:text-ink focus-ring ml-auto rounded px-2 transition-colors"
        >
          →
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <p className="text-ink-faint leading-relaxed">
          {tab === 'diff'
            ? 'Тут будуть зміни воркспейсу відносно базової гілки.'
            : 'Тут буде термінал у теці воркспейсу.'}
        </p>
      </div>
    </section>
  )
}
