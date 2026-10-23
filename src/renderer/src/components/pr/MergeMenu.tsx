import { GitMerge } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { MergeMethod } from '@core/pullRequests.js'

import { Button, type ButtonVariant } from '../Button.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { MERGE_METHODS } from './mergeMethods.js'

/**
 * The merge button and the menu of methods behind it.
 *
 * Shared because two places merge — the window header and the pull request
 * pane — and the two copies had already been written twice over the same list
 * of methods. Which conditions hold the button is the caller's: the header can
 * only see the checks, the pane sees conflicts and drafts as well.
 */
export function MergeMenu({
  onMerge,
  disabled,
  merging = false,
  variant
}: {
  readonly onMerge: (method: MergeMethod) => void
  readonly disabled: boolean
  /** A merge in flight, which the button says rather than only greying out. */
  readonly merging?: boolean
  readonly variant: ButtonVariant
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <DropdownMenu
      // Both places it is drawn sit at the right edge, so it opens leftwards.
      align="right"
      actions={MERGE_METHODS.map(({ method, labelKey }) => ({
        id: method,
        label: t(labelKey),
        onSelect: () => {
          onMerge(method)
        }
      }))}
      trigger={({ onClick, open }) => (
        <Button
          size="sm"
          variant={variant}
          onClick={onClick}
          aria-expanded={open}
          disabled={merging || disabled}
        >
          <GitMerge aria-hidden size={12} />
          {t(merging ? 'pullRequest.merging' : 'pullRequest.merge')}
        </Button>
      )}
    />
  )
}
