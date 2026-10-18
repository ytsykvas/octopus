import { colorFor } from '@core/colors.js'
import { initials } from '@core/initials.js'

import { LETTERS, TILE_WASH } from '../projectTint.js'

/**
 * A plugin's tile: two letters on a colour that follows from its id.
 *
 * Built the way a project tab is — the same palette, the same quarter of ink in
 * the letters for contrast — so a plugin reads as a thing of the same family
 * rather than as an icon from somewhere else. A plugin has no picture of its
 * own to draw, and a generic puzzle piece on every row would say nothing.
 */
export function PluginAvatar({
  id,
  name,
  size = 'md'
}: {
  readonly id: string
  readonly name: string
  readonly size?: 'md' | 'lg'
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center font-semibold ${
        size === 'lg' ? 'size-12 rounded-[12px] text-[16px]' : 'size-9 rounded-[9px] text-[13px]'
      }`}
      style={
        {
          '--project-color': `var(--project-${colorFor(id)})`,
          backgroundColor: TILE_WASH,
          color: LETTERS
        } as React.CSSProperties
      }
    >
      {initials(name)}
    </span>
  )
}
