import { ChevronDown } from 'lucide-react'

import { DropdownMenu } from '../DropdownMenu.js'

interface ComposerPickerOption<T extends string> {
  readonly value: T
  readonly label: string
  /** A second line, for a choice whose name does not explain itself. */
  readonly description?: string
}

interface ComposerPickerProps<T extends string> {
  /** Names the control for anything reading the screen; the row shows no labels. */
  readonly label: string
  readonly value: T
  readonly options: readonly ComposerPickerOption<T>[]
  readonly onChange: (value: T) => void
  readonly icon?: React.ReactNode
  readonly disabled?: boolean
  /** Why it is disabled, or what the current choice means. */
  readonly title?: string
  /**
   * What the trigger says, when that is not the chosen option's own label.
   *
   * The model picker needs the two to differ after a `/model` command: the menu
   * goes on marking what this chat chose, which the command did not touch,
   * while the button names the model the session moved to.
   */
  readonly display?: string
}

/**
 * One setting in the composer's control row.
 *
 * Ghost rather than `Button`: a bordered control on the composer's own surface
 * reads as a filled chip, and three of them turn the row into a toolbar
 * competing with the field above it. These sit quiet until pointed at.
 *
 * A value with no matching option shows as itself rather than as nothing. The
 * model list is remembered from the last session, so a chat can name a model
 * that list no longer has — and "the setting you chose is gone" is worse said
 * silently than said plainly.
 */
export function ComposerPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
  disabled = false,
  title,
  display
}: ComposerPickerProps<T>): React.JSX.Element {
  const current = options.find((option) => option.value === value)

  return (
    <DropdownMenu
      align="left"
      actions={options.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.description !== undefined && { description: option.description }),
        selected: option.value === value,
        onSelect: () => {
          onChange(option.value)
        }
      }))}
      trigger={({ onClick, open }) => (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          {...(title !== undefined && { title })}
          // `min-w-0` rather than `shrink-0`: with the latter the label's
          // `truncate` could never fire, since something that cannot shrink has
          // nothing to shorten — and the row it sits in ran off the edge
          // instead. The icon and the chevron keep their own `shrink-0`, so
          // what gives way is the wording.
          className={`focus-ring hover:bg-muted hover:text-ink inline-flex h-6 min-w-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-50 ${
            open ? 'bg-muted text-ink' : 'text-ink-soft'
          }`}
        >
          <span className="shrink-0">{icon}</span>
          <span className="truncate">{display ?? current?.label ?? value}</span>
          <ChevronDown aria-hidden size={11} className="shrink-0 opacity-60" />
        </button>
      )}
    />
  )
}
