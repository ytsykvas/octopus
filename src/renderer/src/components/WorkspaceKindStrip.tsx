import { useTranslation } from 'react-i18next'

import { KIND_COLORS, WORKSPACE_KINDS, type WorkspaceKind } from '@core/workspaceKinds.js'

import { DropdownMenu } from './DropdownMenu.js'

interface WorkspaceKindStripProps {
  readonly kind: WorkspaceKind
  readonly onChange: (kind: WorkspaceKind) => void
}

/**
 * The kind of work, down the left edge of a workspace card, and the way to
 * change it.
 *
 * Tinted rather than solid (§10.7): twelve solid blocks down a list read as
 * confetti, and the card's own 1px edge stays the same all round. The word
 * runs bottom to top, as a spine does, so the strip stays a strip in a narrow
 * pane. A button of its own beside the card's, not inside it — a button within
 * a button is not valid, and the card's one selects the workspace.
 */
export function WorkspaceKindStrip({ kind, onChange }: WorkspaceKindStripProps): React.JSX.Element {
  const { t } = useTranslation()
  const short = t(`workspaces.kinds.${kind}.short`)
  // Starting with the word on screen: saying what you see — "click Refact." —
  // has to find the button, and a cut word is not the full name.
  const named = t('workspaces.kindLabel', { short, kind: t(`workspaces.kinds.${kind}.label`) })

  return (
    <DropdownMenu
      align="left"
      trigger={({ onClick, open }) => (
        <button
          type="button"
          onClick={onClick}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={named}
          title={named}
          className="workspace-kind focus-ring"
          // The one dynamic value, and it still resolves to a token.
          style={{ '--kind-color': `var(--project-${KIND_COLORS[kind]})` } as React.CSSProperties}
        >
          <span aria-hidden>{short}</span>
        </button>
      )}
      actions={WORKSPACE_KINDS.map((each, index) => ({
        id: each,
        label: t(`workspaces.kinds.${each}.label`),
        selected: each === kind,
        // Said before the choice: a pushed branch keeps its name, and the
        // reader should not find that out from the branch.
        ...(index === 0 && {
          section: { title: t('workspaces.kindTitle'), note: t('workspaces.kindNote') }
        }),
        onSelect: () => {
          if (each !== kind) onChange(each)
        }
      }))}
    />
  )
}
