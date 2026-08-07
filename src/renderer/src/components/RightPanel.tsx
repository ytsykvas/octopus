import { useState } from 'react'

/**
 * Права панель — дифф і термінал у вкладках (§10.8).
 *
 * Вміст обох вкладок з'явиться на пізніших кроках; зараз панель тримає
 * структуру й перемикання, щоб її не довелося вбудовувати заднім числом.
 */
type RightTab = 'diff' | 'terminal'

const TABS: readonly { readonly id: RightTab; readonly label: string }[] = [
  { id: 'diff', label: 'дифф' },
  { id: 'terminal', label: 'термінал' }
]

interface RightPanelProps {
  readonly onCollapse: () => void
}

export function RightPanel({ onCollapse }: RightPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<RightTab>('diff')

  return (
    <section className="border-outline bg-muted flex w-96 shrink-0 flex-col border-l-[3px]">
      <div className="border-outline flex h-14 shrink-0 items-center gap-2 border-b-[3px] px-3">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id)
            }}
            className={`brutal-label border-outline rounded-[var(--radius-badge)] border-2 px-3 py-1.5 text-[0.65rem] ${
              tab === item.id
                ? 'bg-info text-on-info shadow-[var(--shadow-brutal-sm)]'
                : 'bg-canvas text-ink-soft'
            }`}
          >
            {item.label}
          </button>
        ))}

        <button
          type="button"
          onClick={onCollapse}
          className="text-ink-soft hover:text-ink ml-auto px-2 text-lg leading-none"
          title="Згорнути панель"
        >
          ›
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <p className="text-ink-soft text-sm leading-relaxed">
          {tab === 'diff'
            ? 'Тут будуть зміни воркспейсу відносно базової гілки.'
            : 'Тут буде термінал у теці воркспейсу.'}
        </p>
      </div>
    </section>
  )
}
