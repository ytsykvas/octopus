import { PanelLeftClose, PanelLeftOpen, Settings as SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useSubscriptionUsage } from '../hooks/useSubscriptionUsage.js'
import { SubscriptionLimits } from './SubscriptionLimits.js'

interface SidebarFooterProps {
  /** Whether the workspace list beside the tab strip is showing. */
  readonly sidebarOpen: boolean
  readonly onToggleSidebar: () => void
  readonly onOpenSettings: () => void
}

const ICON_BUTTON =
  'text-ink-faint hover:bg-muted hover:text-ink focus-ring flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] transition-colors'

/**
 * The foot of the left column: what is left of the account's limits, then the
 * two controls that belong to the window rather than to any project.
 *
 * It spans the tab strip as well as the workspace list, so it is a sibling of
 * both rather than a part of either. The limits used to sit at the foot of the
 * list alone, which left the strip's width empty beneath them while the
 * Settings bar below ran across all of it.
 *
 * Folding the list away is about the column beside the strip, and this is the
 * part of the window that survives the fold — so the control that brings it
 * back is here, opposite Settings, rather than in the pane it hides.
 */
export function SidebarFooter({
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings
}: SidebarFooterProps): React.JSX.Element {
  const { t } = useTranslation()
  const fold = sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')

  return (
    // `w-0 min-w-full`: the column is as wide as the strip and the list, which
    // is not a width this element may help decide. Left to its own intrinsic
    // width, a long limit row would push the column wider than both and open a
    // gap beside the list.
    <div className="border-line bg-surface w-0 min-w-full shrink-0 border-r">
      {sidebarOpen && <ConnectedLimits />}

      {/* Folded, the column is only as wide as the strip, so the two stack. */}
      <div
        className={`border-line border-t p-2 ${
          sidebarOpen ? 'flex items-center justify-between' : 'flex flex-col items-center gap-1'
        }`}
      >
        <button
          type="button"
          onClick={onOpenSettings}
          title={t('sidebar.settings')}
          aria-label={t('sidebar.settings')}
          className={ICON_BUTTON}
        >
          <SettingsIcon aria-hidden size={15} />
        </button>

        <button
          type="button"
          onClick={onToggleSidebar}
          title={fold}
          aria-label={fold}
          className={ICON_BUTTON}
        >
          {sidebarOpen ? (
            <PanelLeftClose aria-hidden size={15} />
          ) : (
            <PanelLeftOpen aria-hidden size={15} />
          )}
        </button>
      </div>
    </div>
  )
}

/**
 * Its own component so the hook is mounted exactly while the block is.
 *
 * The hook asks the account on a timer and whenever the window regains focus,
 * and says plainly that nothing behind a block nobody can see is worth a
 * process. Calling it from the footer itself would keep it reading while the
 * list is folded away.
 */
function ConnectedLimits(): React.JSX.Element {
  const subscription = useSubscriptionUsage()

  return <SubscriptionLimits subscription={subscription} />
}
