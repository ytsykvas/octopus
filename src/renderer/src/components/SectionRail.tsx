import type { LucideIcon } from 'lucide-react'

export interface RailSection<Id extends string> {
  readonly id: Id
  readonly label: string
  readonly Icon: LucideIcon
  /** Renders the entry in the danger colour — for a section that destroys. */
  readonly destructive?: boolean
}

interface SectionRailProps<Id extends string> {
  readonly sections: readonly RailSection<Id>[]
  readonly active: Id
  readonly onSelect: (id: Id) => void
}

/**
 * Navigation rail for a sectioned dialog.
 *
 * The shape macOS System Settings uses, so it is already familiar. Shared
 * between the application settings and the project dialog: two rails that
 * looked almost alike would read as two different conventions, and the
 * difference would be an accident rather than a decision.
 */
export function SectionRail<Id extends string>({
  sections,
  active,
  onSelect
}: SectionRailProps<Id>): React.JSX.Element {
  return (
    <nav className="border-line bg-surface w-44 shrink-0 border-r p-2">
      <ul className="space-y-px">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => {
                onSelect(section.id)
              }}
              aria-current={section.id === active ? 'true' : undefined}
              className={`row focus-ring flex w-full items-center gap-2 px-2 py-1.5 ${
                section.id === active
                  ? 'row-selected font-medium'
                  : section.destructive === true
                    ? 'text-danger'
                    : 'text-ink-soft'
              }`}
            >
              <section.Icon aria-hidden size={14} className="shrink-0" />
              <span className="truncate">{section.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
