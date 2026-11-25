import { type LucideIcon, SquareKanban, SquareTerminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type Screen = 'octopus' | 'board'

const SCREENS: readonly {
  readonly id: Screen
  readonly label: 'app.screenOctopus' | 'app.screenBoard'
  readonly Icon: LucideIcon
}[] = [
  { id: 'octopus', label: 'app.screenOctopus', Icon: SquareTerminal },
  { id: 'board', label: 'app.screenBoard', Icon: SquareKanban }
]

export interface ScreenSwitchProps {
  readonly screen: Screen
  readonly onScreen: (screen: Screen) => void
}

export function ScreenSwitch({ screen, onScreen }: ScreenSwitchProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      role="group"
      aria-label={t('app.screen')}
      className="border-line bg-muted inline-flex shrink-0 rounded-[var(--radius-control)] border p-0.5"
    >
      {SCREENS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={id === screen ? 'page' : undefined}
          onClick={() => {
            onScreen(id)
          }}
          className={`focus-ring flex h-[22px] items-center gap-1.5 rounded-[4px] px-2.5 text-[12px] font-medium transition-colors ${
            id === screen ? 'bg-accent text-on-accent' : 'text-ink-soft hover:text-ink'
          }`}
        >
          <Icon aria-hidden size={13} />
          {t(label)}
        </button>
      ))}
    </div>
  )
}
