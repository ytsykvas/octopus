import { useEffect, useRef } from 'react'

import type { AgentCommand } from '@core/chats.js'

interface CommandMenuProps {
  readonly commands: readonly AgentCommand[]
  /** Which row Enter would take. Owned by the composer, which hears the keys. */
  readonly active: number
  readonly onActive: (index: number) => void
  readonly onPick: (command: AgentCommand) => void
}

/**
 * The list of commands offered while one is being typed.
 *
 * Presentational on purpose: it listens for no keys at all. The field above it
 * does, because the field is what has focus — a textarea the user is typing
 * into cannot hand its arrow keys to a list without losing the caret, so the
 * highlight is state the composer holds and this draws.
 *
 * It opens *upwards*. The composer sits at the bottom of the window, and a
 * list dropped below it would render past the edge of the screen.
 */
export function CommandMenu({
  commands,
  active,
  onActive,
  onPick
}: CommandMenuProps): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)

  // Keeps the highlighted row in view when the arrows walk past the fold.
  // `nearest` rather than `center`, so a list that already fits does not jump.
  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div
      // `bottom-full`: see the note above. `mb-1` leaves the same gap below the
      // list that `Combobox` leaves above its own.
      className="border-line bg-canvas absolute bottom-full z-30 mb-1 w-full overflow-hidden rounded-[var(--radius-control)] border shadow-[var(--shadow-pop)]"
    >
      <div ref={list} role="listbox" className="max-h-56 overflow-auto p-1">
        {commands.map((command, index) => (
          <button
            /* The name plus its place in the list the agent reported: two
               commands can share a name, and React warned that rows sharing a
               key may be duplicated or omitted — in a list whose highlight
               Enter completes. */
            key={`${command.name}-${String(index)}`}
            type="button"
            role="option"
            aria-selected={index === active}
            // Hovering moves the highlight so the mouse and the keyboard never
            // disagree about which row Enter would take.
            onMouseEnter={() => {
              onActive(index)
            }}
            // Mouse down rather than click: the textarea keeps focus, so the
            // caret is still where it was and the next keystroke goes to the
            // field rather than nowhere.
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(command)
            }}
            className={`flex w-full items-baseline gap-2 rounded-[4px] px-2 py-1 text-left ${
              index === active ? 'bg-muted text-ink' : 'text-ink-soft'
            }`}
          >
            <span className="shrink-0 font-mono">/{command.name}</span>
            {command.argumentHint !== '' && (
              <span className="text-ink-faint shrink-0 font-mono text-[11px]">
                {command.argumentHint}
              </span>
            )}
            {command.description !== '' && (
              <span className="text-ink-faint min-w-0 flex-1 truncate text-[11px]">
                {command.description}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
