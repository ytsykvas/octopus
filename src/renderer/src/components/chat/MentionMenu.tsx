import { useEffect, useRef } from 'react'

import type { MentionFile } from '@core/fileSearch.js'

interface MentionMenuProps {
  readonly files: readonly MentionFile[]
  /** Which row Enter would take. Owned by the composer, which hears the keys. */
  readonly active: number
  readonly onActive: (index: number) => void
  readonly onPick: (file: MentionFile) => void
}

/**
 * The files offered while one is being mentioned.
 *
 * `CommandMenu`'s sibling and built the same way, for the same reasons: it
 * listens for no keys, because the textarea has the focus and cannot hand its
 * arrows to a list without losing the caret, and it opens upwards because the
 * composer sits at the bottom of the window.
 *
 * The name first and the directory after it, faint: a list of paths all
 * beginning `src/renderer/src/components/` is read from the right.
 */
export function MentionMenu({
  files,
  active,
  onActive,
  onPick
}: MentionMenuProps): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className="border-line bg-canvas absolute bottom-full z-30 mb-1 w-full overflow-hidden rounded-[var(--radius-control)] border shadow-[var(--shadow-pop)]">
      <div ref={list} role="listbox" className="max-h-56 overflow-auto p-1">
        {files.map((file, index) => {
          const slash = file.path.lastIndexOf('/')
          const directory = slash === -1 ? '' : file.path.slice(0, slash)
          const name = file.path.slice(slash + 1)

          return (
            <button
              key={file.path}
              type="button"
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => {
                onActive(index)
              }}
              // Mouse down rather than click, so the textarea keeps its focus
              // and caret — the same reason `CommandMenu` gives.
              onMouseDown={(event) => {
                event.preventDefault()
                onPick(file)
              }}
              className={`flex w-full items-baseline gap-2 rounded-[4px] px-2 py-1 text-left ${
                index === active ? 'bg-muted text-ink' : 'text-ink-soft'
              }`}
            >
              <span className="shrink-0 font-mono">{name}</span>
              {directory !== '' && (
                <span className="text-ink-faint min-w-0 flex-1 truncate text-[11px]">
                  {directory}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
